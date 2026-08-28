import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { AuthError, authErrorResponse } from "@/lib/auth/auth-error";
import { enforceSameOrigin, requireAuthUser } from "@/lib/auth/route-utils";
import { facebookMediaPreset } from "@/lib/facebook-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export async function POST(request: Request) {
    let directory = "";
    try {
        enforceSameOrigin(request);
        await requireAuthUser();
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES + 256 * 1024) return Response.json({ error: { message: "图片文件超过 32MB，无法转换 Facebook 尺寸" } }, { status: 413 });

        const form = await request.formData();
        const preset = facebookMediaPreset(String(form.get("preset") || ""));
        if (!preset) return Response.json({ error: { message: "Facebook 图片尺寸不支持" } }, { status: 400 });

        const file = form.get("image");
        if (!(file instanceof File) || !file.size) return Response.json({ error: { message: "缺少待转换的图片" } }, { status: 400 });
        if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: { message: "图片文件超过 32MB，无法转换 Facebook 尺寸" } }, { status: 413 });

        directory = await mkdtemp(join(tmpdir(), "tokaxis-facebook-image-"));
        const inputPath = join(directory, "input.image");
        const outputPath = join(directory, "output.png");
        await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
        const ratio = preset.width / preset.height;
        const filter = `crop=w='if(gt(a,${ratio}),ih*${ratio},iw)':h='if(gt(a,${ratio}),ih,iw/${ratio})',scale=${preset.width}:${preset.height}:flags=lanczos,setsar=1`;
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-frames:v", "1", "-vf", filter, outputPath], {
            timeout: 2 * 60 * 1000,
            maxBuffer: 2 * 1024 * 1024,
        });
        const output = await readFile(outputPath);
        return new Response(output, {
            headers: {
                "Cache-Control": "no-store",
                "Content-Length": String(output.byteLength),
                "Content-Type": "image/png",
                "X-TokAxis-Media-Preset": preset.id,
            },
        });
    } catch (error) {
        if (error instanceof AuthError) return authErrorResponse(error);
        console.error("Facebook image format failed", error);
        return Response.json({ error: { message: "Facebook 图片尺寸转换失败，请稍后重试" } }, { status: 500 });
    } finally {
        if (directory) await rm(directory, { force: true, recursive: true }).catch(() => undefined);
    }
}
