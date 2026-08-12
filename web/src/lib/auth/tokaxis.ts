import { AuthError } from "@/lib/auth/auth-error";
import { parseTokaxisIdentity, type TokaxisIdentity } from "@/lib/auth/tokaxis-identity";

export type { TokaxisIdentity } from "@/lib/auth/tokaxis-identity";

export type TokaxisAuthResult =
    | { status: "authenticated"; identity: TokaxisIdentity }
    | { status: "invalid" }
    | { status: "two_factor_required"; message: string }
    | { status: "blocked"; message: string }
    | { status: "unavailable" };

function tokaxisOrigin() {
    return (process.env.TOKAXIS_INTERNAL_ORIGIN || "http://127.0.0.1:3000").replace(/\/+$/, "");
}

function sharedSecret() {
    const value = process.env.CANVAS_AUTH_SHARED_SECRET?.trim();
    return value && value.length >= 32 ? value : null;
}

export async function verifyTokaxisCredentials(input: { username: string; password: string; code?: string }): Promise<TokaxisAuthResult> {
    const secret = sharedSecret();
    if (!secret) return { status: "unavailable" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
        const response = await fetch(`${tokaxisOrigin()}/api/internal/canvas/auth`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Canvas-Auth-Secret": secret,
            },
            body: JSON.stringify(input),
            cache: "no-store",
            signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as { success?: boolean; data?: unknown; message?: string } | null;
        const identity = payload?.success ? parseTokaxisIdentity(payload.data) : null;
        if (response.ok && identity) return { status: "authenticated", identity };
        const code = typeof (payload as { code?: unknown } | null)?.code === "string" ? (payload as { code: string }).code : "";
        if (response.status === 403 && code === "two_factor_required") return { status: "two_factor_required", message: payload?.message || "请输入动态验证码或备用码" };
        if (response.status === 401 && code === "invalid_two_factor") return { status: "blocked", message: payload?.message || "动态验证码或备用码错误" };
        if (response.status === 403 || response.status === 429) return { status: "blocked", message: payload?.message || "该账号暂不能用于画布登录" };
        if (response.status === 400 || response.status === 401) return { status: "invalid" };
        return { status: "unavailable" };
    } catch {
        return { status: "unavailable" };
    } finally {
        clearTimeout(timeout);
    }
}

export function tokaxisAuthError(result: Extract<TokaxisAuthResult, { status: "blocked" }>) {
    return new AuthError(result.message, 403);
}
