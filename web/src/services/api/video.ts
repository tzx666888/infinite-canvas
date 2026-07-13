import axios from "axios";

import { isGrok1080pVideoModel, isGrokVideoModel, normalizeReferenceVideoSeconds, preferredGrokVideoModel, selectGrokReferenceVideoImages, supportsGrokVideoReferenceCount, videoAspectRatioForSize } from "@/lib/video-model-settings";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { buildVideoProductScalePrompt } from "@/lib/video-product-scale";
import { buildApiUrl, modelOptionName, requiresClientApiKey, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = {
    id?: string;
    request_id?: string;
    status?: string;
    error?: { message?: string } | string;
    video?: { url?: string } | null;
    content?: { video_url?: string; url?: string } | null;
    video_url?: string;
    result_url?: string;
    url?: string;
    output?: string[];
};
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; last_frame_url?: string } | null;
};
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string };
type RequestOptions = { signal?: AbortSignal };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    const apiKey = config.apiKey.trim();
    return {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    const delayMs = task.provider === "seedance" ? 5000 : 2500;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error(`${task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`);
        await delay(delayMs, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = selectGrokVideoModel(config, references.length);
    if (!selectedModel) throw new Error("视频模型只支持 Grok，请先同步模型或配置 Grok 视频模型");
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考素材");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "seedance") return pollSeedanceTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
    throw new Error("视频接口没有返回可播放的视频");
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const requestReferences = selectGrokReferenceVideoImages(references, modelName);
    if (!supportsGrokVideoReferenceCount(modelName, requestReferences.length)) {
        throw new Error(`${modelDisplayNameForError(modelName)} 需要连接 1 张参考图后再生成视频`);
    }
    const seconds = normalizeReferenceVideoSeconds(config.videoSeconds, modelName, requestReferences.length);
    if (!prompt.trim() && !requestReferences.length) throw new Error("请输入视频提示词，或连接干净关键帧/参考图后再生成视频");
    const referenceMode = grokVideoReferenceMode(modelName, requestReferences.length);
    const promptText = limitVideoPrompt(buildReferenceVideoPrompt(prompt, references.length, requestReferences.length, seconds, config.videoProductScaleMode, referenceMode).trim());

    const referenceImages = await Promise.all(requestReferences.map(async (image) => ({ url: await imageToDataUrl(image) })));
    const body = {
        model: modelName,
        prompt: promptText,
        seconds,
        duration: Number(seconds),
        aspect_ratio: videoAspectRatioForSize(config.size),
        resolution: normalizeVideoResolution(config.vquality, modelName),
        ...(referenceMode === "i2v" ? { image: referenceImages[0] } : referenceMode === "r2v" ? { reference_images: referenceImages } : {}),
    };
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos/generations"), body, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const taskId = created.id || created.request_id;
        if (!taskId) throw new Error("视频接口没有返回任务 ID");
        return { id: taskId, provider: "openai", model };
    } catch (error) {
        const errorMessage = readAxiosError(error, "视频任务创建失败");
        console.warn("[canvas-video] create task failed", {
            message: errorMessage,
            status: axios.isAxiosError(error) ? error.response?.status : undefined,
            response: axios.isAxiosError(error) ? summarizeDebugValue(error.response?.data) : undefined,
            endpoint: "/videos/generations",
            model: modelName,
            seconds,
            aspectRatio: body.aspect_ratio,
            resolution: normalizeVideoResolution(config.vquality, modelName),
            referenceCount: requestReferences.length,
            referenceMode,
            promptLength: promptText.length,
        });
        throw new Error(errorMessage);
    }
}

type GrokVideoReferenceMode = "t2v" | "i2v" | "r2v";

function grokVideoReferenceMode(model: string, referenceCount: number): GrokVideoReferenceMode {
    if (!referenceCount) return "t2v";
    if (isGrok1080pVideoModel(model)) return "i2v";
    if (modelOptionName(model) === "grok-imagine-video-1.5-preview" || referenceCount > 1) return "r2v";
    // Fast with one image is the 15-second-capable image-to-video operation.
    // The adapter must receive the explicit image field and must not infer the
    // operation from the number of references.
    return "i2v";
}

function selectGrokVideoModel(config: AiConfig, referenceImageCount: number) {
    const explicitModel = [config.videoModel, config.model].map((model) => model.trim()).find(isGrokVideoModel);
    if (explicitModel) return explicitModel;

    const candidates = [
        ...config.videoModels,
        ...config.models,
        preferredGrokVideoModel(),
        "tokaxis::grok-imagine-video-1.5-fast",
        "grok-imagine-video-1.5-fast",
    ];
    return candidates.map((model) => model.trim()).find((model) => isGrokVideoModel(model) && supportsGrokVideoReferenceCount(model, referenceImageCount)) || "";
}

function modelDisplayNameForError(model: string) {
    if (model === "grok-imagine-video-1.5-preview") return "Grok 多参考图视频";
    if (model === "grok-imagine-video-1.5-1080p") return "Grok 1080P 高清视频";
    if (model === "grok-imagine-video-1.5-fast") return "Grok 视频 1.5";
    return "当前 Grok 视频模型";
}

function buildReferenceVideoPrompt(
    prompt: string,
    originalReferenceCount: number,
    requestReferenceCount: number,
    seconds: string,
    productScaleMode = "auto",
    referenceMode: GrokVideoReferenceMode = requestReferenceCount ? "i2v" : "t2v",
) {
    const rawPrompt = prompt.trim();
    const explicitProductScalePrompt = productScaleMode !== "auto" ? buildVideoProductScalePrompt(productScaleMode) : "";
    if (!requestReferenceCount) return [rawPrompt, explicitProductScalePrompt].filter(Boolean).join("\n");
    if (rawPrompt.includes("STORYBOARD-DIRECTED VIDEO.")) return [rawPrompt, explicitProductScalePrompt].filter(Boolean).join("\n");
    const direction = canonicalizeVideoReferencePrompt(rawPrompt);
    const duration = normalizeDurationNumber(seconds);
    if (referenceMode === "i2v") {
        return [
            `Create a ${duration}-second video by animating the attached source image as the exact opening frame.`,
            "Preserve every visible identity from that source: the same adult face, hair, wardrobe, body proportions, environment, object geometry, colors, label layout, and object count.",
            "Follow the requested shot order with direct editorial cuts. Never cross-dissolve, morph, stretch, merge, or redraw a person or rigid object during a shot transition.",
            "Do not invent a person, product, package, bottle, tool, or prop unless the direction explicitly names it. Keep hands, face, neck, shoulders, torso, and limbs anatomically stable.",
            explicitProductScalePrompt,
            "Use off-screen voiceover by default. Animate visible speech only when the direction explicitly says the presenter speaks on camera.",
            `Direction: ${limitInlinePrompt(direction || "Animate the source naturally while preserving visual identity.", 2200)}`,
        ].filter(Boolean).join("\n");
    }
    const marketGuidance = buildLocalMarketVideoGuidance(direction);
    const dramaGuidance = buildCommerceDramaVideoGuidance(direction, duration);
    const referenceCountLine = originalReferenceCount > requestReferenceCount
        ? `<IMAGE_1> through <IMAGE_${requestReferenceCount}> are ordered references selected from ${originalReferenceCount} source images.`
        : `<IMAGE_1> through <IMAGE_${requestReferenceCount}> are ordered references.`;
    const roleGuidance = buildReferenceRoleGuidance(direction, requestReferenceCount);
    return [
        `Create a ${duration}-second vertical ecommerce video using all attached images in Grok reference-to-video mode.`,
        referenceCountLine,
        buildReferenceLabelMap(requestReferenceCount),
        roleGuidance,
        explicitProductScalePrompt,
        marketGuidance,
        dramaGuidance,
        "Use each reference at the right story moment instead of forcing all references into every frame. Preserve exact product identity, package silhouette, label blocks, colors, object count, people, and scene logic. Never rename, translate, recolor, rebrand, or replace the product.",
        "Use clean edited cuts and stable local motion. Keep normal adult proportions and one consistent presenter. No stretched torso, warped face, melted hand, extra finger, product/person hybrid, or morph between shots.",
        "If audio is generated, use one consistent presenter-matched voice. A visible female presenter requires a natural female voice; never switch to male narration or change language unexpectedly.",
        "Visible speech rule: when a visible presenter is speaking, animate natural synchronized lips, jaw, cheeks, and facial micro-expressions. Never add spoken dialogue over a frozen mouth or static smile. If using off-screen voiceover, keep the presenter looking/listening naturally instead of pretending to speak.",
        "No storyboard artifacts: remove panel numbers, grid borders, badges, captions, arrows, labels, and sheet layout.",
        `Direction: ${limitInlinePrompt(direction || "Animate the references naturally while preserving visual identity and scene continuity.", 2200)}`,
    ].filter(Boolean).join("\n");
}

function normalizeDurationNumber(value: string) {
    return Math.max(1, Math.floor(Number(value) || 6));
}

function canonicalizeVideoReferencePrompt(prompt: string) {
    return prompt
        .replace(/<\s*(?:IMAGE|IMG|PHOTO|PICTURE)\s*[_\-\s]?\s*([1-9]\d*)\s*>/gi, "<IMAGE_$1>")
        .replace(/@?\s*(?:图片|图像|图)\s*([1-9]\d*)/g, "<IMAGE_$1>")
        .replace(/@?\s*(?:image|img|photo|picture)\s*#?\s*([1-9]\d*)/gi, "<IMAGE_$1>")
        .replace(/@\s*(<IMAGE_\d+>)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

function buildReferenceLabelMap(requestReferenceCount: number) {
    const labels = Array.from({ length: requestReferenceCount }, (_, index) => `<IMAGE_${index + 1}> = attached reference image ${index + 1}`);
    return `Reference label map: ${labels.join("; ")}. User labels such as 图片1, 图1, Image 1, and <IMAGE_1> all refer to the same attached file.`;
}

function buildReferenceRoleGuidance(direction: string, requestReferenceCount: number) {
    const pair = inferDirectedReferencePair(direction, requestReferenceCount);
    const lines = [
        "Reference-role discipline: follow the user's explicit image-number roles instead of treating references as generic inspiration.",
    ];
    if (pair) {
        lines.push(
            `- <IMAGE_${pair.base}> is the primary scene, presenter, mood, camera angle, lighting, and opening-frame foundation.`,
            `- <IMAGE_${pair.reference}> is the required product/object identity reference. Feature it as a separate product at natural scale during reveal/demo/hero shots while preserving its geometry, colors, material, details, and object count.`,
            `- Combine <IMAGE_${pair.base}> and <IMAGE_${pair.reference}> across the video sequence, not by welding both references into every single frame.`,
        );
    } else {
        lines.push(
            "- If one reference is a person/scene and another is a product/object, combine them in the same commercial story.",
            "- Any product/object reference must appear as a recognizable hero element, not as a loose color/style hint.",
        );
    }
    lines.push(
        "- Do not turn the product/object reference into a cup, food, clothing, fingernails, body part, decoration, or oversized random prop.",
        "- Keep hands, face, body, and product as separate physical objects with believable contact, scale, and occlusion.",
    );
    return lines.join("\n");
}

function inferDirectedReferencePair(direction: string, requestReferenceCount: number) {
    const directedMatchers = [
        /<IMAGE_([1-9]\d*)>\s*(?:参考|参照|借鉴|依据|按照|根据|reference|references|refer(?:s)? to|based on|using)\s*<IMAGE_([1-9]\d*)>/i,
        /<IMAGE_([1-9]\d*)>\s*(?:带|带着|拿|拿着|手持|展示|使用|融入|融合|加入|植入|结合|搭配|with|featuring|holding|using|showing|including|include|add(?:ing)?)\s*<IMAGE_([1-9]\d*)>(?:\s*(?:产品|商品|物品|道具|object|product|item))?/i,
    ];
    const match = directedMatchers.map((matcher) => direction.match(matcher)).find(Boolean);
    if (!match) return null;
    const base = Number(match[1]);
    const reference = Number(match[2]);
    if (!Number.isFinite(base) || !Number.isFinite(reference)) return null;
    if (base < 1 || reference < 1 || base > requestReferenceCount || reference > requestReferenceCount || base === reference) return null;
    return { base, reference };
}

function buildLocalMarketVideoGuidance(direction: string) {
    const wantsIndonesia = /(印尼|印度尼西亚|indonesia|indonesian|bahasa(?: indonesia)?|jakarta|shopee|tokopedia|tiktok\s*shop)/i.test(direction);
    const wantsCommerce = /(带货|爆款|种草|电商|卖货|直播|commerce|ecommerce|shop|seller|viral|direct[-\s]?response|tiktok|reels|shorts)/i.test(direction);
    const lines: string[] = [];
    if (wantsIndonesia) {
        lines.push("Local market: make the video feel like an Indonesian social-commerce ad. If voice or on-screen text is generated, use natural Bahasa Indonesia and Southeast Asian ecommerce rhythm unless the product branding itself uses another language.");
    }
    if (wantsCommerce) {
        lines.push("Commerce structure: strong hook in the first 1-2 seconds, immediate product visibility, quick benefit/demo moment, believable use case, final product hero and soft call-to-action. Do not invent unsafe claims, fake prices, or fake platform badges.");
    }
    return lines.join("\n");
}

function buildCommerceDramaVideoGuidance(direction: string, duration: number) {
    const wantsDrama = /(微剧|短剧|剧情|反转|drama|story|storyline|scenario|skit)/i.test(direction);
    const wantsCommerce = /(带货|爆款|种草|电商|卖货|直播|commerce|ecommerce|shop|seller|viral|direct[-\s]?response|tiktok|reels|shorts)/i.test(direction);
    if (!wantsDrama && !wantsCommerce) return "";
    const revealAt = Math.max(1, Math.min(3, Math.floor(duration * 0.25)));
    const demoAt = Math.max(revealAt + 1, Math.min(duration - 2, Math.floor(duration * 0.55)));
    const heroAt = Math.max(demoAt + 1, Math.max(1, duration - 2));
    return [
        `Shot rhythm for a ${duration}s short commerce video:`,
        `- 0-${revealAt}s: mini-drama hook from the primary scene/person reference; show a relatable reaction, curiosity moment, or short presenter line with visible natural lip-sync, not a static product pose.`,
        `- ${revealAt}-${demoAt}s: product reveal from the product reference as its own object at plausible scale; keep the object separate from hands and body.`,
        `- ${demoAt}-${heroAt}s: quick benefit/demo close-ups with clean cuts; use motion that makes the product desirable without changing its shape.`,
        `- ${heroAt}-${duration}s: result/reaction plus product hero shot and soft call-to-action; if the presenter speaks, lips must move naturally in sync.`,
    ].join("\n");
}

function limitVideoPrompt(value: string, maxChars = 3600) {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars - 96).trim()}\nKeep all constraints above; omit minor details rather than exceeding the model prompt limit.`;
}

function limitInlinePrompt(value: string, maxChars: number) {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars - 32).trim()}...`;
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        if (video.status === "completed" || video.status === "succeeded" || video.status === "done" || video.status === "success" || video.status === "finished") {
            const url = firstVideoUrl(video.video_url, video.result_url, video.url, video.output, video.content?.video_url, video.content?.url, video.video?.url);
            if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled" || video.status === "expired") return { status: "failed", error: readProviderTaskError(video.error, "视频生成失败") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const payload = {
        model: modelOptionName(model),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality, modelOptionName(model)),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    try {
        const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
        if (state.status === "succeeded") {
            const url = state.content?.video_url;
            if (!url) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
            return { status: "completed", result: await videoResultFromUrl(url, options) };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: state.error?.message || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、素材 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、素材 ID，或本地已保存的音频");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    if (!isProtectedVideoContentUrl(url)) return { url, mimeType: "video/mp4" };
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (requiresClientApiKey(config.baseUrl) && !config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

function normalizeVideoResolution(value: string, model = "") {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    if (resolution === "1080" && !isGrok1080pVideoModel(model)) return "720p";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(payload.msg || payload.message || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string } | string; msg?: string; message?: string; code?: number | string }>(error)) {
        if (error.response?.status === 502) return statusMessage(502, fallback);
        const responseData = error.response?.data;
        const providerMessage = typeof responseData === "string" ? responseData : responseData?.msg || responseData?.message || readProviderTaskError(responseData?.error, "");
        return providerMessage ? normalizeVideoProviderError(providerMessage, fallback) : statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? normalizeVideoProviderError(error.message, fallback) : fallback;
}

function summarizeDebugValue(value: unknown) {
    if (value == null) return "";
    if (typeof value === "string") return limitInlinePrompt(value, 700);
    try {
        return limitInlinePrompt(JSON.stringify(value), 700);
    } catch {
        return String(value);
    }
}

function readProviderTaskError(error: SeedanceTask["error"] | VideoResponse["error"] | string | undefined, fallback: string) {
    if (!error) return fallback;
    if (typeof error === "string") return error || fallback;
    return error.message || fallback;
}

function firstVideoUrl(...values: Array<string | string[] | undefined>) {
    let fallback = "";
    for (const value of values) {
        const url = firstHttpUrl(value);
        if (!url) continue;
        if (!isProtectedVideoContentUrl(url)) return url;
        fallback ||= url;
    }
    return fallback;
}

function firstHttpUrl(value: string | string[] | undefined): string {
    if (typeof value === "string") return /^https?:\/\//i.test(value.trim()) ? value.trim() : "";
    if (Array.isArray(value)) return value.map(firstHttpUrl).find(Boolean) || "";
    return "";
}

function isProtectedVideoContentUrl(value: string) {
    try {
        return /\/v1\/videos\/[^/]+\/content$/.test(new URL(value).pathname);
    } catch {
        return false;
    }
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    if (status === 502) return "视频上游暂时不可用，或当前模型参数不受支持，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

function normalizeVideoProviderError(message: string, fallback: string) {
    const text = message.trim();
    const lower = text.toLowerCase();
    if (
        lower.includes("grok_video_channel_unavailable") ||
        lower.includes("model_cooldown") ||
        lower.includes("resource-exhausted") ||
        lower.includes("requests per minute") ||
        lower.includes("当前分组上游负载已饱和")
    ) {
        return "Grok 视频通道当前没有可用额度或正在冷却，请更换可用 Grok 视频通道后再试";
    }
    if (lower.includes("not_found") || lower.includes("generation_not_found") || lower.includes("not found")) {
        return "视频上游没有找到生成结果，通常是模型参数或参考图不受支持，请换用干净关键帧/其他视频模型后重试";
    }
    if (lower.includes("bad request") || lower.includes("invalid") || lower.includes("unsupported")) {
        return "视频参数或参考图不被当前模型支持，请检查模型、时长、尺寸和参考图后重试";
    }
    if (lower.includes("reference") && (lower.includes("too many") || lower.includes("limit") || lower.includes("maximum"))) {
        return "参考图数量超过当前视频模型限制，请减少参考图后重试";
    }
    if (lower.includes("duration") && (lower.includes("limit") || lower.includes("unsupported") || lower.includes("maximum"))) {
        return "Grok 多参考图视频最长支持 10 秒；单图或纯文字视频可按模型选项生成";
    }
    return text || fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
    const providerMessage = payload.msg || payload.error?.message;
    if (providerMessage) throw new Error(normalizeVideoProviderError(providerMessage, "视频下载失败"));
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地素材失败"));
        reader.readAsDataURL(blob);
    });
}
