export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Director = "director",
    Video = "video",
    Audio = "audio",
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasProductBreakdownPlan = {
    productName?: string;
    category?: string;
    identity?: string;
    materials?: string[];
    components?: string[];
    visibleMarks?: string[];
    packageAccessories?: string[];
    shots?: Array<{
        title?: string;
        focus?: string;
        prompt?: string;
    }>;
};

export type CanvasSceneExpansionPlan = {
    productName?: string;
    identity?: string;
    scenes?: Array<{
        title?: string;
        focus?: string;
        prompt?: string;
    }>;
};

export type CanvasCommerceVideoPlan = {
    productCategory?: string;
    storyboardMode?: "product" | "apparel" | "subject" | "scene";
    storyboardStyle?: "direct-response" | "lifestyle-montage" | "cinematic-subject" | "scene-progression";
    locationStrategy?: "single-location" | "related-location-montage";
    directorBrief?: string;
    plannedLocations?: string[];
    visualIdentity?: string;
    forbiddenAdditions?: string[];
    selectedHookType?: string;
    hookDescription?: string;
    beats?: Array<{
        index: number;
        phase: "hook" | "pain" | "demo" | "cta" | string;
        timeRange: string;
        shotType?: string;
        cameraMove?: string;
        description: string;
        eightElements?: {
            subject?: string;
            action?: string;
            scene?: string;
            lighting?: string;
            camera?: string;
            style?: string;
            quality?: string;
            constraint?: string;
        };
    }>;
    compliance?: {
        mustInclude?: string[];
        mustNotInclude?: string[];
        riskLevel?: string;
    };
    enhancementWords?: string;
};

export type CanvasProductIdentity = {
    fingerprint: string;
    model: string;
    identity: string;
    colors: string[];
    materials: string[];
    labelLayout: string;
    observedText?: string;
    textStatus: "unverified" | "verified";
};

export type CanvasFusionPlacementPlan = {
    scene: {
        summary: string;
        camera: string;
        light: string;
        usableSurfaces: Array<{
            name: string;
            reason: string;
            roughRegion: {
                area: string;
                horizontal: string;
                depth: string;
                vertical: string;
            };
        }>;
        avoidAreas: string[];
    };
    products: Array<{
        imageIndex: number;
        identity: string;
        colors: string[];
        materials: string[];
        labelLayout: string;
        observedText?: string;
        textStatus: "unverified" | "verified";
    }>;
    placements: Array<{
        imageIndex: number;
        position: string;
        reason: string;
        scale: string;
        orientation: string;
        contact: string;
        shadow: string;
        occlusion: string;
    }>;
    plannerModel: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    statusMessage?: string;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    productScaleMode?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    editMask?: string;
    editRequestSize?: string;
    inputOrder?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    productBreakdown?: boolean;
    productDetailShot?: boolean;
    productDetailTitle?: string;
    productBreakdownPlan?: CanvasProductBreakdownPlan;
    sceneExpansion?: boolean;
    sceneExpansionTitle?: string;
    sceneExpansionPlan?: CanvasSceneExpansionPlan;
    productIdentityV1?: CanvasProductIdentity;
    fusionPlacementPlanV1?: CanvasFusionPlacementPlan;
    commerceVideoPlan?: CanvasCommerceVideoPlan;
    directorLastSnapshot?: string;
    directorLastSnapshotStorageKey?: string;
    directorSnapshotNodeId?: string;
    directorConfigNodeId?: string;
    directorPrompt?: string;
    directorPresetId?: string;
    directorMode?: string;
    directorReference?: boolean;
    selectedHookType?: string;
    excludedHookTypes?: string[];
    storyboardPlanId?: string;
    storyboardSourceNodeId?: string;
    storyboardRole?: "review-sheet" | "keyframe";
    storyboardBeatIndex?: number;
    storyboardReviewIndex?: number;
    storyboardReviewNodeId?: string;
    targetVideoModel?: string;
    targetVideoSeconds?: 4 | 8 | 12 | 15 | number;
    targetVideoSize?: string;
    videoSourcePrompt?: string;
    videoConstraintVersion?: string;
    videoReferenceImages?: string[];
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeType;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
