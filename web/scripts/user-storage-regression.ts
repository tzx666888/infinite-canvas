import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import localforage from "localforage";

if (!process.argv[2]) {
    for (const mode of ["legacy-owner", "new-user"]) {
        const result = spawnSync(process.execPath, ["--experimental-strip-types", process.argv[1], mode], { stdio: "inherit" });
        assert.equal(result.status, 0, mode);
    }
} else {
    const mode = process.argv[2];
    const values = new Map<string, string>([["infinite-canvas:ai_config_store", JSON.stringify({ state: { config: { platformApiKeyOwnerId: "owner-a" } } })]]);
    let reloads = 0;
    let listener: (event: any) => void;
    Object.assign(globalThis, { window: { localStorage: { getItem: (k: string) => values.get(k) || null, setItem: (k: string, v: string) => values.set(k, v) }, location: { reload: () => reloads++ }, addEventListener: (_: string, fn: typeof listener) => { listener = fn; } } });
    const opened: string[] = [];
    localforage.createInstance = ((options: any) => {
        opened.push(`${options.name}/${options.storeName}`);
        return { getItem: async () => options.name === "infinite-canvas" ? "legacy-project" : null };
    }) as typeof localforage.createInstance;
    const { activateLocalUser, createUserScopedStore, localUserNamespace } = await import("../src/lib/user-local-storage.ts");
    const store = createUserScopedStore("app_state");
    const pending = store.getItem("projects");
    assert.equal(opened.length, 0, "no local project hydration before authenticated identity");
    activateLocalUser(mode === "legacy-owner" ? "owner-a" : "user-b");
    assert.equal(await pending, mode === "legacy-owner" ? "legacy-project" : null);
    assert.equal(await localUserNamespace(), mode === "legacy-owner" ? "infinite-canvas" : "infinite-canvas-user-user-b");
    assert.equal(values.get("infinite-canvas:legacy_data_owner"), "owner-a", "never give another account the old user's data");
    listener!({ key: "infinite-canvas:active_data_owner", newValue: "different-user" });
    assert.equal(reloads, 1);
    await assert.rejects(store.getItem("projects"), /账号已切换/);
    console.log(`User storage ${mode}: auth gate, preserved legacy data, isolated namespace and cross-tab suspension passed`);
}
