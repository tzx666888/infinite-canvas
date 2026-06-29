"use client";

import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function PromptCover({ coverUrl, title, className }: { coverUrl?: string; title: string; className?: string }) {
    const [failed, setFailed] = useState(false);
    const src = coverUrl?.trim();

    useEffect(() => {
        setFailed(false);
    }, [src]);

    if (src && !failed) {
        return <img src={src} alt={title} className={cn("aspect-[4/3] w-full object-cover", className)} onError={() => setFailed(true)} />;
    }

    return (
        <div className={cn("flex aspect-[4/3] w-full items-center justify-center bg-stone-100 text-stone-400 dark:bg-stone-900/70 dark:text-stone-600", className)}>
            <ImageIcon className="size-8" aria-hidden="true" />
        </div>
    );
}
