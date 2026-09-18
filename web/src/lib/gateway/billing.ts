import { randomUUID } from "node:crypto";

import { AuthError } from "../auth/auth-error.ts";
import { listSubmittedBillingTasks, refundCredits, refundCreditsByTask, reserveCredits, resolveCustomerPrice, settleCredits, settleCreditsByTask } from "../auth/store.ts";
import { productVideoSpec } from "../product-video-models.ts";
import { isH3BillingModel } from "../h3-billing.ts";
import { resolveCanvasUpstreamAuthorization } from "./upstream-auth.ts";

type PriceUnit = "request" | "image" | "second";
type PriceRule = { credits: number; unit: PriceUnit; creditsBySeconds?: Record<string, number> };
type GatewayIdentity = { keyId: string; userId: string };

const DEFAULT_AGENT_BILLING_WINDOW_SECONDS = 600;

export type GatewayReservation = {
    requestId: string;
    path: string;
    model: string;
    amount: number;
};

export async function reserveGatewayRequest(request: Request, path: string, identity: GatewayIdentity, requestIdOverride?: string): Promise<GatewayReservation | null> {
    if (request.method !== "POST" || path === "v1/models") return null;
    if (!billingEnabled()) return null;
    const usage = await requestUsage(request, path);
    const { rule, priced, units, baseAmount, amount } = customerQuote(identity.userId, usage);
    const requestId = requestIdOverride?.trim().slice(0, 100) || request.headers.get("x-canvas-request-id")?.trim().slice(0, 100) || randomUUID();
    const agentWindowMs = path === "v1/responses" && rule.unit === "request" ? agentBillingWindowMs() : 0;
    const agentWindowMinutes = Math.max(1, Math.round(agentWindowMs / 60_000));
    const reservation = reserveCredits({
        userId: identity.userId,
        apiKeyId: identity.keyId,
        requestId,
        model: usage.model,
        amount,
        baseAmount,
        commissionAmount: amount - baseAmount,
        beneficiaryAdminId: priced.beneficiaryAdminId,
        billingProfileId: priced.billingProfileId,
        baseRate: priced.baseCredits,
        retailRate: priced.retailCredits,
        units,
        unit: rule.unit,
        upstreamPath: path,
        reuseWindowMs: agentWindowMs,
        remark: agentWindowMs ? `${usage.model} Agent 对话计费（${agentWindowMinutes} 分钟内仅计一次）` : undefined,
    });
    return { requestId, path, model: usage.model, amount: reservation.amount };
}

function customerQuote(userId: string, usage: { model: string; seconds: number; images: number }) {
    const prices = modelPrices();
    if (!usage.model) throw new AuthError("请求缺少模型名称", 400, "missing_model");
    const rule = prices[usage.model.toLowerCase()];
    if (!rule) throw new AuthError(`模型 ${usage.model} 暂未配置积分价格`, 409, "model_price_missing");
    const baseCredits = requestBaseCredits(rule, usage.seconds);
    const units = rule.unit === "second" ? usage.seconds : rule.unit === "image" ? usage.images : 1;
    if (rule.unit === "second" && isH3BillingModel(usage.model) && ![10, 15].includes(usage.seconds)) throw new AuthError("画布 H3 仅支持 10 秒或 15 秒，请重新选择时长", 400, "invalid_video_duration");
    const priced = resolveCustomerPrice({ userId, model: usage.model, baseCredits, unit: rule.unit });
    const billableUnits = Math.max(1, units);
    const baseAmount = billedAmount(priced.baseCredits, billableUnits, rule.unit);
    const amount = Math.max(baseAmount, billedAmount(priced.retailCredits, billableUnits, rule.unit));
    return { rule, priced, units, baseAmount, amount };
}

export function quoteGatewayVideo(userId: string, model: string, seconds: number) {
    if (!billingEnabled()) throw new AuthError("平台积分计费未开启", 409, "billing_disabled");
    const normalized = model.trim().toLowerCase().split("::").at(-1) || "";
    if (!isH3BillingModel(normalized)) throw new AuthError("此报价入口仅支持 H3", 400, "unsupported_quote_model");
    const { rule, priced, units, amount } = customerQuote(userId, { model: normalized, seconds, images: 1 });
    return { model: normalized, unit: rule.unit, rate: priced.retailCredits, units, amount };
}

function billedAmount(rate: number, units: number, unit: PriceUnit) {
    const precise = Number((rate * units).toFixed(6));
    return unit === "second" ? Math.max(0, precise) : Math.max(1, Math.ceil(precise));
}

function requestBaseCredits(rule: PriceRule, seconds: number) {
    if (rule.unit !== "request" || !rule.creditsBySeconds) return rule.credits;
    const exact = rule.creditsBySeconds[String(Math.round(seconds))];
    return Number.isFinite(exact) && exact > 0 ? exact : rule.credits;
}

export async function finalizeGatewayResponse(response: Response, reservation: GatewayReservation | null) {
    if (!reservation) return response;
    if (!response.ok) {
        refundCredits(reservation.requestId, "请求未被模型服务接受，积分退回");
        return response;
    }
    if (/^v1\/videos(?:\/generations)?$/.test(reservation.path) || reservation.path === "v1/contents/generations/tasks") {
        const payload = await response
            .clone()
            .json()
            .catch(() => null);
        const task = envelopeData(payload);
        const taskId = task && typeof task === "object" ? text((task as Record<string, unknown>).id) || text((task as Record<string, unknown>).request_id) || text((task as Record<string, unknown>).task_id) : "";
        if (taskId) {
            settleCredits(reservation.requestId, taskId, reservation.path);
            return response;
        }
    }
    settleCredits(reservation.requestId);
    return response;
}

export async function reconcileGatewayTaskResponse(path: string, response: Response) {
    if (!response.ok || response.headers.get("content-type")?.includes("video/")) return response;
    const taskId = taskIdFromPath(path);
    if (!taskId) return response;
    const payload = await response
        .clone()
        .json()
        .catch(() => null);
    const task = envelopeData(payload);
    if (!task || typeof task !== "object") return response;
    const status = text((task as Record<string, unknown>).status).toLowerCase();
    if (["failed", "error", "expired", "cancelled", "canceled"].includes(status)) refundCreditsByTask(taskId, "视频生成失败，积分退回");
    if (["done", "completed", "succeeded", "success", "finished"].includes(status)) settleCreditsByTask(taskId);
    return response;
}

export function refundGatewayReservation(reservation: GatewayReservation, remark?: string) {
    return refundCredits(reservation.requestId, remark);
}

export function settleGatewayReservation(reservation: GatewayReservation) {
    return settleCredits(reservation.requestId);
}

const TASK_RECONCILE_INTERVAL_MS = 60_000;
const taskReconcilerState = globalThis as typeof globalThis & { __infiniteCanvasTaskReconciler?: { started: boolean; running: boolean } };

export function ensureGatewayTaskReconciler() {
    if (taskReconcilerState.__infiniteCanvasTaskReconciler?.started) return;
    const state = (taskReconcilerState.__infiniteCanvasTaskReconciler = { started: true, running: false });
    const run = () => void reconcileSubmittedGatewayTasks(state).catch((error) => console.error("[canvas-billing] reconciliation failed", error));
    const timer = setInterval(run, TASK_RECONCILE_INTERVAL_MS);
    timer.unref?.();
    run();
}

async function reconcileSubmittedGatewayTasks(state: { started: boolean; running: boolean }) {
    if (state.running) return;
    state.running = true;
    try {
        const { reconcileReservedImageJobs } = await import("../../server/image-job-store.ts");
        await reconcileReservedImageJobs();
        const origin = (process.env.CANVAS_UPSTREAM_ORIGIN || process.env.TOKAXIS_INTERNAL_ORIGIN || "").replace(/\/+$/, "");
        if (!origin) return;
        const tasks = listSubmittedBillingTasks();
        for (let offset = 0; offset < tasks.length; offset += 8) {
            await Promise.all(tasks.slice(offset, offset + 8).map(async (task) => {
            const path = task.upstreamPath || fallbackVideoTaskPath(task.model);
            if (!path) return;
            try {
                const authorization = resolveCanvasUpstreamAuthorization();
                if (!authorization) return;
                const response = await fetch(`${origin}/${path}/${encodeURIComponent(task.upstreamTaskId)}`, { headers: { Authorization: authorization }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
                if (!response.ok) return;
                const payload = await response.json().catch(() => null);
                const taskPayload = envelopeData(payload);
                if (!taskPayload || typeof taskPayload !== "object") return;
                const status = text((taskPayload as Record<string, unknown>).status).toLowerCase();
                if (["failed", "error", "expired", "cancelled", "canceled"].includes(status)) refundCreditsByTask(task.upstreamTaskId, "视频生成失败，积分退回");
                if (["done", "completed", "succeeded", "success", "finished"].includes(status)) settleCreditsByTask(task.upstreamTaskId);
            } catch {
                // A network failure cannot prove that the provider task failed. Keep the reservation for the next pass.
            }
            }));
        }
    } finally {
        state.running = false;
    }
}

function fallbackVideoTaskPath(model: string) {
    const normalized = model.trim().toLowerCase();
    if ([
        "seedance 2.0-fast-720p", "qy-seedance-2.0", "qy-seedance-2.0-fast",
        "doubao-seedance-2-5-260628", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-fast-260128", "doubao-seedance-1-5-pro-251215",
        "minimaxh3-720p", "minimaxh3-2k", "sd30", "omni", "omni_portrait",
        // The nine public tiers.
        "minimax-h3-720p", "minimax-h3-1080p", "minimax-h3-1080p-pro",
        "sd30-720p", "sd30-1080p", "sd30-1080p-pro",
        "omni-720p", "omni-1080p", "omni-1080p-pro",
    ].includes(normalized)) return "v1/videos/generations";
    if (normalized.startsWith("grok-imagine-video-")) return "v1/videos";
    return "v1/videos";
}

export function billingEnabled() {
    return process.env.CANVAS_BILLING_ENABLED === "true";
}

export function publicModelPrices() {
    const prices = modelPrices();
    return Object.fromEntries(Object.entries(prices).map(([model, rule]) => [model, { ...rule }]));
}

function modelPrices() {
    const raw = process.env.CANVAS_MODEL_PRICES_JSON?.trim();
    if (!raw) return {} as Record<string, PriceRule>;
    try {
        const parsed = JSON.parse(raw) as Record<string, { credits?: unknown; unit?: unknown; creditsBySeconds?: unknown }>;
        return Object.fromEntries(
            Object.entries(parsed).flatMap(([model, rule]) => {
                const credits = Number(rule?.credits);
                const unit = rule?.unit;
                const creditsBySeconds = rule?.creditsBySeconds && typeof rule.creditsBySeconds === "object" ? Object.fromEntries(Object.entries(rule.creditsBySeconds as Record<string, unknown>).flatMap(([seconds, value]) => {
                    const parsedSeconds = Number(seconds);
                    const parsedCredits = Number(value);
                    return Number.isFinite(parsedSeconds) && parsedSeconds > 0 && Number.isFinite(parsedCredits) && parsedCredits > 0 ? [[String(Math.round(parsedSeconds)), parsedCredits]] : [];
                })) : undefined;
                return model.trim() && Number.isFinite(credits) && credits > 0 && (unit === "request" || unit === "image" || unit === "second") ? [[model.trim().toLowerCase(), { credits, unit, ...(creditsBySeconds && Object.keys(creditsBySeconds).length > 0 ? { creditsBySeconds } : {}) } satisfies PriceRule]] : [];
            }),
        );
    } catch {
        throw new AuthError("积分价格配置无效，请联系管理员", 503, "invalid_price_config");
    }
}

function agentBillingWindowMs() {
    const seconds = Number(process.env.CANVAS_AGENT_BILLING_WINDOW_SECONDS || DEFAULT_AGENT_BILLING_WINDOW_SECONDS);
    return (Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 3600) : DEFAULT_AGENT_BILLING_WINDOW_SECONDS) * 1000;
}

async function requestUsage(request: Request, path: string) {
    let model = "";
    let images = 1;
    let seconds = 1;
    let rawSeconds: unknown;
    let rawDuration: unknown;
    const contentType = request.headers.get("content-type") || "";
    try {
        if (contentType.includes("multipart/form-data")) {
            const form = await request.clone().formData();
            model = text(form.get("model"));
            rawSeconds = form.get("seconds");
            rawDuration = form.get("duration");
            images = positiveNumber(form.get("n"), 1);
            seconds = positiveNumber(form.get("seconds") ?? form.get("duration"), 1);
        } else {
            const payload = (await request.clone().json()) as Record<string, unknown>;
            model = text(payload.model);
            rawSeconds = payload.seconds;
            rawDuration = payload.duration;
            images = positiveNumber(payload.n ?? payload.count, 1);
            seconds = positiveNumber(payload.seconds ?? payload.duration, defaultVideoSeconds(path));
        }
    } catch {
        throw new AuthError("请求内容无法解析", 400, "invalid_request_body");
    }
    if (isH3BillingModel(model) && modelPrices()[model.trim().toLowerCase()]?.unit === "second") {
        if (rawSeconds != null && rawDuration != null && Number(rawSeconds) !== Number(rawDuration)) throw new AuthError("seconds 与 duration 必须一致", 400, "conflicting_video_duration");
        seconds = rawSeconds == null && rawDuration == null ? 10 : Number(rawSeconds ?? rawDuration);
    }
    return { model: resolveCanvasBillingModel(model, request.headers.get("x-canvas-billing-model")), images, seconds };
}

/**
 * Product video requests use the public product id for billing while the
 * upstream body continues to carry the provider's base model id.  Only a
 * product id whose declared base model matches the request body is accepted;
 * arbitrary client headers can therefore never downgrade another model's
 * price.
 */
export function resolveCanvasBillingModel(requestModel: string, requestedBillingModel?: string | null) {
    const bodyModel = requestModel.trim().toLowerCase().split("::").at(-1) || "";
    const candidate = (requestedBillingModel || "").trim().toLowerCase().split("::").at(-1) || "";
    if (!candidate || candidate === bodyModel) return bodyModel || requestModel.trim();
    const spec = productVideoSpec(candidate);
    if (!spec || spec.quality === "720p") return bodyModel || requestModel.trim();
    if (spec.family === "omni") {
        return bodyModel === "omni" || bodyModel === "omni_portrait" ? candidate : bodyModel || requestModel.trim();
    }
    return bodyModel === spec.baseModel.trim().toLowerCase() ? candidate : bodyModel || requestModel.trim();
}

function defaultVideoSeconds(path: string) {
    return path.includes("video") || path.includes("contents/generations") ? 10 : 1;
}

function taskIdFromPath(path: string) {
    return /^v1\/videos\/generations\/([^/]+)$/.exec(path)?.[1] || /^v1\/videos\/([^/]+)$/.exec(path)?.[1] || /^v1\/contents\/generations\/tasks\/([^/]+)$/.exec(path)?.[1] || "";
}

function envelopeData(payload: unknown) {
    if (payload && typeof payload === "object" && "data" in payload) return (payload as { data?: unknown }).data;
    return payload;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
