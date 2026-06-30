"use client";

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { promptCoverUrl } from "@/lib/prompt-cover-url";

export function PromptCover({ coverUrl, title, className }: { coverUrl?: string; title: string; className?: string }) {
    const [failed, setFailed] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);
    const baseSrc = promptCoverUrl(coverUrl);
    const src = retryNonce && baseSrc ? `${baseSrc}${baseSrc.includes("?") ? "&" : "?"}retry=${retryNonce}` : baseSrc;

    useEffect(() => {
        setFailed(false);
        setRetryNonce(0);
    }, [baseSrc]);

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
