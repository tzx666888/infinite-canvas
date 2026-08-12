"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useUserStore } from "@/stores/use-user-store";

export function AuthGate({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const hydrateUser = useUserStore((state) => state.hydrateUser);

    useEffect(() => {
        if (!isReady) void hydrateUser();
    }, [hydrateUser, isReady]);

    useEffect(() => {
        if (!isReady || user) return;
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }, [isReady, pathname, router, user]);

    if (!isReady || !user) {
        return <div className="flex h-full items-center justify-center bg-background text-sm text-stone-500 dark:text-stone-400">正在确认登录状态…</div>;
    }

    return <>{children}</>;
}
