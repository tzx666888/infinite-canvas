import type { AuthUser, BillingProfile, BillingUnit, CanvasApiKeySummary, CreditLedgerEntry, InviteSummary, ManagedUserDetails, ManagedUserSummary, PaymentMethod, PaymentOrderSummary, PaymentPackage } from "@/lib/auth/types";

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

export async function createInvitation(input: { label?: string; maxUses?: number; expiresInDays?: number | null; billingProfileId?: string | null }) {
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

export async function fetchManagedUsers(query = "") {
    const search = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
    return requestAuth<{ users: ManagedUserSummary[] }>(`/api/admin/users${search}`);
}

export async function fetchManagedUserDetails(userId: string, input: { ledgerPage?: number; paymentPage?: number; pageSize?: number } = {}) {
    const search = new URLSearchParams({
        ledgerPage: String(input.ledgerPage || 1),
        paymentPage: String(input.paymentPage || 1),
        pageSize: String(input.pageSize || 20),
    });
    return requestAuth<ManagedUserDetails>(`/api/admin/users/${encodeURIComponent(userId)}/details?${search.toString()}`);
}

export async function updateManagedUser(userId: string, input: { displayName?: string; role?: "admin" | "member"; status?: "active" | "disabled" }) {
    return requestAuth<{ user: ManagedUserSummary }>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export type BasePriceMap = Record<string, { credits: number; unit: BillingUnit }>;

export async function fetchBillingProfiles() {
    return requestAuth<{ profiles: BillingProfile[]; basePrices: BasePriceMap }>("/api/admin/billing-profiles");
}

export async function createBillingProfile(input: { name: string; rules: Array<{ model: string; creditsPerUnit: number }> }) {
    return requestAuth<{ profile: BillingProfile }>("/api/admin/billing-profiles", { method: "POST", body: JSON.stringify(input) });
}

export async function updateBillingProfile(profileId: string, input: { name?: string; active?: boolean; rules?: Array<{ model: string; creditsPerUnit: number }> }) {
    return requestAuth<{ profile: BillingProfile }>(`/api/admin/billing-profiles/${encodeURIComponent(profileId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function revokeManagedUserKeys(userId: string) {
    return requestAuth<{ revokedCount: number }>(`/api/admin/users/${encodeURIComponent(userId)}/keys`, { method: "DELETE", body: "{}" });
}

export async function fetchPaymentConfig() {
    return requestAuth<{ enabled: boolean; methods: PaymentMethod[]; packages: PaymentPackage[] }>("/api/account/payments/config");
}

export async function createPaymentOrder(input: { amountYuan: number; paymentMethod: string }) {
    return requestAuth<{ order: PaymentOrderSummary; form: { action: string; fields: Record<string, string> }; checkoutUrl: string }>("/api/account/payments/orders", { method: "POST", body: JSON.stringify(input) });
}

export async function fetchPaymentOrder(orderId: string) {
    return requestAuth<{ order: PaymentOrderSummary }>(`/api/account/payments/orders/${encodeURIComponent(orderId)}`);
}
