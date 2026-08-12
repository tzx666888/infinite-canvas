import type { AuthUser, InviteSummary } from "@/lib/auth/types";

type AuthResponse = { user: AuthUser };

export class AuthRequestError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "AuthRequestError";
        this.status = status;
        this.code = code;
    }
}

async function requestAuth<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        credentials: "same-origin",
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
        },
    });
    const payload = (await response.json().catch(() => null)) as { message?: string; code?: string } & T;
    if (!response.ok) throw new AuthRequestError(payload?.message || "账户请求失败", response.status, payload?.code);
    return payload;
}

export async function fetchCurrentUser() {
    const result = await requestAuth<{ user: AuthUser | null }>("/api/auth/me");
    return result.user;
}

export async function loginAccount(input: { username: string; password: string; code?: string }) {
    return requestAuth<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export async function registerAccount(input: { username: string; password: string; inviteCode: string }) {
    return requestAuth<AuthResponse>("/api/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export async function logoutAccount() {
    await requestAuth<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" });
}

export async function fetchInvites() {
    return requestAuth<{ invites: InviteSummary[] }>("/api/admin/invitations");
}

export async function createInvitation(input: { label?: string; maxUses?: number; expiresInDays?: number | null }) {
    return requestAuth<{ code: string; invite: InviteSummary }>("/api/admin/invitations", { method: "POST", body: JSON.stringify(input) });
}

export async function revokeInvitation(inviteId: string) {
    return requestAuth<{ invite: InviteSummary }>(`/api/admin/invitations/${encodeURIComponent(inviteId)}`, { method: "DELETE", body: "{}" });
}
