"use client";

import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export type StoredImageStats = {
    count: number;
    bytes: number;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const batchWorkspaceStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_batch_workspace" });
const objectUrls = new Map<string, string>();
const IMAGE_DOWNLOAD_ATTEMPTS = 3;
const IMAGE_STORAGE_ATTEMPTS = 2;

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await downloadImageBlob(input) : input;
    if (!blob.size) throw new Error("图片结果为空，请刷新画布后重试恢复");

    const storageKey = `image:${nanoid()}`;
    const url = URL.createObjectURL(blob);
    try {
        const meta = await readImageMeta(url);
        await persistImageBlob(storageKey, blob);
        objectUrls.set(storageKey, url);
        return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
}

async function downloadImageBlob(url: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < IMAGE_DOWNLOAD_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`图片结果读取失败（${response.status}）`);
            return await response.blob();
        } catch (error) {
            lastError = error;
            if (attempt + 1 < IMAGE_DOWNLOAD_ATTEMPTS) await waitForStorageRetry(300 * (attempt + 1));
        }
    }
    throw lastError instanceof Error ? lastError : new Error("图片结果下载失败，请刷新画布后继续恢复");
}

async function persistImageBlob(storageKey: string, blob: Blob) {
    let lastError: unknown;
    for (let attempt = 0; attempt < IMAGE_STORAGE_ATTEMPTS; attempt += 1) {
        try {
            await store.setItem(storageKey, blob);
            return;
        } catch (error) {
            lastError = error;
            if (isImageStorageQuotaError(error) || attempt + 1 >= IMAGE_STORAGE_ATTEMPTS) break;
            await waitForStorageRetry(250);
        }
    }
    if (isImageStorageQuotaError(lastError)) throw new Error("浏览器存储空间不足，图片已生成但暂未保存；请清理站点空间后刷新画布恢复");
    throw lastError instanceof Error ? lastError : new Error("图片已生成，但浏览器暂时无法保存；刷新画布后会继续恢复");
}

function isImageStorageQuotaError(error: unknown) {
    const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name || "") : "";
    const message = error instanceof Error ? error.message : String(error || "");
    return /quotaexceeded|quota|storage full|disk full|空间不足/i.test(`${name} ${message}`);
}

function waitForStorageRetry(delayMs: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function getImageStorageStats(): Promise<StoredImageStats> {
    const stats: StoredImageStats = { count: 0, bytes: 0 };
    await store.iterate((value) => {
        stats.count += 1;
        if (value instanceof Blob) stats.bytes += value.size;
    });
    return stats;
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const batchWorkspace = await batchWorkspaceStore.getItem("current");
    collectImageStorageKeys(batchWorkspace, usedKeys);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    Object.entries(value).forEach(([property, item]) => {
        if ((property === "storageKey" || property.endsWith("StorageKey")) && typeof item === "string" && item.startsWith("image:")) keys.add(item);
        if (Array.isArray(item)) item.forEach((child) => collectImageStorageKeys(child, keys));
        else collectImageStorageKeys(item, keys);
    });
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}
