"use client";

import { create } from "zustand";

import { fetchCurrentUser, loginAccount, logoutAccount, registerAccount } from "@/services/api/auth";
import type { AuthUser } from "@/lib/auth/types";
import { activateLocalUser, suspendLocalUser } from "@/lib/user-local-storage";

export type LocalUser = AuthUser;

type UserStore = {
    user: LocalUser | null;
    isReady: boolean;
    isLoading: boolean;
    hydrateUser: () => Promise<void>;
    refreshUser: () => Promise<void>;
    login: (input: { username: string; password: string; code?: string }) => Promise<LocalUser>;
    register: (input: { username: string; password: string; inviteCode: string }) => Promise<LocalUser>;
    logout: () => Promise<void>;
    clearSession: () => void;
};

let hydrationPromise: Promise<void> | null = null;
let refreshPromise: Promise<void> | null = null;

export const useUserStore = create<UserStore>()((set, get) => ({
    user: null,
    isReady: false,
    isLoading: false,
    hydrateUser: () => {
        if (get().isReady) return Promise.resolve();
        if (hydrationPromise) return hydrationPromise;
        set({ isLoading: true });
        hydrationPromise = fetchCurrentUser()
            .then((user) => { if (user) activateLocalUser(user.id); set({ user, isReady: true, isLoading: false }); })
            .catch(() => set({ user: null, isReady: true, isLoading: false }))
            .finally(() => {
                hydrationPromise = null;
            });
        return hydrationPromise;
    },
    refreshUser: () => {
        if (refreshPromise) return refreshPromise;
        refreshPromise = fetchCurrentUser()
            .then((user) => { if (user) activateLocalUser(user.id); else if (get().user) { suspendLocalUser(); window.location.reload(); } set({ user, isReady: true }); })
            .catch(() => undefined)
            .finally(() => {
                refreshPromise = null;
            });
        return refreshPromise;
    },
    login: async (input) => {
        set({ isLoading: true });
        try {
            const { user } = await loginAccount(input);
            activateLocalUser(user.id);
            set({ user, isReady: true, isLoading: false });
            return user;
        } catch (error) {
            set({ isLoading: false });
            throw error;
        }
    },
    register: async (input) => {
        set({ isLoading: true });
        try {
            const { user } = await registerAccount(input);
            activateLocalUser(user.id);
            set({ user, isReady: true, isLoading: false });
            return user;
        } catch (error) {
            set({ isLoading: false });
            throw error;
        }
    },
    logout: async () => {
        const { flushCanvasPersistence } = await import("@/app/(user)/canvas/stores/use-canvas-store");
        await flushCanvasPersistence();
        try {
            await logoutAccount();
        } finally {
            suspendLocalUser();
            set({ user: null, isReady: true, isLoading: false });
            window.location.reload();
        }
    },
    clearSession: () => { suspendLocalUser(); set({ user: null, isReady: true, isLoading: false }); window.location.reload(); },
}));
