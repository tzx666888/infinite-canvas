import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const cacheRoot = process.env.PROMPT_CACHE_DIR || join(tmpdir(), "infinite-canvas-prompt-cache");
const cacheDir = process.env.PROMPT_COVER_CACHE_DIR || join(cacheRoot, "covers");
const promptLibraryCacheDir = process.env.PROMPT_LIBRARY_CACHE_DIR || cacheRoot;
const promptLibraryCacheFile = join(promptLibraryCacheDir, "prompt-library.json");
const freshTtlMs = 1000 * 60 * 60 * 24 * 7;
const staleTtlMs = 1000 * 60 * 60 * 24 * 180;
const upstreamTimeoutMs = 9000;
const maxBytes = 1024 * 1024 * 12;
const allowedHosts = new Set([
    "github.com",
    "raw.githubusercontent.com",
    "user-images.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "secured-user-images.githubusercontent.com",
    "media.githubusercontent.com",
    "objects.githubusercontent.com",
    "pbs.twimg.com",
    "cms-assets.youmind.com",
    "cdn.imgedify.com",
]);

type CachedCover = {
    body: Buffer;
    contentType: string;
    stale: boolean;
    expired: boolean;
};

export async function GET(request: NextRequest) {
    const rawUrl = request.nextUrl.searchParams.get("url") || "";
    const sourceUrl = parseSourceUrl(rawUrl);
    if (!sourceUrl) return Response.json({ error: "Invalid prompt cover url" }, { status: 400 });
    if (!(await canProxySourceUrl(sourceUrl))) return Response.json({ error: "Prompt cover host is not allowed" }, { status: 400 });

    const cacheKey = createHash("sha256").update(sourceUrl.href).digest("hex");
    const cached = await readCachedCover(cacheKey);
    if (cached && !cached.stale) return coverResponse(cached.body, cached.contentType, "HIT");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    try {
        const response = await fetch(sourceUrl, {
            cache: "no-store",
            redirect: "follow",
            signal: controller.signal,
            headers: {
                accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "user-agent": "Mozilla/5.0 (compatible; TokAxisPromptCoverProxy/1.0)",
            },
        });
        if (!response.ok) {
            if (cached) return coverResponse(cached.body, cached.contentType, cached.expired ? "EXPIRED_STALE" : "STALE");
            return Response.json({ error: `Prompt cover fetch failed: ${response.status}` }, { status: 502 });
        }

        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
        if (!isImageContentType(contentType)) {
            if (cached) return coverResponse(cached.body, cached.contentType, cached.expired ? "EXPIRED_STALE" : "STALE");
            return Response.json({ error: "Prompt cover is not an image" }, { status: 502 });
        }

        const body = Buffer.from(await response.arrayBuffer());
        if (!body.length || body.byteLength > maxBytes) {
            if (cached) return coverResponse(cached.body, cached.contentType, cached.expired ? "EXPIRED_STALE" : "STALE");
            return Response.json({ error: "Prompt cover size is not supported" }, { status: 502 });
        }

        await writeCachedCover(cacheKey, body, contentType);
        return coverResponse(body, contentType, "MISS");
    } catch {
        if (cached) return coverResponse(cached.body, cached.contentType, cached.expired ? "EXPIRED_STALE" : "STALE");
        return Response.json({ error: "Prompt cover fetch failed" }, { status: 502 });
    } finally {
        clearTimeout(timer);
    }
}

function parseSourceUrl(value: string) {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        return url;
    } catch {
        return null;
    }
}

async function canProxySourceUrl(url: URL) {
    if (allowedHosts.has(url.hostname) || url.hostname.endsWith(".githubusercontent.com")) return true;
    return isCachedPromptCoverUrl(url.href);
}

async function isCachedPromptCoverUrl(url: string) {
    try {
        const raw = await readFile(promptLibraryCacheFile, "utf8");
        const parsed = JSON.parse(raw) as { items?: Array<{ coverUrl?: string; preview?: string }> };
        return (parsed.items || []).some((item) => item.coverUrl === url || Boolean(item.preview?.includes(url)));
    } catch {
        return false;
    }
}

async function readCachedCover(cacheKey: string): Promise<CachedCover | null> {
    try {
        const [body, metaRaw, fileStat] = await Promise.all([readFile(bodyPath(cacheKey)), readFile(metaPath(cacheKey), "utf8"), stat(bodyPath(cacheKey))]);
        const meta = JSON.parse(metaRaw) as { contentType?: string };
        const age = Date.now() - fileStat.mtimeMs;
        return { body, contentType: meta.contentType || "image/jpeg", stale: age > freshTtlMs, expired: age > staleTtlMs };
    } catch {
        return null;
    }
}

async function writeCachedCover(cacheKey: string, body: Buffer, contentType: string) {
    await mkdir(cacheDir, { recursive: true });
    await Promise.all([writeFile(bodyPath(cacheKey), body), writeFile(metaPath(cacheKey), JSON.stringify({ contentType }))]);
}

function coverResponse(body: Buffer, contentType: string, cacheStatus: string) {
    return new Response(body, {
        headers: {
            "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=15552000",
            "content-type": contentType,
            "x-prompt-cover-cache": cacheStatus,
        },
    });
}

function bodyPath(cacheKey: string) {
    return join(cacheDir, `${cacheKey}.bin`);
}

function metaPath(cacheKey: string) {
    return join(cacheDir, `${cacheKey}.json`);
}

function isImageContentType(contentType: string) {
    return contentType.startsWith("image/") || contentType === "application/octet-stream";
}
