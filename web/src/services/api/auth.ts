import type { AuthUser, CanvasApiKeySummary, CreditLedgerEntry, InviteSummary, PaymentMethod, PaymentOrderSummary, PaymentPackage } from "@/lib/auth/types";

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

export async function fetchCanvasApiKeys() {
    return requestAuth<{ apiKeys: CanvasApiKeySummary[] }>("/api/account/keys");
}

export async function createCanvasApiKey(name?: string) {
    return requestAuth<{ key: string; apiKey: CanvasApiKeySummary }>("/api/account/keys", { method: "POST", body: JSON.stringify({ name }) });
}

export async function revokeCanvasApiKey(keyId: string) {
    return requestAuth<{ apiKey: CanvasApiKeySummary }>(`/api/account/keys/${encodeURIComponent(keyId)}`, { method: "DELETE", body: "{}" });
}

export async function fetchWallet() {
    return requestAuth<{ credits: number; creditsPerYuan: number; ledger: CreditLedgerEntry[] }>("/api/account/wallet");
}

export async function adjustAccountCredits(input: { username: string; amount: number; remark?: string }) {
    return requestAuth<{ user: AuthUser; credits: number }>("/api/admin/credits", { method: "POST", body: JSON.stringify(input) });
}

export async function fetchPaymentConfig() {
    return requestAuth<{ enabled: boolean; methods: PaymentMethod[]; packages: PaymentPackage[] }>("/api/account/payments/config");
}

export async function createPaymentOrder(input: { amountYuan: number; paymentMethod: string }) {
    return requestAuth<{ order: PaymentOrderSummary; form: { action: string; fields: Record<string, string> } }>("/api/account/payments/orders", { method: "POST", body: JSON.stringify(input) });
}

export async function fetchPaymentOrder(orderId: string) {
    return requestAuth<{ order: PaymentOrderSummary }>(`/api/account/payments/orders/${encodeURIComponent(orderId)}`);
}
