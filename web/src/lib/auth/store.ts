import { createHash, randomBytes, randomUUID } from "node:crypto";

import { AuthError } from "./auth-error.ts";
import { canvasDatabase, withImmediateTransaction, type CanvasDatabase } from "./database.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import type { AuthUser, CanvasApiKeySummary, CreditLedgerEntry, InviteSummary, PaymentOrderSummary } from "./types.ts";

type AccountRow = Record<string, unknown>;
type ApiKeyIdentity = { keyId: string; user: AuthUser };
type PaymentOrderRow = Record<string, unknown>;

export type CreatedCanvasApiKey = { key: string; apiKey: CanvasApiKeySummary };
export type CreditReservation = { requestId: string; amount: number; status: "reserved" | "submitted" | "settled" | "refunded" };

export type SubmittedBillingTask = {
    requestId: string;
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
        role: row.role === "root" ? "root" : "member",
        credits: Number(row.credits || 0),
        createdAt: String(row.created_at),
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

export async function claimExternalAccount(input: { id: number; username: string; displayName: string; role: number; password: string; canvasCredits?: number }) {
    const username = normalizeUsername(input.username) || `member-${input.id}`;
    if (!input.password || input.password.length > 128) throw new AuthError("旧账户密码无法迁移", 400, "legacy_password_invalid");
    const externalId = `tokaxis:${input.id}`;
    const timestamp = now();
    const passwordHash = await hashPassword(input.password);
    const configuredInitialCredits = Number(process.env.CANVAS_LEGACY_INITIAL_CREDITS || 0);
    const requestedInitialCredits = input.canvasCredits === undefined ? configuredInitialCredits : Number(input.canvasCredits);
    const initialCredits = Math.max(0, Math.min(1_000_000_000, Math.floor(Number.isFinite(requestedInitialCredits) ? requestedInitialCredits : 0)));
    return withImmediateTransaction((database) => {
        const existing = database.prepare("SELECT * FROM accounts WHERE external_id = ? OR username = ?").get(externalId, username);
        const role = input.role >= 100 ? "root" : "member";
        if (existing) {
            const existingCredits = Number(existing.credits || 0);
            const migrationCredits = existing.provider === "migrated" ? 0 : initialCredits;
            const nextCredits = existingCredits + migrationCredits;
            database
                .prepare(`UPDATE accounts SET username = ?, display_name = ?, role = ?, provider = 'migrated', external_id = ?, password_hash = ?, credits = ?, status = 'active', updated_at = ?, last_login_at = ? WHERE id = ?`)
                .run(username, input.displayName.trim() || username, role, externalId, passwordHash, nextCredits, timestamp, timestamp, existing.id);
            if (migrationCredits) insertLedger(database, { userId: String(existing.id), type: "migration_credit", amount: migrationCredits, balanceAfter: nextCredits, remark: "旧账户首次迁移积分" });
            return toAuthUser({
                ...existing,
                username,
                display_name: input.displayName.trim() || username,
                role,
                provider: "migrated",
                external_id: externalId,
                password_hash: passwordHash,
                credits: nextCredits,
                updated_at: timestamp,
                last_login_at: timestamp,
            });
        }
        const id = randomUUID();
        database
            .prepare(`INSERT INTO accounts (id, username, display_name, role, provider, external_id, password_hash, credits, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, 'migrated', ?, ?, ?, ?, ?, ?)`)
            .run(id, username, input.displayName.trim() || username, role, externalId, passwordHash, initialCredits, timestamp, timestamp, timestamp);
        if (initialCredits) insertLedger(database, { userId: id, type: "migration_credit", amount: initialCredits, balanceAfter: initialCredits, remark: "旧账户首次迁移积分" });
        return toAuthUser({ id, username, display_name: input.displayName.trim() || username, avatar_url: "", role, credits: initialCredits, created_at: timestamp });
    });
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
        const invite = database.prepare("SELECT * FROM invites WHERE code_hash = ?").get(codeHash);
        if (!invite || inviteStatus(invite) !== "active") throw new AuthError("邀请码无效、已过期或已使用", 403);
        const createdAt = now();
        const id = randomUUID();
        database
            .prepare(`INSERT INTO accounts (id, username, display_name, role, provider, password_hash, credits, created_at, updated_at, last_login_at) VALUES (?, ?, ?, 'member', 'local', ?, ?, ?, ?, ?)`)
            .run(id, username, username, passwordHash, initialCredits, createdAt, createdAt, createdAt);
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

export async function createInvite(input: { rootUserId: string; label?: string; maxUses?: number; expiresInDays?: number | null }) {
    await ensureBootstrapRoot();
    const label = input.label?.trim().slice(0, 80) || "未命名邀请码";
    const maxUses = Math.max(1, Math.min(100, Math.floor(Number(input.maxUses) || 1)));
    const requestedDays = input.expiresInDays === null ? null : Number(input.expiresInDays ?? 7);
    const expiresInDays = requestedDays === null ? null : Math.max(1, Math.min(90, Math.floor(Number.isFinite(requestedDays) ? requestedDays : 7)));
    return withImmediateTransaction((database) => {
        requireRoot(database, input.rootUserId);
        const createdAt = now();
        const code = createInviteCode();
        const row = {
            id: randomUUID(),
            code_hash: inviteCodeHash(code),
            label,
            created_by: input.rootUserId,
            created_at: createdAt,
            expires_at: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
            max_uses: maxUses,
            used_count: 0,
            revoked_at: null,
        };
        database
            .prepare(`INSERT INTO invites (id, code_hash, label, created_by, created_at, expires_at, max_uses, used_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
            .run(row.id, row.code_hash, row.label, row.created_by, row.created_at, row.expires_at, row.max_uses);
        return { code, invite: toInviteSummary(row) };
    });
}

export async function listInvites(rootUserId: string) {
    await ensureBootstrapRoot();
    const database = canvasDatabase();
    requireRoot(database, rootUserId);
    return database.prepare("SELECT * FROM invites ORDER BY created_at DESC").all().map(toInviteSummary);
}

export async function revokeInvite(input: { rootUserId: string; inviteId: string }) {
    return withImmediateTransaction((database) => {
        requireRoot(database, input.rootUserId);
        const invite = database.prepare("SELECT * FROM invites WHERE id = ?").get(input.inviteId);
        if (!invite) throw new AuthError("邀请码不存在", 404);
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

export function reserveCredits(input: { userId: string; apiKeyId: string; requestId: string; model: string; amount: number; units: number; unit: string; upstreamPath?: string; reuseWindowMs?: number; remark?: string }): CreditReservation {
    const requestedAmount = Math.max(0, Math.ceil(input.amount));
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
            if (recentCharge) amount = 0;
        }
        if (amount) {
            const result = database.prepare("UPDATE accounts SET credits = credits - ?, updated_at = ? WHERE id = ? AND status = 'active' AND credits >= ?").run(amount, now(), input.userId, amount);
            if (!Number(result.changes)) throw new AuthError("积分不足，请充值后再试", 402, "insufficient_credits");
        }
        const balance = Number(database.prepare("SELECT credits FROM accounts WHERE id = ?").get(input.userId)?.credits || 0);
        const timestamp = now();
        database
            .prepare(`INSERT INTO billing_transactions (request_id, user_id, api_key_id, model, amount, units, unit, status, upstream_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`)
            .run(input.requestId, input.userId, input.apiKeyId, input.model, amount, input.units, input.unit, input.upstreamPath || null, timestamp, timestamp);
        if (amount) insertLedger(database, { userId: input.userId, type: "consume", amount: -amount, balanceAfter: balance, requestId: input.requestId, model: input.model, units: input.units, remark: input.remark?.trim() || `${input.model} 生成预扣` });
        return { requestId: input.requestId, amount, status: "reserved" };
    });
}

export function settleCredits(requestId: string, upstreamTaskId?: string, upstreamPath?: string) {
    canvasDatabase()
        .prepare("UPDATE billing_transactions SET status = ?, upstream_task_id = COALESCE(?, upstream_task_id), upstream_path = COALESCE(?, upstream_path), updated_at = ? WHERE request_id = ? AND status IN ('reserved', 'submitted')")
        .run(upstreamTaskId ? "submitted" : "settled", upstreamTaskId || null, upstreamPath || null, now(), requestId);
}

export function settleCreditsByTask(upstreamTaskId: string) {
    canvasDatabase().prepare("UPDATE billing_transactions SET status = 'settled', updated_at = ? WHERE upstream_task_id = ? AND status = 'submitted'").run(now(), upstreamTaskId);
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
        .prepare("SELECT request_id, upstream_task_id, upstream_path, model, updated_at FROM billing_transactions WHERE status = 'submitted' AND upstream_task_id IS NOT NULL ORDER BY updated_at ASC LIMIT ?")
        .all(Math.max(1, Math.min(500, Math.floor(limit))))
        .map((row) => ({
            requestId: String(row.request_id),
            upstreamTaskId: String(row.upstream_task_id),
            upstreamPath: String(row.upstream_path || ""),
            model: String(row.model),
            updatedAt: String(row.updated_at),
        }));
}

function requireRoot(database: CanvasDatabase, userId: string) {
    if (!database.prepare("SELECT id FROM accounts WHERE id = ? AND role = 'root' AND status = 'active'").get(userId)) throw new AuthError("没有此操作权限", 403);
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
