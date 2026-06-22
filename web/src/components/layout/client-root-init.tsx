"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";

const TOKAXIS_PROXY_BASE_URL = "/api/tokaxis";
const APP_BUILD_ID = process.env.NEXT_PUBLIC_APP_BUILD_ID || process.env.NEXT_PUBLIC_APP_VERSION || "dev";
const BUILD_ID_STORAGE_KEY = "infinite-canvas:app_build_id";
const BUILD_ID_RELOAD_KEY = "infinite-canvas:app_build_reload";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const promptedForMissingKey = useRef(false);
    const syncedExistingKey = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const syncModelsFromKey = useConfigStore((state) => state.syncModelsFromKey);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

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
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                baseUrl: TOKAXIS_PROXY_BASE_URL,
                                apiKey,
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "TokAxis", baseUrl: TOKAXIS_PROXY_BASE_URL, apiKey })],
        );
        updateConfig("baseUrl", TOKAXIS_PROXY_BASE_URL);
        if (apiKey) updateConfig("apiKey", apiKey);
        void syncModelsFromKey(apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, syncModelsFromKey, updateConfig]);

    useEffect(() => {
        const syncExistingKey = () => {
            if (syncedExistingKey.current) return;
            const channel = useConfigStore.getState().config.channels[0];
            const apiKey = channel?.apiKey.trim();
            if (!apiKey) return;
            syncedExistingKey.current = true;
            void useConfigStore.getState().syncModelsFromKey(apiKey);
        };

        if (useConfigStore.persist.hasHydrated()) syncExistingKey();
        return useConfigStore.persist.onFinishHydration(syncExistingKey);
    }, []);

    useEffect(() => {
        const promptForMissingKey = () => {
            if (promptedForMissingKey.current) return;
            const searchParams = new URLSearchParams(window.location.search);
            if (searchParams.get("apiKey") || searchParams.get("apikey")) return;
            const channel = useConfigStore.getState().config.channels[0];
            if (channel?.apiKey.trim()) return;
            promptedForMissingKey.current = true;
            openConfigDialog(false);
        };

        if (useConfigStore.persist.hasHydrated()) promptForMissingKey();
        return useConfigStore.persist.onFinishHydration(promptForMissingKey);
    }, [openConfigDialog]);

    return <>{children}</>;
}
