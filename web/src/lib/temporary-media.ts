import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const TEMPORARY_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TEMPORARY_MEDIA_BYTES = 20 * 1024 * 1024;
const MEDIA_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["audio/mpeg", "mp3"],
    ["audio/mp4", "m4a"],
    ["audio/x-m4a", "m4a"],
    ["audio/wav", "wav"],
    ["audio/x-wav", "wav"],
]);
const EXTENSION_TYPES = new Map(Array.from(MEDIA_TYPES, ([mimeType, extension]) => [extension, mimeType]));
let lastCleanupAt = 0;

export async function storeTemporaryMediaDataUrl(dataUrl: string, publicOrigin: string) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
    if (!match) throw new Error("参考素材格式不正确，请重新上传");
    const mimeType = match[1].toLowerCase();
    const extension = MEDIA_TYPES.get(mimeType);
    if (!extension) throw new Error(`参考素材格式 ${mimeType} 暂不支持`);
    const content = Buffer.from(match[2], "base64");
    if (!content.length) throw new Error("参考素材内容为空，请重新上传");
    if (content.byteLength > MAX_TEMPORARY_MEDIA_BYTES) throw new Error("单个参考素材不能超过 20 MB");

    const directory = temporaryMediaDirectory();
    await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
    await cleanupExpiredTemporaryMedia();
    const filename = `${randomBytes(24).toString("hex")}.${extension}`;
    await writeFile(
        /* turbopackIgnore: true */ join(/* turbopackIgnore: true */ directory, filename),
        content,
        { mode: 0o600, flag: "wx" },
    );
    return `${publicOrigin.replace(/\/+$/, "")}/api/tokaxis-media/${filename}`;
}

export async function readTemporaryMedia(filename: string) {
    if (!/^[a-f0-9]{48}\.(?:jpg|png|webp|mp3|m4a|wav)$/.test(filename)) return null;
    const mimeType = EXTENSION_TYPES.get(extname(filename).slice(1));
    if (!mimeType) return null;
    try {
        const path = join(/* turbopackIgnore: true */ temporaryMediaDirectory(), filename);
        const metadata = await stat(/* turbopackIgnore: true */ path);
        if (Date.now() - metadata.mtimeMs > TEMPORARY_MEDIA_TTL_MS) {
            await unlink(/* turbopackIgnore: true */ path).catch(() => undefined);
            return null;
        }
        return { content: await readFile(/* turbopackIgnore: true */ path), mimeType };
    } catch {
        return null;
    }
}

async function cleanupExpiredTemporaryMedia() {
    const now = Date.now();
    if (now - lastCleanupAt < 60 * 60 * 1000) return;
    lastCleanupAt = now;
    const directory = temporaryMediaDirectory();
    const entries = await readdir(/* turbopackIgnore: true */ directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(
        entries.map(async (entry) => {
            if (!entry.isFile()) return;
            const path = join(/* turbopackIgnore: true */ directory, entry.name);
            const metadata = await stat(/* turbopackIgnore: true */ path).catch(() => null);
            if (metadata && now - metadata.mtimeMs > TEMPORARY_MEDIA_TTL_MS) {
                await unlink(/* turbopackIgnore: true */ path).catch(() => undefined);
            }
        }),
    );
}

function temporaryMediaDirectory() {
    return process.env.VIDEO_REFERENCE_DIR || "/app/data/video-references";
}
