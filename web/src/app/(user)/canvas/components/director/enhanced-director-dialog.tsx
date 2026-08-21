"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
    onVideo?: (video: { blob: Blob; fileName: string; width: number; height: number; durationSeconds: number }) => void;
};

type CapturePayload = { dataUrl?: unknown; fileName?: unknown };

export function EnhancedDirectorDialog({
    open,
    nodeId,
    project,
    panoramas = [],
    onClose,
    onProjectChange,
    onCaptures,
    onVideo,
}: EnhancedDirectorDialogProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const projectRef = useRef(project);
    const panoramasRef = useRef(panoramas);
    const sessionSentRef = useRef(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        projectRef.current = project;
    }, [project]);

    useEffect(() => {
        panoramasRef.current = panoramas;
    }, [panoramas]);

    const postToDirector = useCallback((type: string, payload: unknown) => {
        iframeRef.current?.contentWindow?.postMessage({ type, payload }, "*");
    }, []);

    useEffect(() => {
        if (!open) return;

        const handleMessage = (event: MessageEvent) => {
            const allowedOrigin = event.origin === window.location.origin || event.origin === "null";
            if (!allowedOrigin || event.source !== iframeRef.current?.contentWindow) return;
            const type = event.data?.type;
            if (type === "storyai:director-ready") {
                setReady(true);
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
    }, [onCaptures, onClose, onProjectChange, onVideo, open]);

    useEffect(() => {
        if (!open) {
            sessionSentRef.current = false;
            setReady(false);
            return;
        }
        if (!ready || sessionSentRef.current) return;
        sessionSentRef.current = true;
        postToDirector("storyai:director-session", {
            instanceId: nodeId,
            theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
            project: projectRef.current,
        });
        postToDirector("storyai:director-panoramas", { panoramas: panoramasRef.current });
    }, [nodeId, open, postToDirector, ready]);

    useEffect(() => {
        if (!open || !ready || !sessionSentRef.current) return;
        postToDirector("storyai:director-panoramas", { panoramas });
    }, [open, panoramas, postToDirector, ready]);

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[2100] bg-black/80">
            <iframe
                ref={iframeRef}
                title="增强 3D 导演台"
                src="/director/index.html"
                sandbox="allow-scripts allow-downloads allow-pointer-lock"
                className="block h-full w-full border-0"
            />
        </div>
    );
}
