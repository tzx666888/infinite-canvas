import { productVideoSpec } from "../product-video-models.ts";

const ENHANCEMENT_GRANT_TTL_MS = 2 * 60 * 60 * 1000;
const INTERNAL_ENHANCER_MODELS = new Set(["1080", "1080pro"]);

type GrantState = "available" | "claimed";

export type VideoEnhancementGrant = {
    userId: string;
    requestId: string;
    publicModel: string;
    baseModel: string;
    enhancerModel: string;
    createdAt: number;
    state: GrantState;
};

type GrantRegistry = Map<string, VideoEnhancementGrant>;

const registryState = globalThis as typeof globalThis & { __infiniteCanvasVideoEnhancementGrants?: GrantRegistry };

function registry() {
    return (registryState.__infiniteCanvasVideoEnhancementGrants ||= new Map());
}

function normalizeModel(value: string) {
    return value.trim().toLowerCase().split("::").at(-1) || "";
}

function grantKey(userId: string, requestId: string) {
    return `${userId}\n${requestId}`;
}

function pruneExpired(now = Date.now()) {
    for (const [key, grant] of registry()) {
        if (now - grant.createdAt > ENHANCEMENT_GRANT_TTL_MS) registry().delete(key);
    }
}

export function isVideoCreationPath(path: string) {
    return /^v1\/videos(?:\/generations)?$/.test(path) || path === "v1/contents/generations/tasks";
}

export function isInternalVideoEnhancerModel(model: string) {
    return INTERNAL_ENHANCER_MODELS.has(normalizeModel(model));
}

export function isCompatibleProductBaseModel(publicModel: string, baseModel: string) {
    const spec = productVideoSpec(publicModel);
    if (!spec || spec.quality === "720p") return false;
    const normalizedBase = normalizeModel(baseModel);
    if (spec.family === "omni") return normalizedBase === "omni" || normalizedBase === "omni_portrait";
    return normalizedBase === normalizeModel(spec.baseModel);
}

export function rememberVideoEnhancementGrant(input: { userId: string; requestId: string; publicModel: string; baseModel: string }) {
    const userId = input.userId.trim();
    const requestId = input.requestId.trim();
    const publicModel = normalizeModel(input.publicModel);
    const baseModel = normalizeModel(input.baseModel);
    const spec = productVideoSpec(publicModel);
    if (!userId || !requestId || !spec?.enhancerModel || !isCompatibleProductBaseModel(publicModel, baseModel)) return;
    pruneExpired();
    registry().set(grantKey(userId, requestId), {
        userId,
        requestId,
        publicModel,
        baseModel,
        enhancerModel: spec.enhancerModel,
        createdAt: Date.now(),
        state: "available",
    });
}

export function claimVideoEnhancementGrant(input: { userId: string; requestId: string; enhancerModel: string }) {
    const userId = input.userId.trim();
    const requestId = input.requestId.trim();
    const enhancerModel = normalizeModel(input.enhancerModel);
    if (!userId || !requestId || !INTERNAL_ENHANCER_MODELS.has(enhancerModel)) return null;
    pruneExpired();
    const key = grantKey(userId, requestId);
    const grant = registry().get(key);
    if (!grant || grant.state !== "available" || grant.enhancerModel !== enhancerModel) return null;
    grant.state = "claimed";
    return { ...grant };
}

export function commitVideoEnhancementGrant(grant: Pick<VideoEnhancementGrant, "userId" | "requestId">) {
    registry().delete(grantKey(grant.userId, grant.requestId));
}

export function releaseVideoEnhancementGrant(grant: Pick<VideoEnhancementGrant, "userId" | "requestId">) {
    const key = grantKey(grant.userId, grant.requestId);
    const current = registry().get(key);
    if (current) current.state = "available";
}

export function clearVideoEnhancementGrantsForTests() {
    registry().clear();
}
