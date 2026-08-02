import axios from "axios";

import { fixedGoogleVideoResolution, googleVideoModelDisplayName, googleVideoReferenceImageLimit, googleVideoReferenceMode, normalizeGoogleVideoSeconds, supportsGoogleVideoReferenceCount } from "@/lib/video-providers/google-video";
import { videoAspectRatioForSize } from "@/lib/video-providers/shared";
import { resolveConfiguredGoogleVideoModel } from "@/lib/google-video-routing";
import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { buildCompactVideoProductScalePrompt, buildVideoProductScalePrompt } from "@/lib/video-product-scale";
import { VIDEO_WORKBENCH_PROMPT_MARKER } from "@/lib/video-workbench-prompt";
import { buildApiUrl, modelOptionName, requiresClientApiKey, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { createGoogleFlowVideoTaskRequest, pollGoogleFlowVideoTaskRequest } from "@/services/api/video/google-flow-adapter";
import { createSeedanceVideoTaskRequest, pollSeedanceVideoTaskRequest } from "@/services/api/video/seedance-adapter";
import type { VideoGenerationResult, VideoGenerationTask, VideoGenerationTaskState, VideoRequestOptions } from "@/services/api/video/provider-contract";

export type { VideoGenerationResult, VideoGenerationTask, VideoGenerationTaskState } from "@/services/api/video/provider-contract";

const OPENAI_VIDEO_POLL_MAX_ATTEMPTS = 240;
const SEEDANCE_VIDEO_POLL_MAX_ATTEMPTS = 120;
const VIDEO_POLL_TRANSIENT_RETRY_LIMIT = 12;

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

export async function requestVideoGeneration(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    videoReferences: ReferenceVideo[] = [],
    audioReferences: ReferenceAudio[] = [],
    options?: VideoRequestOptions,
): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    const delayMs = task.provider === "seedance" ? 5000 : 2500;
    const maxAttempts = task.provider === "seedance" ? SEEDANCE_VIDEO_POLL_MAX_ATTEMPTS : OPENAI_VIDEO_POLL_MAX_ATTEMPTS;
    let transientFailures = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        let state: VideoGenerationTaskState;
        try {
            state = await pollVideoGenerationTask(config, task, options);
            transientFailures = 0;
        } catch (error) {
            if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            if (!isRetryableVideoPollError(error) || transientFailures >= VIDEO_POLL_TRANSIENT_RETRY_LIMIT) throw error;
            transientFailures += 1;
            await delay(delayMs, options?.signal);
            continue;
        }
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === maxAttempts - 1) throw new Error(`${task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`);
        await delay(delayMs, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export async function createVideoGenerationTask(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    videoReferences: ReferenceVideo[] = [],
    audioReferences: ReferenceAudio[] = [],
    options?: VideoRequestOptions,
): Promise<VideoGenerationTask> {
    const configuredModel = (config.videoModel || config.model).trim();
    const configuredRequest = resolveModelRequestConfig(config, configuredModel);
    if (isSeedanceVideoConfig(configuredRequest)) {
        assertVideoConfig(configuredRequest, configuredRequest.model);
        return createSeedanceTask(configuredRequest, configuredModel, prompt, references, videoReferences, audioReferences, options);
    }
    const selectedModel = resolveConfiguredGoogleVideoModel(config, references.length);
    if (!selectedModel) throw new Error("当前令牌未开放 Google 视频模型，请先同步 Veo / Omni 模型");
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考素材");
    }
    return createFlowVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: VideoRequestOptions): Promise<VideoGenerationTaskState> {
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

async function createFlowVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoRequestOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    if (!supportsGoogleVideoReferenceCount(modelName, references.length)) {
        const limit = googleVideoReferenceImageLimit(modelName);
        if (references.length > limit) {
            throw new Error(`${googleVideoModelDisplayName(modelName)}最多支持 ${limit} 张参考图，请移除多余图片后重试`);
        }
        const mode = googleVideoReferenceMode(modelName, references.length);
        throw new Error(mode === "i2v" ? `${googleVideoModelDisplayName(modelName)} 需要连接 1–2 张参考图` : `${googleVideoModelDisplayName(modelName)} 需要连接 1–3 张参考图`);
    }
    const requestReferences = references;
    const seconds = normalizeGoogleVideoSeconds(config.videoSeconds, modelName);
    if (!prompt.trim() && !requestReferences.length) throw new Error("请输入视频提示词，或连接干净关键帧/参考图后再生成视频");
    const referenceMode = googleVideoReferenceMode(modelName, requestReferences.length);
    const promptText = limitVideoPrompt(buildReferenceVideoPrompt(prompt, references.length, requestReferences.length, seconds, config.videoProductScaleMode, referenceMode).trim());

    const files = await Promise.all(
        requestReferences.map(async (image, index) => {
            const dataUrl = await imageToDataUrl(image);
            if (!dataUrl) throw new Error(`参考图 ${index + 1} 读取失败，请移除后重新上传`);
            return dataUrlToFile({ ...image, dataUrl });
        }),
    );
    try {
        return await createGoogleFlowVideoTaskRequest({
            endpoint: aiApiUrl(config, "/videos"),
            headers: aiHeaders(config),
            model: modelName,
            taskModel: model,
            prompt: promptText,
            seconds,
            size: normalizeFlowVideoSize(config.size, modelName),
            resolution: normalizeVideoResolution(config.vquality, modelName),
            files,
            options,
        });
    } catch (error) {
        const errorMessage = readAxiosError(error, "视频任务创建失败");
        console.warn("[canvas-video] create task failed", {
            message: errorMessage,
            status: axios.isAxiosError(error) ? error.response?.status : undefined,
            response: axios.isAxiosError(error) ? summarizeDebugValue(error.response?.data) : undefined,
            endpoint: "/videos",
            model: modelName,
            seconds,
            size: normalizeFlowVideoSize(config.size, modelName),
            resolution: normalizeVideoResolution(config.vquality, modelName),
            referenceCount: requestReferences.length,
            referenceMode,
            promptLength: promptText.length,
        });
        throw new Error(errorMessage);
    }
}

function buildReferenceVideoPrompt(
    prompt: string,
    originalReferenceCount: number,
    requestReferenceCount: number,
    seconds: string,
    productScaleMode = "auto",
    referenceMode: ReturnType<typeof googleVideoReferenceMode> = requestReferenceCount ? "i2v" : "t2v",
) {
    const rawPrompt = prompt.trim();
    if (isCompiledVideoPrompt(rawPrompt)) return [rawPrompt, buildCompactVideoProductScalePrompt(productScaleMode)].filter(Boolean).join("\n");
    const explicitProductScalePrompt = productScaleMode !== "auto" ? buildVideoProductScalePrompt(productScaleMode) : "";
    if (!requestReferenceCount) return [rawPrompt, explicitProductScalePrompt].filter(Boolean).join("\n");
    const direction = canonicalizeVideoReferencePrompt(rawPrompt);
    const duration = normalizeDurationNumber(seconds);
    const marketGuidance = buildLocalMarketVideoGuidance(direction);
    const dramaGuidance = buildCommerceDramaVideoGuidance(direction, duration);
    if (referenceMode === "i2v") {
        return [
            `Create a ${duration}-second video by animating the attached source image as the exact opening frame.`,
            "Preserve the same subject or product identity, package geometry, colors, label placement, object count, environment, composition, and camera orientation.",
            "Add only physically plausible local motion. Keep faces, bodies, hands, labels, rigid objects, and background geometry stable; no morphing, redesign, rebranding, or invented label text.",
            "If the source image is a product/object, keep it as a rigid unchanged product. Do not elongate it, add or remove parts, alter its surface pattern, or redesign its component count while creating motion around it.",
            explicitProductScalePrompt,
            marketGuidance,
            dramaGuidance,
            "If audio is generated, use one consistent voice matching the visible presenter and the user's requested language. A visible female presenter requires a female voice; never change speaker or voice gender.",
            "Visible speech rule: when a visible presenter is speaking, keep the face clearly visible for the complete line and animate natural synchronized lips, jaw, cheeks, breath, and facial micro-expressions. Never add spoken dialogue over a frozen mouth, static smile, back view, or product-only close-up. Put silent detail shots between spoken lines instead.",
            `Direction: ${limitInlinePrompt(direction || "Animate the source naturally while preserving visual identity.", 2200)}`,
        ]
            .filter(Boolean)
            .join("\n");
    }
    const referenceCountLine =
        originalReferenceCount > requestReferenceCount
            ? `<IMAGE_1> through <IMAGE_${requestReferenceCount}> are ordered references selected from ${originalReferenceCount} source images.`
            : `<IMAGE_1> through <IMAGE_${requestReferenceCount}> are ordered references.`;
    const roleGuidance = buildReferenceRoleGuidance(direction, requestReferenceCount);
    return [
        `Create a ${duration}-second ecommerce video using all attached images as distinct ordered references.`,
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
    ]
        .filter(Boolean)
        .join("\n");
}

function isCompiledVideoPrompt(prompt: string) {
    return prompt.includes("STORYBOARD-DIRECTED VIDEO.") || prompt.includes(VIDEO_WORKBENCH_PROMPT_MARKER) || prompt.includes("PRODUCT-LOCKED KEYFRAME VIDEO.");
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
    const lines = ["Reference-role discipline: follow the user's explicit image-number roles instead of treating references as generic inspiration."];
    if (pair) {
        lines.push(
            `- <IMAGE_${pair.base}> is the primary scene, presenter, mood, camera angle, lighting, and opening-frame foundation.`,
            `- <IMAGE_${pair.reference}> is the required product/object identity reference. Feature it as a separate product at natural scale during reveal/demo/hero shots while preserving its geometry, colors, material, details, and object count.`,
            `- Combine <IMAGE_${pair.base}> and <IMAGE_${pair.reference}> across the video sequence, not by welding both references into every single frame.`,
        );
    } else {
        lines.push("- If one reference is a person/scene and another is a product/object, combine them in the same commercial story.", "- Any product/object reference must appear as a recognizable hero element, not as a loose color/style hint.");
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
        lines.push(
            "Local market: make the video feel like an Indonesian social-commerce ad. If voice or on-screen text is generated, use natural Bahasa Indonesia and Southeast Asian ecommerce rhythm unless the product branding itself uses another language.",
        );
    }
    if (wantsCommerce) {
        lines.push(
            "Commerce structure: strong hook in the first 1-2 seconds, immediate product visibility, quick benefit/demo moment, believable use case, final product hero and soft call-to-action. Do not invent unsafe claims, fake prices, or fake platform badges.",
        );
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

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: VideoRequestOptions): Promise<VideoGenerationTaskState> {
    try {
        return await pollGoogleFlowVideoTaskRequest({ endpoint: aiApiUrl(config, `/videos/${task.id}`), contentEndpoint: aiApiUrl(config, `/videos/${task.id}/content`), headers: aiHeaders(config), options });
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: VideoRequestOptions): Promise<VideoGenerationTask> {
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
        return await createSeedanceVideoTaskRequest({ endpoint: seedanceApiUrl(config), headers: aiHeaders(config, "application/json"), model, payload, options });
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: VideoRequestOptions): Promise<VideoGenerationTaskState> {
    try {
        return await pollSeedanceVideoTaskRequest({ endpoint: seedanceApiUrl(config, task.id), headers: aiHeaders(config), options });
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

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (requiresClientApiKey(config.baseUrl) && !config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

function normalizeFlowVideoSize(value: string, model: string) {
    const normalizedModel = modelOptionName(model).toLowerCase();
    if (normalizedModel.includes("portrait")) return "720x1280";
    if (normalizedModel.includes("landscape") || normalizedModel === "omni") return "1280x720";
    return videoAspectRatioForSize(value) === "9:16" ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string, model = "") {
    const fixedResolution = fixedGoogleVideoResolution(model);
    if (fixedResolution) return `${fixedResolution}p`;
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
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

function readProviderTaskError(error: { message?: string } | string | undefined, fallback: string) {
    if (!error) return fallback;
    if (typeof error === "string") return error || fallback;
    return error.message || fallback;
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
    if (lower.includes("grok_video_channel_unavailable") || lower.includes("model_cooldown") || lower.includes("resource-exhausted") || lower.includes("requests per minute") || lower.includes("当前分组上游负载已饱和")) {
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
        return "当前视频时长不受模型支持：Veo 智能生成支持 4、6、8 秒，多参考固定 8 秒，Omni 固定 10 秒";
    }
    return text || fallback;
}

function isRetryableVideoPollError(error: unknown) {
    const text = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
    return /视频任务查询失败|timeout|timed out|network|failed to fetch|load failed|connection|socket|gateway|upstream|暂时不可用|限流|429|502|503|504/.test(text);
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
