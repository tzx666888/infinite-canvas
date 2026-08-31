import axios from "axios";

import { fixedGoogleVideoResolution, googleVideoModelDisplayName, googleVideoReferenceImageLimit, googleVideoReferenceMode, normalizeGoogleVideoSeconds, supportsGoogleVideoReferenceCount } from "@/lib/video-providers/google-video";
import { videoAspectRatioForSize } from "@/lib/video-providers/shared";
import { resolveConfiguredGoogleVideoModel } from "@/lib/google-video-routing";
import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import {
    boolConfig,
    buildTokaxisSeedanceVideoPayload,
    buildSeedancePromptText,
    isSeedanceFixed720pModel,
    isSeedanceVideoConfig,
    normalizeSeedanceDuration,
    normalizeSeedanceRatio,
    normalizeSeedanceResolution,
    seedanceSupportsGeneratedAudio,
    seedanceSupportsVideoAudioReferences,
    seedanceVideoReferenceError,
    SEEDANCE_REFERENCE_LIMITS,
} from "@/lib/seedance-video";
import { buildTokaxisMiniMaxH3Payload, isMiniMaxH3VideoConfig, MINIMAX_H3_REFERENCE_LIMITS, normalizeMiniMaxH3Duration, normalizeTokaxisMiniMaxH3Model, TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID } from "@/lib/minimax-h3-video";
import { buildCompactVideoProductScalePrompt, buildVideoProductScalePrompt } from "@/lib/video-product-scale";
import { VIDEO_WORKBENCH_PROMPT_MARKER } from "@/lib/video-workbench-prompt";
import { buildApiUrl, isTokaxisProxyBaseUrl, modelOptionName, requiresClientApiKey, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { createGoogleFlowVideoTaskRequest, pollGoogleFlowVideoTaskRequest } from "@/services/api/video/google-flow-adapter";
import { createSeedanceVideoTaskRequest, pollSeedanceVideoTaskRequest } from "@/services/api/video/seedance-adapter";
import type { VideoGenerationResult, VideoGenerationTask, VideoGenerationTaskState, VideoRequestOptions } from "@/services/api/video/provider-contract";
import { facebookMediaPreset, facebookVideoSourceSize } from "@/lib/facebook-media";

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
    options?.onTaskCreated?.(task);
    return resumeVideoGenerationTask(config, task, options);
}

export async function resumeVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: VideoRequestOptions): Promise<VideoGenerationResult> {
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
    if (isMiniMaxH3VideoConfig(configuredRequest)) {
        assertVideoConfig(configuredRequest, configuredRequest.model);
        return createMiniMaxH3Task(configuredRequest, configuredModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (isSeedanceVideoConfig(configuredRequest)) {
        assertVideoConfig(configuredRequest, configuredRequest.model);
        return createSeedanceTask(configuredRequest, configuredModel, prompt, references, videoReferences, audioReferences, options);
    }
    const selectedModel = resolveConfiguredGoogleVideoModel(config, references.length);
    if (!selectedModel) throw new Error("当前令牌未开放所需的 Omni 视频模型，请先同步模型权限");
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

export async function storeGeneratedVideo(result: VideoGenerationResult, requestedSize = ""): Promise<UploadedFile> {
    const preset = facebookMediaPreset(requestedSize);
    if (preset) {
        const body = new FormData();
        body.set("preset", preset.id);
        if (result.blob) body.set("video", result.blob, "generated.mp4");
        else if (result.url) {
            const source = await fetch(result.url);
            if (!source.ok) throw new Error(`Facebook 视频尺寸转换前下载失败（${source.status}）`);
            body.set("video", await source.blob(), "generated.mp4");
        }
        else throw new Error("视频接口没有返回可播放的视频");
        const response = await fetch("/api/media/facebook-video", { method: "POST", body });
        if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
            throw new Error(payload?.error?.message || `Facebook 视频尺寸转换失败（${response.status}）`);
        }
        return uploadMediaFile(await response.blob(), "video");
    }
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
            resolution: normalizeVideoResolution(config.vquality, modelName, seconds),
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
            resolution: normalizeVideoResolution(config.vquality, modelName, seconds),
            referenceCount: requestReferences.length,
            referenceMode,
            promptLength: promptText.length,
        });
        throw new Error(errorMessage);
    }
}

export function buildReferenceVideoPrompt(
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
    const direction = canonicalizeVideoReferencePrompt(rawPrompt);
    const duration = normalizeDurationNumber(seconds);
    const promptRoute = classifyVideoPromptDetail(direction);
    const hardConstraints = buildVideoHardConstraintGuidance(direction);
    const productOnly = forbidsPeople(direction);
    const directionLimit = promptRoute === "detailed" ? 2600 : promptRoute === "medium" ? 1700 : 700;
    const userDirection = `USER DIRECTION (${promptRoute.toUpperCase()} PRIORITY): ${limitInlinePrompt(direction || "Animate the references naturally while preserving visual identity and scene continuity.", directionLimit)}`;
    const marketGuidance = buildLocalMarketVideoGuidance(direction);
    const exactLocalizedNarration = buildExactLocalizedCommerceNarration(direction, duration, promptRoute);
    const exactVisualHook = buildExactCommerceVisualHook(direction, duration, productOnly, promptRoute);
    const dramaGuidance = buildCommerceDramaVideoGuidance(direction, duration, productOnly, promptRoute, Boolean(exactVisualHook));
    if (!requestReferenceCount) {
        if (promptRoute === "detailed" || !dramaGuidance) return [rawPrompt, explicitProductScalePrompt].filter(Boolean).join("\n");
        return [
            `Create a ${duration}-second text-to-video commercial from the user direction below.`,
            exactVisualHook,
            exactLocalizedNarration,
            hardConstraints,
            userDirection,
            "No reference images are attached. Establish one clear product hero from the user's stated product, then keep its silhouette, parts, colors, logo treatment, label layout, quantity, and scale consistent across every shot. Do not silently replace it with another product.",
            explicitProductScalePrompt,
            marketGuidance,
            dramaGuidance,
            productOnly
                ? "Keep the entire video product-only. Do not invent a visible presenter, customer, body part, hand demonstration, or reaction shot. Use off-screen narration when the spoken-delivery lock is active unless the user explicitly forbids speech."
                : "Use one consistent adult presenter only when it materially helps demonstrate the product; never let the presenter replace or obscure the product hero.",
            "Use clean edited cuts, stable product geometry, physically readable motion, and one final hero frame. Do not generate storyboard panels, production notes, prompt text, reference labels, or multiple competing CTAs inside the video.",
            hardConstraints ? "FINAL CHECK: every HARD USER CONSTRAINT above must remain true in every frame." : "",
        ]
            .filter(Boolean)
            .join("\n");
    }
    if (promptRoute === "detailed") {
        return [
            `Create a ${duration}-second video using all ${requestReferenceCount} attached images as ordered references.`,
            buildReferenceLabelMap(requestReferenceCount),
            hardConstraints,
            userDirection,
            "The user supplied a complete production brief. Follow its timeline, framing, motion, text, exclusions, and reference roles exactly. Do not add a generic presenter, reaction shot, hand demonstration, dialogue, smoke, rotation, or story beat that the user did not request.",
            hardConstraints ? "FINAL CHECK: every HARD USER CONSTRAINT above must remain true in every frame." : "Do not replace or rewrite the user's complete production brief.",
        ]
            .filter(Boolean)
            .join("\n");
    }
    if (referenceMode === "i2v") {
        return [
            exactVisualHook
                ? `Create a ${duration}-second video using the attached source image as an exact product/subject identity reference, not as a mandatory literal opening frame. Establish the new hook scene below while preserving the reference identity exactly.`
                : `Create a ${duration}-second video by animating the attached source image as the exact opening frame.`,
            exactVisualHook,
            exactLocalizedNarration,
            hardConstraints,
            userDirection,
            promptRoute === "short"
                ? "Preserve the source product/subject identity, package geometry, colors, labels, quantity, scale, and orientation. Treat every product unit and every retail box as a distinct rigid body with its own closed silhouette and a visible background gap. Keep rigid objects unchanged; use plausible motion with no fusion, interpenetration, morphing, redesign, rebranding, invented text, or added/removed parts."
                : "Preserve the same subject or product identity, package geometry, colors, label placement, object count, environment, composition, and camera orientation.",
            promptRoute === "short" ? "" : "Add only physically plausible local motion. Keep faces, bodies, hands, labels, rigid objects, and background geometry stable; no morphing, redesign, rebranding, or invented label text.",
            promptRoute === "short" ? "" : "If the source image is a product/object, keep it as a rigid unchanged product. Do not elongate it, add or remove parts, alter its surface pattern, or redesign its component count while creating motion around it.",
            explicitProductScalePrompt,
            marketGuidance,
            dramaGuidance,
            !productOnly && promptRoute === "short"
                ? "If audio is generated, use one consistent voice matching the visible presenter and the user's requested language. A visible female presenter requires a female voice; never change speaker or voice gender."
                : "",
            !productOnly && promptRoute === "short"
                ? "Visible speech rule: when a visible presenter is speaking, keep the face clearly visible for the complete line and animate natural synchronized lips, jaw, cheeks, breath, and facial micro-expressions. Never add spoken dialogue over a frozen mouth, static smile, back view, or product-only close-up. Put silent detail shots between spoken lines instead."
                : "",
            hardConstraints ? "FINAL CHECK: every HARD USER CONSTRAINT above must remain true in every frame." : "",
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
        exactVisualHook,
        exactLocalizedNarration,
        referenceCountLine,
        buildReferenceLabelMap(requestReferenceCount),
        hardConstraints,
        userDirection,
        productOnly
            ? "Product-only route: use every attached product/scene reference without inventing a visible presenter, model, customer, body part, hand demonstration, or reaction shot. Use off-screen narration when the spoken-delivery lock is active unless the user explicitly forbids speech."
            : roleGuidance,
        explicitProductScalePrompt,
        marketGuidance,
        dramaGuidance,
        "Use each reference at the right story moment instead of forcing all references into every frame. Preserve exact product identity, package silhouette, label blocks, colors, object count, people, and scene logic. Never rename, translate, recolor, rebrand, or replace the product.",
        !productOnly && promptRoute === "short"
            ? "Use clean edited cuts and stable local motion. Keep normal adult proportions and one consistent presenter. No stretched torso, warped face, melted hand, extra finger, product/person hybrid, or morph between shots."
            : "Use clean edited cuts and stable local motion. Do not add subjects, actions, props, camera moves, or effects that conflict with the user direction.",
        !productOnly && promptRoute === "short" ? "If audio is generated, use one consistent presenter-matched voice. A visible female presenter requires a natural female voice; never switch to male narration or change language unexpectedly." : "",
        !productOnly && promptRoute === "short"
            ? "Visible speech rule: when a visible presenter is speaking, animate natural synchronized lips, jaw, cheeks, and facial micro-expressions. Never add spoken dialogue over a frozen mouth or static smile. Continue with presenter-matched off-screen narration during product detail shots so the spoken-delivery lock remains continuous."
            : "",
        "No storyboard artifacts: remove panel numbers, grid borders, badges, captions, arrows, labels, and sheet layout.",
        hardConstraints ? "FINAL CHECK: every HARD USER CONSTRAINT above must remain true in every frame." : "",
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

export type VideoPromptDetail = "short" | "medium" | "detailed";

export function classifyVideoPromptDetail(prompt: string): VideoPromptDetail {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    const length = [...normalized].length;
    const timelineCount = normalized.match(/(?:^|\s)\d{1,2}\s*[-–—]\s*\d{1,2}\s*(?:s|sec(?:ond)?s?|秒)\s*[:：]?/gi)?.length || 0;
    const structuredBrief = timelineCount >= 2 || (/(?:total|duration|总时长|时长)\s*[:：]?\s*\d{1,2}\s*(?:s|sec(?:ond)?s?|秒)/i.test(normalized) && /(?:front[- ]only|no rotation|do not|absolutely no|严禁|不要|不得)/i.test(normalized));
    if (length > 600 || structuredBrief) return "detailed";
    if (length > 200) return "medium";
    return "short";
}

function forbidsPeople(direction: string) {
    return /(?:不要|禁止|不得|无|不出现)[^\n。；;]{0,12}(?:人物|人像|人类|主播|模特|真人|手|嘴)|(?:no|without|exclude|avoid|do not (?:show|include|generate))\s+(?:any\s+)?(?:human(?: beings?)?|people|person|presenter|model|hands?|mouth)/i.test(direction);
}

function forbidsSpeech(direction: string) {
    return /(?:no dialogue|no voice|no speech|silent|music only|without (?:dialogue|voice|speech)|do not (?:add|include|generate) (?:dialogue|voice|speech)|不要口播|无台词|无对白|无口播|静音|只要音乐)/i.test(direction);
}

function buildVideoHardConstraintGuidance(direction: string) {
    const constraints: string[] = [];
    if (forbidsPeople(direction)) constraints.push("NO people, humans, presenters, models, faces, bodies, hands, mouths, or human silhouettes.");
    if (/(?:不要|禁止|不得|无|不出现)[^\n。；;]{0,12}(?:烟|雾|蒸汽|水蒸气)|(?:no|without|exclude|avoid|do not (?:show|include|generate))\s+(?:any\s+)?(?:smoke|vapou?r|mist|fog)/i.test(direction))
        constraints.push("NO smoke, vapor, vapour, mist, fog, steam, haze, or smoke-like effects.");
    if (/(?:front[- ]only|front face only|仅正面|只展示正面|保持正面)/i.test(direction)) constraints.push("Keep the product FRONT-ONLY and facing the camera in every product shot; never reveal its back or side.");
    if (/(?:no rotation|no spinning|no turning|do not (?:rotate|spin|turn)|不旋转|禁止旋转|不转身)/i.test(direction)) constraints.push("NO product rotation, spinning, turning around, orbiting, or back-side reveal.");
    if (forbidsSpeech(direction)) constraints.push("NO presenter dialogue, spoken lines, lip-sync, or invented voiceover.");
    return constraints.length ? `HARD USER CONSTRAINTS — higher priority than every built-in template:\n- ${constraints.join("\n- ")}` : "";
}

function buildReferenceLabelMap(requestReferenceCount: number) {
    const labels = Array.from({ length: requestReferenceCount }, (_, index) => `<IMAGE_${index + 1}> = attached reference image ${index + 1}`);
    const orderSteps = Array.from({ length: requestReferenceCount }, (_, index) => `Step ${index + 1}: execute <IMAGE_${index + 1}> first, complete its assigned subject/scene role, then continue to Step ${index + 2}.`).slice(0, -1);
    return [
        `Reference label map: ${labels.join("; ")}. User labels such as 图片1, 图1, Image 1, and <IMAGE_1> all refer to the same attached file.`,
        `REFERENCE EXECUTION ORDER — MANDATORY: process all connected references strictly in numeric order 1 → ${requestReferenceCount}.`,
        ...orderSteps,
        "Do not reorder, skip, merge, average, or reinterpret a later reference before the earlier reference role is completed.",
    ].join("\n");
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
    } else if (requestReferenceCount === 1 && /product|object|device|package|bottle|apparel|商品|产品|设备|包装|瓶|服装/i.test(direction)) {
        lines.push(
            "- The single attached image is the exact product/object identity anchor. Preserve its silhouette, proportions, visible materials, colors, markings, logo/label placement, openings, controls, and object count exactly.",
            "- Show the same product as a separate physical object throughout; never redesign, rebrand, translate, recolor, simplify, substitute, merge, duplicate, stretch, melt, or turn it into another category.",
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
    const wantsCommerce = /(带货|爆款|种草|电商|卖货|直播|commerce|ecommerce|shop|seller|viral|direct[-\s]?response|tiktok|reels|shorts)/i.test(direction);
    if (!wantsCommerce) return "";
    const explicitlyRequestsIndonesia = /(印尼|印度尼西亚|indonesia|indonesian)/i.test(direction);
    return [
        "Market routing: localize only when USER DIRECTION names a country, city, language, currency, platform, or culture; otherwise stay region-neutral.",
        explicitlyRequestsIndonesia
            ? "The user explicitly requested Indonesia: use natural everyday Bahasa Indonesia with native short-video rhythm and stress, not translated Chinese phrasing or slow delivery. Keep the product unchanged."
            : "No country is selected by default. Do not silently turn a globally neutral request into an Indonesian, American, Chinese, or other country-specific advertisement.",
        "Never translate branding or invent claims, prices, discounts, ratings, urgency, landmarks, flags, or platform badges.",
    ].join("\n");
}

function buildExactLocalizedCommerceNarration(direction: string, duration: number, promptRoute: VideoPromptDetail) {
    if (promptRoute !== "short" || forbidsSpeech(direction)) return "";
    const wantsCommerce = /(带货|爆款|种草|电商|卖货|直播|commerce|ecommerce|shop|seller|viral|direct[-\s]?response|tiktok|reels|shorts)/i.test(direction);
    if (!wantsCommerce || !/(印尼|印度尼西亚|indonesia|indonesian)/i.test(direction)) return "";
    const script =
        duration >= 15
            ? "Wah, bikin kaget. Oke, lanjut—lihat yang satu ini. Bentuknya ringkas dan mudah dibawa ke mana saja. Dari dekat, warna, bentuk, dan detail kemasannya terlihat jelas. Lihat cara pemakaiannya, cek informasi produknya, lalu pilih yang paling sesuai untuk kebutuhanmu."
            : "Wah, bikin kaget. Oke, lanjut—lihat yang ini. Bentuknya ringkas, detail kemasannya jelas, dan mudah dibawa. Cek produknya, siapa tahu cocok buat kamu.";
    return [
        "EXACT NARRATION OVERRIDE — HIGHEST PRIORITY: speak the following Bahasa Indonesia script verbatim. Do not shorten, paraphrase, translate, reorder, replace, or add any words.",
        `EXACT SCRIPT: “${script}”`,
        `Start the first audible syllable between 0.55s and 0.80s, immediately after the visual trigger begins. Use a natural native Indonesian short-video pace and continuous conversational delivery across at least ${duration >= 15 ? "12.5" : "8.0"} seconds; do not wait for the product reveal.`,
        "Use the exact script as off-screen narration during the opening visual hook. Keep every sentence intelligible. No extra efficacy, durability, safety, price, scarcity, urgency, medical, or sexual-performance claims before, during, or after the exact script.",
    ].join("\n");
}

function hasConcreteUserOpening(direction: string) {
    return /(?:0\s*[-–—]\s*\d|前\s*[一二三四五六七八九十0-9]+\s*秒|开头[^。；;]{0,48}(?:摔|跌|坠|撞|砸|爆|弹|倒|冻结|倒放|逆向|黑屏|掉落|冲入)|(?:hook|勾子)[^。；;]{0,48}(?:摔|跌|坠|撞|砸|爆|弹|倒|冻结|倒放|逆向|黑屏|掉落|冲入)|(?:stumble|fall|drop|crash|burst|freeze|reverse|black screen)[^.;]{0,48}(?:hook|opening))/i.test(direction);
}

let previousHumanCommerceHook = -1;
let previousProductOnlyCommerceHook = -1;
let humanCommerceHookBag: number[] = [];
let productOnlyCommerceHookBag: number[] = [];

function commerceHookRandom() {
    return globalThis.crypto?.getRandomValues
        ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000
        : Math.random();
}

function selectNonRepeatingHookIndex(length: number, productOnly: boolean) {
    if (length <= 1) return 0;
    let bag = productOnly ? productOnlyCommerceHookBag : humanCommerceHookBag;
    const previous = productOnly ? previousProductOnlyCommerceHook : previousHumanCommerceHook;
    if (!bag.length) {
        bag = Array.from({ length }, (_, index) => index);
        for (let index = bag.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(commerceHookRandom() * (index + 1));
            [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
        }
        if (bag[bag.length - 1] === previous) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
        if (productOnly) productOnlyCommerceHookBag = bag;
        else humanCommerceHookBag = bag;
    }
    const index = bag.pop() ?? 0;
    if (productOnly) previousProductOnlyCommerceHook = index;
    else previousHumanCommerceHook = index;
    return index;
}

function buildExactCommerceVisualHook(direction: string, duration: number, productOnly: boolean, promptRoute: VideoPromptDetail) {
    if (promptRoute !== "short") return "";
    const wantsCommerce = /(带货|爆款|种草|电商|卖货|直播|commerce|ecommerce|shop|seller|viral|direct[-\s]?response|tiktok|reels|shorts)/i.test(direction);
    if (!wantsCommerce || hasConcreteUserOpening(direction)) return "";

    const hookEnd = duration >= 8 ? 3 : 1;
    const firstBeatEnd = hookEnd >= 3 ? "0.70" : "0.20";
    const secondBeatEnd = hookEnd >= 3 ? "2.00" : "0.65";
    const hookEndLabel = hookEnd.toFixed(2);
    const cleanCutReveal = `At exactly ${hookEndLabel}s, after the complete hook payoff, use one HARD EDITORIAL CUT with zero in-between transformation frames. Only after this cut show the original referenced product unit and any referenced retail box already fully formed, upright, and separately placed on a clean hero surface. Keep a persistent visible background gap between their silhouettes; the earlier stunt parcel or prop is absent.`;
    const humanHooks = [
        `0.00-0.65s: photoreal live-action documentary style, begin inside an ordinary ongoing action in one continuous medium-wide shot: the adult is already walking naturally for two visible steps while carrying a light stack of empty shipping cartons; both feet and the complete carton stack remain visible. 0.65-1.70s: the top empty carton shifts because the stack tilts during the next step; the adult notices it late, reflexively braces the lower cartons with one forearm, and catches the top carton with the other hand. 1.70-${hookEndLabel}s: body momentum settles through one recovery step, the stack becomes stable, and the adult gives one restrained relieved breath before one motivated whip-pan. Preserve real gravity, hand contact, carton continuity, anatomy, and screen direction; no product is visible. ${cleanCutReveal}`,
        `0.00-0.65s: photoreal live-action documentary style, begin inside an ordinary ongoing action in one continuous medium-wide shot: the adult walks naturally past a counter while a harmless empty paper cup sits near its edge; both feet remain visible. 0.65-1.70s: the adult's loose sleeve lightly brushes the cup, it tips and starts to fall, and the adult reacts a fraction late to catch it just above the floor with one open hand while the other hand steadies on the counter. 1.70-${hookEndLabel}s: the adult rises through one continuous recovery movement, replaces the unchanged empty cup, gives one restrained surprised breath, and the camera follows the glance with one motivated whip-pan; no product is visible. Preserve real gravity, contact, anatomy, and object continuity. ${cleanCutReveal}`,
        `0.00-0.65s: photoreal live-action documentary style, begin inside an ordinary ongoing action in one continuous medium-wide shot: the adult turns a familiar indoor corner at a normal walking pace while an unattended lightweight empty trolley rolls slowly into the crossing path. 0.65-1.70s: the adult sees it, takes one realistic sidestep, and catches the trolley handle before contact; the trolley wheels decelerate naturally and never hit the body. 1.70-${hookEndLabel}s: momentum settles, the adult straightens the trolley, exhales with a small involuntary reaction, and the camera performs one motivated whip-pan; no product is visible. Keep both feet visible and preserve anatomy, wheel contact, inertia, and screen direction. ${cleanCutReveal}`,
        `0.00-0.65s: photoreal live-action documentary style, begin inside an ordinary ongoing action in one continuous medium-wide shot: the adult walks naturally while reading one plain paper packing list held at chest level, with the path still visible and both feet in frame. 0.65-1.70s: a mild indoor draft folds the loose paper across the adult's view; the adult startles, pauses one step, and catches the flapping sheet with both hands without colliding with anything. 1.70-${hookEndLabel}s: the paper settles, the adult gives a brief embarrassed breath and restrained glance, then the camera follows that glance with one motivated whip-pan; no product is visible. Preserve real airflow, hand contact, body balance, and continuity. ${cleanCutReveal}`,
        `0.00-0.65s: photoreal live-action documentary style, begin inside an ordinary ongoing action in one continuous full-body medium-wide shot in the reference-compatible everyday setting. The adult is already walking at a normal pace for two visible steps, eyes naturally forward, arms relaxed, and both feet fully visible; do not begin already crouched, falling, or posing. Let the two footfalls land cleanly on the first two rhythm beats. 0.65-2.20s: the rear shoe visibly contacts one loose dry paper sheet and slides forward; the planted foot loses support, the hips continue with real inertia, both arms react involuntarily, and the adult completes one genuine continuous low-energy fall onto a clearly safe padded floor, landing first through the outside thigh and open palm and then the side of the torso. Show the whole body throughout: no fake squat, kneel, jump, floating body, counter catch, instant pose reset, cutaway, or hidden landing. Synchronize the slide sound to the trigger beat and the visible body-floor contact to the strongest impact beat. 2.20-${hookEndLabel}s: keep the adult safely on the padded floor for one stunned breath and a restrained look toward the off-screen product while the camera settles from one physically motivated dip; do not unrealistically stand up before the cut. Keep anatomy, clothing, paper position, floor contact, and screen direction continuous; no pain, injury, exaggerated acting, staged smile, or product before the hard cut. On the exact next beat, execute the 3.00s reveal cut. ${cleanCutReveal}`,
    ];
    const productOnlyHooks = [
        `0.00-${firstBeatEnd}s: a tall stack of empty lightweight cartons topples toward the camera and freezes centimeters from the lens. ${firstBeatEnd}-${secondBeatEnd}s: every unchanged empty carton snaps backward in reverse and scatters safely out of frame without becoming another object. ${secondBeatEnd}-${hookEndLabel}s: one final unchanged carton rushes forward, stops one millimeter from the lens, then snaps safely away; no product is present. ${cleanCutReveal}`,
        `0.00-${firstBeatEnd}s: a sealed shipping parcel slams onto a theatrical breakaway cardboard display with a sharp impact. ${firstBeatEnd}-${secondBeatEnd}s: the same sealed rigid parcel rebounds upward against gravity while only the empty display rebuilds itself in reverse; the parcel never opens or changes shape. ${secondBeatEnd}-${hookEndLabel}s: that same parcel nearly lands, rebounds once more, and freezes for an instant at the peak before dropping out of frame; no product is visible. ${cleanCutReveal}`,
        `0.00-${firstBeatEnd}s: an enormous parcel shadow sweeps over an empty set while a tiny sealed shipping box drops into frame. ${firstBeatEnd}-${secondBeatEnd}s: the same small rigid box bounces once, remains sealed, keeps exactly the same size, and never unfolds or transforms. ${secondBeatEnd}-${hookEndLabel}s: the shadow expands again while the unchanged tiny box performs one final sharp bounce and exits; no product is visible. ${cleanCutReveal}`,
        `0.00-${firstBeatEnd}s: a fast domino chain of harmless empty props races toward an empty pedestal and stops one millimeter before impact. ${firstBeatEnd}-${secondBeatEnd}s: the unchanged props reverse at double speed and clear the empty pedestal; no product is present during this motion. ${secondBeatEnd}-${hookEndLabel}s: the last prop reverses direction twice in a rapid near-miss and shoots safely off frame, completing the payoff without a static hold. ${cleanCutReveal}`,
    ];
    const selectedHooks = productOnly ? productOnlyHooks : humanHooks;
    const hookIndex = selectNonRepeatingHookIndex(selectedHooks.length, productOnly);
    const exactTimeline = selectedHooks[hookIndex];
    return [
        `EXACT VISUAL HOOK OVERRIDE — HIGHEST VISUAL PRIORITY, MANDATORY 0-${hookEnd}s: the simple user request contains no concrete opening, so execute the following timeline exactly. It overrides every later generic hook menu but never overrides HARD USER CONSTRAINTS.`,
        `FIRST-FRAME LOCK: begin inside an already ongoing, ordinary real-world action at 0.00s with no establishing shot or presenter entrance. Show the natural cause before the surprise: normal movement may occupy only 0.00-0.65s, the physical trigger must begin by 0.65s, and the person must not start already crouched, falling, recoiling, or posing. No waving, smiling, pointing, greeting, lip-sync, or ordinary product holding.`,
        `EXACT HOOK TIMELINE: ${exactTimeline}`,
        `NATURAL CAUSALITY LOCK: use one continuous cause-and-effect chain—ordinary action, visible physical trigger, involuntary reaction, then fully motivated recovery. Real gravity, inertia, contact, anatomy, and object continuity are mandatory. Never jump directly from a neutral pose into a fall, crouch, catch, or recovery pose.`,
        `BEAT-SYNC LOCK: use four motivated edit-and-sound beats—ordinary action rhythm, physical trigger accent, reaction/payoff accent, and the strongest clean reveal hit exactly at ${hookEndLabel}s. Movement must cause the beat accents; never force body speed, physics, or pose changes merely to chase music.`,
        `HOOK ROTATION LOCK: this timeline was randomly selected from the natural hook pool for this generation. Do not replace it with the previous generation's hook or combine multiple hook incidents in one video.`,
        `REJECTION LOCK: a presenter merely entering frame or saying “wait/look” is a failed hook even if narration starts on time. Use off-screen narration during the complete 0-${hookEnd}s hook so the visual incident remains dominant.`,
        `RIGID-BODY SEPARATION LOCK — MANDATORY: product unit, bottle, cap, retail box, shipping parcel, platform, and hands are distinct rigid bodies with independent closed contours. Product and retail box must never share a mesh, surface, edge, label, or shadow and must never touch, fuse, bridge, melt, stretch, intersect, penetrate, or grow through one another. No product emerges from, grows out of, pops from, or transforms from any package. Reveal the product only after the hard cut, already complete and separated by visible background.`,
        `PRODUCT AND SAFETY LOCK: the incident may affect only harmless props and the environment. Keep the referenced product separate, rigid, unchanged, undamaged, correctly labeled, and at plausible scale. Make any slip or impact read as a harmless everyday micro-incident through normal biomechanics and an immediate safe aftermath, not through exaggerated acting; no blood, pain, injury, stairs, traffic, weapons, fire, or imitable hazard.`,
    ].join("\n");
}

function buildCommerceSpeechDensityGuidance(direction: string, duration: number, productOnly: boolean, promptRoute: VideoPromptDetail) {
    if (promptRoute !== "short" || forbidsSpeech(direction)) return "";
    const voiceMode = productOnly
        ? "Use one continuous off-screen narrator only; do not create a visible speaker, presenter, mouth, hand, or body."
        : "Use one consistent voice. Prefer off-screen narration during the expectation-breaking visual hook so the action remains dominant. If a presenter speaks after the product reveal, require natural lip-sync; continue as the same off-screen voice over product detail cuts.";
    const localSpeechRouting =
        "LOCAL SPEECH ROUTING: use the named market's natural everyday commercial language, native accent, idiom, sentence length, emphasis, pauses, and short-video speed; never translate Chinese phrasing word-for-word. An explicit language overrides the country default. With no named market, use the prompt language neutrally. Word targets are semantic equivalents adjusted to natural local pronunciation and breath.";
    const claimLock =
        "FACTUAL SCRIPT LOCK — MANDATORY: narration may use only the visible hook, readable product name/category, visibly provable size/color/package/portability/shown operation, and a neutral view-details CTA. Never invent efficacy, results, safety, price, discount, rating, guarantee, limited stock, scarcity, urgency, or medical/sexual-performance claims. Ban unsupplied phrases such as 'stok terbatas', 'rasakan khasiat/hasilnya', 'aman', 'efektif', and equivalents.";
    if (duration >= 15) {
        return [
            "SPOKEN DELIVERY LOCK — MANDATORY: write and audibly deliver 38-47 natural target-language word equivalents across the finished 15-second video.",
            claimLock,
            localSpeechRouting,
            "Speech timing: let the natural action establish first, start between 0.55s and 0.80s as the physical trigger begins; 0-3s spoken hook 6-9 words, 3-7s problem/product setup 10-12 words, 7-12s benefit or evidence 12-15 words, 12-15s CTA 8-10 words.",
            "Cover at least 12.5 seconds with intelligible speech. No silent gap may exceed 0.6s; never slow-stretch, repeat, or replace required words with music, sound effects, captions, or planning notes.",
            voiceMode,
            "The spoken hook must react to the visible expectation-breaking event; talking while normally holding the product is not a hook.",
        ].join("\n");
    }
    if (duration >= 8) {
        return [
            `SPOKEN DELIVERY LOCK — MANDATORY: write exactly four short sentences totaling 22-28 natural target-language word equivalents. Start sentence 1 between 0.55s and 0.80s as the visual trigger begins; never wait for product reveal.`,
            claimLock,
            localSpeechRouting,
            `Timing: 0-3s hook reaction 4-6 words; 3-6s product identity 6-8; 6-${Math.max(7, duration - 2)}s visible detail 6-8; ${Math.max(7, duration - 2)}-${duration}s neutral CTA 4-6.`,
            `Keep intelligible speech active across at least ${Math.max(6.5, duration - 2)} seconds. No silent gap may exceed 0.35s; never slow-stretch, rush, repeat, or replace required words with music, sound effects, captions, or planning notes.`,
            voiceMode,
            "The spoken hook must react to the visible expectation-breaking event; talking while normally holding the product is not a hook.",
        ].join("\n");
    }
    return [
        `SPOKEN DELIVERY LOCK — MANDATORY: start speaking by 0.2s and audibly deliver ${Math.max(8, Math.round(duration * 2.4))}-${Math.max(11, Math.round(duration * 3.1))} natural target-language word equivalents across this ${duration}-second commercial.`,
        claimLock,
        localSpeechRouting,
        "Keep the hook, selling point, and CTA verbally distinct with no silent gap over 0.45s; never stretch a few words or replace speech with music.",
        voiceMode,
        "The spoken hook must react to the visible expectation-breaking event; talking while normally holding the product is not a hook.",
    ].join("\n");
}

function buildCommerceDramaVideoGuidance(direction: string, duration: number, productOnly = false, promptRoute: VideoPromptDetail = "short", hasExactVisualHook = false) {
    const wantsDrama = /(微剧|短剧|剧情|反转|drama|story|storyline|scenario|skit)/i.test(direction);
    const wantsCommerce = /(带货|爆款|种草|电商|卖货|直播|commerce|ecommerce|shop|seller|viral|direct[-\s]?response|tiktok|reels|shorts)/i.test(direction);
    if (!wantsDrama && !wantsCommerce) return "";
    const hookEnd = duration >= 8 ? 3 : 1;
    const heroDuration = duration >= 15 ? 3 : duration >= 8 ? 2 : 1;
    const heroAt = Math.max(hookEnd + 1, duration - heroDuration);
    const demoAt = Math.max(hookEnd + 1, Math.min(heroAt - 1, Math.floor((hookEnd + heroAt) / 2)));
    const hookBeatPlan =
        hookEnd >= 3
            ? "Hook timing lock: 0-1s trigger the expectation break, 1-2s escalate it, and 2-3s deliver the incident payoff. At exactly 3.00s, hard-cut to the stable readable product reveal. Never show or flash the product before 3s, never cut away and back during the incident, never begin the product demonstration early, finish the hook early, or hold a static frame before 3s."
            : "Hook timing lock: trigger, escalate, and pay off the expectation break inside the first second with no static hold.";
    const lightTouch = promptRoute === "medium";
    const speechDensityGuidance = buildCommerceSpeechDensityGuidance(direction, duration, productOnly, promptRoute);
    if (productOnly) {
        return [
            `Product-only shot rhythm for a ${duration}s short commerce video:`,
            lightTouch ? "" : "SHORT-COMMERCE ACCEPTANCE LOCK: the opening fails unless BOTH the expectation-breaking visual hook and the locally natural factual narration are present on time. Never sacrifice one to satisfy the other.",
            lightTouch ? "" : "NARRATION START LOCK: begin locally natural factual narration between 0.55s and 0.80s as the visual trigger starts; never delay speech until the reveal.",
            lightTouch
                ? `- 0-${hookEnd}s: preserve the user's hook and add only a compact product-safe visual accent when needed.`
                : hasExactVisualHook
                  ? `HOOK ACCEPTANCE GATE — MANDATORY 0-${hookEnd}s: follow the earlier EXACT VISUAL HOOK OVERRIDE without substituting another idea. Ordinary product holding, a logo close-up, a slow pan or push-in, simple placement, gentle floating, or a standard demonstration DO NOT count as a hook.`
                  : `HOOK ACCEPTANCE GATE — MANDATORY 0-${hookEnd}s: start a visible expectation-breaking event within the first 0.3s and sustain a complete stop-scroll hook through ${hookEnd}s. Select exactly one product-safe structure: burst-to-reveal, scale contrast, spatial mismatch, wrong-result reversal, counter-intuitive motion, or an environmental near-miss. Ordinary product holding, a logo close-up, a slow pan or push-in, simple placement, gentle floating, or a standard demonstration DO NOT count as a hook. Reject and rewrite any opening that could be mistaken for an ordinary product demo.`,
            lightTouch ? "" : hookBeatPlan,
            speechDensityGuidance,
            `- By ${hookEnd}s: make the unchanged product unmistakably readable, then cut immediately into its benefit or demonstration.`,
            `- ${hookEnd}-${demoAt}s: clear product reveal at plausible scale while preserving exact identity and orientation.`,
            `- ${demoAt}-${heroAt}s: product benefit/detail shots using only user-approved motion and effects.`,
            `- ${heroAt}-${duration}s: final product hero and user-requested call-to-action with no person or hand.`,
            "Keep the story compressed: no dead air, no repeated holding shot, no slow establishing shot, and no beat that fails to reveal the product or advance its selling point.",
            "The hook may transform the environment but never deform, explode, rotate, relabel, duplicate, recolor, or endanger the product.",
        ].join("\n");
    }
    return [
        `Shot rhythm for a ${duration}s short commerce video:`,
        lightTouch ? "" : "SHORT-COMMERCE ACCEPTANCE LOCK: the opening fails unless BOTH the expectation-breaking visual hook and the locally natural factual narration are present on time. Never sacrifice one to satisfy the other.",
        lightTouch ? "" : "NARRATION START LOCK: begin locally natural factual narration between 0.55s and 0.80s as the visual trigger starts; never delay speech until the reveal.",
        lightTouch
            ? `- 0-${hookEnd}s: preserve the user's existing hook and add only the minimum visual clarification needed.`
            : hasExactVisualHook
              ? `HOOK ACCEPTANCE GATE — MANDATORY 0-${hookEnd}s: follow the earlier randomly selected EXACT VISUAL HOOK OVERRIDE without substituting another idea. The opening ordinary action is only causal setup: its physical surprise must begin by 0.65s and complete naturally at ${hookEnd}s. Ordinary presenter holding the product, purposeless walking, waving, smiling, lip-sync, a slow pan or push-in, tabletop placement, logo close-up, or a standard demonstration DO NOT count as a hook.`
              : `HOOK ACCEPTANCE GATE — MANDATORY 0-${hookEnd}s: begin inside one ordinary ongoing real-world action, show its cause clearly, trigger one safe expectation-breaking micro-incident by 0.65s, then sustain realistic reaction and recovery through ${hookEnd}s. Select exactly one natural structure: walking slip with visible floor cause, nearly dropped harmless object, shifting empty carton stack, rolling trolley near-miss, or windblown paper surprise. Never begin already falling or recoiling. Ordinary presenter holding the product, purposeless walking, a slow pan or push-in, tabletop placement, logo close-up, or a standard demonstration DO NOT count as a hook. Reject and rewrite any plan whose opening could be mistaken for an ordinary product demonstration.`,
        lightTouch ? "" : hookBeatPlan,
        speechDensityGuidance,
        `- By ${hookEnd}s: reveal the separate unchanged product clearly and cut immediately into the selling point.`,
        `- ${hookEnd}-${heroAt}s: show one real benefit or demonstration with rapid readable cuts; every beat must change the story or reveal useful product information.`,
        `- ${heroAt}-${duration}s: finish on the unchanged product hero and one soft call-to-action.`,
        "Keep the story compressed: no dead air, no repeated holding shot, no slow establishing shot, and no filler reaction.",
        "Safety and identity lock: falls, collision expectations, and impacts must be staged or surreal, non-graphic and injury-free; never show imitable danger. The product never causes the danger and keeps its exact silhouette, parts, colors, logo, labels, quantity, and orientation.",
        "When audio is enabled, use one rising-tension cue, one clean impact/drop accent, and one reveal accent.",
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
    const modelName = modelOptionName(model);
    assertSeedanceReferenceCounts(references, videoReferences, audioReferences);
    if (!seedanceSupportsVideoAudioReferences(modelName) && (videoReferences.length || audioReferences.length)) {
        throw new Error(`${modelName} 只支持文字和参考图，不支持参考视频或参考音频`);
    }
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const promptText = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (!promptText && (!isSeedanceFixed720pModel(modelName) || !references.length)) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");

    if (isTokaxisProxyBaseUrl(config.baseUrl)) {
        const [images, videos, audios] = await Promise.all([
            Promise.all(references.map((image) => resolveSeedanceImageUrl(config, image))),
            Promise.all(videoReferences.map(resolveSeedanceVideoUrl)),
            Promise.all(audioReferences.map(resolveSeedanceAudioUrl)),
        ]);
        const ratio = normalizeSeedanceRatio(config.size, modelName);
        const payload = buildTokaxisSeedanceVideoPayload({
            model: modelName,
            prompt: promptText,
            images,
            videos,
            audios,
            duration: config.videoSeconds,
            resolution: config.vquality,
            ratio,
            generateAudio: boolConfig(config.videoGenerateAudio, true),
            watermark: boolConfig(config.videoWatermark, false),
        });
        try {
            return await createSeedanceVideoTaskRequest({ endpoint: seedanceApiUrl(config), headers: aiHeaders(config, "application/json"), model, payload, options });
        } catch (error) {
            throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
        }
    }

    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
    const supportsGeneratedAudio = seedanceSupportsGeneratedAudio(modelName);
    const watermark = boolConfig(config.videoWatermark, false);
    const payload = {
        model: modelName,
        content,
        ratio: normalizeSeedanceRatio(config.size, modelName),
        resolution: normalizeSeedanceResolution(config.vquality, modelName),
        duration: normalizeSeedanceDuration(config.videoSeconds, modelName),
        ...(supportsGeneratedAudio ? { generate_audio: boolConfig(config.videoGenerateAudio, true) } : {}),
        ...(watermark ? { watermark: true } : {}),
    };

    try {
        return await createSeedanceVideoTaskRequest({ endpoint: seedanceApiUrl(config), headers: aiHeaders(config, "application/json"), model, payload, options });
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function createMiniMaxH3Task(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: VideoRequestOptions): Promise<VideoGenerationTask> {
    if (!isTokaxisProxyBaseUrl(config.baseUrl)) throw new Error("MiniMax H3 仅支持通过平台模型调用");
    if (videoReferences.length) throw new Error("MiniMax H3 不支持参考视频，请移除参考视频后重试");
    if (references.length > MINIMAX_H3_REFERENCE_LIMITS.images) throw new Error(`MiniMax H3 最多支持 ${MINIMAX_H3_REFERENCE_LIMITS.images} 张参考图`);
    if (audioReferences.length > MINIMAX_H3_REFERENCE_LIMITS.audios) throw new Error(`MiniMax H3 最多支持 ${MINIMAX_H3_REFERENCE_LIMITS.audios} 个参考音频`);
    if (audioReferences.length && !references.length) throw new Error("MiniMax H3 参考音频需要同时提供参考图");
    const duration = String(normalizeMiniMaxH3Duration(config.videoSeconds));
    // MiniMax H3 receives `images` as identity/reference media through the
    // platform adaptor. They are not guaranteed to be literal opening frames,
    // even when there is only one image. Route every image-backed H3 request
    // through the reference-to-video prompt so the commerce hook may establish
    // a new scene instead of being constrained to a static source frame.
    const referenceMode: ReturnType<typeof googleVideoReferenceMode> = references.length ? "r2v" : "t2v";
    const promptText = limitVideoPrompt(buildReferenceVideoPrompt(prompt, references.length, references.length, duration, config.videoProductScaleMode, referenceMode).trim());
    const [images, audios] = await Promise.all([Promise.all(references.map((image) => resolveSeedanceImageUrl(config, image))), Promise.all(audioReferences.map(resolveSeedanceAudioUrl))]);
    const payload = buildTokaxisMiniMaxH3Payload({
        model: normalizeTokaxisMiniMaxH3Model(model),
        prompt: promptText,
        images,
        audios,
        duration,
        size: config.size,
        generateAudio: boolConfig(config.videoGenerateAudio, true),
    });
    try {
        return await createSeedanceVideoTaskRequest({
            endpoint: seedanceApiUrl(config),
            headers: aiHeaders(config, "application/json"),
            model: model || TOKAXIS_MINIMAX_H3_VIDEO_MODEL_ID,
            payload,
            options,
        });
    } catch (error) {
        throw new Error(readAxiosError(error, "MiniMax H3 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: VideoRequestOptions): Promise<VideoGenerationTaskState> {
    try {
        return await pollSeedanceVideoTaskRequest({
            endpoint: seedanceApiUrl(config, task.id),
            ...(isTokaxisProxyBaseUrl(config.baseUrl) ? { contentEndpoint: aiApiUrl(config, `/videos/${encodeURIComponent(task.id)}/content`) } : {}),
            headers: aiHeaders(config),
            options,
        });
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

function assertSeedanceReferenceCounts(references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    if (references.length > SEEDANCE_REFERENCE_LIMITS.images) throw new Error(`Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.images} 张参考图`);
    if (videoReferences.length > SEEDANCE_REFERENCE_LIMITS.videos) throw new Error(`Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.videos} 个参考视频`);
    if (audioReferences.length > SEEDANCE_REFERENCE_LIMITS.audios) throw new Error(`Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.audios} 个参考音频`);
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
    if (isTokaxisProxyBaseUrl(config.baseUrl)) return buildApiUrl(config.baseUrl, `/videos/generations${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences) {
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
    value = facebookVideoSourceSize(value);
    const normalizedModel = modelOptionName(model).toLowerCase();
    if (normalizedModel.includes("portrait")) return "720x1280";
    if (normalizedModel.includes("landscape") || normalizedModel === "omni") return "1280x720";
    return videoAspectRatioForSize(value) === "9:16" ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string, model = "", duration?: string | number) {
    const fixedResolution = fixedGoogleVideoResolution(model, duration);
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
    if ((lower.includes("duration") || text.includes("时长")) && (lower.includes("limit") || lower.includes("unsupported") || lower.includes("maximum") || lower.includes("only support") || text.includes("只支持"))) {
        return "当前视频时长不受模型支持：Veo 固定 8 秒，Omni 固定 10 秒，Seedance 固定 Fast 720p 仅支持 5/10/15 秒，其他 Seedance 支持 5–15 秒整数时长";
    }
    if (lower.includes("bad request") || lower.includes("invalid") || lower.includes("unsupported")) {
        return "视频参数或参考图不被当前模型支持，请检查模型、时长、尺寸和参考图后重试";
    }
    if (lower.includes("reference") && (lower.includes("too many") || lower.includes("limit") || lower.includes("maximum"))) {
        return "参考图数量超过当前视频模型限制，请减少参考图后重试";
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
