"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { resolveVisibleViewportFrame } from "@/utils/visible-viewport";

export default function UserLayout({ children }: { children: ReactNode }) {
    const [viewportStyle, setViewportStyle] = useState<CSSProperties>();

    useEffect(() => {
        const visualViewport = window.visualViewport;
        const syncViewport = () => {
            const frame = resolveVisibleViewportFrame({
                innerHeight: window.innerHeight,
                visualHeight: visualViewport?.height,
                offsetTop: visualViewport?.offsetTop,
            });

            setViewportStyle((current) => {
                const height = `${frame.height}px`;
                const transform = frame.offsetTop > 0 ? `translateY(${frame.offsetTop}px)` : undefined;
                if (current?.height === height && current?.transform === transform) return current;
                return { height, transform };
            });
        };

        syncViewport();
        window.addEventListener("resize", syncViewport);
        window.addEventListener("orientationchange", syncViewport);
        visualViewport?.addEventListener("resize", syncViewport);
        visualViewport?.addEventListener("scroll", syncViewport);

        return () => {
            window.removeEventListener("resize", syncViewport);
            window.removeEventListener("orientationchange", syncViewport);
            visualViewport?.removeEventListener("resize", syncViewport);
            visualViewport?.removeEventListener("scroll", syncViewport);
        };
    }, []);

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground" style={viewportStyle} data-visible-viewport-height={viewportStyle?.height || "css-fallback"}>
            <AppTopNav />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
