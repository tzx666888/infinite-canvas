export type AccountRole = "root" | "member";

export type AuthUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    role: AccountRole;
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
