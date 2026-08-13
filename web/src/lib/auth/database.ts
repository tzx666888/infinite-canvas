import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Statement = {
    run: (...values: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
    get: (...values: unknown[]) => Record<string, unknown> | undefined;
    all: (...values: unknown[]) => Record<string, unknown>[];
};

export type CanvasDatabase = {
    exec: (sql: string) => void;
    prepare: (sql: string) => Statement;
};

declare global {
    var __infiniteCanvasDatabase: CanvasDatabase | undefined;
}

export function authDataDirectory() {
    return process.env.AUTH_DATA_DIR?.trim() || join(tmpdir(), "infinite-canvas-auth");
}

export function canvasDatabase() {
    if (globalThis.__infiniteCanvasDatabase) return globalThis.__infiniteCanvasDatabase;
    const directory = authDataDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = join(directory, "canvas.sqlite");
    const database = new BetterSqlite3(target) as unknown as CanvasDatabase;
    database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    database.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            display_name TEXT NOT NULL,
            avatar_url TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL CHECK (role IN ('root', 'member')),
            provider TEXT NOT NULL CHECK (provider IN ('local', 'migrated', 'tokaxis')),
            external_id TEXT UNIQUE,
            password_hash TEXT NOT NULL DEFAULT '',
            credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT
        );
        CREATE TABLE IF NOT EXISTS invites (
            id TEXT PRIMARY KEY,
            code_hash TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES accounts(id),
            created_at TEXT NOT NULL,
            expires_at TEXT,
            max_uses INTEGER NOT NULL,
            used_count INTEGER NOT NULL DEFAULT 0,
            revoked_at TEXT
        );
        CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES accounts(id),
            name TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            prefix TEXT NOT NULL,
            last_four TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT,
            revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS credit_ledger (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES accounts(id),
            type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            request_id TEXT,
            model TEXT,
            units REAL,
            remark TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_request_type_idx ON credit_ledger(request_id, type) WHERE request_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger(user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS billing_transactions (
            request_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES accounts(id),
            api_key_id TEXT NOT NULL REFERENCES api_keys(id),
            model TEXT NOT NULL,
            amount INTEGER NOT NULL,
            units REAL NOT NULL,
            unit TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('reserved', 'submitted', 'settled', 'refunded')),
            upstream_task_id TEXT,
            upstream_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS billing_upstream_task_idx ON billing_transactions(upstream_task_id) WHERE upstream_task_id IS NOT NULL;
    `);
    try {
        database.exec("ALTER TABLE billing_transactions ADD COLUMN upstream_path TEXT");
    } catch {
        // Existing databases already have the column.
    }
    migrateLegacyJson(database, directory);
    chmodSync(target, 0o600);
    globalThis.__infiniteCanvasDatabase = database;
    return database;
}

export function withImmediateTransaction<T>(handler: (database: CanvasDatabase) => T): T {
    const database = canvasDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
        const value = handler(database);
        database.exec("COMMIT");
        return value;
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function migrateLegacyJson(database: CanvasDatabase, directory: string) {
    const count = Number(database.prepare("SELECT COUNT(*) AS count FROM accounts").get()?.count || 0);
    const legacyPath = join(directory, "accounts.json");
    if (count || !existsSync(legacyPath)) return;
    try {
        const legacy = JSON.parse(readFileSync(legacyPath, "utf8")) as {
            accounts?: Array<Record<string, unknown>>;
            invites?: Array<Record<string, unknown>>;
        };
        withDatabaseTransaction(database, () => {
            const insertAccount = database.prepare(`
                INSERT OR IGNORE INTO accounts
                    (id, username, display_name, avatar_url, role, provider, external_id, password_hash, credits, created_at, updated_at, last_login_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            `);
            for (const account of legacy.accounts || []) {
                insertAccount.run(
                    string(account.id),
                    string(account.username),
                    string(account.displayName) || string(account.username),
                    string(account.avatarUrl),
                    account.role === "root" ? "root" : "member",
                    account.provider === "tokaxis" ? "tokaxis" : "local",
                    nullableString(account.externalId),
                    string(account.passwordHash),
                    string(account.createdAt),
                    string(account.updatedAt),
                    nullableString(account.lastLoginAt),
                );
            }
            const insertInvite = database.prepare(`
                INSERT OR IGNORE INTO invites (id, code_hash, label, created_by, created_at, expires_at, max_uses, used_count, revoked_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const invite of legacy.invites || []) {
                insertInvite.run(
                    string(invite.id),
                    string(invite.codeHash),
                    string(invite.label),
                    string(invite.createdBy),
                    string(invite.createdAt),
                    nullableString(invite.expiresAt),
                    number(invite.maxUses, 1),
                    number(invite.usedCount, 0),
                    nullableString(invite.revokedAt),
                );
            }
        });
    } catch (error) {
        console.error("[canvas-auth] legacy account migration failed", error);
        throw error;
    }
}

function withDatabaseTransaction(database: CanvasDatabase, handler: () => void) {
    database.exec("BEGIN IMMEDIATE");
    try {
        handler();
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function string(value: unknown) {
    return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
    const result = string(value);
    return result || null;
}

function number(value: unknown, fallback: number) {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
}
