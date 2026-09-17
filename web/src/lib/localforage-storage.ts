import { createUserScopedStore, localUserNamespace } from "./user-local-storage.ts";
import type { StateStorage } from "zustand/middleware";

const store = createUserScopedStore("app_state");

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        const namespace = await localUserNamespace();
        const fallbackKey = namespace === "infinite-canvas" ? name : `${namespace}:${name}`;
        try {
            return (await store.getItem<string>(name)) || window.localStorage.getItem(fallbackKey) || null;
        } catch {
            return window.localStorage.getItem(fallbackKey);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        const namespace = await localUserNamespace();
        // Do not silently write a second, stale copy after an IndexedDB failure.
        await store.setItem(name, value);
        window.localStorage.removeItem(namespace === "infinite-canvas" ? name : `${namespace}:${name}`);
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        const namespace = await localUserNamespace();
        await store.removeItem(name);
        window.localStorage.removeItem(namespace === "infinite-canvas" ? name : `${namespace}:${name}`);
    },
};
