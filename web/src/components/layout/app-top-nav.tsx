"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { BrandMark } from "@/components/brand/brand-mark";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";
import { App } from "antd";
import { useState } from "react";

export function AppTopNav() {
    const { message } = App.useApp();
    const pathname = usePathname();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const apiKey = useConfigStore((state) => state.config.channels[0]?.apiKey || "");
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    async function openTokAxisTts() {
        const key = apiKey.trim();
        if (!key) {
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
            window.open(data.url, "_blank", "noopener,noreferrer");
        } catch (error) {
            message.error(`打开 TokAxis TTS 失败：${(error as Error).message}`);
        }
    }

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-16 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            <Link href="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <BrandMark showName nameClassName="text-base font-medium" />
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 lg:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="hide-scrollbar ml-8 hidden h-16 min-w-0 items-center gap-6 overflow-x-auto lg:flex xl:gap-7">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    const className = cn(
                                        "relative flex h-16 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                        active ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100" : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                    );
                                    if (tool.slug === "tts") {
                                        return (
                                            <button key={tool.slug} type="button" onClick={openTokAxisTts} className={className}>
                                                <Icon className="size-4" />
                                                <span className="truncate">{tool.label}</span>
                                            </button>
                                        );
                                    }
                                    return (
                                        <Link key={tool.slug} href={`/${tool.slug}`} className={className}>
                                            <Icon className="size-4" />
                                            <span className="truncate">{tool.label}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
