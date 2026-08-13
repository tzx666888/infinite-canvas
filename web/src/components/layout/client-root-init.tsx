"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { createCanvasApiKey } from "@/services/api/auth";
import { isTokaxisProxyBaseUrl, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const APP_BUILD_ID = process.env.NEXT_PUBLIC_APP_BUILD_ID || process.env.NEXT_PUBLIC_APP_VERSION || "dev";
const BUILD_ID_STORAGE_KEY = "infinite-canvas:app_build_id";
const BUILD_ID_RELOAD_KEY = "infinite-canvas:app_build_reload";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const promptedForMissingKey = useRef(false);
    const syncedExistingKey = useRef(false);
    const provisionedPlatformKeyForUser = useRef<string | null>(null);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const user = useUserStore((state) => state.user);
    const authReady = useUserStore((state) => state.isReady);
    const hydrateUser = useUserStore((state) => state.hydrateUser);

    useEffect(() => {
        void hydrateUser();
    }, [hydrateUser]);

    useEffect(() => {
        try {
            const storedBuildId = window.localStorage.getItem(BUILD_ID_STORAGE_KEY);
            if (storedBuildId && storedBuildId !== APP_BUILD_ID && window.sessionStorage.getItem(BUILD_ID_RELOAD_KEY) !== APP_BUILD_ID) {
                window.sessionStorage.setItem(BUILD_ID_RELOAD_KEY, APP_BUILD_ID);
                window.localStorage.setItem(BUILD_ID_STORAGE_KEY, APP_BUILD_ID);
                window.location.reload();
                return;
            }
            window.localStorage.setItem(BUILD_ID_STORAGE_KEY, APP_BUILD_ID);
            if (window.sessionStorage.getItem(BUILD_ID_RELOAD_KEY) === APP_BUILD_ID) window.sessionStorage.removeItem(BUILD_ID_RELOAD_KEY);
        } catch {
            // Ignore storage access errors in private or restricted browser contexts.
        }
    }, []);

    useEffect(() => {
        const syncExistingKey = () => {
            if (syncedExistingKey.current) return;
            const channel = useConfigStore.getState().config.channels[0];
            const apiKey = channel?.apiKey.trim();
            if (!apiKey) return;
            if (isTokaxisProxyBaseUrl(channel?.baseUrl || "") && !apiKey.startsWith("vc_live_")) return;
            syncedExistingKey.current = true;
            void useConfigStore.getState().syncModelsFromKey(apiKey);
        };

        if (useConfigStore.persist.hasHydrated()) syncExistingKey();
        return useConfigStore.persist.onFinishHydration(syncExistingKey);
    }, []);

    useEffect(() => {
        const provisionPlatformKey = () => {
            if (!authReady || !user || provisionedPlatformKeyForUser.current === user.id) return;
            const channel = useConfigStore.getState().config.channels[0];
            if (!isTokaxisProxyBaseUrl(channel?.baseUrl || "") || channel?.apiKey.trim().startsWith("vc_live_")) return;

            provisionedPlatformKeyForUser.current = user.id;
            void createCanvasApiKey("平台默认 Key")
                .then(({ key }) => {
                    const configStore = useConfigStore.getState();
                    configStore.setPlatformApiKey(key);
                    return configStore.syncModelsFromKey(key);
                })
                .catch((error) => {
                    console.warn("[platform-key] automatic canvas key setup failed", error);
                    openConfigDialog(false);
                });
        };

        if (useConfigStore.persist.hasHydrated()) provisionPlatformKey();
        return useConfigStore.persist.onFinishHydration(provisionPlatformKey);
    }, [authReady, openConfigDialog, user]);

    useEffect(() => {
        const promptForMissingKey = () => {
            if (promptedForMissingKey.current) return;
            if (!authReady || !user) return;
            const channel = useConfigStore.getState().config.channels[0];
            if (channel?.apiKey.trim()) return;
            if (isTokaxisProxyBaseUrl(channel?.baseUrl || "")) return;
            promptedForMissingKey.current = true;
            openConfigDialog(false);
        };

        if (useConfigStore.persist.hasHydrated()) promptForMissingKey();
        return useConfigStore.persist.onFinishHydration(promptForMissingKey);
    }, [authReady, openConfigDialog, user]);

    return <>{children}</>;
}
