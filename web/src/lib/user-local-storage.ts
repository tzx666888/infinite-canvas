import localforage from "localforage";

const LEGACY_OWNER = "infinite-canvas:legacy_data_owner";
const ACTIVE_OWNER = "infinite-canvas:active_data_owner";
let userId: string | undefined;
let suspended = false;
let resolveReady: () => void;
const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

/** Bind existing data once; keep its original database intact, including blobs. */
export function activateLocalUser(id: string) {
    if (typeof window === "undefined") return;
    if (userId && userId !== id) {
        suspendLocalUser();
        window.location.reload();
        return;
    }
    if (!window.localStorage.getItem(LEGACY_OWNER)) {
        let previousOwner = "";
        try {
            previousOwner = JSON.parse(window.localStorage.getItem("infinite-canvas:ai_config_store") || "null")?.state?.config?.platformApiKeyOwnerId || "";
        } catch { /* Unattributed legacy data stays with the first authenticated owner. */ }
        window.localStorage.setItem(LEGACY_OWNER, previousOwner || id);
    }
    userId = id;
    window.localStorage.setItem(ACTIVE_OWNER, id);
    resolveReady();
}

export function suspendLocalUser() {
    suspended = true;
    if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_OWNER, "");
}

if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
    if (event.key === ACTIVE_OWNER && userId && event.newValue !== userId) {
        suspended = true;
        window.location.reload();
    }
});

export async function localUserNamespace() {
    await ready;
    if (suspended || !userId) throw new Error("账号已切换，请刷新后继续");
    return window.localStorage.getItem(LEGACY_OWNER) === userId ? "infinite-canvas" : `infinite-canvas-user-${userId}`;
}

/** Same LocalForage API, but never opens another account's database. */
export function createUserScopedStore(storeName: string): LocalForage {
    let instance: LocalForage | undefined;
    return new Proxy({} as LocalForage, {
        get(_target, property) {
            return async (...args: unknown[]) => {
                const name = await localUserNamespace();
                instance ||= localforage.createInstance({ name, storeName });
                const method = instance[property as keyof LocalForage];
                if (typeof method !== "function") throw new Error("不支持的本地存储操作");
                return Reflect.apply(method, instance, args);
            };
        },
    });
}
