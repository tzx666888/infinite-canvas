import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import type { ReferenceImage } from "@/types/image";
import type { CanvasNodeData, CanvasNodeMetadata, CanvasConnection, CanvasImageGenerationType, CanvasAssistantSession } from "../types";
import { CanvasNodeType } from "../types";
import { splitDataUrl, cropDataUrl } from "./canvas-image-data";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { modelMatchesCapability } from "@/stores/use-config-store";
import { normalizeModelVideoSeconds } from "@/lib/video-model-settings";
import { NODE_DEFAULT_SIZE } from "../constants";
import type { NodeGenerationInput } from "../components/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { uploadImage, imageToDataUrl } from "@/services/image-storage";
import { defaultConfig } from "@/stores/use-config-store";
import { nodeSizeFromRatio } from "./canvas-node-size";
import { getGenerationResourceNodes } from "./canvas-resource-references";
import type { ConnectionHandle } from "../types";
import type { CanvasImageAngleParams } from "../components/canvas-node-angle-dialog";


export const STORYBOARD_REVIEW_COLUMNS = 3;
export const STORYBOARD_REVIEW_ROWS = 4;
export const STORYBOARD_REVIEW_PANEL_COUNT = STORYBOARD_REVIEW_COLUMNS * STORYBOARD_REVIEW_ROWS;
export const STORYBOARD_VIDEO_FRAME_CROP = { x: 0.14, y: 0.055, width: 0.82, height: 0.88 };
export const NODE_STATUS_LOADING = "loading" as const;
export const NODE_STATUS_SUCCESS = "success" as const;
export const NODE_STATUS_ERROR = "error" as const;
export const NODE_STATUS_IDLE = "idle" as const;
export const VIDEO_NODE_MAX_WIDTH = 420;
export const VIDEO_NODE_MAX_HEIGHT = 420;
export const STORYBOARD_REVIEW_NODE_MAX_WIDTH = 420;
export const STORYBOARD_REVIEW_NODE_MAX_HEIGHT = 720;
export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

export function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

export function resolveMaskEditRequestSize(node: CanvasNodeData) {
    const sizeMatch = node.metadata?.size?.match(/^(\d+)x(\d+)$/i);
    const width = node.metadata?.naturalWidth || (sizeMatch ? Number(sizeMatch[1]) : 1024);
    const height = node.metadata?.naturalHeight || (sizeMatch ? Number(sizeMatch[2]) : 1024);
    return resolveMaskEditRequestSizeFromDimensions(width, height);
}

export function resolveMaskEditRequestSizeFromDimensions(width: number, height: number) {
    const longEdge = Math.max(width, height);
    const minimumPixelScale = Math.sqrt(655360 / Math.max(1, width * height)) * 1.01;
    const scale = Math.min(2048 / longEdge, Math.max(1, minimumPixelScale));
    return `${alignImageRequestDimension(width * scale)}x${alignImageRequestDimension(height * scale)}`;
}

export function alignImageRequestDimension(value: number) {
    return Math.max(16, Math.ceil(value / 16) * 16);
}

export function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

export function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function resolveMetadataEditMask(url: string): Promise<ReferenceImage | undefined> {
    const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
    if (!dataUrl) return undefined;
    return {
        id: "edit-mask",
        name: "mask.png",
        type: "image/png",
        dataUrl,
        storageKey: url.startsWith("image:") ? url : undefined,
    };
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !content) return node;
            if (node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content) } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>) {
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            for (;;) {
                const index = nextIndex++;
                if (index >= items.length) return;
                await task(items[index], index);
            }
        }),
    );
}

export function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

export function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    const configuredModel = node?.metadata?.model;
    const resolvedModel = configuredModel && modelMatchesCapability(configuredModel, mode) ? configuredModel : defaultModel || (mode === "audio" ? defaultConfig.audioModel : config.model || defaultConfig.model);
    const resolvedVideoSeconds = node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds;
    return {
        ...config,
        model: resolvedModel,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        videoSeconds: resolvedVideoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => (node.metadata?.status === "loading" ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } } : node));
}

export function restoreLegacySceneExpansionBatches(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    let nextNodes = nodes;
    let nextConnections = connections;

    nodes.forEach((analysisNode) => {
        if (analysisNode.type !== CanvasNodeType.Text || !analysisNode.metadata?.sceneExpansion) return;
        const outgoing = connections.filter((connection) => connection.fromNodeId === analysisNode.id);
        const sceneNodes = outgoing
            .map((connection) => nodes.find((node) => node.id === connection.toNodeId))
            .filter((node): node is CanvasNodeData => Boolean(node?.type === CanvasNodeType.Image && node.metadata?.sceneExpansion && !node.metadata?.batchRootId && !node.metadata?.isBatchRoot));
        if (sceneNodes.length < 2) return;

        const [root, ...children] = sceneNodes;
        const childIds = children.map((node) => node.id);
        nextNodes = nextNodes.map((node) => {
            if (node.id === root.id) {
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        isBatchRoot: true,
                        batchChildIds: childIds,
                        batchUsesReferenceImages: true,
                        imageBatchExpanded: true,
                        count: sceneNodes.length,
                    },
                };
            }
            if (childIds.includes(node.id)) return { ...node, metadata: { ...node.metadata, batchRootId: root.id } };
            return node;
        });
        nextConnections = nextConnections.map((connection) => (childIds.includes(connection.toNodeId) && connection.fromNodeId === analysisNode.id ? { ...connection, fromNodeId: root.id } : connection));
    });

    return { nodes: nextNodes, connections: nextConnections };
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export async function storyboardReviewSheetReferenceFrames(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const node = nodes.find((item) => item.id === nodeId);
    const reviewSheets = [
        ...(node && isStoryboardReviewSheetNode(node) ? [node] : []),
        ...getGenerationResourceNodes(nodeId, nodes, connections).filter(isStoryboardReviewSheetNode),
    ];
    const frameGroups = await Promise.all(reviewSheets.map((item) => splitStoryboardReviewSheetNode(item)));
    return mergeReferenceImages(...frameGroups);
}

export function isStoryboardReviewSheetNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image && node.metadata?.storyboardRole === "review-sheet";
}

export async function splitStoryboardReviewSheetNode(node: CanvasNodeData): Promise<ReferenceImage[]> {
    const [reference] = sourceNodeReferenceImages(node);
    if (!reference) return [];
    const dataUrl = await imageToDataUrl(reference);
    if (!dataUrl) return [];
    try {
        const pieces = await splitDataUrl(dataUrl, { rows: STORYBOARD_REVIEW_ROWS, columns: STORYBOARD_REVIEW_COLUMNS });
        return Promise.all(
            pieces.slice(0, STORYBOARD_REVIEW_PANEL_COUNT).map(async (piece, index) => ({
                id: `${reference.id}-storyboard-frame-${index + 1}`,
                name: `${node.title || reference.id}-frame-${String(index + 1).padStart(2, "0")}.png`,
                type: "image/png",
                dataUrl: await cropStoryboardVideoFrame(piece.dataUrl),
            })),
        );
    } catch {
        return [reference];
    }
}

export async function cropStoryboardVideoFrame(dataUrl: string) {
    try {
        return await cropDataUrl(dataUrl, STORYBOARD_VIDEO_FRAME_CROP);
    } catch {
        return dataUrl;
    }
}

export function buildStoryboardReviewSheetVideoPrompt(prompt: string, storyboardReferenceCount: number, videoSeconds = "15") {
    const text = normalizeVideoGenerationPrompt(prompt);
    if (!storyboardReferenceCount) return text;
    const duration = normalizeStoryboardVideoSeconds(videoSeconds);
    const perReferenceSeconds = formatStoryboardSeconds(duration / Math.max(1, Math.min(STORYBOARD_REVIEW_PANEL_COUNT, storyboardReferenceCount)));
    const maxLingerSeconds = formatStoryboardSeconds(Math.max(duration / Math.max(1, storyboardReferenceCount), duration / 10));
    if (storyboardReferenceCount >= STORYBOARD_REVIEW_PANEL_COUNT) {
        return [
            compactStoryboardVideoPrompt(text, duration),
            `Create a ${duration}-second vertical direct-response ecommerce video with a viral commerce structure. Map the storyboard by percentage, not fixed seconds: 0-20% exaggerated but believable hook/problem, 20-35% product-as-rescue reveal, 35-70% hands-on demonstration and proof, 70-87% contrast result and reassurance, 87-100% final product hero and purchase-intent beat.`,
            `The ${STORYBOARD_REVIEW_PANEL_COUNT} supplied reference images are the exact storyboard timeline in order: reference image 1 is the opening shot, reference image ${STORYBOARD_REVIEW_PANEL_COUNT} is the final shot.`,
            `Follow reference images sequentially from 1 to 12, using each reference as one short beat of about ${perReferenceSeconds} seconds. Anchor every shot to the corresponding reference beat; do not generate an unrelated autonomous video. Do not linger on any single reference for more than about ${maxLingerSeconds} seconds, do not loop the opening shot, and do not skip directly from hook to final product shot.`,
            "Use clean edited shot cuts between different subjects, angles, or camera distances. Do not morph, cross-dissolve, or interpolate human faces, hands, bodies, product bottles, and stove surfaces into one another.",
            "When a person appears in only some references, use that person as a short reaction or approval cutaway only. Do not carry the person through product-only, surface-only, or packshot beats, and never transform a person into a product or background.",
            "Inside each shot, keep motion local and physically stable: facial features stay anatomically correct, hands keep the right number of fingers, the product label stays attached to the bottle, and the stove geometry remains rigid.",
            "Ignore and remove all storyboard artifacts from the references: no corner numbers, panel labels, borders, black badges, grid lines, captions, or sheet layout may appear in the video.",
            "Keep the first second thumb-stopping when the references support it: startled reaction, sudden mess, visible pain point, product pushed toward camera, or urgent camera push-in. Make it dramatic but believable.",
            "Keep the product visible in the opening third, middle proof section, and final hero shot, but avoid endless bottle close-ups. Do not spend the whole video on repetitive wiping, spraying, or generic motion.",
            "For cleaning or problem-solution products, the final 13% of the video must resolve the visual problem: show the cleaned or improved result behind a clear product packshot. If an earlier reference still shows dirt or mess, treat it as before-state context, not the final outcome.",
            "Do not add fake prices, fake discounts, endorsements, certifications, exaggerated claims, warped people, distorted faces, extra fingers, melted hands, or product/person hybrids.",
            "Render only clean full-frame video shots with no panel numbers, grid borders, labels, arrows, captions, watermarks, or storyboard sheet layout.",
        ].join("\n");
    }
    return [
        compactStoryboardVideoPrompt(text, duration),
        `Create a ${duration}-second vertical direct-response ecommerce video: exaggerated first-second hook, fast product rescue reveal, believable action/proof, contrast result, then final product hero and purchase-intent beat.`,
        "The supplied storyboard frame references are mandatory shot-order guidance. Interpret the references as sequential beats and recreate them as clean full-frame video shots.",
        "Use clean cuts between different shots. Do not morph human faces, hands, bodies, products, or backgrounds between references; if people appear only in some shots, keep them as brief reaction cutaways.",
        "Render only clean full-frame shots; omit visible grid layout, panel borders, panel numbers, labels, arrows, captions, collage format, and storyboard sheet presentation.",
        "Preserve the product identity, colors, label placement, scene logic, and camera orientation implied by the panels while turning them into smooth continuous motion.",
    ].join("\n");
}

export function compactStoryboardVideoPrompt(prompt: string, duration = 15) {
    if (prompt.length > 900) {
        return `Create a ${duration}-second vertical direct-response ecommerce video following the supplied 12 storyboard reference frames in exact order. Use an exaggerated but believable first-second hook, fast product rescue reveal, demo/proof, contrast result, and final packshot-plus-result hero. Anchor every shot to the matching reference beat; do not generate unrelated footage. Use clean shot cuts instead of morphing between human, product, and surface references. Preserve the product shape, colors, label placement, scene style, and camera framing shown in each frame.`;
    }
    return prompt || `Create a ${duration}-second vertical direct-response ecommerce video following the supplied 12 storyboard reference frames in exact order, using a strong hook, product rescue, proof, contrast result, and final product hero plus result shot.`;
}

export function normalizeStoryboardVideoSeconds(value: string) {
    return Math.max(1, Math.floor(Number(normalizeModelVideoSeconds(value || "15", "grok-imagine-video")) || 15));
}

export function formatStoryboardSeconds(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function normalizeVideoGenerationPrompt(prompt: string) {
    const versionPrompt = extractVideoPromptVersion(prompt);
    return limitVideoPromptLength(sanitizeVideoProviderPrompt(stripStoryboardSheetPrompt(versionPrompt || prompt))).replace(/\n{3,}/g, "\n\n").trim();
}

export function extractVideoPromptVersion(prompt: string) {
    return extractPromptSection(prompt, "Grok Version");
}

export function extractPromptSection(prompt: string, heading: string) {
    const pattern = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\nCreate ONE strict (?:\\d+|twelve)-frame storyboard contact sheet|\\nHidden sequence plan:\\s*|\\nRules:\\s*|\\nThe supplied (?:numbered )?storyboard grid|$)`, "i");
    return prompt.match(pattern)?.[1]?.trim() || "";
}

export function stripStoryboardSheetPrompt(prompt: string) {
    const markers = [
        "\nCreate ONE strict 12-frame storyboard contact sheet",
        "\nCreate ONE strict twelve-frame storyboard contact sheet",
        "\nPanel plan:",
        "\nHidden sequence plan:",
        "\nRules:\n- Preserve one consistent product identity",
        "\nThe supplied numbered storyboard grid is mandatory shot-order guidance",
        "\nThe supplied storyboard grid is mandatory shot-order guidance",
    ];
    const firstMarker = markers.map((marker) => prompt.indexOf(marker)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
    const text = firstMarker === undefined ? prompt : prompt.slice(0, firstMarker);
    return text.replace(/\n?Output a single vertical (?:12|twelve)-panel storyboard sheet\.[\s\S]*$/i, "");
}

export function sanitizeVideoProviderPrompt(prompt: string) {
    return prompt
        .replace(/Negative prompt:[\s\S]*$/i, "")
        .replace(/^\s*User prompt:\s*/gim, "")
        .replace(/^\s*User direction:\s*/gim, "")
        .replace(/^The supplied reference image\(s\)[^\n]*\n?/gim, "")
        .replace(/^Preserve the same subject identity[^\n]*\n?/gim, "")
        .replace(/^Perform only the requested[^\n]*\n?/gim, "")
        .replace(/^If a reference is a storyboard sheet[^\n]*\n?/gim, "")
        .replace(/^.*\b(?:do not|don't|never|unsafe|disease|medical|steriliz|guaranteed|false claims?|open flame|active burner)\b.*$/gim, "")
        .replace(/\bgas\s+(?:stovetop|stove|burner)\b/gi, "stainless-steel cooktop")
        .replace(/\bburnt\s+(?:specks?|splatter|stains?)\b/gi, "cooked-on residue")
        .replace(/\bdark oil stains?\b/gi, "dark cooking residue")
        .replace(/\bheavy grease cleaner\b/gi, "kitchen cleaner")
        .replace(/\btrigger-spray\b/gi, "spray")
        .replace(/\bgreen trigger\b/gi, "green spray handle")
        .replace(/\btrigger\b/gi, "spray handle")
        .replace(/\bstainless-steel stainless-steel cooktop\b/gi, "stainless-steel cooktop")
        .replace(/\bgreen kitchen kitchen cleaner\b/gi, "green kitchen cleaner")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function limitVideoPromptLength(prompt: string) {
    const maxLength = 2400;
    if (prompt.length <= maxLength) return prompt;
    const clipped = prompt.slice(0, maxLength);
    const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("。"), clipped.lastIndexOf("\n"));
    return clipped.slice(0, sentenceEnd > 800 ? sentenceEnd : maxLength).trim();
}

export function mergeReferenceImages(...groups: ReferenceImage[][]) {
    const seen = new Set<string>();
    return groups.flat().filter((image) => {
        const key = image.storageKey || image.url || image.id || image.dataUrl;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

export function isHiddenBatchConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
