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

export type ManagedUserSummary = {
    id: string;
    username: string;
    displayName: string;
    role: AccountRole;
    provider: "local" | "migrated" | "tokaxis";
    status: "active" | "disabled";
    credits: number;
    activeKeyCount: number;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
};

export type ManagedUserDetailStats = {
    currentCredits: number;
    paidRechargeAmountYuan: number;
    paidRechargeCredits: number;
    paidRechargeCount: number;
    totalAddedCredits: number;
    totalConsumedCredits: number;
    totalDeductedCredits: number;
    ledgerNetCredits: number;
    historicalCarryoverCredits: number;
};

export type ManagedUserPaymentOrder = PaymentOrderSummary & {
    orderNo: string;
    providerTradeNo: string | null;
};

export type ManagedUserDetails = {
    user: ManagedUserSummary;
    stats: ManagedUserDetailStats;
    ledger: {
        items: CreditLedgerEntry[];
        total: number;
        page: number;
        pageSize: number;
    };
    paymentOrders: {
        items: ManagedUserPaymentOrder[];
        total: number;
        page: number;
        pageSize: number;
    };
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

export type PaymentMethod = {
    type: string;
    name: string;
};

export type PaymentPackage = {
    amountYuan: number;
    credits: number;
};

export type PaymentOrderSummary = {
    id: string;
    status: "pending" | "paid" | "expired";
    amountYuan: number;
    credits: number;
    paymentMethod: string;
    createdAt: string;
    paidAt: string | null;
    expiresAt: string;
};
