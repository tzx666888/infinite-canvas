"use client";

import { useEffect, useState } from "react";
import { Aperture, Clapperboard, ImageIcon, PackageSearch, ScrollText, Sparkles, UserRound, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { promptCoverUrl } from "@/lib/prompt-cover-url";
import type { PromptAction, PromptMedia, PromptVisual } from "@/services/api/prompts";

const tokaxisVisuals: Record<PromptVisual, { index: string; label: string; icon: LucideIcon; glow: string; accent: string }> = {
    workflow: { index: "01", label: "END-TO-END", icon: Sparkles, glow: "rgba(34,211,238,.28)", accent: "#67e8f9" },
    script: { index: "02", label: "SCRIPT LAB", icon: ScrollText, glow: "rgba(251,191,36,.25)", accent: "#fbbf24" },
    portrait: { index: "03", label: "HUMAN ID", icon: UserRound, glow: "rgba(244,114,182,.24)", accent: "#f9a8d4" },
    product: { index: "04", label: "PRODUCT ID", icon: PackageSearch, glow: "rgba(52,211,153,.24)", accent: "#6ee7b7" },
    image: { index: "05", label: "STILL FRAME", icon: Aperture, glow: "rgba(96,165,250,.26)", accent: "#93c5fd" },
    storyboard: { index: "06", label: "SHOT DESIGN", icon: Clapperboard, glow: "rgba(167,139,250,.28)", accent: "#c4b5fd" },
    video: { index: "07", label: "VIDEO SYSTEM", icon: Clapperboard, glow: "rgba(248,113,113,.24)", accent: "#fca5a5" },
};

export function PromptCover({ coverUrl, title, className, visual, action, media }: { coverUrl?: string; title: string; className?: string; visual?: PromptVisual; action?: PromptAction; media?: PromptMedia }) {
    const [failed, setFailed] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);
    const baseSrc = promptCoverUrl(coverUrl);
    const src = retryNonce && baseSrc ? `${baseSrc}${baseSrc.includes("?") ? "&" : "?"}retry=${retryNonce}` : baseSrc;

    useEffect(() => {
        setFailed(false);
        setRetryNonce(0);
    }, [baseSrc]);

    if (visual) return <TokaxisPromptCover title={title} visual={visual} action={action} media={media} className={className} />;

    if (!src || failed) {
        return (
            <div className={cn("flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-stone-100 px-3 text-center text-stone-400 dark:bg-stone-900 dark:text-stone-600", className)}>
                <ImageIcon className="size-7" />
                <span className="text-xs">封面暂不可用</span>
                {baseSrc ? (
                    <button
                        type="button"
                        className="rounded-full border border-stone-300 px-2.5 py-1 text-xs text-stone-500 transition hover:border-stone-500 hover:text-stone-700 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:text-stone-200"
                        onClick={(event) => {
                            event.stopPropagation();
                            setFailed(false);
                            setRetryNonce(Date.now());
                        }}
                    >
                        重试封面
                    </button>
                ) : null}
            </div>
        );
    }

    return <img src={src} alt={title} className={cn("aspect-[4/3] w-full object-cover", className)} onError={() => setFailed(true)} />;
}

function TokaxisPromptCover({ title, visual, action, media, className }: { title: string; visual: PromptVisual; action?: PromptAction; media?: PromptMedia; className?: string }) {
    const meta = tokaxisVisuals[visual];
    const Icon = meta.icon;
    const format = action === "agent_workflow" ? "AGENT WORKFLOW" : media === "video" ? "VIDEO PROMPT" : "IMAGE PROMPT";

    return (
        <div
            className={cn("relative isolate aspect-[4/3] w-full overflow-hidden bg-[#070b10] text-white", className)}
            style={{
                backgroundImage: `radial-gradient(circle at 78% 22%, ${meta.glow}, transparent 34%), linear-gradient(135deg, rgba(255,255,255,.055) 0 1px, transparent 1px 18px), linear-gradient(145deg, #0b1119 0%, #070b10 64%, #111827 100%)`,
                backgroundSize: "auto, 18px 18px, auto",
            }}
        >
            <div className="absolute -right-8 -top-10 size-44 rounded-full border border-white/10" />
            <div className="absolute -right-2 top-5 size-24 rounded-full border border-white/10" />
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${meta.accent}, transparent)` }} />
            <div className="relative flex h-full flex-col p-4 sm:p-5">
                <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.22em] text-white/55">
                    <span>TOKAXIS / CREATION SYSTEM</span>
                    <span>{meta.index}</span>
                </div>
                <div className="flex flex-1 items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="mb-3 text-[10px] font-medium tracking-[0.28em]" style={{ color: meta.accent }}>
                            {meta.label}
                        </div>
                        <div className="max-w-[13rem] text-balance text-xl font-semibold leading-tight tracking-[-0.03em] sm:text-2xl">{title}</div>
                    </div>
                    <div className="grid size-16 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.055] shadow-[inset_0_0_30px_rgba(255,255,255,.04)] transition duration-500 group-hover:rotate-3 group-hover:scale-105">
                        <Icon className="size-7" strokeWidth={1.35} style={{ color: meta.accent }} />
                    </div>
                </div>
                <div className="flex items-end justify-between gap-3">
                    <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 font-mono text-[8px] tracking-[0.18em] text-white/65">{format}</span>
                    <span className="font-mono text-[8px] tracking-[0.16em] text-white/35">COMMERCE READY</span>
                </div>
            </div>
        </div>
    );
}
