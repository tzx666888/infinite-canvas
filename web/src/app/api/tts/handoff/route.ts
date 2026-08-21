import { nanoid } from "nanoid";
import type { NextRequest } from "next/server";

import { authErrorResponse } from "@/lib/auth/auth-error";
import { requireAuthUser } from "@/lib/auth/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HandoffPayload = { apiKey?: string };

function maskKey(key: string) {
    if (key.length <= 10) return "已接管";
    return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export async function POST(request: NextRequest) {
    try {
        await requireAuthUser();
        let payload: HandoffPayload = {};
        try {
            payload = (await request.json()) as HandoffPayload;
        } catch {
            payload = {};
        }
        const suppliedKey = String(payload.apiKey || "").trim();
        const apiKey = (process.env.TOKAXIS_TTS_API_KEY || process.env.CANVAS_UPSTREAM_API_KEY || suppliedKey).trim();
        if (!apiKey) return Response.json({ error: "tts_key_missing", message: "TTS 服务授权尚未配置，请联系管理员" }, { status: 503 });
        const secret = process.env.TOKAXIS_TTS_HANDOFF_SECRET || process.env.TTS_HANDOFF_SECRET;
        if (!secret) return Response.json({ error: "handoff_secret_missing", message: "TTS handoff secret 未配置" }, { status: 500 });
        const ttsInternal = (process.env.TOKAXIS_TTS_INTERNAL_URL || "https://tts.tokaxis.com/ui-api").replace(/\/+$/, "");
        const ttsPublic = (process.env.TOKAXIS_TTS_APP_URL || "https://tts.tokaxis.com").replace(/\/+$/, "");
        const token = nanoid(40);
        const upstream = await fetch(`${ttsInternal}/handoff/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Handoff-Secret": secret },
            body: JSON.stringify({ token, api_key: apiKey, ttl_sec: 600 }),
        });
        if (!upstream.ok) {
            const detail = await upstream.text().catch(() => "");
            let upstreamError = "";
            try {
                upstreamError = String(JSON.parse(detail).error || "");
            } catch {
                upstreamError = "";
            }
            if (upstream.status === 401 || upstreamError === "invalid_api_key") {
                return Response.json({ error: "invalid_api_key", message: "TTS 服务授权无效，请联系管理员" }, { status: 401 });
            }
            return Response.json({ error: "handoff_register_failed", message: "TTS 服务暂时不可用，请稍后重试" }, { status: 502 });
        }
        return Response.json({ url: `${ttsPublic}/?handoff=${encodeURIComponent(token)}`, keyHint: maskKey(apiKey) });
    } catch (error) {
        return authErrorResponse(error);
    }
}
