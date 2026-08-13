import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { AuthError } from "../auth/auth-error.ts";
import { refundCredits, refundCreditsByTask, reserveCredits, settleCredits, settleCreditsByTask } from "../auth/store.ts";

type PriceUnit = "request" | "image" | "second";
type PriceRule = { credits: number; unit: PriceUnit };
type GatewayIdentity = { keyId: string; userId: string };

export type GatewayReservation = {
    requestId: string;
    path: string;
    model: string;
    amount: number;
};

export async function reserveGatewayRequest(request: NextRequest, path: string, identity: GatewayIdentity, requestIdOverride?: string): Promise<GatewayReservation | null> {
    if (request.method !== "POST" || path === "v1/models") return null;
    const prices = modelPrices();
    if (!billingEnabled()) return null;
    const usage = await requestUsage(request, path);
    if (!usage.model) throw new AuthError("请求缺少模型名称", 400, "missing_model");
    const rule = prices[usage.model.toLowerCase()];
    if (!rule) throw new AuthError(`模型 ${usage.model} 暂未配置积分价格`, 409, "model_price_missing");
    const units = rule.unit === "second" ? usage.seconds : rule.unit === "image" ? usage.images : 1;
    const amount = Math.max(1, Math.ceil(rule.credits * Math.max(1, units)));
    const requestId = requestIdOverride?.trim().slice(0, 100) || request.headers.get("x-canvas-request-id")?.trim().slice(0, 100) || randomUUID();
    reserveCredits({ userId: identity.userId, apiKeyId: identity.keyId, requestId, model: usage.model, amount, units, unit: rule.unit });
    return { requestId, path, model: usage.model, amount };
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
            settleCredits(reservation.requestId, taskId);
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
        const parsed = JSON.parse(raw) as Record<string, { credits?: unknown; unit?: unknown }>;
        return Object.fromEntries(
            Object.entries(parsed).flatMap(([model, rule]) => {
                const credits = Number(rule?.credits);
                const unit = rule?.unit;
                return model.trim() && Number.isFinite(credits) && credits > 0 && (unit === "request" || unit === "image" || unit === "second") ? [[model.trim().toLowerCase(), { credits, unit } satisfies PriceRule]] : [];
            }),
        );
    } catch {
        throw new AuthError("积分价格配置无效，请联系管理员", 503, "invalid_price_config");
    }
}

async function requestUsage(request: NextRequest, path: string) {
    let model = "";
    let images = 1;
    let seconds = 1;
    const contentType = request.headers.get("content-type") || "";
    try {
        if (contentType.includes("multipart/form-data")) {
            const form = await request.clone().formData();
            model = text(form.get("model"));
            images = positiveNumber(form.get("n"), 1);
            seconds = positiveNumber(form.get("seconds") ?? form.get("duration"), 1);
        } else {
            const payload = (await request.clone().json()) as Record<string, unknown>;
            model = text(payload.model);
            images = positiveNumber(payload.n ?? payload.count, 1);
            seconds = positiveNumber(payload.seconds ?? payload.duration, defaultVideoSeconds(path));
        }
    } catch {
        throw new AuthError("请求内容无法解析", 400, "invalid_request_body");
    }
    return { model: model.split("::").at(-1) || model, images, seconds };
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
