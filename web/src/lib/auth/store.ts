import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import { AuthError } from "./auth-error.ts";
import { canvasDatabase, withImmediateTransaction, type CanvasDatabase } from "./database.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import type {
    AdminDistributorOverview,
    AdminInviteOverview,
    AdminOverview,
    AuthUser,
    BillingPriceRule,
    BillingProfile,
    BillingUnit,
    CanvasApiKeySummary,
    CreditLedgerEntry,
    InviteSummary,
    ManagedUserDetails,
    ManagedUserPaymentOrder,
    ManagedUserSummary,
    PaymentOrderSummary,
} from "./types.ts";

type AccountRow = Record<string, unknown>;
type ApiKeyIdentity = { keyId: string; user: AuthUser };
type PaymentOrderRow = Record<string, unknown>;

export type CreatedCanvasApiKey = { key: string; apiKey: CanvasApiKeySummary };
export type CreditReservation = { requestId: string; amount: number; status: "reserved" | "submitted" | "settled" | "refunded" };

export type SubmittedBillingTask = {
    requestId: string;
    userId: string;
    username: string;
    displayName: string;
    upstreamTaskId: string;
    upstreamPath: string;
    model: string;
    updatedAt: string;
};

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function now() {
    return new Date().toISOString();
}

function normalizeUsername(value: string) {
    return value.trim().toLowerCase();
}

function validateUsername(value: string) {
    const username = normalizeUsername(value);
    if (!/^[a-z0-9_-]{3,32}$/.test(username)) throw new AuthError("用户名需为 3-32 位小写字母、数字、下划线或短横线");
    return username;
}

function validatePassword(value: string) {
    if (value.length < 12 || value.length > 128) throw new AuthError("密码需为 12-128 位");
    return value;
}

function normalizeInviteCode(value: string) {
    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

function inviteCodeHash(value: string) {
    return createHash("sha256").update(normalizeInviteCode(value)).digest("base64url");
}

function apiKeyHash(value: string) {
    const pepper = process.env.CANVAS_API_KEY_PEPPER?.trim() || process.env.CANVAS_SESSION_SECRET?.trim();
    if (!pepper && process.env.NODE_ENV === "production") throw new AuthError("画布 Key 安全密钥尚未配置", 503, "api_key_pepper_missing");
    return createHash("sha256")
        .update(`${pepper || "local-development-only"}:${value.trim()}`)
        .digest("base64url");
}

function createInviteCode() {
    const bytes = randomBytes(16);
    const characters = Array.from(bytes, (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]);
    return `VC-${characters.slice(0, 4).join("")}-${characters.slice(4, 8).join("")}-${characters.slice(8, 12).join("")}-${characters.slice(12, 16).join("")}`;
}

function toAuthUser(row: AccountRow): AuthUser {
    return {
        id: String(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        avatarUrl: String(row.avatar_url || ""),
        role: effectiveRole(row),
        credits: Number(row.credits || 0),
        createdAt: String(row.created_at),
    };
}

function effectiveRole(row: AccountRow): AuthUser["role"] {
    if (String(row.role) === "root" && String(row.username).trim().toLowerCase() === "root") return "root";
    return Number(row.is_distributor || 0) ? "admin" : "member";
}

function toManagedUserSummary(row: AccountRow): ManagedUserSummary {
    return {
        id: String(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        role: effectiveRole(row),
        provider: row.provider === "local" || row.provider === "tokaxis" ? row.provider : "migrated",
        status: row.status === "disabled" ? "disabled" : "active",
        credits: Number(row.credits || 0),
        activeKeyCount: Number(row.active_key_count || 0),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
        ownerAdminId: row.owner_admin_id ? String(row.owner_admin_id) : null,
        ownerAdminName: row.owner_admin_name ? String(row.owner_admin_name) : null,
        billingProfileId: row.billing_profile_id ? String(row.billing_profile_id) : null,
        billingProfileName: row.billing_profile_name ? String(row.billing_profile_name) : null,
    };
}

function inviteStatus(row: AccountRow): InviteSummary["status"] {
    if (row.revoked_at) return "revoked";
    if (row.expires_at && Date.parse(String(row.expires_at)) <= Date.now()) return "expired";
    if (Number(row.used_count) >= Number(row.max_uses)) return "used";
    return "active";
}

function toInviteSummary(row: AccountRow): InviteSummary {
    return {
        id: String(row.id),
        label: String(row.label),
        createdAt: String(row.created_at),
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        maxUses: Number(row.max_uses),
        usedCount: Number(row.used_count),
        revokedAt: row.revoked_at ? String(row.revoked_at) : null,
        status: inviteStatus(row),
        createdBy: String(row.created_by),
        createdByUsername: String(row.created_by_username || "root"),
        billingProfileId: row.billing_profile_id ? String(row.billing_profile_id) : null,
        billingProfileName: row.billing_profile_name ? String(row.billing_profile_name) : null,
    };
}

function toApiKeySummary(row: AccountRow): CanvasApiKeySummary {
    return {
        id: String(row.id),
        name: String(row.name),
        prefix: String(row.prefix),
        lastFour: String(row.last_four),
        createdAt: String(row.created_at),
        lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
        revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    };
}

function toPaymentOrderSummary(row: PaymentOrderRow): PaymentOrderSummary {
    return {
        id: String(row.id),
        status: row.status === "paid" ? "paid" : row.status === "expired" ? "expired" : "pending",
        amountYuan: Number(row.amount_cents) / 100,
        credits: Number(row.credits),
        paymentMethod: String(row.payment_method),
        createdAt: String(row.created_at),
        paidAt: row.paid_at ? String(row.paid_at) : null,
        expiresAt: String(row.expires_at),
    };
}

function toManagedUserPaymentOrder(row: PaymentOrderRow): ManagedUserPaymentOrder {
    return {
        ...toPaymentOrderSummary(row),
        orderNo: String(row.order_no),
        providerTradeNo: row.provider_trade_no ? String(row.provider_trade_no) : null,
    };
}

export async function ensureBootstrapRoot() {
    const usernameInput = process.env.CANVAS_BOOTSTRAP_ROOT_USERNAME?.trim();
    const passwordInput = process.env.CANVAS_BOOTSTRAP_ROOT_PASSWORD || "";
    if (!usernameInput || !passwordInput) return;
    const username = validateUsername(usernameInput);
    validatePassword(passwordInput);
    const database = canvasDatabase();
    if (database.prepare("SELECT id FROM accounts WHERE role = 'root' LIMIT 1").get()) return;
    const timestamp = now();
    database
        .prepare(
            `
        INSERT OR IGNORE INTO accounts
            (id, username, display_name, role, provider, password_hash, credits, created_at, updated_at)
        VALUES (?, ?, ?, 'root', 'local', ?, ?, ?, ?)
    `,
        )
        .run(randomUUID(), username, username, await hashPassword(passwordInput), Math.max(0, Math.floor(Number(process.env.CANVAS_BOOTSTRAP_ROOT_CREDITS || 0))), timestamp, timestamp);
}

export async function authenticateLocalUser(input: { username: string; password: string }) {
    await ensureBootstrapRoot();
    const username = normalizeUsername(input.username);
    const database = canvasDatabase();
    const account = database.prepare("SELECT * FROM accounts WHERE username = ? AND status = 'active'").get(username);
    if (!account || !String(account.password_hash) || !(await verifyPassword(input.password, String(account.password_hash)))) return null;
    const timestamp = now();
    database.prepare("UPDATE accounts SET last_login_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, account.id);
    return toAuthUser({ ...account, last_login_at: timestamp, updated_at: timestamp });
}

export async function registerWithInvite(input: { username: string; password: string; inviteCode: string }) {
    await ensureBootstrapRoot();
    const username = validateUsername(input.username);
    const password = validatePassword(input.password);
    const codeHash = inviteCodeHash(input.inviteCode);
    if (!normalizeInviteCode(input.inviteCode)) throw new AuthError("请输入邀请码");
    const passwordHash = await hashPassword(password);
    const initialCredits = Math.max(0, Math.floor(Number(process.env.CANVAS_INVITE_INITIAL_CREDITS || 0)));
    return withImmediateTransaction((database) => {
        if (database.prepare("SELECT id FROM accounts WHERE username = ?").get(username)) throw new AuthError("该用户名已被使用", 409);
        const invite = database
            .prepare(
                `SELECT i.*, a.is_distributor AS creator_is_distributor, a.status AS creator_status
                      FROM invites i JOIN accounts a ON a.id = i.created_by WHERE i.code_hash = ?`,
            )
            .get(codeHash);
        if (!invite || inviteStatus(invite) !== "active") throw new AuthError("邀请码无效、已过期或已使用", 403);
        const createdByAdmin = Number(invite.creator_is_distributor || 0) === 1;
        if (createdByAdmin && invite.creator_status !== "active") throw new AuthError("该邀请链接已停用", 403);
        const ownedByAdmin = createdByAdmin;
        if (ownedByAdmin && !invite.billing_profile_id) throw new AuthError("该邀请链接未绑定计费方案", 409);
        if (ownedByAdmin) {
            const profile = database.prepare("SELECT id FROM billing_profiles WHERE id = ? AND admin_user_id = ? AND active = 1").get(invite.billing_profile_id, invite.created_by);
            if (!profile) throw new AuthError("该邀请链接的计费方案已停用", 409);
        }
        const createdAt = now();
        const id = randomUUID();
        database
            .prepare(`INSERT INTO accounts (id, username, display_name, role, provider, password_hash, credits, owner_admin_id, billing_profile_id, created_at, updated_at, last_login_at) VALUES (?, ?, ?, 'member', 'local', ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, username, username, passwordHash, initialCredits, ownedByAdmin ? invite.created_by : null, ownedByAdmin ? invite.billing_profile_id : null, createdAt, createdAt, createdAt);
        database.prepare("UPDATE invites SET used_count = used_count + 1 WHERE id = ?").run(invite.id);
        if (initialCredits) insertLedger(database, { userId: id, type: "registration_bonus", amount: initialCredits, balanceAfter: initialCredits, remark: "注册赠送积分" });
        return toAuthUser({ id, username, display_name: username, avatar_url: "", role: "member", credits: initialCredits, created_at: createdAt });
    });
}

export async function getAuthUser(userId: string) {
    await ensureBootstrapRoot();
    const account = canvasDatabase().prepare("SELECT * FROM accounts WHERE id = ? AND status = 'active'").get(userId);
    return account ? toAuthUser(account) : null;
}

export function getCanvasUpstreamApiKey(userId: string) {
    const row = canvasDatabase().prepare("SELECT upstream_api_key_ciphertext FROM accounts WHERE id = ? AND status = 'active'").get(userId);
    const ciphertext = row?.upstream_api_key_ciphertext;
    if (typeof ciphertext !== "string" || !ciphertext) return null;
    return decryptCanvasUpstreamApiKey(ciphertext);
}

export function saveCanvasUpstreamApiKey(userId: string, apiKey: string) {
    const ciphertext = encryptCanvasUpstreamApiKey(apiKey);
    if (!ciphertext) return false;
    canvasDatabase().prepare("UPDATE accounts SET upstream_api_key_ciphertext = ?, updated_at = ? WHERE id = ?").run(ciphertext, now(), userId);
    return true;
}

function canvasUpstreamEncryptionKey() {
    const secret = process.env.CANVAS_AUTH_SHARED_SECRET?.trim() || process.env.CANVAS_SESSION_SECRET?.trim();
    if (!secret || secret.length < 32) return null;
    return createHash("sha256").update(`infinite-canvas-upstream:${secret}`).digest();
}

function encryptCanvasUpstreamApiKey(apiKey: string) {
    const key = canvasUpstreamEncryptionKey();
    if (!key || !apiKey.trim()) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(apiKey.trim(), "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString("base64url")).join(".");
}

function decryptCanvasUpstreamApiKey(value: string) {
    const key = canvasUpstreamEncryptionKey();
    const parts = value.split(".");
    if (!key || parts.length !== 3) return null;
    try {
        const iv = Buffer.from(parts[0], "base64url");
        const authTag = Buffer.from(parts[1], "base64url");
        const encrypted = Buffer.from(parts[2], "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch {
        return null;
    }
}

export async function createInvite(input: { actorUserId: string; label?: string; maxUses?: number; expiresInDays?: number | null; billingProfileId?: string | null }) {
    await ensureBootstrapRoot();
    const label = input.label?.trim().slice(0, 80) || "未命名邀请码";
    const maxUses = Math.max(1, Math.min(100, Math.floor(Number(input.maxUses) || 1)));
    const requestedDays = input.expiresInDays === null ? null : Number(input.expiresInDays ?? 7);
    const expiresInDays = requestedDays === null ? null : Math.max(1, Math.min(90, Math.floor(Number.isFinite(requestedDays) ? requestedDays : 7)));
    return withImmediateTransaction((database) => {
        const actor = requireAdmin(database, input.actorUserId);
        let profileId = input.billingProfileId?.trim() || null;
        if (effectiveRole(actor) === "admin") {
            if (!profileId) throw new AuthError("分销邀请必须选择计费方案");
            if (!database.prepare("SELECT id FROM billing_profiles WHERE id = ? AND admin_user_id = ? AND active = 1").get(profileId, input.actorUserId)) throw new AuthError("计费方案不存在或已停用", 404);
        } else {
            profileId = null;
        }
        const createdAt = now();
        const code = createInviteCode();
        const row = {
            id: randomUUID(),
            code_hash: inviteCodeHash(code),
            label,
            created_by: input.actorUserId,
            created_by_username: actor.username,
            billing_profile_id: profileId,
            billing_profile_name: profileId ? database.prepare("SELECT name FROM billing_profiles WHERE id = ?").get(profileId)?.name : null,
            created_at: createdAt,
            expires_at: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
            max_uses: maxUses,
            used_count: 0,
            revoked_at: null,
        };
        database
            .prepare(`INSERT INTO invites (id, code_hash, label, created_by, billing_profile_id, created_at, expires_at, max_uses, used_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`)
            .run(row.id, row.code_hash, row.label, row.created_by, row.billing_profile_id, row.created_at, row.expires_at, row.max_uses);
        return { code, invite: toInviteSummary(row) };
    });
}

export async function listInvites(actorUserId: string) {
    await ensureBootstrapRoot();
    const database = canvasDatabase();
    const actor = requireAdmin(database, actorUserId);
    const where = effectiveRole(actor) === "root" ? "" : "WHERE i.created_by = ?";
    const values = effectiveRole(actor) === "root" ? [] : [actorUserId];
    return database
        .prepare(`SELECT i.*, a.username AS created_by_username, p.name AS billing_profile_name FROM invites i JOIN accounts a ON a.id = i.created_by LEFT JOIN billing_profiles p ON p.id = i.billing_profile_id ${where} ORDER BY i.created_at DESC`)
        .all(...values)
        .map(toInviteSummary);
}

export async function revokeInvite(input: { actorUserId: string; inviteId: string }) {
    return withImmediateTransaction((database) => {
        const actor = requireAdmin(database, input.actorUserId);
        const invite = database
            .prepare("SELECT i.*, a.username AS created_by_username, p.name AS billing_profile_name FROM invites i JOIN accounts a ON a.id = i.created_by LEFT JOIN billing_profiles p ON p.id = i.billing_profile_id WHERE i.id = ?")
            .get(input.inviteId);
        if (!invite) throw new AuthError("邀请码不存在", 404);
        if (effectiveRole(actor) !== "root" && String(invite.created_by) !== input.actorUserId) throw new AuthError("没有此操作权限", 403);
        const revokedAt = String(invite.revoked_at || now());
        database.prepare("UPDATE invites SET revoked_at = ? WHERE id = ?").run(revokedAt, input.inviteId);
        return toInviteSummary({ ...invite, revoked_at: revokedAt });
    });
}

export async function createCanvasApiKey(userId: string, nameInput?: string): Promise<CreatedCanvasApiKey> {
    const database = canvasDatabase();
    if (!database.prepare("SELECT id FROM accounts WHERE id = ? AND status = 'active'").get(userId)) throw new AuthError("账户不存在", 404);
    const key = `vc_live_${randomBytes(24).toString("base64url")}`;
    const createdAt = now();
    const row = { id: randomUUID(), name: nameInput?.trim().slice(0, 50) || "默认画布 Key", prefix: key.slice(0, 12), last_four: key.slice(-4), created_at: createdAt, last_used_at: null, revoked_at: null };
    database.prepare("INSERT INTO api_keys (id, user_id, name, key_hash, prefix, last_four, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(row.id, userId, row.name, apiKeyHash(key), row.prefix, row.last_four, createdAt);
    return { key, apiKey: toApiKeySummary(row) };
}

export async function listCanvasApiKeys(userId: string) {
    return canvasDatabase().prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(toApiKeySummary);
}

export async function revokeCanvasApiKey(userId: string, keyId: string) {
    const database = canvasDatabase();
    const row = database.prepare("SELECT * FROM api_keys WHERE id = ? AND user_id = ?").get(keyId, userId);
    if (!row) throw new AuthError("画布 Key 不存在", 404);
    const revokedAt = String(row.revoked_at || now());
    database.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").run(revokedAt, keyId);
    return toApiKeySummary({ ...row, revoked_at: revokedAt });
}

export async function authenticateCanvasApiKey(value: string): Promise<ApiKeyIdentity | null> {
    const token = value.trim().replace(/^Bearer\s+/i, "");
    if (!token.startsWith("vc_live_")) return null;
    const database = canvasDatabase();
    const row = database.prepare(`SELECT k.id AS key_id, a.* FROM api_keys k JOIN accounts a ON a.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL AND a.status = 'active'`).get(apiKeyHash(token));
    if (!row) return null;
    database.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now(), row.key_id);
    return { keyId: String(row.key_id), user: toAuthUser(row) };
}

export async function authenticateCanvasApiKeyReadOnly(value: string): Promise<ApiKeyIdentity | null> {
    const token = value.trim().replace(/^Bearer\s+/i, "");
    if (!token.startsWith("vc_live_")) return null;
    const row = canvasDatabase().prepare(`SELECT k.id AS key_id, a.* FROM api_keys k JOIN accounts a ON a.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL AND a.status = 'active'`).get(apiKeyHash(token));
    return row ? { keyId: String(row.key_id), user: toAuthUser(row) } : null;
}

export async function walletSummary(userId: string) {
    const database = canvasDatabase();
    const account = database.prepare("SELECT credits FROM accounts WHERE id = ?").get(userId);
    if (!account) throw new AuthError("账户不存在", 404);
    const ledger = database.prepare("SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(userId).map(toLedgerEntry);
    return { credits: Number(account.credits), creditsPerYuan: 10, ledger };
}

function expirePendingPaymentOrders(database: CanvasDatabase) {
    database.prepare("UPDATE payment_orders SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expires_at <= ?").run(now(), now());
}

function createPaymentOrderNo() {
    return `VCP${randomUUID().replace(/-/g, "").slice(0, 25).toUpperCase()}`;
}

export type CreatedPaymentOrder = {
    order: PaymentOrderSummary;
    orderNo: string;
    amountCents: number;
};

export function createPaymentOrder(input: { userId: string; amountYuan: number; credits: number; paymentMethod: string }): CreatedPaymentOrder {
    const amountYuan = Math.floor(input.amountYuan);
    const credits = Math.floor(input.credits);
    if (!Number.isInteger(amountYuan) || amountYuan < 1 || !Number.isInteger(credits) || credits < 1) throw new AuthError("充值金额不正确");
    return withImmediateTransaction((database) => {
        const account = database.prepare("SELECT id FROM accounts WHERE id = ? AND status = 'active'").get(input.userId);
        if (!account) throw new AuthError("账户不存在", 404);
        expirePendingPaymentOrders(database);
        const existing = database
            .prepare("SELECT * FROM payment_orders WHERE user_id = ? AND payment_method = ? AND amount_cents = ? AND credits = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
            .get(input.userId, input.paymentMethod, amountYuan * 100, credits, now());
        if (existing) return { order: toPaymentOrderSummary(existing), orderNo: String(existing.order_no), amountCents: Number(existing.amount_cents) };

        const timestamp = now();
        const row = {
            id: randomUUID(),
            order_no: createPaymentOrderNo(),
            user_id: input.userId,
            payment_method: input.paymentMethod,
            amount_cents: amountYuan * 100,
            credits,
            status: "pending",
            created_at: timestamp,
            paid_at: null,
            expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
            updated_at: timestamp,
        };
        database
            .prepare("INSERT INTO payment_orders (id, order_no, user_id, payment_method, amount_cents, credits, status, created_at, paid_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(row.id, row.order_no, row.user_id, row.payment_method, row.amount_cents, row.credits, row.status, row.created_at, row.paid_at, row.expires_at, row.updated_at);
        return { order: toPaymentOrderSummary(row), orderNo: row.order_no, amountCents: row.amount_cents };
    });
}

export function getPaymentOrderForUser(userId: string, orderId: string) {
    return withImmediateTransaction((database) => {
        expirePendingPaymentOrders(database);
        const order = database.prepare("SELECT * FROM payment_orders WHERE id = ? AND user_id = ?").get(orderId, userId);
        if (!order) throw new AuthError("充值订单不存在", 404);
        return toPaymentOrderSummary(order);
    });
}

export function getPaymentCheckoutForUser(userId: string, orderId: string) {
    return withImmediateTransaction((database) => {
        expirePendingPaymentOrders(database);
        const order = database.prepare("SELECT * FROM payment_orders WHERE id = ? AND user_id = ?").get(orderId, userId);
        if (!order) throw new AuthError("充值订单不存在", 404);
        if (order.status !== "pending") throw new AuthError(order.status === "paid" ? "充值订单已经支付" : "充值订单已失效", 409, "payment_order_unavailable");
        return {
            orderNo: String(order.order_no),
            amountCents: Number(order.amount_cents),
            paymentMethod: String(order.payment_method),
        };
    });
}

export function completePaymentOrder(input: { orderNo: string; amountCents: number; providerTradeNo?: string }) {
    return withImmediateTransaction((database) => {
        const order = database.prepare("SELECT * FROM payment_orders WHERE order_no = ?").get(input.orderNo);
        if (!order) throw new AuthError("充值订单不存在", 404);
        if (Number(order.amount_cents) !== input.amountCents) throw new AuthError("充值金额校验失败", 400, "payment_amount_mismatch");
        if (order.status === "paid") return { order: toPaymentOrderSummary(order), newlyPaid: false };
        if (order.status !== "pending" && order.status !== "expired") throw new AuthError("充值订单已失效", 409, "payment_order_expired");

        const timestamp = now();
        const update = database
            .prepare("UPDATE payment_orders SET status = 'paid', provider_trade_no = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'expired')")
            .run(input.providerTradeNo?.slice(0, 128) || null, timestamp, timestamp, order.id);
        if (!Number(update.changes)) {
            const refreshed = database.prepare("SELECT * FROM payment_orders WHERE id = ?").get(order.id);
            return { order: toPaymentOrderSummary(refreshed || order), newlyPaid: false };
        }
        database.prepare("UPDATE accounts SET credits = credits + ?, updated_at = ? WHERE id = ?").run(Number(order.credits), timestamp, order.user_id);
        const balance = Number(database.prepare("SELECT credits FROM accounts WHERE id = ?").get(order.user_id)?.credits || 0);
        insertLedger(database, {
            userId: String(order.user_id),
            type: "recharge",
            amount: Number(order.credits),
            balanceAfter: balance,
            requestId: `payment:${String(order.id)}`,
            remark: "在线支付充值",
        });
        return { order: toPaymentOrderSummary({ ...order, status: "paid", provider_trade_no: input.providerTradeNo || null, paid_at: timestamp, updated_at: timestamp }), newlyPaid: true };
    });
}

export async function adjustUserCredits(input: { rootUserId: string; username: string; amount: number; remark?: string }) {
    const amount = Math.trunc(input.amount);
    if (!amount) throw new AuthError("积分调整值不能为 0");
    return withImmediateTransaction((database) => {
        requireRoot(database, input.rootUserId);
        const account = database.prepare("SELECT * FROM accounts WHERE username = ?").get(normalizeUsername(input.username));
        if (!account) throw new AuthError("用户不存在", 404);
        const balance = Number(account.credits) + amount;
        if (balance < 0) throw new AuthError("扣减后积分不能小于 0");
        database.prepare("UPDATE accounts SET credits = ?, updated_at = ? WHERE id = ?").run(balance, now(), account.id);
        insertLedger(database, { userId: String(account.id), type: amount > 0 ? "recharge" : "admin_adjust", amount, balanceAfter: balance, remark: input.remark?.trim() || "管理员调整积分" });
        return { user: toAuthUser({ ...account, credits: balance }), credits: balance };
    });
}

export async function listManagedUsers(input: { rootUserId: string; query?: string }) {
    const database = canvasDatabase();
    requireRoot(database, input.rootUserId);
    const query = input.query?.trim().toLocaleLowerCase() || "";
    const rows = database
        .prepare(
            `SELECT a.*, owner.username AS owner_admin_name, p.name AS billing_profile_name,
                    COUNT(CASE WHEN k.id IS NOT NULL AND k.revoked_at IS NULL THEN 1 END) AS active_key_count
             FROM accounts a
             LEFT JOIN api_keys k ON k.user_id = a.id
             LEFT JOIN accounts owner ON owner.id = a.owner_admin_id
             LEFT JOIN billing_profiles p ON p.id = a.billing_profile_id
             GROUP BY a.id
             ORDER BY CASE WHEN lower(a.username) = 'root' THEN 0 ELSE 1 END, a.created_at DESC
             LIMIT 1000`,
        )
        .all();
    return rows.map(toManagedUserSummary).filter((user) => !query || user.username.toLocaleLowerCase().includes(query) || user.displayName.toLocaleLowerCase().includes(query));
}

export function getAdminOverview(rootUserId: string): AdminOverview {
    const database = canvasDatabase();
    requireRoot(database, rootUserId);
    const accountStats = database
        .prepare(
            `SELECT COUNT(*) AS account_count,
                    COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_account_count,
                    COUNT(CASE WHEN is_distributor = 1 THEN 1 END) AS distributor_count,
                    COALESCE(SUM(credits), 0) AS current_credits
             FROM accounts`,
        )
        .get()!;
    const ledgerStats = database
        .prepare(
            `SELECT
                COALESCE(SUM(CASE WHEN type = 'consume' AND amount < 0 THEN -amount ELSE 0 END), 0) AS consumed_credits,
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS added_credits,
                COALESCE(SUM(CASE WHEN type = 'commission' AND amount > 0 THEN amount ELSE 0 END), 0) AS commission_credits
             FROM credit_ledger`,
        )
        .get()!;
    const paymentStats = database
        .prepare(
            `SELECT COUNT(*) AS order_count,
                    COALESCE(SUM(amount_cents), 0) AS amount_cents,
                    COALESCE(SUM(credits), 0) AS credits
             FROM payment_orders
             WHERE status = 'paid'`,
        )
        .get()!;
    const inviteStats = database.prepare("SELECT COUNT(*) AS invite_count, COALESCE(SUM(used_count), 0) AS used_invite_count FROM invites").get()!;
    const distributedCustomerCount = database.prepare("SELECT COUNT(*) AS count FROM accounts WHERE owner_admin_id IS NOT NULL").get()!;
    const distributors = database
        .prepare(
            `SELECT a.id, a.username, a.display_name, a.status,
                    (SELECT COUNT(*) FROM invites i WHERE i.created_by = a.id) AS invite_count,
                    (SELECT COALESCE(SUM(i.used_count), 0) FROM invites i WHERE i.created_by = a.id) AS used_invite_count,
                    (SELECT COUNT(*) FROM accounts child WHERE child.owner_admin_id = a.id) AS customer_count,
                    (SELECT COALESCE(SUM(child.credits), 0) FROM accounts child WHERE child.owner_admin_id = a.id) AS customer_credits,
                    (SELECT COALESCE(SUM(CASE WHEN l.type = 'consume' AND l.amount < 0 THEN -l.amount ELSE 0 END), 0)
                       FROM credit_ledger l WHERE l.user_id IN (SELECT child.id FROM accounts child WHERE child.owner_admin_id = a.id)) AS customer_consumed_credits,
                    (SELECT COALESCE(SUM(po.credits), 0) FROM payment_orders po
                       WHERE po.status = 'paid' AND po.user_id IN (SELECT child.id FROM accounts child WHERE child.owner_admin_id = a.id)) AS customer_recharge_credits,
                    (SELECT COALESCE(SUM(po.amount_cents), 0) FROM payment_orders po
                       WHERE po.status = 'paid' AND po.user_id IN (SELECT child.id FROM accounts child WHERE child.owner_admin_id = a.id)) AS customer_recharge_amount_cents,
                    (SELECT COALESCE(SUM(CASE WHEN l.type = 'commission' AND l.amount > 0 THEN l.amount ELSE 0 END), 0)
                       FROM credit_ledger l WHERE l.user_id = a.id) AS commission_credits
             FROM accounts a
             WHERE a.is_distributor = 1
             ORDER BY customer_count DESC, a.created_at ASC`,
        )
        .all()
        .map((row): AdminDistributorOverview => ({
            id: String(row.id),
            username: String(row.username),
            displayName: String(row.display_name),
            status: row.status === "disabled" ? "disabled" : "active",
            inviteCount: Number(row.invite_count || 0),
            usedInviteCount: Number(row.used_invite_count || 0),
            customerCount: Number(row.customer_count || 0),
            customerCredits: Number(row.customer_credits || 0),
            customerConsumedCredits: Number(row.customer_consumed_credits || 0),
            customerRechargeCredits: Number(row.customer_recharge_credits || 0),
            customerRechargeAmountYuan: Number(row.customer_recharge_amount_cents || 0) / 100,
            commissionCredits: Number(row.commission_credits || 0),
        }));
    const invites = database
        .prepare(
            `SELECT i.*, a.username AS created_by_username, p.name AS billing_profile_name,
                    i.used_count AS registered_count
             FROM invites i JOIN accounts a ON a.id = i.created_by
             LEFT JOIN billing_profiles p ON p.id = i.billing_profile_id
             ORDER BY i.created_at DESC LIMIT 500`,
        )
        .all()
        .map((row): AdminInviteOverview => ({ ...toInviteSummary(row), registeredCount: Number(row.registered_count || 0) }));
    return {
        totals: {
            accountCount: Number(accountStats.account_count || 0),
            activeAccountCount: Number(accountStats.active_account_count || 0),
            distributorCount: Number(accountStats.distributor_count || 0),
            currentCredits: Number(accountStats.current_credits || 0),
            totalConsumedCredits: Number(ledgerStats.consumed_credits || 0),
            totalAddedCredits: Number(ledgerStats.added_credits || 0),
            commissionCredits: Number(ledgerStats.commission_credits || 0),
            rechargeAmountYuan: Number(paymentStats.amount_cents || 0) / 100,
            rechargeCredits: Number(paymentStats.credits || 0),
            rechargeOrderCount: Number(paymentStats.order_count || 0),
            inviteCount: Number(inviteStats.invite_count || 0),
            usedInviteCount: Number(inviteStats.used_invite_count || 0),
            distributedCustomerCount: Number(distributedCustomerCount.count || 0),
        },
        distributors,
        invites,
    };
}

export async function getManagedUserDetails(input: { rootUserId: string; userId: string; ledgerPage?: number; paymentPage?: number; pageSize?: number }): Promise<ManagedUserDetails> {
    const database = canvasDatabase();
    requireRoot(database, input.rootUserId);
    const account = database
        .prepare(
            `SELECT a.*, owner.username AS owner_admin_name, p.name AS billing_profile_name,
                    COUNT(CASE WHEN k.id IS NOT NULL AND k.revoked_at IS NULL THEN 1 END) AS active_key_count
             FROM accounts a
             LEFT JOIN api_keys k ON k.user_id = a.id
             LEFT JOIN accounts owner ON owner.id = a.owner_admin_id
             LEFT JOIN billing_profiles p ON p.id = a.billing_profile_id
             WHERE a.id = ?
             GROUP BY a.id`,
        )
        .get(input.userId);
    if (!account) throw new AuthError("用户不存在", 404);

    const pageSize = Math.min(100, Math.max(10, Math.trunc(input.pageSize || 20)));
    const ledgerPage = Math.max(1, Math.trunc(input.ledgerPage || 1));
    const paymentPage = Math.max(1, Math.trunc(input.paymentPage || 1));
    const ledgerStats = database
        .prepare(
            `SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_added_credits,
                COALESCE(SUM(CASE WHEN type = 'consume' AND amount < 0 THEN -amount ELSE 0 END), 0) AS total_consumed_credits,
                COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS total_deducted_credits,
                COALESCE(SUM(amount), 0) AS ledger_net_credits
             FROM credit_ledger
             WHERE user_id = ?`,
        )
        .get(input.userId)!;
    const paymentStats = database
        .prepare(
            `SELECT
                COUNT(*) AS total,
                COALESCE(SUM(amount_cents), 0) AS paid_amount_cents,
                COALESCE(SUM(credits), 0) AS paid_credits
             FROM payment_orders
             WHERE user_id = ? AND status = 'paid'`,
        )
        .get(input.userId)!;
    const paymentTotal = Number(database.prepare("SELECT COUNT(*) AS total FROM payment_orders WHERE user_id = ?").get(input.userId)?.total || 0);
    const ledgerTotal = Number(ledgerStats.total || 0);
    const ledger = database
        .prepare("SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(input.userId, pageSize, (ledgerPage - 1) * pageSize)
        .map(toLedgerEntry);
    const paymentOrders = database
        .prepare("SELECT * FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(input.userId, pageSize, (paymentPage - 1) * pageSize)
        .map(toManagedUserPaymentOrder);
    const currentCredits = Number(account.credits || 0);
    const ledgerNetCredits = Number(ledgerStats.ledger_net_credits || 0);

    return {
        user: toManagedUserSummary(account),
        stats: {
            currentCredits,
            paidRechargeAmountYuan: Number(paymentStats.paid_amount_cents || 0) / 100,
            paidRechargeCredits: Number(paymentStats.paid_credits || 0),
            paidRechargeCount: Number(paymentStats.total || 0),
            totalAddedCredits: Number(ledgerStats.total_added_credits || 0),
            totalConsumedCredits: Number(ledgerStats.total_consumed_credits || 0),
            totalDeductedCredits: Number(ledgerStats.total_deducted_credits || 0),
            ledgerNetCredits,
            historicalCarryoverCredits: currentCredits - ledgerNetCredits,
        },
        ledger: { items: ledger, total: ledgerTotal, page: ledgerPage, pageSize },
        paymentOrders: { items: paymentOrders, total: paymentTotal, page: paymentPage, pageSize },
    };
}

export async function updateManagedUser(input: { rootUserId: string; userId: string; displayName?: string; role?: "admin" | "member"; status?: "active" | "disabled" }) {
    return withImmediateTransaction((database) => {
        requireRoot(database, input.rootUserId);
        const account = database.prepare("SELECT * FROM accounts WHERE id = ?").get(input.userId);
        if (!account) throw new AuthError("用户不存在", 404);

        const isPrimaryRoot = String(account.username).trim().toLowerCase() === "root";
        if (isPrimaryRoot && input.role) throw new AuthError("不能修改主 root 账号角色", 409);
        if (isPrimaryRoot && input.status === "disabled") throw new AuthError("不能禁用主 root 账号", 409);

        const updates: string[] = [];
        const values: unknown[] = [];
        if (input.displayName !== undefined) {
            const displayName = input.displayName.trim();
            if (!displayName) throw new AuthError("显示名称不能为空");
            if (displayName.length > 80) throw new AuthError("显示名称不能超过 80 个字符");
            updates.push("display_name = ?");
            values.push(displayName);
        }
        if (input.role !== undefined) {
            if (input.role !== "admin" && input.role !== "member") throw new AuthError("用户角色不正确");
            updates.push("role = 'member'", "is_distributor = ?");
            values.push(input.role === "admin" ? 1 : 0);
            if (input.role === "admin") updates.push("owner_admin_id = NULL", "billing_profile_id = NULL");
        }
        if (input.status !== undefined) {
            if (input.status !== "active" && input.status !== "disabled") throw new AuthError("用户状态不正确");
            updates.push("status = ?");
            values.push(input.status);
        }
        if (!updates.length) throw new AuthError("没有需要修改的内容");

        updates.push("updated_at = ?");
        values.push(now(), input.userId);
        database.prepare(`UPDATE accounts SET ${updates.join(", ")} WHERE id = ?`).run(...values);
        if (input.role === "member" && Number(account.is_distributor || 0)) {
            database.prepare("UPDATE billing_profiles SET active = 0, updated_at = ? WHERE admin_user_id = ?").run(now(), input.userId);
            database.prepare("UPDATE accounts SET owner_admin_id = NULL, billing_profile_id = NULL, updated_at = ? WHERE owner_admin_id = ?").run(now(), input.userId);
        }
        const updated = database
            .prepare(
                `SELECT a.*, owner.username AS owner_admin_name, p.name AS billing_profile_name,
                        COUNT(CASE WHEN k.id IS NOT NULL AND k.revoked_at IS NULL THEN 1 END) AS active_key_count
                 FROM accounts a LEFT JOIN api_keys k ON k.user_id = a.id
                 LEFT JOIN accounts owner ON owner.id = a.owner_admin_id LEFT JOIN billing_profiles p ON p.id = a.billing_profile_id
                 WHERE a.id = ? GROUP BY a.id`,
            )
            .get(input.userId);
        return toManagedUserSummary(updated!);
    });
}

export async function revokeManagedUserKeys(input: { rootUserId: string; userId: string }) {
    return withImmediateTransaction((database) => {
        requireRoot(database, input.rootUserId);
        const account = database.prepare("SELECT username FROM accounts WHERE id = ?").get(input.userId);
        if (!account) throw new AuthError("用户不存在", 404);
        if (String(account.username).trim().toLowerCase() === "root") throw new AuthError("不能批量撤销主 root 账号的 Key", 409);
        const timestamp = now();
        const result = database.prepare("UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(timestamp, input.userId);
        return { revokedCount: Number(result.changes) };
    });
}

type BasePriceMap = Record<string, { credits: number; unit: BillingUnit }>;

const DISTRIBUTOR_WHOLESALE_MULTIPLIER = 0.7;

function distributorWholesaleCredits(credits: number) {
    return Number((credits * DISTRIBUTOR_WHOLESALE_MULTIPLIER).toFixed(6));
}

function distributorBasePrices(basePrices: BasePriceMap): BasePriceMap {
    return Object.fromEntries(Object.entries(basePrices).map(([model, rule]) => [model, { ...rule, credits: distributorWholesaleCredits(rule.credits) }]));
}

function normalizeProfileRules(rules: Array<{ model: string; creditsPerUnit: number }>, basePrices: BasePriceMap): BillingPriceRule[] {
    const seen = new Set<string>();
    return rules.map((rule) => {
        const model = rule.model.trim().toLowerCase();
        const base = basePrices[model];
        const creditsPerUnit = Number(rule.creditsPerUnit);
        if (!model || seen.has(model) || !base) throw new AuthError("计费模型不正确");
        if (!Number.isFinite(creditsPerUnit) || creditsPerUnit < base.credits) throw new AuthError(`${model} 的分销价不能低于分销批发底价 ${base.credits}`);
        if (creditsPerUnit > 1_000_000) throw new AuthError("分销价超出允许范围");
        seen.add(model);
        return { model, baseCredits: base.credits, creditsPerUnit, unit: base.unit };
    });
}

function toBillingProfile(database: CanvasDatabase, row: AccountRow, basePrices: BasePriceMap): BillingProfile {
    const wholesalePrices = Number(row.admin_is_distributor || 0) === 1 ? distributorBasePrices(basePrices) : basePrices;
    const configured = new Map(
        database
            .prepare("SELECT model, credits_per_unit, unit FROM billing_price_rules WHERE profile_id = ? ORDER BY model")
            .all(row.id)
            .map((rule) => [String(rule.model), rule]),
    );
    const rules = Object.entries(wholesalePrices).map(([model, base]) => {
        const configuredRule = configured.get(model);
        return { model, baseCredits: base.credits, creditsPerUnit: configuredRule ? Number(configuredRule.credits_per_unit) : base.credits, unit: base.unit } satisfies BillingPriceRule;
    });
    return {
        id: String(row.id),
        adminUserId: String(row.admin_user_id),
        adminUsername: String(row.admin_username),
        name: String(row.name),
        active: Number(row.active) === 1,
        invitedUsers: Number(row.invited_users || 0),
        earnedCredits: Number(row.earned_credits || 0),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        rules,
    };
}

export function listBillingProfiles(input: { actorUserId: string; basePrices: BasePriceMap }) {
    const database = canvasDatabase();
    const actor = requireAdmin(database, input.actorUserId);
    const scoped = effectiveRole(actor) === "admin";
    const rows = database
        .prepare(
            `SELECT p.*, a.username AS admin_username, a.is_distributor AS admin_is_distributor,
                    (SELECT COUNT(*) FROM accounts child WHERE child.billing_profile_id = p.id) AS invited_users,
                    COALESCE((SELECT SUM(l.amount) FROM credit_ledger l WHERE l.user_id = p.admin_user_id AND l.type = 'commission' AND l.remark LIKE '%' || p.id || '%'), 0) AS earned_credits
                  FROM billing_profiles p JOIN accounts a ON a.id = p.admin_user_id
                  ${scoped ? "WHERE p.admin_user_id = ?" : ""}
                  ORDER BY p.created_at DESC`,
        )
        .all(...(scoped ? [input.actorUserId] : []));
    return rows.map((row) => toBillingProfile(database, row, input.basePrices));
}

export function createBillingProfile(input: { actorUserId: string; name: string; rules: Array<{ model: string; creditsPerUnit: number }>; basePrices: BasePriceMap }) {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new AuthError("请输入计费方案名称");
    const rules = normalizeProfileRules(input.rules, distributorBasePrices(input.basePrices));
    return withImmediateTransaction((database) => {
        const actor = requireAdmin(database, input.actorUserId);
        if (effectiveRole(actor) !== "admin") throw new AuthError("Root 负责平台成本，请使用分销管理员账号创建售价方案", 403);
        const timestamp = now();
        const id = randomUUID();
        database.prepare("INSERT INTO billing_profiles (id, admin_user_id, name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").run(id, input.actorUserId, name, timestamp, timestamp);
        const insert = database.prepare("INSERT INTO billing_price_rules (profile_id, model, credits_per_unit, unit) VALUES (?, ?, ?, ?)");
        for (const rule of rules) insert.run(id, rule.model, rule.creditsPerUnit, rule.unit);
        return toBillingProfile(
            database,
            { id, admin_user_id: input.actorUserId, admin_username: actor.username, admin_is_distributor: 1, name, active: 1, invited_users: 0, earned_credits: 0, created_at: timestamp, updated_at: timestamp },
            input.basePrices,
        );
    });
}

export function updateBillingProfile(input: { actorUserId: string; profileId: string; name?: string; active?: boolean; rules?: Array<{ model: string; creditsPerUnit: number }>; basePrices: BasePriceMap }) {
    const rules = input.rules ? normalizeProfileRules(input.rules, distributorBasePrices(input.basePrices)) : null;
    return withImmediateTransaction((database) => {
        const actor = requireAdmin(database, input.actorUserId);
        const profile = database.prepare("SELECT * FROM billing_profiles WHERE id = ?").get(input.profileId);
        if (!profile) throw new AuthError("计费方案不存在", 404);
        if (effectiveRole(actor) !== "admin" || String(profile.admin_user_id) !== input.actorUserId) throw new AuthError("只能修改自己的计费方案", 403);
        const name = input.name === undefined ? String(profile.name) : input.name.trim().slice(0, 80);
        if (!name) throw new AuthError("请输入计费方案名称");
        const timestamp = now();
        database.prepare("UPDATE billing_profiles SET name = ?, active = ?, updated_at = ? WHERE id = ?").run(name, input.active === undefined ? Number(profile.active) : input.active ? 1 : 0, timestamp, input.profileId);
        if (rules) {
            database.prepare("DELETE FROM billing_price_rules WHERE profile_id = ?").run(input.profileId);
            const insert = database.prepare("INSERT INTO billing_price_rules (profile_id, model, credits_per_unit, unit) VALUES (?, ?, ?, ?)");
            for (const rule of rules) insert.run(input.profileId, rule.model, rule.creditsPerUnit, rule.unit);
        }
        const updated = database
            .prepare(
                "SELECT p.*, a.username AS admin_username, a.is_distributor AS admin_is_distributor, (SELECT COUNT(*) FROM accounts child WHERE child.billing_profile_id = p.id) AS invited_users, 0 AS earned_credits FROM billing_profiles p JOIN accounts a ON a.id = p.admin_user_id WHERE p.id = ?",
            )
            .get(input.profileId)!;
        return toBillingProfile(database, updated, input.basePrices);
    });
}

export function resolveCustomerPrice(input: { userId: string; model: string; baseCredits: number; unit: BillingUnit }) {
    const row = canvasDatabase()
        .prepare(
            `SELECT child.billing_profile_id, child.owner_admin_id, child.is_distributor AS child_is_distributor, child.status AS child_status,
                         p.active, owner.is_distributor, owner.status AS owner_status,
                         r.credits_per_unit, r.unit
                  FROM accounts child
                  LEFT JOIN billing_profiles p ON p.id = child.billing_profile_id AND p.admin_user_id = child.owner_admin_id
                  LEFT JOIN accounts owner ON owner.id = child.owner_admin_id
                  LEFT JOIN billing_price_rules r ON r.profile_id = p.id AND r.model = ?
                  WHERE child.id = ?`,
        )
        .get(input.model.toLowerCase(), input.userId);
    const childIsDistributor = Number(row?.child_is_distributor || 0) === 1 && row?.child_status === "active";
    const ownerIsDistributor = Number(row?.is_distributor || 0) === 1 && row?.owner_status === "active" && row?.owner_admin_id;
    const distributorPricing = childIsDistributor || Boolean(ownerIsDistributor);
    const baseCredits = distributorPricing ? distributorWholesaleCredits(input.baseCredits) : input.baseCredits;
    const validProfile = Boolean(ownerIsDistributor && Number(row?.active) === 1 && row?.billing_profile_id);
    const configured = validProfile && row?.unit === input.unit ? Number(row?.credits_per_unit) : baseCredits;
    const retailCredits = Number.isFinite(configured) && configured >= baseCredits ? configured : baseCredits;
    return {
        baseCredits,
        retailCredits,
        billingProfileId: validProfile && retailCredits > baseCredits ? String(row!.billing_profile_id) : null,
        beneficiaryAdminId: validProfile && retailCredits > baseCredits ? String(row!.owner_admin_id) : null,
    };
}

export function reserveCredits(input: {
    userId: string;
    apiKeyId: string;
    requestId: string;
    model: string;
    amount: number;
    baseAmount?: number;
    commissionAmount?: number;
    beneficiaryAdminId?: string | null;
    billingProfileId?: string | null;
    baseRate?: number;
    retailRate?: number;
    units: number;
    unit: string;
    upstreamPath?: string;
    reuseWindowMs?: number;
    remark?: string;
}): CreditReservation {
    const requestedAmount = normalizedCreditAmount(input.amount);
    return withImmediateTransaction((database) => {
        const existing = database.prepare("SELECT * FROM billing_transactions WHERE request_id = ?").get(input.requestId);
        if (existing) {
            const sameReservation =
                String(existing.user_id) === input.userId &&
                String(existing.api_key_id) === input.apiKeyId &&
                String(existing.model) === input.model &&
                Number(existing.units) === input.units &&
                String(existing.unit) === input.unit &&
                String(existing.upstream_path || "") === (input.upstreamPath || "");
            if (!sameReservation) throw new AuthError("请求编号已被其他任务使用", 409, "request_id_conflict");
            if (existing.status === "refunded") throw new AuthError("该请求已经结束，请重新发起生成", 409, "request_already_refunded");
            if (existing.status === "submitted" || existing.status === "settled") throw new AuthError("该请求已经提交完成，请勿重复生成", 409, "request_already_completed");
            return { requestId: String(existing.request_id), amount: Number(existing.amount), status: existing.status as CreditReservation["status"] };
        }
        let amount = requestedAmount;
        let baseAmount = normalizedCreditAmount(input.baseAmount ?? amount);
        let commissionAmount = normalizedCreditAmount(input.commissionAmount ?? amount - baseAmount);
        const reuseWindowMs = Math.max(0, Math.floor(input.reuseWindowMs || 0));
        if (amount && reuseWindowMs && input.upstreamPath) {
            const since = new Date(Date.now() - reuseWindowMs).toISOString();
            const recentCharge = database
                .prepare(
                    `SELECT request_id FROM billing_transactions
                     WHERE user_id = ? AND api_key_id = ? AND model = ? AND upstream_path = ?
                       AND amount > 0 AND status IN ('reserved', 'submitted', 'settled') AND created_at >= ?
                     ORDER BY created_at DESC LIMIT 1`,
                )
                .get(input.userId, input.apiKeyId, input.model, input.upstreamPath, since);
            if (recentCharge) {
                amount = 0;
                baseAmount = 0;
                commissionAmount = 0;
            }
        }
        if (amount) {
            const result = database.prepare("UPDATE accounts SET credits = credits - ?, updated_at = ? WHERE id = ? AND status = 'active' AND credits >= ?").run(amount, now(), input.userId, amount);
            if (!Number(result.changes)) throw new AuthError("积分不足，请充值后再试", 402, "insufficient_credits");
        }
        const balance = Number(database.prepare("SELECT credits FROM accounts WHERE id = ?").get(input.userId)?.credits || 0);
        const timestamp = now();
        database
            .prepare(
                `INSERT INTO billing_transactions (request_id, user_id, api_key_id, model, amount, base_amount, commission_amount, beneficiary_admin_id, billing_profile_id, base_rate, retail_rate, units, unit, status, upstream_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`,
            )
            .run(
                input.requestId,
                input.userId,
                input.apiKeyId,
                input.model,
                amount,
                baseAmount,
                commissionAmount,
                amount ? input.beneficiaryAdminId || null : null,
                amount ? input.billingProfileId || null : null,
                input.baseRate ?? null,
                input.retailRate ?? null,
                input.units,
                input.unit,
                input.upstreamPath || null,
                timestamp,
                timestamp,
            );
        if (amount) insertLedger(database, { userId: input.userId, type: "consume", amount: -amount, balanceAfter: balance, requestId: input.requestId, model: input.model, units: input.units, remark: input.remark?.trim() || `${input.model} 生成预扣` });
        return { requestId: input.requestId, amount, status: "reserved" };
    });
}

function normalizedCreditAmount(value: number) {
    return Math.max(0, Number((Number(value) || 0).toFixed(6)));
}

export function settleCredits(requestId: string, upstreamTaskId?: string, upstreamPath?: string) {
    if (upstreamTaskId) {
        canvasDatabase()
            .prepare("UPDATE billing_transactions SET status = 'submitted', upstream_task_id = COALESCE(?, upstream_task_id), upstream_path = COALESCE(?, upstream_path), updated_at = ? WHERE request_id = ? AND status = 'reserved'")
            .run(upstreamTaskId, upstreamPath || null, now(), requestId);
        return;
    }
    settleTransaction("request_id", requestId, "reserved");
}

export function settleCreditsByTask(upstreamTaskId: string) {
    settleTransaction("upstream_task_id", upstreamTaskId, "submitted");
}

function settleTransaction(column: "request_id" | "upstream_task_id", value: string, expectedStatus: "reserved" | "submitted") {
    return withImmediateTransaction((database) => {
        const transaction = database.prepare(`SELECT * FROM billing_transactions WHERE ${column} = ?`).get(value);
        if (!transaction || transaction.status !== expectedStatus) return false;
        const update = database.prepare("UPDATE billing_transactions SET status = 'settled', updated_at = ? WHERE request_id = ? AND status = ?").run(now(), transaction.request_id, expectedStatus);
        if (!Number(update.changes)) return false;
        const commission = Math.max(0, Number(transaction.commission_amount || 0));
        if (commission && transaction.beneficiary_admin_id) {
            database.prepare("UPDATE accounts SET credits = credits + ?, updated_at = ? WHERE id = ?").run(commission, now(), transaction.beneficiary_admin_id);
            const balance = Number(database.prepare("SELECT credits FROM accounts WHERE id = ?").get(transaction.beneficiary_admin_id)?.credits || 0);
            insertLedger(database, {
                userId: String(transaction.beneficiary_admin_id),
                type: "commission",
                amount: commission,
                balanceAfter: balance,
                requestId: String(transaction.request_id),
                model: String(transaction.model),
                units: Number(transaction.units),
                remark: `${String(transaction.model)} 分销溢价·${String(transaction.billing_profile_id || "")}`,
            });
        }
        return true;
    });
}

export function refundCredits(requestId: string, remark = "生成失败，积分退回") {
    return withImmediateTransaction((database) => {
        const transaction = database.prepare("SELECT * FROM billing_transactions WHERE request_id = ?").get(requestId);
        if (!transaction || transaction.status === "refunded") return false;
        if (transaction.status === "settled") return false;
        const amount = Number(transaction.amount);
        database.prepare("UPDATE accounts SET credits = credits + ?, updated_at = ? WHERE id = ?").run(amount, now(), transaction.user_id);
        const balance = Number(database.prepare("SELECT credits FROM accounts WHERE id = ?").get(transaction.user_id)?.credits || 0);
        database.prepare("UPDATE billing_transactions SET status = 'refunded', updated_at = ? WHERE request_id = ?").run(now(), requestId);
        if (amount) insertLedger(database, { userId: String(transaction.user_id), type: "refund", amount, balanceAfter: balance, requestId, model: String(transaction.model), units: Number(transaction.units), remark });
        return true;
    });
}

export function refundCreditsByTask(upstreamTaskId: string, remark?: string) {
    const row = canvasDatabase().prepare("SELECT request_id FROM billing_transactions WHERE upstream_task_id = ?").get(upstreamTaskId);
    return row ? refundCredits(String(row.request_id), remark) : false;
}

export function listSubmittedBillingTasks(limit = 100): SubmittedBillingTask[] {
    return canvasDatabase()
        .prepare(
            `SELECT b.request_id, b.user_id, a.username, a.display_name, b.upstream_task_id, b.upstream_path, b.model, b.updated_at
             FROM billing_transactions b JOIN accounts a ON a.id = b.user_id
             WHERE b.status = 'submitted' AND b.upstream_task_id IS NOT NULL
             ORDER BY b.updated_at ASC LIMIT ?`,
        )
        .all(Math.max(1, Math.min(500, Math.floor(limit))))
        .map((row) => ({
            requestId: String(row.request_id),
            userId: String(row.user_id),
            username: String(row.username),
            displayName: String(row.display_name),
            upstreamTaskId: String(row.upstream_task_id),
            upstreamPath: String(row.upstream_path || ""),
            model: String(row.model),
            updatedAt: String(row.updated_at),
        }));
}

function requireRoot(database: CanvasDatabase, userId: string) {
    if (!database.prepare("SELECT id FROM accounts WHERE id = ? AND role = 'root' AND status = 'active' AND username = 'root' COLLATE NOCASE").get(userId)) throw new AuthError("没有此操作权限", 403);
}

function requireAdmin(database: CanvasDatabase, userId: string) {
    const account = database.prepare("SELECT * FROM accounts WHERE id = ? AND status = 'active'").get(userId);
    if (!account || (effectiveRole(account) !== "root" && effectiveRole(account) !== "admin")) throw new AuthError("没有此操作权限", 403);
    return account;
}

function insertLedger(database: CanvasDatabase, input: { userId: string; type: CreditLedgerEntry["type"]; amount: number; balanceAfter: number; requestId?: string; model?: string; units?: number; remark: string }) {
    database
        .prepare(`INSERT INTO credit_ledger (id, user_id, type, amount, balance_after, request_id, model, units, remark, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), input.userId, input.type, input.amount, input.balanceAfter, input.requestId || null, input.model || null, input.units ?? null, input.remark, now());
}

function toLedgerEntry(row: AccountRow): CreditLedgerEntry {
    return {
        id: String(row.id),
        type: row.type as CreditLedgerEntry["type"],
        amount: Number(row.amount),
        balanceAfter: Number(row.balance_after),
        model: row.model ? String(row.model) : null,
        units: row.units === null || row.units === undefined ? null : Number(row.units),
        remark: String(row.remark || ""),
        createdAt: String(row.created_at),
    };
}
