import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    saveStatus: "idle" | "saving" | "saved" | "error";
    lastSavedAt: number | null;
    saveError?: string;
    projects: CanvasProject[];
    deletedProjectIds: string[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjectIds?: string[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjectIds">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let pendingPersist: { name: string; value: StorageValue<CanvasStore> } | null = null;
let persistInFlight: Promise<boolean> | null = null;

function migrateLegacyProjectTitle(title: string) {
    return title.replace(/^(无限画布|幻境画布|幻境造物|幻境项目|视觉项目|视觉画布)(?=\s|$)/, "视觉画布");
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjectIds === nextState.deletedProjectIds) return;
        queuedPersistState = nextState;
        pendingPersist = { name, value };
        useCanvasStore.setState({ saveStatus: "saving", saveError: undefined });
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void flushCanvasPersistence().catch(() => undefined), 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export async function flushCanvasPersistence() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (persistInFlight) await persistInFlight;
    const pending = pendingPersist;
    if (!pending) return true;
    pendingPersist = null;
    persistInFlight = (async () => {
        try {
            await localForageStorage.setItem(pending.name, JSON.stringify(pending.value));
            useCanvasStore.setState({ saveStatus: "saved", lastSavedAt: Date.now(), saveError: undefined });
            return true;
        } catch (error) {
            const saveError = error instanceof Error ? error.message : "保存失败";
            useCanvasStore.setState({ saveStatus: "error", saveError });
            return false;
        } finally {
            persistInFlight = null;
        }
    })();
    const saved = await persistInFlight;
    if (pendingPersist) return flushCanvasPersistence();
    if (!saved) throw new Error("画布保存失败");
    return true;
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            saveStatus: "idle",
            lastSavedAt: null,
            projects: [],
            deletedProjectIds: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: migrateLegacyProjectTitle(source.title || "导入画布"),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    const deletedProjectIds = Array.from(new Set([...state.deletedProjectIds, ...ids]));
                    return { projects, deletedProjectIds };
                }),
            replaceProjects: (projects, deletedProjectIds) => set((state) => ({ projects, deletedProjectIds: deletedProjectIds || state.deletedProjectIds })),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjectIds: state.deletedProjectIds,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (state) => {
                const projects = (state?.projects || []).map((project) => ({ ...project, title: migrateLegacyProjectTitle(project.title) }));
                useCanvasStore.setState({ hydrated: true, projects, deletedProjectIds: state?.deletedProjectIds || [] });
            },
        },
    ),
);
