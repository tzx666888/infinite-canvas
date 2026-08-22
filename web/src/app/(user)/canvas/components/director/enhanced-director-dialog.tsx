"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { APP_VERSION } from "@/constant/env";

import { prepareDirectorPanoramas, prepareDirectorSessionPayload } from "./director-embed-safety";
import { DirectorStudioDialog } from "./director-studio-dialog";
import type { DirectorSnapshotPayload } from "./director-types";

export type EnhancedDirectorCapture = { dataUrl: string; fileName: string };
export type EnhancedDirectorPanorama = {
    edgeId: string;
    sourceNodeId: string;
    imageUrl: string;
    fileName: string;
    projectionMode: "equirectangular" | "backdrop";
};

type EnhancedDirectorDialogProps = {
    open: boolean;
    nodeId: string;
    project?: unknown;
    panoramas?: EnhancedDirectorPanorama[];
    onClose: () => void;
    onProjectChange: (project: unknown) => void;
    onCaptures: (captures: EnhancedDirectorCapture[]) => void;
    onFallbackSnapshot: (payload: DirectorSnapshotPayload) => Promise<void> | void;
    onVideo?: (video: { blob: Blob; fileName: string; width: number; height: number; durationSeconds: number }) => void;
};

type CapturePayload = { dataUrl?: unknown; fileName?: unknown };

export function EnhancedDirectorDialog({ open, nodeId, project, panoramas = [], onClose, onProjectChange, onCaptures, onFallbackSnapshot, onVideo }: EnhancedDirectorDialogProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const projectRef = useRef(project);
    const panoramasRef = useRef(panoramas);
    const sessionSentRef = useRef(false);
    const [ready, setReady] = useState(false);
    const [frameAttempt, setFrameAttempt] = useState(0);
    const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
    const [fallbackMode, setFallbackMode] = useState(false);
    const iframeSrc = useMemo(() => `/director/index.html?v=${encodeURIComponent(APP_VERSION)}&attempt=${frameAttempt}`, [frameAttempt]);

    useEffect(() => {
        projectRef.current = project;
    }, [project]);

    useEffect(() => {
        panoramasRef.current = panoramas;
    }, [panoramas]);

    const postToDirector = useCallback((type: string, payload: unknown) => {
        try {
            const target = iframeRef.current?.contentWindow;
            if (!target) return false;
            target.postMessage({ type, payload }, "*");
            return true;
        } catch {
            setLoadState("failed");
            return false;
        }
    }, []);

    useLayoutEffect(() => {
        if (!open || fallbackMode) return;

        const handleMessage = (event: MessageEvent) => {
            const allowedOrigin = event.origin === window.location.origin || event.origin === "null";
            if (!allowedOrigin || event.source !== iframeRef.current?.contentWindow) return;
            const type = event.data?.type;
            if (type === "storyai:director-ready") {
                setReady(true);
                setLoadState("ready");
                return;
            }
            if (type === "storyai:director-close") {
                onClose();
                return;
            }
            if (type === "storyai:director-project-changed") {
                const nextProject = event.data?.payload?.project;
                if (nextProject && typeof nextProject === "object" && !Array.isArray(nextProject)) onProjectChange(nextProject);
                return;
            }
            if (type === "storyai:director-captures-sent") {
                const captures = Array.isArray(event.data?.payload?.captures)
                    ? event.data.payload.captures
                          .filter((capture: CapturePayload): capture is { dataUrl: string; fileName?: unknown } => typeof capture?.dataUrl === "string" && capture.dataUrl.startsWith("data:image/"))
                          .map((capture: { dataUrl: string; fileName?: unknown }, index: number) => ({
                              dataUrl: capture.dataUrl,
                              fileName: typeof capture.fileName === "string" && capture.fileName.trim() ? capture.fileName.trim() : `增强导演台截图-${index + 1}.png`,
                          }))
                    : [];
                if (captures.length) onCaptures(captures);
                return;
            }
            if (type === "storyai:director-video-sent" && onVideo) {
                const blob = event.data?.payload?.blob;
                if (!(blob instanceof Blob) || !blob.size || !blob.type.startsWith("video/")) return;
                const width = Number(event.data?.payload?.width);
                const height = Number(event.data?.payload?.height);
                const durationSeconds = Number(event.data?.payload?.durationSeconds);
                onVideo({
                    blob,
                    fileName: typeof event.data?.payload?.fileName === "string" && event.data.payload.fileName.trim() ? event.data.payload.fileName.trim() : "增强导演台视频.mp4",
                    width: Number.isFinite(width) && width > 0 ? width : 1280,
                    height: Number.isFinite(height) && height > 0 ? height : 720,
                    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0,
                });
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [fallbackMode, onCaptures, onClose, onProjectChange, onVideo, open]);

    useEffect(() => {
        if (!open) {
            setFallbackMode(false);
            setLoadState("loading");
            return;
        }
        if (fallbackMode) return;
        sessionSentRef.current = false;
        setReady(false);
        setLoadState("loading");
        const timeout = window.setTimeout(() => setLoadState((current) => (current === "ready" ? current : "failed")), 10_000);
        return () => window.clearTimeout(timeout);
    }, [fallbackMode, frameAttempt, open]);

    useEffect(() => {
        if (!open || fallbackMode) {
            sessionSentRef.current = false;
            setReady(false);
            return;
        }
        if (!ready || sessionSentRef.current) return;
        const sessionPayload = prepareDirectorSessionPayload({
            instanceId: nodeId,
            theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
            project: projectRef.current,
        });
        if (!postToDirector("storyai:director-session", sessionPayload)) return;
        sessionSentRef.current = true;
        postToDirector("storyai:director-panoramas", { panoramas: prepareDirectorPanoramas(panoramasRef.current) });
    }, [fallbackMode, nodeId, open, postToDirector, ready]);

    useEffect(() => {
        if (!open || fallbackMode || !ready || !sessionSentRef.current) return;
        postToDirector("storyai:director-panoramas", { panoramas: prepareDirectorPanoramas(panoramas) });
    }, [fallbackMode, open, panoramas, postToDirector, ready]);

    if (!open) return null;
    if (fallbackMode) return <DirectorStudioDialog open onClose={onClose} onSnapshot={onFallbackSnapshot} />;
    return (
        <div className="fixed inset-0 z-[2100] bg-[#090909]">
            <iframe key={frameAttempt} ref={iframeRef} title="增强 3D 导演台" src={iframeSrc} sandbox="allow-scripts allow-downloads allow-pointer-lock" className="block h-full w-full border-0" onError={() => setLoadState("failed")} />
            <button type="button" onClick={onClose} className="absolute right-4 top-4 z-30 rounded-lg border border-white/20 bg-black/70 px-4 py-2 text-sm text-white shadow-lg backdrop-blur" aria-label="关闭导演台">
                关闭
            </button>
            {loadState !== "ready" ? (
                <div className="absolute inset-0 z-20 grid place-items-center bg-[#090909] px-6 text-white">
                    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
                        <h2 className="text-xl font-semibold">{loadState === "loading" ? "导演台加载中" : "导演台没有正常启动"}</h2>
                        <p className="mt-3 text-sm leading-6 text-white/60">{loadState === "loading" ? "正在准备 3D 场景，请稍候。" : "可能是浏览器 3D 加速、缓存或场景数据导致。画布数据没有丢失。"}</p>
                        {loadState === "failed" ? (
                            <div className="mt-6 flex flex-wrap justify-center gap-3">
                                <button type="button" onClick={() => setFrameAttempt((value) => value + 1)} className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black">
                                    重新加载
                                </button>
                                <button type="button" onClick={() => setFallbackMode(true)} className="rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-white">
                                    使用兼容导演台
                                </button>
                                <button type="button" onClick={onClose} className="rounded-lg border border-white/20 px-5 py-2.5 text-sm text-white/80">
                                    返回画布
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
