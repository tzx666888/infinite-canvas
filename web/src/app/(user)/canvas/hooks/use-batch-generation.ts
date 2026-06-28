import { useCallback, type RefObject } from "react";
import { nanoid } from "nanoid";
import type { ReferenceImage } from "@/types/image";
import type { AiConfig } from "@/stores/use-config-store";
import type { MessageInstance } from "antd/es/message/interface";
import { requestGeneration } from "@/services/api/image";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import {
    buildProductDetailImagePrompt,
    buildSceneExpansionImagePrompt,
    buildStoryboardKeyframePrompt,
    formatCommerceVideoPlan,
    formatProductBreakdownPlan,
    formatSceneExpansionPlan,
    type ProductBreakdownPlan,
    type SceneExpansionPlan,
    buildStoryboardReviewSheetPrompt,
} from "@/services/api/prompt-polish";
import { uploadImage } from "@/services/image-storage";
import {
    CanvasNodeType,
    type CanvasCommerceVideoPlan,
    type CanvasConnection,
    type CanvasNodeData,
} from "../types";
import { fitNodeSize } from "../utils/canvas-node-size";
import {
    buildGenerationConfig,
    buildImageGenerationMetadata,
    mergeReferenceImages,
    sourceNodeReferenceImages,
    runWithConcurrency,
    isGenerationCanceled,
    storyboardReviewSheetReferenceFrames,
    splitStoryboardReviewSheetNode,
    isStoryboardReviewSheetNode,
    STORYBOARD_REVIEW_PANEL_COUNT,
    NODE_STATUS_LOADING, NODE_STATUS_SUCCESS, NODE_STATUS_ERROR,
    VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT, STORYBOARD_REVIEW_NODE_MAX_WIDTH, STORYBOARD_REVIEW_NODE_MAX_HEIGHT,
    imageMetadata,
    videoMetadata,
    getGenerationCount,
} from "../utils/canvas-generation-utils";
import { NODE_DEFAULT_SIZE } from "../constants";
import { compileVideoPrompt, compileBeatPrompt, extractCommerceVideoPlan } from "../utils/video-prompt-compiler";
import { normalizeModelVideoSeconds } from "@/lib/video-model-settings";
import { requestEdit } from "@/services/api/image";
import { hydrateNodeGenerationContext, buildNodeGenerationContext } from "../components/canvas-node-generation";
import type { Dispatch, SetStateAction } from "react";


export interface BatchGenerationDeps {
    effectiveConfig: AiConfig;
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    setNodes: (fn: (prev: CanvasNodeData[]) => CanvasNodeData[]) => void;
    setConnections: (fn: (prev: CanvasConnection[]) => CanvasConnection[]) => void;
    setRunningNodeId: (id: string | null) => void;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: (id: string | null) => void;
    message: MessageInstance;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (open: boolean) => void;
    focusNodesInViewport: (targetNodes: CanvasNodeData[]) => void;
}


export function useBatchGeneration(deps: BatchGenerationDeps) {
    const {
        effectiveConfig,
        nodesRef,
        connectionsRef,
        setNodes,
        setConnections,
        setRunningNodeId,
        setSelectedNodeIds,
        setSelectedConnectionId,
        message,
        startGenerationRequest,
        finishGenerationRequest,
        isAiConfigReady,
        openConfigDialog,
        focusNodesInViewport,
    } = deps;

const handleGenerateProductBreakdown = useCallback(
    async (nodeId: string, plan: ProductBreakdownPlan) => {
        const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
        if (!sourceNode) throw new Error("找不到产品参考图节点");
        const generationConfig = { ...buildGenerationConfig(effectiveConfig, sourceNode, "image"), count: "1" };
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            openConfigDialog(true);
            throw new Error("请先配置可用的生图模型");
        }

        const generationContext = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, ""));
        const referenceImages = mergeReferenceImages(sourceNodeReferenceImages(sourceNode), generationContext.referenceImages);
        if (!referenceImages.length) throw new Error("没有读取到产品参考图，无法生成细节图");

        const shots = plan.shots;
        if (!shots.length) throw new Error("产品拆解没有可生成的细节镜头");
        setRunningNodeId(nodeId);
        const controller = startGenerationRequest(nodeId, nodeId, nodeId);
        const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const gap = 96;
        const rowGap = 36;
        const analysisId = nanoid();
        const rootId = nanoid();
        const childIds = shots.slice(1).map(() => nanoid());
        const targetIds = [rootId, ...childIds];
        const analysisText = formatProductBreakdownPlan(plan);
        const analysisNode: CanvasNodeData = {
            id: analysisId,
            type: CanvasNodeType.Text,
            title: `${plan.productName} 产品拆解`,
            position: { x: sourceNode.position.x + sourceNode.width + gap, y: sourceNode.position.y },
            width: textSpec.width,
            height: textSpec.height,
            metadata: { content: analysisText, prompt: analysisText, status: NODE_STATUS_SUCCESS, fontSize: 14, productBreakdown: true },
        };
        const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, referenceImages);
        const rootNode: CanvasNodeData = {
            id: rootId,
            type: CanvasNodeType.Image,
            title: shots[0].title,
            position: { x: analysisNode.position.x + analysisNode.width + gap, y: sourceNode.position.y },
            width: imageSpec.width,
            height: imageSpec.height,
            metadata: {
                ...generationMetadata,
                prompt: buildProductDetailImagePrompt(plan, shots[0]),
                status: NODE_STATUS_LOADING,
                isBatchRoot: childIds.length > 0,
                batchChildIds: childIds.length > 0 ? childIds : undefined,
                batchUsesReferenceImages: true,
                imageBatchExpanded: childIds.length > 0 ? true : undefined,
                productBreakdown: true,
                productDetailShot: true,
                productDetailTitle: shots[0].title,
                count: shots.length,
            },
        };
        const childNodes = childIds.map((id, index): CanvasNodeData => {
            const shot = shots[index + 1];
            const shotPrompt = buildProductDetailImagePrompt(plan, shot, index + 1);
            return {
                id,
                type: CanvasNodeType.Image,
                title: shot.title,
                position: {
                    x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageSpec.width + 36),
                    y: rootNode.position.y + Math.floor(index / 2) * (imageSpec.height + rowGap),
                },
                width: imageSpec.width,
                height: imageSpec.height,
                metadata: {
                    prompt: shotPrompt,
                    status: NODE_STATUS_LOADING,
                    batchRootId: rootId,
                    productDetailShot: true,
                    productDetailTitle: shot.title,
                    ...generationMetadata,
                },
            };
        });
        const nextConnections: CanvasConnection[] = [
            { id: nanoid(), fromNodeId: nodeId, toNodeId: analysisId },
            { id: nanoid(), fromNodeId: analysisId, toNodeId: rootId },
            ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId })),
        ];

        setNodes((prev) => [...prev, analysisNode, rootNode, ...childNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set([rootId]));
        setSelectedConnectionId(null);
        targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));

        let hasSuccess = false;
        let hasFailure = false;
        try {
            await runWithConcurrency(targetIds, 2, async (targetId, index) => {
                    const shot = shots[index];
                    const shotPrompt = buildProductDetailImagePrompt(plan, shot, index);
                    try {
                        const image = await requestEdit(generationConfig, shotPrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0]);
                        const uploaded = await uploadImage(image.dataUrl);
                        const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageSpec.width, imageSpec.height);
                        setNodes((prev) =>
                            prev.map((node) => {
                                if (node.id === targetId) {
                                    const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                    return {
                                        ...node,
                                        position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                        width: imageSize.width,
                                        height: imageSize.height,
                                        metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: shotPrompt },
                                    };
                                }
                                return node;
                            }),
                        );
                        hasSuccess = true;
                    } catch (error) {
                        if (isGenerationCanceled(error)) return;
                        hasFailure = true;
                        const errorDetails = error instanceof Error ? error.message : "细节图生成失败";
                        setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    } finally {
                        finishGenerationRequest(targetId, controller);
                    }
            });
            if (controller.signal.aborted) return;
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === rootId
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                  errorDetails: hasSuccess ? undefined : "全部细节图生成失败",
                              },
                          }
                        : node,
                ),
            );
            if (!hasFailure) message.success(`${shots.length} 张产品细节拆解图已生成`);
            else message.error(hasSuccess ? "部分细节图生成失败，可单独重试" : "全部细节图生成失败");
        } finally {
            finishGenerationRequest(rootId, controller);
            finishGenerationRequest(nodeId, controller);
            setRunningNodeId(null);
        }
    },
    [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
);

const handleGenerateSceneExpansion = useCallback(
    async (nodeId: string, plan: SceneExpansionPlan) => {
        const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
        if (!sourceNode) throw new Error("找不到产品参考图节点");
        const generationConfig = { ...buildGenerationConfig(effectiveConfig, sourceNode, "image"), count: "1" };
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            openConfigDialog(true);
            throw new Error("请先配置可用的生图模型");
        }

        const generationContext = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, ""));
        const referenceImages = mergeReferenceImages(sourceNodeReferenceImages(sourceNode), generationContext.referenceImages);
        if (!referenceImages.length) throw new Error("没有读取到产品参考图，无法生成场景图");

        const scenes = plan.scenes;
        if (!scenes.length) throw new Error("场景扩展没有可生成的场景");
        setRunningNodeId(nodeId);
        const controller = startGenerationRequest(nodeId, nodeId, nodeId);
        const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const gap = 96;
        const rowGap = 36;
        const analysisId = nanoid();
        const rootId = nanoid();
        const childIds = scenes.slice(1).map(() => nanoid());
        const targetIds = [rootId, ...childIds];
        const analysisText = formatSceneExpansionPlan(plan);
        const analysisNode: CanvasNodeData = {
            id: analysisId,
            type: CanvasNodeType.Text,
            title: `${plan.productName} 场景扩展`,
            position: { x: sourceNode.position.x + sourceNode.width + gap, y: sourceNode.position.y },
            width: textSpec.width,
            height: textSpec.height,
            metadata: { content: analysisText, prompt: analysisText, status: NODE_STATUS_SUCCESS, fontSize: 14, sceneExpansion: true },
        };
        const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, referenceImages);
        const rootScene = scenes[0];
        const rootPrompt = buildSceneExpansionImagePrompt(plan, rootScene);
        const rootNode: CanvasNodeData = {
            id: rootId,
            type: CanvasNodeType.Image,
            title: rootScene.title,
            position: { x: analysisNode.position.x + analysisNode.width + gap, y: analysisNode.position.y },
            width: imageSpec.width,
            height: imageSpec.height,
            metadata: {
                ...generationMetadata,
                prompt: rootPrompt,
                status: NODE_STATUS_LOADING,
                isBatchRoot: childIds.length > 0,
                batchChildIds: childIds.length > 0 ? childIds : undefined,
                batchUsesReferenceImages: true,
                imageBatchExpanded: childIds.length > 0 ? true : undefined,
                count: scenes.length,
                sceneExpansion: true,
                sceneExpansionTitle: rootScene.title,
            },
        };
        const childNodes = childIds.map((id, index): CanvasNodeData => {
            const scene = scenes[index + 1];
            const scenePrompt = buildSceneExpansionImagePrompt(plan, scene);
            return {
                id,
                type: CanvasNodeType.Image,
                title: scene.title,
                position: {
                    x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageSpec.width + 36),
                    y: rootNode.position.y + Math.floor(index / 2) * (imageSpec.height + rowGap),
                },
                width: imageSpec.width,
                height: imageSpec.height,
                metadata: {
                    ...generationMetadata,
                    prompt: scenePrompt,
                    status: NODE_STATUS_LOADING,
                    batchRootId: rootId,
                    sceneExpansion: true,
                    sceneExpansionTitle: scene.title,
                },
            };
        });
        const nextConnections: CanvasConnection[] = [
            { id: nanoid(), fromNodeId: nodeId, toNodeId: analysisId },
            { id: nanoid(), fromNodeId: analysisId, toNodeId: rootId },
            ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId })),
        ];

        setNodes((prev) => [...prev, analysisNode, rootNode, ...childNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set([rootId]));
        setSelectedConnectionId(null);
        targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));

        let successCount = 0;
        try {
            await runWithConcurrency(targetIds, 2, async (targetId, index) => {
                const scene = scenes[index];
                const scenePrompt = buildSceneExpansionImagePrompt(plan, scene);
                try {
                    const image = await requestEdit(generationConfig, scenePrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0]);
                    const uploaded = await uploadImage(image.dataUrl);
                    const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageSpec.width, imageSpec.height);
                    setNodes((prev) =>
                        prev.map((node) => {
                            if (node.id !== targetId) return node;
                            const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                            return {
                                ...node,
                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                width: imageSize.width,
                                height: imageSize.height,
                                metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scenePrompt },
                            };
                        }),
                    );
                    successCount += 1;
                } catch (error) {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "场景图生成失败";
                    setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                } finally {
                    finishGenerationRequest(targetId, controller);
                }
            });
            if (controller.signal.aborted) return;
            if (successCount === scenes.length) message.success(`${successCount} 张独立场景图已生成`);
            else if (successCount > 0) message.error(`已生成 ${successCount} 张，${scenes.length - successCount} 张失败，可单独重试`);
            else message.error("全部场景图生成失败");
        } finally {
            finishGenerationRequest(nodeId, controller);
            setRunningNodeId(null);
        }
    },
    [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
);


const handleGenerateVideoStoryboard = useCallback(
    async (nodeId: string, plan: CanvasCommerceVideoPlan) => {
        const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
        if (!sourceNode) throw new Error("找不到源节点");
        const baseGenerationConfig = buildGenerationConfig(effectiveConfig, sourceNode, "image");
        const reviewSheetCount = Math.max(1, Math.min(4, getGenerationCount(baseGenerationConfig.count)));
        const generationConfig = { ...baseGenerationConfig, count: "1" };
        const reviewSheetConfig = { ...generationConfig, size: "1024x1536" };
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            openConfigDialog(true);
            throw new Error("请先配置可用的生图模型");
        }

        const generationContext = await hydrateNodeGenerationContext(
            buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, ""),
        );
        const referenceImages = mergeReferenceImages(sourceNodeReferenceImages(sourceNode), generationContext.referenceImages);

        const beats = plan.beats;
        if (!beats?.length) throw new Error("视频分镜没有可生成的 beat");
        setRunningNodeId(nodeId);
        const controller = startGenerationRequest(nodeId, nodeId, nodeId);
        const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
        const gap = 96;
        const rowGap = 36;
        const planId = nanoid();
        const analysisId = nanoid();
        const rootId = nanoid();
        const childIds = Array.from({ length: Math.max(0, reviewSheetCount - 1) }, () => nanoid());
        const targetIds = [rootId, ...childIds];
        const reviewPrompts = Array.from({ length: reviewSheetCount }, (_, index) => buildStoryboardReviewSheetPrompt(plan, index + 1));

        const analysisText = formatCommerceVideoPlan(plan);
        const analysisNode: CanvasNodeData = {
            id: analysisId,
            type: CanvasNodeType.Text,
            title: `${plan.productCategory || "产品"} 视频分镜规划`,
            position: { x: sourceNode.position.x + sourceNode.width + gap, y: sourceNode.position.y },
            width: textSpec.width,
            height: textSpec.height,
            metadata: {
                content: analysisText,
                prompt: analysisText,
                status: NODE_STATUS_SUCCESS,
                fontSize: 14,
                storyboardPlanId: planId,
                storyboardSourceNodeId: nodeId,
                commerceVideoPlan: plan,
            },
        };

        const generationMetadata = buildImageGenerationMetadata(referenceImages.length > 0 ? "edit" : "generation", reviewSheetConfig, 1, referenceImages);
        const rootPrompt = reviewPrompts[0];
        const rootNode: CanvasNodeData = {
            id: rootId,
            type: CanvasNodeType.Image,
            title: "12宫格分镜候选 1",
            position: { x: analysisNode.position.x + analysisNode.width + gap, y: analysisNode.position.y },
            width: 360,
            height: 630,
            metadata: {
                ...generationMetadata,
                prompt: rootPrompt,
                status: NODE_STATUS_LOADING,
                isBatchRoot: childIds.length > 0,
                batchChildIds: childIds.length > 0 ? childIds : undefined,
                batchUsesReferenceImages: referenceImages.length > 0,
                imageBatchExpanded: childIds.length > 0 ? true : undefined,
                count: reviewSheetCount,
                storyboardRole: "review-sheet" as const,
                storyboardPlanId: planId,
                storyboardSourceNodeId: nodeId,
                storyboardReviewIndex: 1,
                commerceVideoPlan: plan,
            },
        };
        const childNodes = childIds.map((id, index): CanvasNodeData => {
            const reviewPrompt = reviewPrompts[index + 1];
            return {
                id,
                type: CanvasNodeType.Image,
                title: `12宫格分镜候选 ${index + 2}`,
                position: {
                    x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (rootNode.width + 36),
                    y: rootNode.position.y + Math.floor(index / 2) * (rootNode.height + rowGap),
                },
                width: rootNode.width,
                height: rootNode.height,
                metadata: {
                    ...generationMetadata,
                    prompt: reviewPrompt,
                    status: NODE_STATUS_LOADING,
                    batchRootId: rootId,
                    storyboardRole: "review-sheet" as const,
                    storyboardPlanId: planId,
                    storyboardSourceNodeId: nodeId,
                    storyboardReviewIndex: index + 2,
                    commerceVideoPlan: plan,
                },
            };
        });

        const nextConnections: CanvasConnection[] = [
            { id: nanoid(), fromNodeId: nodeId, toNodeId: analysisId },
            { id: nanoid(), fromNodeId: analysisId, toNodeId: rootId },
            ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId })),
        ];

        setNodes((prev) => [...prev, analysisNode, rootNode, ...childNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set([rootId]));
        setSelectedConnectionId(null);
        focusNodesInViewport([analysisNode, rootNode, ...childNodes]);
        targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));

        let successCount = 0;
        try {
            const useEdit = referenceImages.length > 0;
            await runWithConcurrency(targetIds, 2, async (targetId, index) => {
                const reviewPrompt = reviewPrompts[index] || reviewPrompts[0];
                try {
                    const image = useEdit
                        ? await requestEdit(reviewSheetConfig, reviewPrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0])
                        : await requestGeneration(reviewSheetConfig, reviewPrompt, { signal: controller.signal }).then((items) => items[0]);
                    const uploaded = await uploadImage(image.dataUrl);
                    const imageSize = fitNodeSize(uploaded.width, uploaded.height, STORYBOARD_REVIEW_NODE_MAX_WIDTH, STORYBOARD_REVIEW_NODE_MAX_HEIGHT);
                    setNodes((prev) => {
                        const root = prev.find((node) => node.id === rootId);
                        return prev.map((node) => {
                            if (node.id !== targetId && node.id !== rootId) return node;
                            const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                            if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                return {
                                    ...node,
                                    position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                    width: imageSize.width,
                                    height: imageSize.height,
                                    metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: reviewPrompt, primaryImageId: targetId },
                                };
                            if (node.id === targetId)
                                return {
                                    ...node,
                                    position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                    width: imageSize.width,
                                    height: imageSize.height,
                                    metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: reviewPrompt },
                                };
                            return node;
                        });
                    });
                    successCount += 1;
                } catch (error) {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "12宫格分镜生成失败";
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node,
                        ),
                    );
                } finally {
                    finishGenerationRequest(targetId, controller);
                }
            });
            if (controller.signal.aborted) return;
            if (successCount === reviewSheetCount) message.success(`${successCount} 张12宫格分镜候选已生成，请选择一张生成关键帧`);
            else if (successCount > 0) message.error(`已生成 ${successCount} 张，${reviewSheetCount - successCount} 张失败，可单独重试`);
            else message.error("全部12宫格分镜生成失败");
        } finally {
            finishGenerationRequest(nodeId, controller);
            setRunningNodeId(null);
        }
    },
    [effectiveConfig, finishGenerationRequest, focusNodesInViewport, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
);

const handleGenerateStoryboardKeyframes = useCallback(
    async (reviewNode: CanvasNodeData) => {
        const plan = reviewNode.metadata?.commerceVideoPlan;
        if (!plan?.beats?.length) {
            message.error("找不到分镜规划数据");
            return;
        }
        const planId = reviewNode.metadata?.storyboardPlanId;
        if (!planId || reviewNode.metadata?.storyboardRole !== "review-sheet") {
            message.error("请选择12宫格分镜候选图生成关键帧");
            return;
        }
        const reviewImageUrl = reviewNode.metadata?.content;
        if (!reviewImageUrl) {
            message.error("这张12宫格还没有生成完成");
            return;
        }

        const sourceNode = reviewNode.metadata?.storyboardSourceNodeId
            ? nodesRef.current.find((node) => node.id === reviewNode.metadata?.storyboardSourceNodeId) || null
            : null;
        const generationConfig = { ...buildGenerationConfig(effectiveConfig, sourceNode || reviewNode, "image"), count: "1" };
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            openConfigDialog(true);
            return;
        }

        const sourceContext = sourceNode
            ? await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, ""))
            : { referenceImages: [] as ReferenceImage[] };
        const sourceReferences = sourceNode ? mergeReferenceImages(sourceNodeReferenceImages(sourceNode), sourceContext.referenceImages) : [];
        const reviewReference: ReferenceImage = {
            id: reviewNode.id,
            name: `storyboard-review-${reviewNode.metadata?.storyboardReviewIndex || 1}.png`,
            type: reviewNode.metadata?.mimeType || "image/png",
            dataUrl: reviewImageUrl,
            storageKey: reviewNode.metadata?.storageKey || (reviewImageUrl.startsWith("image:") ? reviewImageUrl : undefined),
            url: reviewImageUrl.startsWith("http") ? reviewImageUrl : undefined,
        };
        const referenceImages = mergeReferenceImages(sourceReferences, [reviewReference]);
        const beats = plan.beats;
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const gap = 96;
        const rowGap = 36;
        const rootId = nanoid();
        const childIds = beats.slice(1).map(() => nanoid());
        const targetIds = [rootId, ...childIds];
        const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, referenceImages);

        const buildBeatPrompt = (beat: NonNullable<CanvasCommerceVideoPlan["beats"]>[number]) =>
            buildStoryboardKeyframePrompt(plan, beat, { selectedReviewSheet: true });
        const rootBeat = beats[0];
        const rootPrompt = buildBeatPrompt(rootBeat);
        const rootNode: CanvasNodeData = {
            id: rootId,
            type: CanvasNodeType.Image,
            title: `关键帧 Beat ${rootBeat.index} | ${rootBeat.phase} | ${rootBeat.timeRange}`,
            position: { x: reviewNode.position.x + reviewNode.width + gap, y: reviewNode.position.y },
            width: imageSpec.width,
            height: imageSpec.height,
            metadata: {
                ...generationMetadata,
                prompt: rootPrompt,
                status: NODE_STATUS_LOADING,
                isBatchRoot: childIds.length > 0,
                batchChildIds: childIds.length > 0 ? childIds : undefined,
                batchUsesReferenceImages: true,
                imageBatchExpanded: childIds.length > 0 ? true : undefined,
                count: beats.length,
                storyboardRole: "keyframe" as const,
                storyboardBeatIndex: 0,
                storyboardPlanId: planId,
                storyboardSourceNodeId: reviewNode.metadata?.storyboardSourceNodeId,
                storyboardReviewNodeId: reviewNode.id,
                storyboardReviewIndex: reviewNode.metadata?.storyboardReviewIndex,
            },
        };
        const childNodes = childIds.map((id, index): CanvasNodeData => {
            const beat = beats[index + 1];
            const beatPrompt = buildBeatPrompt(beat);
            return {
                id,
                type: CanvasNodeType.Image,
                title: `关键帧 Beat ${beat.index} | ${beat.phase} | ${beat.timeRange}`,
                position: {
                    x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageSpec.width + 36),
                    y: rootNode.position.y + Math.floor(index / 2) * (imageSpec.height + rowGap),
                },
                width: imageSpec.width,
                height: imageSpec.height,
                metadata: {
                    ...generationMetadata,
                    prompt: beatPrompt,
                    status: NODE_STATUS_LOADING,
                    batchRootId: rootId,
                    storyboardRole: "keyframe" as const,
                    storyboardBeatIndex: index + 1,
                    storyboardPlanId: planId,
                    storyboardSourceNodeId: reviewNode.metadata?.storyboardSourceNodeId,
                    storyboardReviewNodeId: reviewNode.id,
                    storyboardReviewIndex: reviewNode.metadata?.storyboardReviewIndex,
                },
            };
        });
        const nextConnections: CanvasConnection[] = [
            { id: nanoid(), fromNodeId: reviewNode.id, toNodeId: rootId },
            ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId })),
        ];

        setRunningNodeId(reviewNode.id);
        const controller = startGenerationRequest(reviewNode.id, reviewNode.id, reviewNode.id);
        setNodes((prev) => [...prev, rootNode, ...childNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set([rootId]));
        setSelectedConnectionId(null);
        focusNodesInViewport([reviewNode, rootNode, ...childNodes]);
        targetIds.forEach((targetId) => startGenerationRequest(targetId, reviewNode.id, reviewNode.id, controller));

        let successCount = 0;
        try {
            await runWithConcurrency(targetIds, 2, async (targetId, index) => {
                const beat = beats[index];
                const beatPrompt = buildBeatPrompt(beat);
                try {
                    const image = await requestEdit(generationConfig, beatPrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0]);
                    const uploaded = await uploadImage(image.dataUrl);
                    const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageSpec.width, imageSpec.height);
                    setNodes((prev) => {
                        const root = prev.find((node) => node.id === rootId);
                        return prev.map((node) => {
                            if (node.id !== targetId && node.id !== rootId) return node;
                            const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                            if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                return {
                                    ...node,
                                    position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                    width: imageSize.width,
                                    height: imageSize.height,
                                    metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: beatPrompt, primaryImageId: targetId },
                                };
                            if (node.id === targetId)
                                return {
                                    ...node,
                                    position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                    width: imageSize.width,
                                    height: imageSize.height,
                                    metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: beatPrompt },
                                };
                            return node;
                        });
                    });
                    successCount += 1;
                } catch (error) {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "关键帧生成失败";
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node,
                        ),
                    );
                } finally {
                    finishGenerationRequest(targetId, controller);
                }
            });
            if (controller.signal.aborted) return;
            if (successCount === beats.length) message.success(`${successCount} 张干净关键帧已生成，可从分镜规划节点生成视频`);
            else if (successCount > 0) message.error(`已生成 ${successCount} 张，${beats.length - successCount} 张失败，可单独重试`);
            else message.error("全部关键帧生成失败");
        } finally {
            finishGenerationRequest(reviewNode.id, controller);
            setRunningNodeId(null);
        }
    },
    [effectiveConfig, finishGenerationRequest, focusNodesInViewport, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
);


const handleGenerateVideoClips = useCallback(
    async (planNode: CanvasNodeData) => {
        const plan = planNode.metadata?.commerceVideoPlan;
        if (!plan?.beats?.length) throw new Error("找不到分镜规划数据");
        const planId = planNode.metadata?.storyboardPlanId;
        if (!planId) throw new Error("找不到分镜规划 ID");

        const generationConfig = { ...buildGenerationConfig(effectiveConfig, planNode, "video"), count: "1" };
        if (!generationConfig.videoModels.length) {
            message.error("当前令牌未开放视频模型，无法生成视频片段");
            return;
        }

        const keyframeNodes = nodesRef.current
            .filter((node) => node.metadata?.storyboardPlanId === planId && node.metadata?.storyboardRole === "keyframe" && node.metadata?.content)
            .sort((a, b) => (a.metadata?.storyboardBeatIndex ?? 0) - (b.metadata?.storyboardBeatIndex ?? 0));

        if (!keyframeNodes.length) {
            message.error("找不到已生成的关键帧图片，请先生成关键帧");
            return;
        }

        const videoSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
        const gap = 96;
        setRunningNodeId(planNode.id);
        const controller = startGenerationRequest(planNode.id, planNode.id, planNode.id);
        const videoModel = generationConfig.model || generationConfig.videoModel || effectiveConfig.videoModel || effectiveConfig.model;
        const videoSeconds = normalizeModelVideoSeconds(generationConfig.videoSeconds, videoModel);

        const beatAspectRatio = generationConfig.size === "16:9" ? "16:9" as const : generationConfig.size === "1:1" ? "1:1" as const : "9:16" as const;
        const perBeatSeconds = normalizeModelVideoSeconds("6", videoModel);

        const videoEntries = keyframeNodes.map((kfNode, index) => {
            const beat = plan.beats![index] || plan.beats![plan.beats!.length - 1];
            const videoId = nanoid();
            const videoNode: CanvasNodeData = {
                id: videoId,
                type: CanvasNodeType.Video,
                title: `Beat ${beat.index} | ${beat.phase} | ${beat.timeRange}`,
                position: { x: kfNode.position.x + kfNode.width + gap, y: kfNode.position.y },
                width: videoSpec.width,
                height: videoSpec.height,
                metadata: {
                    prompt: "",
                    status: NODE_STATUS_LOADING,
                    model: videoModel,
                    size: generationConfig.size,
                    seconds: perBeatSeconds,
                    vquality: generationConfig.vquality,
                    generateAudio: generationConfig.videoGenerateAudio,
                    watermark: generationConfig.videoWatermark,
                    storyboardPlanId: planId,
                    storyboardBeatIndex: beat.index,
                },
            };
            return { kfNode, beat, videoId, videoNode };
        });

        const videoIds = videoEntries.map((entry) => entry.videoId);
        const newConnections: CanvasConnection[] = videoEntries.map((entry) => ({
            id: nanoid(),
            fromNodeId: entry.kfNode.id,
            toNodeId: entry.videoId,
        }));

        setNodes((prev) => [...prev, ...videoEntries.map((entry) => entry.videoNode)]);
        setConnections((prev) => [...prev, ...newConnections]);
        videoIds.forEach((videoId) => startGenerationRequest(videoId, planNode.id, planNode.id, controller));

        let successCount = 0;
        try {
            await runWithConcurrency(videoIds, 1, async (videoId, index) => {
                const entry = videoEntries[index];
                const referenceImages = sourceNodeReferenceImages(entry.kfNode);
                try {
                    const beatPrompt = compileBeatPrompt(plan, entry.beat, {
                        model: "grok",
                        duration: Number(perBeatSeconds),
                        aspectRatio: beatAspectRatio,
                        referenceMode: "i2v",
                    });
                    const video = await storeGeneratedVideo(await requestVideoGeneration(
                        { ...generationConfig, model: videoModel, videoSeconds: perBeatSeconds },
                        beatPrompt,
                        referenceImages,
                        [],
                        [],
                        { signal: controller.signal },
                    ));
                    const videoSize = fitNodeSize(video.width || videoSpec.width, video.height || videoSpec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((node) => {
                            if (node.id !== videoId) return node;
                            return {
                                ...node,
                                width: videoSize.width,
                                height: videoSize.height,
                                position: {
                                    x: node.position.x + node.width / 2 - videoSize.width / 2,
                                    y: node.position.y + node.height / 2 - videoSize.height / 2,
                                },
                                metadata: { ...node.metadata, ...videoMetadata(video), prompt: beatPrompt },
                            };
                        }),
                    );
                    successCount += 1;
                } catch (error) {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "视频片段生成失败";
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === videoId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node,
                        ),
                    );
                } finally {
                    finishGenerationRequest(videoId, controller);
                }
            });
            if (controller.signal.aborted) return;
            if (successCount === videoEntries.length) message.success(`${successCount} 个视频片段已生成`);
            else if (successCount > 0) message.error(`已生成 ${successCount} 个，${videoEntries.length - successCount} 个失败，可单独重试`);
            else message.error("全部视频片段生成失败");
        } finally {
            finishGenerationRequest(planNode.id, controller);
            setRunningNodeId(null);
        }
    },
    [effectiveConfig, finishGenerationRequest, message, startGenerationRequest],
);


    return {
        handleGenerateProductBreakdown,
        handleGenerateSceneExpansion,
        handleGenerateVideoStoryboard,
        handleGenerateStoryboardKeyframes,
        handleGenerateVideoClips,
    };
}
