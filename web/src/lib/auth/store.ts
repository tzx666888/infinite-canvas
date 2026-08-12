import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthError } from "@/lib/auth/auth-error";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { AuthUser, InviteSummary } from "@/lib/auth/types";

type AccountRecord = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    role: AuthUser["role"];
    provider: "local" | "tokaxis";
    externalId: string | null;
    passwordHash: string;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
};

type InviteRecord = {
    id: string;
    codeHash: string;
    label: string;
    createdBy: string;
    createdAt: string;
    expiresAt: string | null;
    maxUses: number;
    usedCount: number;
    revokedAt: string | null;
};

type AuthDatabase = {
    version: 1;
    accounts: AccountRecord[];
    invites: InviteRecord[];
};

type CreatedInvite = {
    code: string;
    invite: InviteSummary;
};

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMPTY_DATABASE: AuthDatabase = { version: 1, accounts: [], invites: [] };
let mutationQueue: Promise<void> = Promise.resolve();

function authDataDirectory() {
    return process.env.AUTH_DATA_DIR?.trim() || join(tmpdir(), "infinite-canvas-auth");
}

function databasePath() {
    return join(authDataDirectory(), "accounts.json");
}

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

function createInviteCode() {
    const bytes = randomBytes(16);
    const characters = Array.from(bytes, (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]);
    return `VC-${characters.slice(0, 4).join("")}-${characters.slice(4, 8).join("")}-${characters.slice(8, 12).join("")}-${characters.slice(12, 16).join("")}`;
}

function isDatabase(value: unknown): value is AuthDatabase {
    if (!value || typeof value !== "object") return false;
    const database = value as Partial<AuthDatabase>;
    return database.version === 1 && Array.isArray(database.accounts) && Array.isArray(database.invites);
}

async function readDatabase(): Promise<AuthDatabase> {
    const directory = authDataDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
        const value = JSON.parse(await readFile(databasePath(), "utf8")) as unknown;
        if (!isDatabase(value)) throw new Error("invalid auth database");
        return value;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_DATABASE);
        throw error;
    }
}

async function writeDatabase(database: AuthDatabase) {
    const directory = authDataDirectory();
    const target = databasePath();
    const temp = join(directory, `accounts-${process.pid}-${randomUUID()}.tmp`);
    await writeFile(temp, `${JSON.stringify(database, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, target);
    await chmod(target, 0o600);
}

async function mutateDatabase<T>(handler: (database: AuthDatabase) => Promise<{ value: T; changed: boolean }>) {
    const operation = mutationQueue.then(async () => {
        const database = await readDatabase();
        const result = await handler(database);
        if (result.changed) await writeDatabase(database);
        return result.value;
    });
    mutationQueue = operation.then(
        () => undefined,
        () => undefined,
    );
    return operation;
}

function toAuthUser(account: AccountRecord): AuthUser {
    return {
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        role: account.provider === "tokaxis" && account.role === "root" ? "root" : "member",
        createdAt: account.createdAt,
    };
}

function isTokaxisRoot(account: AccountRecord) {
    return account.provider === "tokaxis" && account.role === "root";
}

function inviteStatus(invite: InviteRecord): InviteSummary["status"] {
    if (invite.revokedAt) return "revoked";
    if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) return "expired";
    if (invite.usedCount >= invite.maxUses) return "used";
    return "active";
}

function toInviteSummary(invite: InviteRecord): InviteSummary {
    return {
        id: invite.id,
        label: invite.label,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
        usedCount: invite.usedCount,
        revokedAt: invite.revokedAt,
        status: inviteStatus(invite),
    };
}

export async function authenticateLocalUser(input: { username: string; password: string }) {
    let username: string;
    try {
        username = validateUsername(input.username);
    } catch {
        return null;
    }
    return mutateDatabase(async (database) => {
        const account = database.accounts.find((item) => item.provider !== "tokaxis" && item.username === username);
        if (!account || !account.passwordHash || !(await verifyPassword(input.password, account.passwordHash))) return { value: null, changed: false };
        account.lastLoginAt = now();
        account.updatedAt = account.lastLoginAt;
        return { value: toAuthUser(account), changed: true };
    });
}

export async function upsertTokaxisAccount(input: { id: number; username: string; displayName: string; role: number }) {
    const externalId = `tokaxis:${input.id}`;
    const username = input.username.trim() || externalId;
    const displayName = input.displayName.trim() || username;
    const role: AuthUser["role"] = input.role >= 100 ? "root" : "member";
    return mutateDatabase(async (database) => {
        const timestamp = now();
        const existing = database.accounts.find((account) => account.provider === "tokaxis" && account.externalId === externalId);
        if (existing) {
            existing.username = username;
            existing.displayName = displayName;
            existing.role = role;
            existing.updatedAt = timestamp;
            existing.lastLoginAt = timestamp;
            return { value: toAuthUser(existing), changed: true };
        }
        const account: AccountRecord = {
            id: externalId,
            username,
            displayName,
            avatarUrl: "",
            role,
            provider: "tokaxis",
            externalId,
            passwordHash: "",
            createdAt: timestamp,
            updatedAt: timestamp,
            lastLoginAt: timestamp,
        };
        database.accounts.push(account);
        return { value: toAuthUser(account), changed: true };
    });
}

export async function registerWithInvite(input: { username: string; password: string; inviteCode: string }) {
    const username = validateUsername(input.username);
    const password = validatePassword(input.password);
    const codeHash = inviteCodeHash(input.inviteCode);
    if (!normalizeInviteCode(input.inviteCode)) throw new AuthError("请输入邀请码");

    return mutateDatabase(async (database) => {
        if (database.accounts.some((account) => account.username.toLowerCase() === username)) throw new AuthError("该用户名已被使用", 409);
        const invite = database.invites.find((item) => item.codeHash === codeHash);
        if (!invite || inviteStatus(invite) !== "active") throw new AuthError("邀请码无效、已过期或已使用", 403);

        const createdAt = now();
        const account: AccountRecord = {
            id: randomUUID(),
            username,
            displayName: username,
            avatarUrl: "",
            role: "member",
            provider: "local",
            externalId: null,
            passwordHash: await hashPassword(password),
            createdAt,
            updatedAt: createdAt,
            lastLoginAt: createdAt,
        };
        database.accounts.push(account);
        invite.usedCount += 1;
        return { value: toAuthUser(account), changed: true };
    });
}

export async function getAuthUser(userId: string) {
    const database = await readDatabase();
    const account = database.accounts.find((item) => item.id === userId);
    return account ? toAuthUser(account) : null;
}

export async function createInvite(input: { rootUserId: string; label?: string; maxUses?: number; expiresInDays?: number | null }): Promise<CreatedInvite> {
    const label = input.label?.trim().slice(0, 80) || "未命名邀请码";
    const maxUses = Math.max(1, Math.min(100, Math.floor(Number(input.maxUses) || 1)));
    const requestedDays = input.expiresInDays === null ? null : Number(input.expiresInDays ?? 7);
    const expiresInDays = requestedDays === null ? null : Math.max(1, Math.min(90, Math.floor(Number.isFinite(requestedDays) ? requestedDays : 7)));

    return mutateDatabase(async (database) => {
        const root = database.accounts.find((account) => account.id === input.rootUserId && isTokaxisRoot(account));
        if (!root) throw new AuthError("没有管理邀请码的权限", 403);
        const createdAt = now();
        const code = createInviteCode();
        const invite: InviteRecord = {
            id: randomUUID(),
            codeHash: inviteCodeHash(code),
            label,
            createdBy: root.id,
            createdAt,
            expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
            maxUses,
            usedCount: 0,
            revokedAt: null,
        };
        database.invites.unshift(invite);
        return { value: { code, invite: toInviteSummary(invite) }, changed: true };
    });
}

export async function listInvites(rootUserId: string) {
    const database = await readDatabase();
    const root = database.accounts.find((account) => account.id === rootUserId && isTokaxisRoot(account));
    if (!root) throw new AuthError("没有查看邀请码的权限", 403);
    return database.invites.map(toInviteSummary);
}

export async function revokeInvite(input: { rootUserId: string; inviteId: string }) {
    return mutateDatabase(async (database) => {
        const root = database.accounts.find((account) => account.id === input.rootUserId && isTokaxisRoot(account));
        if (!root) throw new AuthError("没有管理邀请码的权限", 403);
        const invite = database.invites.find((item) => item.id === input.inviteId);
        if (!invite) throw new AuthError("邀请码不存在", 404);
        if (!invite.revokedAt) invite.revokedAt = now();
        return { value: toInviteSummary(invite), changed: true };
    });
}
