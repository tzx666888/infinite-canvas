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
const MAX_VIDEO_BYTES = 128 * 1024 * 1024;

type VideoDimensions = { width: number; height: number };

async function probeVideoDimensions(path: string): Promise<VideoDimensions> {
    const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path], {
        timeout: 30 * 1000,
        maxBuffer: 512 * 1024,
    });
    const payload = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
    const width = Number(payload.streams?.[0]?.width || 0);
    const height = Number(payload.streams?.[0]?.height || 0);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("无法读取视频尺寸");
    return { width, height };
}

export async function POST(request: Request) {
    let directory = "";
    try {
        enforceSameOrigin(request);
        await requireAuthUser();
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_BYTES + 1024 * 1024) return Response.json({ error: { message: "视频文件超过 128MB，无法转换 Facebook 尺寸" } }, { status: 413 });

        const form = await request.formData();
        const preset = facebookMediaPreset(String(form.get("preset") || ""));
        if (!preset) return Response.json({ error: { message: "Facebook 视频尺寸不支持" } }, { status: 400 });

        const file = form.get("video");
        if (!(file instanceof File) || !file.size) return Response.json({ error: { message: "缺少待转换的视频" } }, { status: 400 });
        if (file.size > MAX_VIDEO_BYTES) return Response.json({ error: { message: "视频文件超过 128MB，无法转换 Facebook 尺寸" } }, { status: 413 });
        const input = await file.arrayBuffer();

        directory = await mkdtemp(join(tmpdir(), "tokaxis-facebook-video-"));
        const inputPath = join(directory, "input.mp4");
        const outputPath = join(directory, "output.mp4");
        await writeFile(inputPath, Buffer.from(input));
        const source = await probeVideoDimensions(inputPath);
        const sourceRatio = source.width / source.height;
        const ratio = preset.width / preset.height;
        const useContainBlur = preset.id === "FB-4:5" && sourceRatio < 0.7;
        const cropFilter = `crop=w='if(gt(a,${ratio}),ih*${ratio},iw)':h='if(gt(a,${ratio}),ih,iw/${ratio})',scale=${preset.width}:${preset.height}:flags=lanczos,setsar=1`;
        const containBlurFilter = `[0:v]split=2[bg][fg];[bg]scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${preset.width}:${preset.height},gblur=sigma=30[bg];[fg]scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1[outv]`;
        const videoFilterArgs = useContainBlur ? ["-filter_complex", containBlurFilter, "-map", "[outv]"] : ["-map", "0:v:0", "-vf", cropFilter];
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, ...videoFilterArgs, "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath], {
            timeout: 5 * 60 * 1000,
            maxBuffer: 2 * 1024 * 1024,
        });
        const converted = await probeVideoDimensions(outputPath);
        if (converted.width !== preset.width || converted.height !== preset.height) {
            throw new Error(`Facebook 视频尺寸校验失败：期望 ${preset.width}x${preset.height}，实际 ${converted.width}x${converted.height}`);
        }
        const output = await readFile(outputPath);
        return new Response(output, {
            headers: {
                "Cache-Control": "no-store",
                "Content-Length": String(output.byteLength),
                "Content-Type": "video/mp4",
                "X-TokAxis-Media-Preset": preset.id,
                "X-TokAxis-Media-Reframe": useContainBlur ? "contain-blur" : "center-crop",
            },
        });
    } catch (error) {
        if (error instanceof AuthError) return authErrorResponse(error);
        console.error("Facebook video format failed", error);
        return Response.json({ error: { message: "Facebook 视频尺寸转换失败，请稍后重试" } }, { status: 500 });
    } finally {
        if (directory) await rm(directory, { force: true, recursive: true }).catch(() => undefined);
    }
}
