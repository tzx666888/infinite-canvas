"use client";

import { useEffect, type CSSProperties } from "react";
import { Avatar, Dropdown } from "antd";
import { BadgeDollarSign, BarChart3, Keyboard, KeyRound, LogIn, LogOut, Settings2, Users } from "lucide-react";
import type { ItemType } from "antd/es/menu/interface";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const refreshUser = useUserStore((state) => state.refreshUser);
    const logout = useUserStore((state) => state.logout);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const userName = user?.displayName || user?.username || "用户";
    const creditsLabel = user ? user.credits.toLocaleString("zh-CN") : "0";
    const userId = user?.id;
    const avatarText = (userName.trim()[0] || "U").toUpperCase();
    const isPrimaryRoot = user?.role === "root" && user.username.trim().toLowerCase() === "root";
    const isDistributorAdmin = user?.role === "admin";

    useEffect(() => {
        if (!isReady || !userId) return;
        void refreshUser();
        const interval = window.setInterval(() => void refreshUser(), 30_000);
        const refreshWhenVisible = () => {
            if (document.visibilityState === "visible") void refreshUser();
        };
        document.addEventListener("visibilitychange", refreshWhenVisible);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener("visibilitychange", refreshWhenVisible);
        };
    }, [isReady, refreshUser, userId]);
    const menuItems: ItemType[] = user
        ? [
              {
                  key: "user",
                  disabled: true,
                  label: (
                      <span className="font-medium text-current">
                          {userName} · {user.credits} 积分
                      </span>
                  ),
              },
              { key: "account", icon: <KeyRound className="size-4" />, label: <Link href="/account">账户与画布 Key</Link> },
              ...(isPrimaryRoot || isDistributorAdmin ? [{ key: "invitations", icon: <KeyRound className="size-4" />, label: <Link href="/admin/invitations">邀请码管理</Link> }] : []),
              ...(isPrimaryRoot || isDistributorAdmin ? [{ key: "billing", icon: <BadgeDollarSign className="size-4" />, label: <Link href="/admin/billing">分销中心</Link> }] : []),
              ...(isPrimaryRoot ? [{ key: "overview", icon: <BarChart3 className="size-4" />, label: <Link href="/admin/overview">运营总览</Link> }] : []),
              ...(isPrimaryRoot ? [{ key: "users", icon: <Users className="size-4" />, label: <Link href="/admin/users">用户管理</Link> }] : []),
              ...(onOpenShortcuts ? [{ key: "shortcuts", icon: <Keyboard className="size-4" />, label: "快捷键", onClick: onOpenShortcuts }] : []),
              { type: "divider" },
              {
                  key: "logout",
                  icon: <LogOut className="size-4" />,
                  label: "退出登录",
                  onClick: () => {
                      void logout().finally(() => router.replace("/"));
                  },
              },
          ]
        : [];

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {isReady && user ? (
                <Link
                    href="/account"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-stone-300 bg-transparent px-2.5 text-xs font-medium text-stone-700 transition hover:border-stone-500 hover:text-stone-950 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400 dark:hover:text-white"
                    style={variant === "canvas" ? { borderColor: canvasTheme.toolbar.border, color: canvasTheme.node.text } : undefined}
                    aria-label={`可用积分 ${creditsLabel}`}
                    title="可用积分"
                >
                    <span className="text-sm leading-none" aria-hidden="true">
                        ✨
                    </span>
                    <span className="tabular-nums">{creditsLabel}</span>
                    <span className="hidden md:inline">积分</span>
                </Link>
            ) : null}
            {isReady ? (
                user ? (
                    <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: menuItems }}>
                        <button
                            type="button"
                            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-transparent text-xs font-semibold text-stone-800 transition hover:border-stone-500 dark:border-stone-700 dark:text-stone-100 dark:hover:border-stone-400"
                            style={variant === "canvas" ? { borderColor: canvasTheme.toolbar.border, color: canvasTheme.node.text } : undefined}
                            aria-label="账户菜单"
                        >
                            <Avatar size={24} className="!bg-transparent !text-current">
                                {avatarText}
                            </Avatar>
                        </button>
                    </Dropdown>
                ) : (
                    <Link href="/login" className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-medium text-stone-700 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white" style={iconStyle}>
                        <LogIn className="size-4" />
                        登录
                    </Link>
                )
            ) : null}
        </div>
    );
}
