"use client";

import { App, Button, Empty, Image as AntImage, Input, Progress, Select, Tag, Tooltip } from "antd";
import { Archive, BookOpen, CheckCircle2, CircleStop, Clock3, Download, ImagePlus, Layers3, LoaderCircle, Play, RefreshCw, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { saveAs } from "file-saver";
import { zip } from "fflate";

import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { useSaveAsset } from "@/hooks/use-save-asset";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { normalizeImageSizeForSelectedModel } from "@/lib/tokaxis-google-image";
import { requestEdit } from "@/services/api/image";
import { deleteStoredImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

type BatchStatus = "ready" | "queued" | "running" | "success" | "failed" | "stopped";

type BatchItem = {
    id: string;
    name: string;
    mimeType: string;
    sourceUrl: string;
    sourceStorageKey: string;
    sourceWidth: number;
    sourceHeight: number;
    sourceBytes: number;
    status: BatchStatus;
    error?: string;
    startedAt?: number;
    durationMs: number;
    resultUrl?: string;
    resultStorageKey?: string;
    resultWidth?: number;
    resultHeight?: number;
    resultBytes?: number;
    resultMimeType?: string;
    resultPrompt?: string;
    resultModel?: string;
    resultQuality?: string;
    resultSize?: string;
};

type BatchWorkspace = {
    version: 1;
    prompt: string;
    model: string;
    quality: string;
    size: string;
    concurrency: number;
    timeoutSeconds: number;
    items: BatchItem[];
};

type RunSnapshot = {
    prompt: string;
    config: AiConfig;
    timeoutSeconds: number;
};

const MAX_BATCH_IMAGES = 30;
const WORKSPACE_KEY = "current";
const workspaceStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_batch_workspace" });
const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];
const sizeOptions = [
    { value: "auto", label: "自动" },
    { value: "1:1", label: "1:1" },
    { value: "4:3", label: "4:3" },
    { value: "3:4", label: "3:4" },
    { value: "16:9", label: "16:9" },
    { value: "9:16", label: "9:16" },
];
const concurrencyOptions = [1, 2, 3, 4, 5].map((value) => ({ value, label: `${value} 个任务` }));
const timeoutOptions = [
    { value: 0, label: "不限制" },
    { value: 60, label: "1 分钟" },
    { value: 120, label: "2 分钟" },
    { value: 300, label: "5 分钟" },
    { value: 600, label: "10 分钟" },
];

export default function BatchPage() {
    const { message, modal } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const itemsRef = useRef<BatchItem[]>([]);
    const controllersRef = useRef(new Map<string, AbortController>());
    const runTokenRef = useRef(0);
    const runningRef = useRef(false);
    const uploadTokenRef = useRef(0);
    const mountedRef = useRef(true);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const saveAsset = useSaveAsset();
    const [items, setItems] = useState<BatchItem[]>([]);
    const [prompt, setPrompt] = useState("");
    const [model, setModel] = useState(effectiveConfig.imageModel || effectiveConfig.model);
    const [quality, setQuality] = useState(effectiveConfig.quality || "auto");
    const [size, setSize] = useState(effectiveConfig.size || "auto");
    const [concurrency, setConcurrency] = useState(3);
    const [timeoutSeconds, setTimeoutSeconds] = useState(300);
    const [hydrated, setHydrated] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [running, setRunning] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [packing, setPacking] = useState(false);
    const [now, setNow] = useState(Date.now());

    const counts = useMemo(
        () => ({
            success: items.filter((item) => item.status === "success").length,
            failed: items.filter((item) => item.status === "failed").length,
            running: items.filter((item) => item.status === "running").length,
            queued: items.filter((item) => item.status === "queued").length,
            stopped: items.filter((item) => item.status === "stopped").length,
        }),
        [items],
    );
    const completedCount = counts.success + counts.failed + counts.stopped;
    const progressPercent = items.length ? Math.round((completedCount / items.length) * 100) : 0;
    const hasRunnableItems = items.some((item) => item.status !== "success");

    const updateItems = (updater: (current: BatchItem[]) => BatchItem[]) => {
        setItems((current) => {
            const next = updater(current);
            itemsRef.current = next;
            return next;
        });
    };

    useEffect(() => {
        let cancelled = false;
        void readWorkspace().then((workspace) => {
            if (cancelled) return;
            if (workspace) {
                setPrompt(workspace.prompt || "");
                setModel(workspace.model || effectiveConfig.imageModel || effectiveConfig.model);
                setQuality(workspace.quality || "auto");
                setSize(workspace.size || "auto");
                setConcurrency(clamp(workspace.concurrency, 1, 5));
                setTimeoutSeconds([0, 60, 120, 300, 600].includes(workspace.timeoutSeconds) ? workspace.timeoutSeconds : 300);
                itemsRef.current = workspace.items;
                setItems(workspace.items);
            }
            setHydrated(true);
        });
        return () => {
            cancelled = true;
        };
        // 配置仅用于首次兜底，工作区恢复后以持久化快照为准。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        void workspaceStore.setItem(WORKSPACE_KEY, serializeWorkspace({ version: 1, prompt, model, quality, size, concurrency, timeoutSeconds, items })).catch((error) => console.warn("[ImageBatch] workspace save failed", error));
    }, [concurrency, hydrated, items, model, prompt, quality, size, timeoutSeconds]);

    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running]);

    useEffect(() => {
        if (effectiveConfig.imageModels.includes(model)) return;
        const fallback = effectiveConfig.imageModels.includes(effectiveConfig.imageModel) ? effectiveConfig.imageModel : effectiveConfig.imageModels[0] || "";
        if (fallback && fallback !== model) setModel(fallback);
    }, [effectiveConfig.imageModel, effectiveConfig.imageModels, model]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            uploadTokenRef.current += 1;
            runTokenRef.current += 1;
            runningRef.current = false;
            controllersRef.current.forEach((controller) => controller.abort());
            controllersRef.current.clear();
        };
    }, []);

    if (!hydrated) {
        return (
            <div className="grid h-full place-items-center bg-stone-50 text-stone-500 dark:bg-stone-950 dark:text-stone-400">
                <div className="flex items-center gap-2 text-sm">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在恢复图片批量工作区…
                </div>
            </div>
        );
    }

    const addFiles = async (files: File[]) => {
        if (runningRef.current || uploading) return;
        const images = files.filter((file) => file.type.startsWith("image/"));
        if (!images.length) {
            message.warning("请选择图片文件");
            return;
        }
        const capacity = Math.max(0, MAX_BATCH_IMAGES - itemsRef.current.length);
        if (!capacity) {
            message.warning(`单个批次最多 ${MAX_BATCH_IMAGES} 张图片`);
            return;
        }
        const selected = images.slice(0, capacity);
        if (images.length > selected.length) message.warning(`本次只加入前 ${selected.length} 张，单批上限为 ${MAX_BATCH_IMAGES} 张`);
        const uploadToken = uploadTokenRef.current + 1;
        uploadTokenRef.current = uploadToken;
        setUploading(true);
        try {
            const uploaded = await Promise.allSettled(
                selected.map(async (file): Promise<BatchItem> => {
                    const stored = await uploadImage(file);
                    return {
                        id: nanoid(),
                        name: file.name,
                        mimeType: stored.mimeType,
                        sourceUrl: stored.url,
                        sourceStorageKey: stored.storageKey,
                        sourceWidth: stored.width,
                        sourceHeight: stored.height,
                        sourceBytes: stored.bytes,
                        status: "ready",
                        durationMs: 0,
                    };
                }),
            );
            const successes = uploaded.filter((result): result is PromiseFulfilledResult<BatchItem> => result.status === "fulfilled").map((result) => result.value);
            if (!mountedRef.current || uploadToken !== uploadTokenRef.current) {
                await deleteStoredImages(successes.map((item) => item.sourceStorageKey));
                return;
            }
            updateItems((current) => [...current, ...successes]);
            const failed = uploaded.length - successes.length;
            if (successes.length) message.success(`已加入 ${successes.length} 张图片`);
            if (failed) message.error(`${failed} 张图片读取失败`);
        } finally {
            if (mountedRef.current && uploadToken === uploadTokenRef.current) {
                setUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        }
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragging(false);
        if (running || uploading) return;
        void addFiles(Array.from(event.dataTransfer.files));
    };

    const executeTask = async (task: BatchItem, snapshot: RunSnapshot, token: number) => {
        if (token !== runTokenRef.current) return;
        const controller = new AbortController();
        controllersRef.current.set(task.id, controller);
        const startedAt = Date.now();
        let timedOut = false;
        updateItems((current) => current.map((item) => (item.id === task.id ? { ...item, status: "running", error: undefined, startedAt, durationMs: 0 } : item)));
        let timeout = snapshot.timeoutSeconds
            ? window.setTimeout(() => {
                  timedOut = true;
                  controller.abort();
              }, snapshot.timeoutSeconds * 1000)
            : undefined;

        try {
            const reference: ReferenceImage = {
                id: task.id,
                name: task.name,
                type: task.mimeType,
                dataUrl: task.sourceUrl,
                storageKey: task.sourceStorageKey,
            };
            const [generated] = await requestEdit(snapshot.config, snapshot.prompt, [reference], undefined, { signal: controller.signal });
            if (!generated) throw new Error("接口没有返回图片");
            if (timeout) {
                window.clearTimeout(timeout);
                timeout = undefined;
            }
            const stored = await uploadImage(generated.dataUrl);
            if (token !== runTokenRef.current) {
                await deleteStoredImages([stored.storageKey]);
                return;
            }
            updateItems((current) =>
                current.map((item) =>
                    item.id === task.id
                        ? {
                              ...item,
                              status: "success",
                              error: undefined,
                              startedAt: undefined,
                              durationMs: Date.now() - startedAt,
                              resultUrl: stored.url,
                              resultStorageKey: stored.storageKey,
                              resultWidth: stored.width,
                              resultHeight: stored.height,
                              resultBytes: stored.bytes,
                              resultMimeType: stored.mimeType,
                              resultPrompt: snapshot.prompt,
                              resultModel: snapshot.config.model,
                              resultQuality: snapshot.config.quality,
                              resultSize: snapshot.config.size,
                          }
                        : item,
                ),
            );
        } catch (error) {
            if (token !== runTokenRef.current) return;
            const stopped = token !== runTokenRef.current || (controller.signal.aborted && !timedOut);
            updateItems((current) =>
                current.map((item) =>
                    item.id === task.id
                        ? {
                              ...item,
                              status: stopped ? "stopped" : "failed",
                              error: stopped ? "已停止" : timedOut ? `处理超时（${snapshot.timeoutSeconds} 秒）` : error instanceof Error ? error.message : "生成失败",
                              startedAt: undefined,
                              durationMs: Date.now() - startedAt,
                          }
                        : item,
                ),
            );
        } finally {
            if (timeout) window.clearTimeout(timeout);
            if (controllersRef.current.get(task.id) === controller) controllersRef.current.delete(task.id);
        }
    };

    const runBatch = async (requestedIds?: string[]) => {
        if (runningRef.current || uploading) return;
        const text = prompt.trim();
        if (!text) {
            message.warning("请输入处理提示词");
            return;
        }
        const selected = itemsRef.current.filter((item) => (requestedIds ? requestedIds.includes(item.id) : item.status !== "success"));
        if (!selected.length) {
            message.info(itemsRef.current.length ? "当前任务已全部完成" : "请先添加图片");
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成图片模型配置");
            openConfigDialog(true);
            return;
        }
        if (!effectiveConfig.imageModels.includes(model)) {
            message.warning("当前图片模型已失效，请重新选择");
            const fallback = effectiveConfig.imageModels.includes(effectiveConfig.imageModel) ? effectiveConfig.imageModel : effectiveConfig.imageModels[0] || "";
            if (fallback) setModel(fallback);
            return;
        }

        const token = runTokenRef.current + 1;
        runTokenRef.current = token;
        const snapshot: RunSnapshot = {
            prompt: text,
            config: { ...effectiveConfig, model, imageModel: model, quality, size, count: "1" },
            timeoutSeconds,
        };
        const selectedIds = new Set(selected.map((item) => item.id));
        runningRef.current = true;
        setRunning(true);
        setNow(Date.now());
        updateItems((current) =>
            current.map((item) =>
                selectedIds.has(item.id)
                    ? {
                          ...item,
                          status: "queued",
                          error: undefined,
                          startedAt: undefined,
                          durationMs: 0,
                          resultUrl: undefined,
                          resultStorageKey: undefined,
                          resultWidth: undefined,
                          resultHeight: undefined,
                          resultBytes: undefined,
                          resultMimeType: undefined,
                          resultPrompt: undefined,
                          resultModel: undefined,
                          resultQuality: undefined,
                          resultSize: undefined,
                      }
                    : item,
            ),
        );
        const staleResultKeys = selected.map((item) => item.resultStorageKey).filter((key): key is string => Boolean(key));
        try {
            if (staleResultKeys.length) await deleteStoredImages(staleResultKeys);
        } catch (error) {
            if (!mountedRef.current || token !== runTokenRef.current) return;
            runningRef.current = false;
            setRunning(false);
            updateItems((current) => current.map((item) => (selectedIds.has(item.id) && item.status === "queued" ? { ...item, status: "failed", error: "准备任务失败" } : item)));
            message.error(error instanceof Error ? `准备任务失败：${error.message}` : "准备任务失败");
            return;
        }
        if (!mountedRef.current || token !== runTokenRef.current) return;

        let cursor = 0;
        const worker = async () => {
            while (token === runTokenRef.current) {
                const task = selected[cursor];
                cursor += 1;
                if (!task) return;
                await executeTask(task, snapshot, token);
            }
        };

        await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));
        if (token !== runTokenRef.current) return;
        runningRef.current = false;
        setRunning(false);
        const finished = itemsRef.current.filter((item) => selectedIds.has(item.id));
        const successCount = finished.filter((item) => item.status === "success").length;
        const failedCount = finished.filter((item) => item.status === "failed").length;
        if (failedCount) message.warning(`本轮完成 ${successCount} 张，失败 ${failedCount} 张`);
        else message.success(`本轮 ${successCount} 张图片已全部完成`);
    };

    const stopBatch = () => {
        if (!runningRef.current) return;
        runTokenRef.current += 1;
        runningRef.current = false;
        controllersRef.current.forEach((controller) => controller.abort());
        controllersRef.current.clear();
        updateItems((current) => current.map((item) => (item.status === "queued" || item.status === "running" ? { ...item, status: "stopped", error: "已停止", startedAt: undefined } : item)));
        setRunning(false);
        message.info("批量处理已停止");
    };

    const removeItem = async (id: string) => {
        if (runningRef.current || uploading) return;
        const item = itemsRef.current.find((value) => value.id === id);
        if (!item) return;
        updateItems((current) => current.filter((value) => value.id !== id));
        await deleteStoredImages([item.sourceStorageKey, item.resultStorageKey].filter((key): key is string => Boolean(key)));
    };

    const clearItems = () => {
        if (runningRef.current || uploading) return;
        modal.confirm({
            title: "清空当前批次？",
            content: "原图和批量结果将从当前浏览器工作区删除，此操作无法撤销。",
            okText: "清空",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                const keys = itemsRef.current.flatMap((item) => [item.sourceStorageKey, item.resultStorageKey]).filter((key): key is string => Boolean(key));
                await deleteStoredImages(keys);
                itemsRef.current = [];
                setItems([]);
                await workspaceStore.removeItem(WORKSPACE_KEY);
            },
        });
    };

    const downloadResult = (item: BatchItem) => {
        if (!item.resultUrl) return;
        saveAs(item.resultUrl, resultFileName(item));
    };

    const downloadAll = async () => {
        const completed = itemsRef.current.filter((item) => item.status === "success" && item.resultUrl);
        if (!completed.length) return;
        setPacking(true);
        try {
            const files: Array<readonly [string, Uint8Array]> = [];
            let totalBytes = 0;
            for (const [index, item] of completed.entries()) {
                const bytes = new Uint8Array(await (await fetch(item.resultUrl!)).arrayBuffer());
                totalBytes += bytes.byteLength;
                if (totalBytes > 160 * 1024 * 1024) throw new Error("批量结果超过 160 MB，请分批下载");
                files.push([`${String(index + 1).padStart(2, "0")}-${resultFileName(item)}`, bytes]);
            }
            const archive = await new Promise<Uint8Array>((resolve, reject) => {
                zip(Object.fromEntries(files), { level: 0 }, (error, data) => (error ? reject(error) : resolve(data)));
            });
            const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
            saveAs(new Blob([buffer], { type: "application/zip" }), `图片批量-${dateStamp()}.zip`);
        } catch (error) {
            message.error(error instanceof Error ? `打包失败：${error.message}` : "打包失败");
        } finally {
            setPacking(false);
        }
    };

    const saveResultToAssets = (item: BatchItem) => {
        if (!item.resultUrl) return;
        saveAsset({
            kind: "image",
            initialCategory: "其他",
            prepare: async () => {
                const stored = await uploadImage(item.resultUrl!);
                return {
                    asset: {
                        kind: "image",
                        title: `${fileStem(item.name)} 处理结果`,
                        coverUrl: stored.url,
                        tags: ["图片批量"],
                        source: "图片批量",
                        data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                        metadata: {
                            source: "image-batch",
                            prompt: item.resultPrompt || "",
                            model: item.resultModel || "",
                            quality: item.resultQuality || "",
                            size: item.resultSize || "",
                        },
                    },
                    rollback: () => deleteStoredImages([stored.storageKey]),
                };
            },
        });
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[390px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                <aside className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="flex items-center gap-2">
                                <Layers3 className="size-5 text-violet-500" />
                                <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">图片批量</h1>
                            </div>
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">同一提示词逐张独立处理，失败不会影响其他图片。</p>
                        </div>
                        <Tag className="m-0 shrink-0">
                            {items.length}/{MAX_BATCH_IMAGES}
                        </Tag>
                    </div>

                    <div className="mt-5 space-y-5">
                        <section>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold">输入图片（批量）</span>
                                <Button size="small" icon={<Upload className="size-3.5" />} loading={uploading} disabled={running} onClick={() => fileInputRef.current?.click()}>
                                    添加图片
                                </Button>
                            </div>
                            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => void addFiles(Array.from(event.target.files || []))} />
                            <div
                                className={`rounded-lg border border-dashed p-3 transition ${dragging ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20" : "border-stone-300 dark:border-stone-700"}`}
                                onDragEnter={(event) => {
                                    event.preventDefault();
                                    if (!running && !uploading) setDragging(true);
                                }}
                                onDragOver={(event) => event.preventDefault()}
                                onDragLeave={() => setDragging(false)}
                                onDrop={handleDrop}
                            >
                                {items.length ? (
                                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-4">
                                        {items.map((item, index) => (
                                            <div key={item.id} className="group relative aspect-square overflow-hidden rounded-md border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900">
                                                <img src={item.sourceUrl} alt={item.name} className="size-full object-cover" />
                                                <span className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</span>
                                                <button
                                                    type="button"
                                                    aria-label={`移除 ${item.name}`}
                                                    disabled={running || uploading}
                                                    className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/65 text-white opacity-0 transition hover:bg-black group-hover:opacity-100 disabled:hidden"
                                                    onClick={() => void removeItem(item.id)}
                                                >
                                                    <X className="size-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                        {items.length < MAX_BATCH_IMAGES ? (
                                            <button
                                                type="button"
                                                disabled={running || uploading}
                                                className="grid aspect-square place-items-center rounded-md border border-dashed border-stone-300 text-stone-400 transition hover:border-stone-500 hover:text-stone-600 disabled:cursor-not-allowed dark:border-stone-700 dark:hover:border-stone-500 dark:hover:text-stone-200"
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                <ImagePlus className="size-5" />
                                            </button>
                                        ) : null}
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={running || uploading}
                                        className="flex min-h-32 w-full flex-col items-center justify-center gap-2 text-sm text-stone-500 disabled:cursor-not-allowed dark:text-stone-400"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <ImagePlus className="size-7" />
                                        <span>点击或拖入多张图片</span>
                                        <span className="text-xs text-stone-400">最多 {MAX_BATCH_IMAGES} 张</span>
                                    </button>
                                )}
                            </div>
                        </section>

                        <section>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold">处理提示词</span>
                                <Button size="small" icon={<BookOpen className="size-3.5" />} disabled={running} onClick={() => setPromptDialogOpen(true)}>
                                    提示词库
                                </Button>
                            </div>
                            <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} maxLength={4000} showCount disabled={running} placeholder="例如：保持主体不变，统一改为纯白电商背景，柔和棚拍光线，高清细节" />
                        </section>

                        <section className="space-y-3">
                            <span className="text-sm font-semibold">处理设置</span>
                            <label className="grid gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                                图片模型
                                <ModelPicker
                                    config={effectiveConfig}
                                    value={model}
                                    onChange={(value) => {
                                        setModel(value);
                                        setSize((current) => normalizeImageSizeForSelectedModel(value, current));
                                    }}
                                    capability="image"
                                    fullWidth
                                    className={running ? "pointer-events-none opacity-60" : undefined}
                                    onMissingConfig={() => openConfigDialog(true)}
                                />
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="grid gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                                    质量
                                    <Select value={quality} options={qualityOptions} onChange={setQuality} disabled={running} />
                                </label>
                                <label className="grid gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                                    输出比例
                                    <Select value={size} options={sizeOptions} onChange={setSize} disabled={running} />
                                </label>
                                <label className="grid gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                                    并发处理
                                    <Select value={concurrency} options={concurrencyOptions} onChange={setConcurrency} disabled={running} />
                                </label>
                                <label className="grid gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                                    单张超时
                                    <Select value={timeoutSeconds} options={timeoutOptions} onChange={setTimeoutSeconds} disabled={running} />
                                </label>
                            </div>
                        </section>

                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                            {running ? (
                                <Button danger size="large" icon={<CircleStop className="size-4" />} onClick={stopBatch}>
                                    停止全部
                                </Button>
                            ) : (
                                <Button type="primary" size="large" icon={<Play className="size-4" />} disabled={!items.length || !hasRunnableItems || !prompt.trim() || uploading} onClick={() => void runBatch()}>
                                    {counts.success === items.length ? "已全部完成" : counts.success ? "处理未完成" : "运行全部"}
                                </Button>
                            )}
                            <Tooltip title="清空当前批次">
                                <Button danger size="large" icon={<Trash2 className="size-4" />} disabled={!items.length || running || uploading} onClick={clearItems} aria-label="清空当前批次" />
                            </Tooltip>
                        </div>
                    </div>
                </aside>

                <section className="flex min-h-[520px] flex-col rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:min-h-0">
                    <div className="border-b border-stone-200 p-4 dark:border-stone-800">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h2 className="text-base font-semibold">处理队列</h2>
                                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">每张原图单独请求、单独计时，可分别重试和保存。</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button size="small" icon={<RotateCcw className="size-3.5" />} disabled={running || uploading || !counts.failed} onClick={() => void runBatch(items.filter((item) => item.status === "failed").map((item) => item.id))}>
                                    重试失败项
                                </Button>
                                <Button size="small" icon={<Archive className="size-3.5" />} loading={packing} disabled={!counts.success} onClick={() => void downloadAll()}>
                                    下载全部
                                </Button>
                            </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                            <Progress percent={progressPercent} status={counts.failed && !running ? "exception" : running ? "active" : counts.success && counts.success === items.length ? "success" : "normal"} showInfo={false} />
                            <div className="flex flex-wrap gap-1.5 text-xs">
                                <Tag className="m-0">共 {items.length}</Tag>
                                <Tag color="green" className="m-0">
                                    成功 {counts.success}
                                </Tag>
                                <Tag color="red" className="m-0">
                                    失败 {counts.failed}
                                </Tag>
                                {counts.running ? (
                                    <Tag color="processing" className="m-0">
                                        处理中 {counts.running}
                                    </Tag>
                                ) : null}
                                {counts.queued ? (
                                    <Tag color="gold" className="m-0">
                                        排队 {counts.queued}
                                    </Tag>
                                ) : null}
                                {counts.stopped ? (
                                    <Tag color="orange" className="m-0">
                                        已停止 {counts.stopped}
                                    </Tag>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
                        {items.length ? (
                            <div className="space-y-2">
                                {items.map((item, index) => (
                                    <BatchRow
                                        key={item.id}
                                        item={item}
                                        index={index}
                                        now={now}
                                        disabled={running || uploading}
                                        onRetry={() => void runBatch([item.id])}
                                        onDownload={() => downloadResult(item)}
                                        onSave={() => saveResultToAssets(item)}
                                        onRemove={() => void removeItem(item.id)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="grid h-full min-h-80 place-items-center">
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="添加图片后，处理任务会显示在这里" />
                            </div>
                        )}
                    </div>
                </section>
            </main>

            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
        </div>
    );
}

function BatchRow({ item, index, now, disabled, onRetry, onDownload, onSave, onRemove }: { item: BatchItem; index: number; now: number; disabled: boolean; onRetry: () => void; onDownload: () => void; onSave: () => void; onRemove: () => void }) {
    const duration = item.status === "running" && item.startedAt ? now - item.startedAt : item.durationMs;
    return (
        <article
            className={`rounded-lg border p-3 transition ${item.status === "failed" ? "border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/10" : item.status === "running" ? "border-violet-300 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/10" : "border-stone-200 bg-background dark:border-stone-800"}`}
        >
            <div className="grid gap-3 md:grid-cols-[36px_88px_minmax(150px,1fr)_auto] md:items-center xl:grid-cols-[36px_96px_minmax(170px,1fr)_130px_minmax(120px,180px)_auto]">
                <div
                    className={`grid size-8 place-items-center rounded-full text-xs font-semibold ${item.status === "success" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : item.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : item.status === "running" ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"}`}
                >
                    {item.status === "success" ? <CheckCircle2 className="size-4" /> : item.status === "running" ? <LoaderCircle className="size-4 animate-spin" /> : index + 1}
                </div>
                <AntImage src={item.sourceUrl} alt={item.name} width="100%" height={64} className="rounded-md object-cover" preview={{ mask: "查看原图" }} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold" title={item.name}>
                        {item.name}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                        <span>
                            {item.sourceWidth}×{item.sourceHeight}
                        </span>
                        <span>{formatBytes(item.sourceBytes)}</span>
                    </div>
                    {item.error ? (
                        <div className="mt-1 line-clamp-2 text-xs text-red-600 dark:text-red-400" title={item.error}>
                            {item.error}
                        </div>
                    ) : null}
                </div>
                <div className="flex items-center gap-2 md:col-start-3 xl:col-start-auto">
                    <StatusTag status={item.status} />
                    {duration ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
                            <Clock3 className="size-3" />
                            {formatDuration(duration)}
                        </span>
                    ) : null}
                </div>
                <div className="md:col-span-2 xl:col-span-1">
                    {item.resultUrl ? (
                        <AntImage src={item.resultUrl} alt={`${item.name} 处理结果`} width="100%" height={64} className="rounded-md object-cover" preview={{ mask: "查看结果" }} />
                    ) : (
                        <div className="grid h-16 place-items-center rounded-md border border-dashed border-stone-300 text-xs text-stone-400 dark:border-stone-700">等待结果</div>
                    )}
                </div>
                <div className="flex flex-wrap justify-end gap-1.5 md:col-span-2 xl:col-span-1">
                    {item.status === "failed" || item.status === "stopped" || item.status === "success" ? (
                        <Tooltip title={item.status === "success" ? "重新处理" : "重试"}>
                            <Button size="small" icon={<RefreshCw className="size-3.5" />} disabled={disabled} onClick={onRetry} aria-label={item.status === "success" ? "重新处理" : "重试"} />
                        </Tooltip>
                    ) : null}
                    <Tooltip title="下载">
                        <Button size="small" icon={<Download className="size-3.5" />} disabled={!item.resultUrl} onClick={onDownload} aria-label="下载" />
                    </Tooltip>
                    <Tooltip title="保存到我的素材">
                        <Button size="small" icon={<Save className="size-3.5" />} disabled={!item.resultUrl} onClick={onSave} aria-label="保存到我的素材" />
                    </Tooltip>
                    <Tooltip title="移除">
                        <Button danger size="small" icon={<Trash2 className="size-3.5" />} disabled={disabled} onClick={onRemove} aria-label="移除" />
                    </Tooltip>
                </div>
            </div>
        </article>
    );
}

function StatusTag({ status }: { status: BatchStatus }) {
    const values: Record<BatchStatus, { label: string; color?: string }> = {
        ready: { label: "待处理" },
        queued: { label: "排队中", color: "gold" },
        running: { label: "处理中", color: "processing" },
        success: { label: "成功", color: "green" },
        failed: { label: "失败", color: "red" },
        stopped: { label: "已停止", color: "orange" },
    };
    const value = values[status];
    return (
        <Tag color={value.color} className="m-0 whitespace-nowrap">
            {value.label}
        </Tag>
    );
}

async function readWorkspace(): Promise<BatchWorkspace | null> {
    try {
        const stored = await workspaceStore.getItem<BatchWorkspace>(WORKSPACE_KEY);
        if (!stored || stored.version !== 1 || !Array.isArray(stored.items)) return null;
        const items = await Promise.all(
            stored.items.map(async (item): Promise<BatchItem> => {
                const sourceUrl = await resolveImageUrl(item.sourceStorageKey, item.sourceUrl);
                const resultUrl = item.resultStorageKey ? await resolveImageUrl(item.resultStorageKey, item.resultUrl) : item.resultUrl;
                let status: BatchStatus = item.status === "running" || item.status === "queued" ? "stopped" : item.status;
                let error = item.status === "running" || item.status === "queued" ? "页面刷新，任务已停止" : item.error;
                if (!sourceUrl) {
                    status = "failed";
                    error = "原图已失效，请移除后重新添加";
                } else if (status === "success" && !resultUrl) {
                    status = "failed";
                    error = "处理结果已失效，请重试";
                }
                return { ...item, sourceUrl, resultUrl: resultUrl || undefined, status, error, startedAt: undefined };
            }),
        );
        return { ...stored, items };
    } catch {
        return null;
    }
}

function serializeWorkspace(workspace: BatchWorkspace): BatchWorkspace {
    return {
        ...workspace,
        items: workspace.items.map((item) => ({
            ...item,
            sourceUrl: item.sourceStorageKey ? "" : item.sourceUrl,
            resultUrl: item.resultStorageKey ? "" : item.resultUrl,
        })),
    };
}

function resultFileName(item: BatchItem) {
    return `${fileStem(item.name)}-处理结果.${mimeExtension(item.resultMimeType)}`;
}

function fileStem(name: string) {
    const stem = name.replace(/\.[^.]+$/, "") || "image";
    return stem.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
}

function mimeExtension(mimeType?: string) {
    if (mimeType?.includes("jpeg")) return "jpg";
    if (mimeType?.includes("webp")) return "webp";
    if (mimeType?.includes("gif")) return "gif";
    return "png";
}

function dateStamp() {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Number(value) || min));
}
