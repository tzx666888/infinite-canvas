"use client";

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { promptCoverUrl } from "@/lib/prompt-cover-url";

export function PromptCover({ coverUrl, title, className }: { coverUrl?: string; title: string; className?: string }) {
    const [failed, setFailed] = useState(false);
    const src = promptCoverUrl(coverUrl);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    if (!src || failed) {
        return (
            <div className={cn("flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600", className)}>
                <ImageIcon className="size-7" />
                <span className="text-xs">封面暂不可用</span>
            </div>
        );
    }

    return <img src={src} alt={title} className={cn("aspect-[4/3] w-full object-cover", className)} onError={() => setFailed(true)} />;
}
