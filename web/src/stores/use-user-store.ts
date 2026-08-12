"use client";

import { create } from "zustand";

import { fetchCurrentUser, loginAccount, logoutAccount, registerAccount } from "@/services/api/auth";
import type { AuthUser } from "@/lib/auth/types";

export type LocalUser = AuthUser;

type UserStore = {
    user: LocalUser | null;
    isReady: boolean;
    isLoading: boolean;
    hydrateUser: () => Promise<void>;
    login: (input: { username: string; password: string }) => Promise<LocalUser>;
    register: (input: { username: string; password: string; inviteCode: string }) => Promise<LocalUser>;
    logout: () => Promise<void>;
    clearSession: () => void;
};

let hydrationPromise: Promise<void> | null = null;

export const useUserStore = create<UserStore>()((set, get) => ({
    user: null,
    isReady: false,
    isLoading: false,
    hydrateUser: () => {
        if (get().isReady) return Promise.resolve();
        if (hydrationPromise) return hydrationPromise;
        set({ isLoading: true });
        hydrationPromise = fetchCurrentUser()
            .then((user) => set({ user, isReady: true, isLoading: false }))
            .catch(() => set({ user: null, isReady: true, isLoading: false }))
            .finally(() => {
                hydrationPromise = null;
            });
        return hydrationPromise;
    },
    login: async (input) => {
        set({ isLoading: true });
        try {
            const { user } = await loginAccount(input);
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
            set({ user, isReady: true, isLoading: false });
            return user;
        } catch (error) {
            set({ isLoading: false });
            throw error;
        }
    },
    logout: async () => {
        try {
            await logoutAccount();
        } finally {
            set({ user: null, isReady: true, isLoading: false });
        }
    },
    clearSession: () => set({ user: null, isReady: true, isLoading: false }),
}));
