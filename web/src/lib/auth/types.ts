export type AccountRole = "root" | "member";

export type AuthUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    role: AccountRole;
    credits: number;
    createdAt: string;
};

export type InviteSummary = {
    id: string;
    label: string;
    createdAt: string;
    expiresAt: string | null;
    maxUses: number;
    usedCount: number;
    revokedAt: string | null;
    status: "active" | "used" | "expired" | "revoked";
};

export type CanvasApiKeySummary = {
    id: string;
    name: string;
    prefix: string;
    lastFour: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
};

export type CreditLedgerEntry = {
    id: string;
    type: "recharge" | "consume" | "refund" | "admin_adjust" | "registration_bonus" | "migration_credit";
    amount: number;
    balanceAfter: number;
    model: string | null;
    units: number | null;
    remark: string;
    createdAt: string;
};
