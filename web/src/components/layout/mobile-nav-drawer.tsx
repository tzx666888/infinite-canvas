"use client";

import { App, Drawer } from "antd";
import Link from "next/link";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { message } = App.useApp();
    const apiKey = useConfigStore((state) => state.config.channels[0]?.apiKey || "");
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    async function openTokAxisTts() {
        const key = apiKey.trim();
        if (!key) {
            onClose();
            openConfigDialog(true);
            return;
        }
        try {
            const response = await fetch("/api/tts/handoff", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: key }),
            });
            const data = await response.json();
            if (!response.ok || !data.url) throw new Error(data.message || data.error || "TTS handoff 失败");
            onClose();
            window.open(data.url, "_blank", "noopener,noreferrer");
        } catch (error) {
            message.error(`打开 TokAxis TTS 失败：${(error as Error).message}`);
        }
    }

    return (
        <Drawer title="导航" placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {navigationTools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    const className = cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-base transition",
                        active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                    );
                    if (tool.slug === "tts") {
                        return (
                            <button key={tool.slug} type="button" onClick={openTokAxisTts} className={className}>
                                <Icon className="size-5" />
                                <span>{tool.label}</span>
                            </button>
                        );
                    }
                    return (
                        <Link key={tool.slug} href={`/${tool.slug}`} onClick={onClose} className={className}>
                            <Icon className="size-5" />
                            <span>{tool.label}</span>
                        </Link>
                    );
                })}
            </div>
        </Drawer>
    );
}
