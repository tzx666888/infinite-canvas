"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function PromptCover({ coverUrl, title, className }: { coverUrl?: string; title: string; className?: string }) {
    const [failed, setFailed] = useState(false);
    const src = coverUrl?.trim();

    useEffect(() => {
        setFailed(false);
    }, [src]);

    if (!src || failed) return null;

    return <img src={src} alt={title} className={cn("aspect-[4/3] w-full object-cover", className)} onError={() => setFailed(true)} />;
}
