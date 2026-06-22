export interface ExtractedFrame {
    timestamp: number;
    dataUrl: string;
    label: string;
}

type ExtractVideoKeyFramesOptions = {
    intervalSec?: number;
    minFrames?: number;
    maxFrames?: number;
    diffThreshold?: number;
    quality?: number;
};

const DEFAULT_INTERVAL_SEC = 1;
const DEFAULT_MIN_FRAMES = 6;
const DEFAULT_MAX_FRAMES = 10;
const DEFAULT_DIFF_THRESHOLD = 0.08;
const DEFAULT_JPEG_QUALITY = 0.8;
const MAX_FRAME_WIDTH = 512;

export async function extractVideoKeyFrames(videoSrc: string, options?: ExtractVideoKeyFramesOptions): Promise<ExtractedFrame[]> {
    const interval = options?.intervalSec ?? DEFAULT_INTERVAL_SEC;
    const minFrames = options?.minFrames ?? DEFAULT_MIN_FRAMES;
    const maxFrames = options?.maxFrames ?? DEFAULT_MAX_FRAMES;
    const diffThreshold = options?.diffThreshold ?? DEFAULT_DIFF_THRESHOLD;
    const quality = options?.quality ?? DEFAULT_JPEG_QUALITY;
    const frameLimit = Math.max(1, maxFrames);

    const video = document.createElement("video");
    video.muted = true;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.src = videoSrc;
    video.pause();

    try {
        await waitForVideoMetadata(video);
        await waitForVideoReady(video);

        if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) {
            throw new Error("视频信息不完整，无法抽帧");
        }

        const width = Math.min(video.videoWidth, MAX_FRAME_WIDTH);
        const height = Math.max(1, Math.round(width * (video.videoHeight / video.videoWidth)));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("浏览器不支持视频帧提取");

        const candidateTimestamps = buildCandidateTimestamps(video.duration, interval);
        const rawFrames = [];

        for (const timestamp of candidateTimestamps) {
            video.currentTime = clampSeekTime(timestamp, video.duration);
            await waitForSeek(video);
            ctx.drawImage(video, 0, 0, width, height);
            rawFrames.push({
                timestamp: video.currentTime,
                dataUrl: canvas.toDataURL("image/jpeg", quality),
                imageData: ctx.getImageData(0, 0, width, height),
            });
        }

        const filtered: ExtractedFrame[] = [];
        for (let index = 0; index < rawFrames.length; index += 1) {
            const frame = rawFrames[index];
            const keepEndpoint = index === 0 || index === rawFrames.length - 1;
            const diff = keepEndpoint ? Number.POSITIVE_INFINITY : computeFrameDifference(rawFrames[index - 1].imageData, frame.imageData);
            if (keepEndpoint || diff >= diffThreshold) {
                filtered.push({
                    timestamp: frame.timestamp,
                    dataUrl: frame.dataUrl,
                    label: `[${frame.timestamp.toFixed(1)}s]`,
                });
            }
        }

        const withMinimumFrames = ensureMinimumFrames(filtered, rawFrames, Math.min(frameLimit, Math.max(1, minFrames)));
        return sampleFrames(withMinimumFrames, frameLimit);
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

function waitForVideoMetadata(video: HTMLVideoElement) {
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            video.removeEventListener("loadedmetadata", onLoaded);
            video.removeEventListener("error", onError);
        };
        const onLoaded = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error("视频加载失败"));
        };
        video.addEventListener("loadedmetadata", onLoaded, { once: true });
        video.addEventListener("error", onError, { once: true });
    });
}

function waitForVideoReady(video: HTMLVideoElement) {
    if (video.readyState >= 3) return Promise.resolve();
    return new Promise<void>((resolve) => {
        video.addEventListener("canplay", () => resolve(), { once: true });
    });
}

function waitForSeek(video: HTMLVideoElement) {
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("error", onError);
        };
        const onSeeked = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error("视频抽帧失败"));
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("error", onError, { once: true });
    });
}

function buildCandidateTimestamps(duration: number, interval: number) {
    const safeInterval = Math.max(0.25, interval);
    const timestamps: number[] = [];
    for (let timestamp = 0; timestamp < duration; timestamp += safeInterval) {
        timestamps.push(timestamp);
    }
    const lastTime = clampSeekTime(duration - 0.1, duration);
    if (!timestamps.length || timestamps[timestamps.length - 1] < lastTime - safeInterval * 0.5) {
        timestamps.push(lastTime);
    }
    return timestamps;
}

function clampSeekTime(timestamp: number, duration: number) {
    return Math.max(0, Math.min(timestamp, Math.max(0, duration - 0.05)));
}

function sampleFrames(frames: ExtractedFrame[], maxFrames: number) {
    if (frames.length <= maxFrames) return frames;
    if (maxFrames === 1) return frames.length ? [frames[0]] : [];
    const sampled: ExtractedFrame[] = [];
    const lastIndex = frames.length - 1;
    for (let index = 0; index < maxFrames; index += 1) {
        const sourceIndex = Math.round((index / (maxFrames - 1)) * lastIndex);
        sampled.push(frames[sourceIndex]);
    }
    sampled[0] = frames[0];
    sampled[sampled.length - 1] = frames[lastIndex];
    return sampled;
}

function ensureMinimumFrames(frames: ExtractedFrame[], rawFrames: Array<{ timestamp: number; dataUrl: string; imageData: ImageData }>, minFrames: number) {
    if (frames.length >= minFrames || rawFrames.length <= frames.length) return frames;
    const byTimestamp = new Map(frames.map((frame) => [frame.timestamp.toFixed(3), frame]));
    const candidates = sampleRawFrames(rawFrames, minFrames);
    candidates.forEach((frame) => {
        const key = frame.timestamp.toFixed(3);
        if (byTimestamp.has(key)) return;
        byTimestamp.set(key, {
            timestamp: frame.timestamp,
            dataUrl: frame.dataUrl,
            label: `[${frame.timestamp.toFixed(1)}s]`,
        });
    });
    return Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function sampleRawFrames(rawFrames: Array<{ timestamp: number; dataUrl: string; imageData: ImageData }>, targetCount: number) {
    if (rawFrames.length <= targetCount) return rawFrames;
    if (targetCount === 1) return [rawFrames[0]];
    const sampled: typeof rawFrames = [];
    const lastIndex = rawFrames.length - 1;
    for (let index = 0; index < targetCount; index += 1) {
        sampled.push(rawFrames[Math.round((index / (targetCount - 1)) * lastIndex)]);
    }
    return sampled;
}

function computeFrameDifference(a: ImageData, b: ImageData): number {
    let diff = 0;
    const len = Math.min(a.data.length, b.data.length);
    for (let i = 0; i < len; i += 4) {
        diff += Math.abs(a.data[i] - b.data[i]);
        diff += Math.abs(a.data[i + 1] - b.data[i + 1]);
        diff += Math.abs(a.data[i + 2] - b.data[i + 2]);
    }
    return diff / ((len / 4) * 3 * 255);
}
