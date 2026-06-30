"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Input, Modal, Slider } from "antd";
import { Brush, Eraser, Layers3, Palette, RefreshCcw, RotateCcw, Sparkles, Trash2, WandSparkles, X } from "lucide-react";

import { readImageMeta } from "@/lib/image-utils";

export type CanvasImageMaskEditPayload = {
    prompt: string;
    displayPrompt?: string;
    maskDataUrl: string;
};

type DrawMode = "paint" | "erase";
type MaskEditIntent = "remove" | "recolor" | "material" | "replace" | "cleanup" | "custom";

const fallbackBrushSize = 56;
const maskFillColor = "rgba(37, 99, 235, .38)";
const maskBorderColor = "rgba(255, 255, 255, .72)";
const maskEditIntents = [
    { value: "remove", label: "移除", icon: Trash2 },
    { value: "recolor", label: "换色", icon: Palette },
    { value: "material", label: "换材质", icon: Layers3 },
    { value: "replace", label: "替换", icon: RefreshCcw },
    { value: "cleanup", label: "清理瑕疵", icon: Sparkles },
    { value: "custom", label: "自定义", icon: WandSparkles },
] as const satisfies ReadonlyArray<{ value: MaskEditIntent; label: string; icon: typeof Trash2 }>;

const intentInputConfig: Record<MaskEditIntent, { label: string; placeholder: string; required: boolean; actionLabel: string }> = {
    remove: {
        label: "补充要求（可选）",
        placeholder: "例如：保留右侧产品，只移除涂抹的包装盒",
        required: false,
        actionLabel: "移除选区",
    },
    recolor: {
        label: "目标颜色",
        placeholder: "例如：深蓝色、珍珠白、潘通 186 C",
        required: true,
        actionLabel: "更换颜色",
    },
    material: {
        label: "目标材质",
        placeholder: "例如：磨砂金属、透明玻璃、哑光陶瓷",
        required: true,
        actionLabel: "更换材质",
    },
    replace: {
        label: "替换成什么",
        placeholder: "例如：替换成白色圆瓶，大小和位置保持一致",
        required: true,
        actionLabel: "替换选区",
    },
    cleanup: {
        label: "清理内容（可选）",
        placeholder: "例如：去掉划痕和灰尘，保留原有纹理",
        required: false,
        actionLabel: "清理瑕疵",
    },
    custom: {
        label: "修改要求",
        placeholder: "描述只需要在涂抹区域内完成的修改",
        required: true,
        actionLabel: "AI 修改",
    },
};

export function CanvasNodeMaskEditDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (payload: CanvasImageMaskEditPayload) => void }) {
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef<{ active: boolean; last: { x: number; y: number } | null }>({ active: false, last: null });
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [prompt, setPrompt] = useState("");
    const [brushSize, setBrushSize] = useState(fallbackBrushSize);
    const [mode, setMode] = useState<DrawMode>("paint");
    const [intent, setIntent] = useState<MaskEditIntent>("remove");
    const [error, setError] = useState("");
    const [hasPainted, setHasPainted] = useState(false);

    useEffect(() => {
        if (!open) return;
        setPrompt("");
        setMode("paint");
        setIntent("remove");
        setError("");
        setHasPainted(false);
        setImage(null);
        void readImageMeta(dataUrl).then((meta) => {
            setImage(meta);
            setBrushSize(getDefaultBrushSize(meta));
        });
    }, [dataUrl, open]);

    useEffect(() => {
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
    }, [image]);

    const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        const maskCanvas = maskCanvasRef.current;
        const context = maskCanvas?.getContext("2d");
        if (!context) return;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = brushSize;
        context.globalCompositeOperation = mode === "paint" ? "source-over" : "destination-out";
        context.strokeStyle = "#000";
        context.fillStyle = "#000";
        if (!drawingRef.current.last) {
            drawMaskStroke(context, point, point, brushSize);
        } else {
            drawMaskStroke(context, drawingRef.current.last, point, brushSize);
        }
        if (maskCanvas && previewCanvasRef.current) renderMaskPreview(maskCanvas, previewCanvasRef.current);
        drawingRef.current.last = point;
        if (mode === "paint") {
            setHasPainted(true);
            setError("");
        }
    };

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drawingRef.current = { active: true, last: null };
        if (maskCanvasRef.current) renderMaskPreview(maskCanvasRef.current, previewCanvasRef.current);
        draw(event);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current.active) return;
        event.preventDefault();
        draw(event);
    };

    const stopDraw = () => {
        drawingRef.current = { active: false, last: null };
        const maskCanvas = maskCanvasRef.current;
        if (maskCanvas) {
            const painted = canvasHasPaint(maskCanvas);
            setHasPainted(painted);
            renderMaskPreview(maskCanvas, previewCanvasRef.current, painted);
        }
    };

    const resetMask = () => {
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
        setHasPainted(false);
        setError("");
    };

    const submitEdit = () => {
        const canvas = maskCanvasRef.current;
        if (!canvas) return;
        if (!hasPainted || !canvasHasPaint(canvas)) return setError("请先涂抹局部区域");
        const detail = prompt.trim();
        const config = intentInputConfig[intent];
        if (config.required && !detail) return setError(`请输入${config.label}`);
        onConfirm({
            prompt: buildIntentPrompt(intent, detail),
            displayPrompt: buildDisplayPrompt(intent, detail),
            maskDataUrl: buildEditMask(canvas, intent, brushSize),
        });
    };

    const inputConfig = intentInputConfig[intent];
    const needsRequiredDetail = inputConfig.required && !prompt.trim();
    const canSubmit = hasPainted && !needsRequiredDetail;
    const activeStep = !hasPainted ? 0 : needsRequiredDetail ? 2 : 3;
    const stepItems = ["涂抹区域", "选择操作", "补充要求", "Agent 执行"];

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={980} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_320px]">
                <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-black/10 bg-transparent p-0 dark:border-white/10">
                    <div className="relative inline-block max-w-full overflow-hidden rounded-lg bg-transparent select-none">
                        <img src={dataUrl} alt="" className="block max-h-[68vh] max-w-full bg-transparent" draggable={false} />
                        {image ? (
                            <>
                                <canvas ref={maskCanvasRef} width={image.width} height={image.height} className="hidden" />
                                <canvas
                                    ref={previewCanvasRef}
                                    width={image.width}
                                    height={image.height}
                                    className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                                    onPointerDown={startDraw}
                                    onPointerMove={moveDraw}
                                    onPointerUp={stopDraw}
                                    onPointerCancel={stopDraw}
                                />
                            </>
                        ) : null}
                    </div>
                </div>

                <div className="flex min-h-[360px] flex-col gap-5">
                    <div>
                        <div className="flex items-start justify-between gap-3">
                            <h2 className="text-xl font-semibold">局部遮罩编辑</h2>
                            <span className="rounded-full border border-black/10 px-2 py-1 text-xs opacity-70 dark:border-white/15">先涂抹再执行</span>
                        </div>
                        <div className="mt-2 text-sm opacity-60">{image ? `${image.width} x ${image.height}px` : "读取中"}</div>
                        <div className="mt-4 grid grid-cols-4 gap-1.5">
                            {stepItems.map((step, index) => (
                                <div
                                    key={step}
                                    className={`rounded-lg border px-2 py-1.5 text-center text-[11px] leading-tight ${index <= activeStep ? "border-[#3b82f6]/45 bg-[#3b82f6]/10 text-[#1d4ed8] dark:text-[#93c5fd]" : "border-black/10 text-black/45 dark:border-white/10 dark:text-white/45"}`}
                                >
                                    {index + 1}. {step}
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 text-xs leading-5 opacity-55">在左侧图片上涂抹需要修改的区域；擦除可微调边缘，未涂抹前不会误触发生成。</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button type={mode === "paint" ? "primary" : "default"} icon={<Brush className="size-4" />} onClick={() => setMode("paint")}>
                            画笔
                        </Button>
                        <Button type={mode === "erase" ? "primary" : "default"} icon={<Eraser className="size-4" />} onClick={() => setMode("erase")}>
                            擦除
                        </Button>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium opacity-75">笔刷大小</span>
                            <span className="font-semibold">{brushSize}px</span>
                        </div>
                        <Slider min={8} max={160} step={2} value={brushSize} onChange={setBrushSize} />
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">操作类型</div>
                        <div className="grid grid-cols-2 gap-2">
                            {maskEditIntents.map((item) => {
                                const Icon = item.icon;
                                const selected = intent === item.value;
                                return (
                                    <Button
                                        key={item.value}
                                        type={selected ? "primary" : "default"}
                                        icon={<Icon className="size-4" />}
                                        aria-pressed={selected}
                                        onClick={() => {
                                            setIntent(item.value);
                                            setPrompt("");
                                            setError("");
                                        }}
                                    >
                                        {item.label}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">
                            {inputConfig.label}
                            {inputConfig.required ? <span className="ml-1 text-[#ef4444]">*</span> : null}
                        </div>
                        <Input.TextArea
                            rows={4}
                            value={prompt}
                            status={error ? "error" : undefined}
                            placeholder={inputConfig.placeholder}
                            onChange={(event) => {
                                setPrompt(event.target.value);
                                setError("");
                            }}
                        />
                        {error ? <div className="text-xs font-medium text-[#ef4444]">{error}</div> : null}
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Button icon={<RotateCcw className="size-4" />} onClick={resetMask}>
                                重置
                            </Button>
                            <Button icon={<X className="size-4" />} onClick={onClose}>
                                取消
                            </Button>
                        </div>
                        <Button type="primary" icon={<WandSparkles className="size-4" />} disabled={!canSubmit} onClick={submitEdit} title={hasPainted ? "Agent 驱动执行" : "请先在图片上涂抹区域"}>
                            Agent {inputConfig.actionLabel}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function buildIntentPrompt(intent: MaskEditIntent, detail: string) {
    const sharedRules = [
        "Edit only inside the supplied transparent mask.",
        "Everything outside the mask must remain pixel-identical: do not move, resize, crop, redraw, relight, recolor, sharpen, blur, or alter any unmasked object, text, logo, background, composition, or camera perspective.",
        "Blend the edited area naturally with the surrounding perspective, scale, lighting direction, exposure, color temperature, texture, reflections, contact shadows, depth of field, and image grain.",
    ];
    const detailLine = detail ? `Additional requirement: ${detail}` : "";
    const prompts: Record<MaskEditIntent, string[]> = {
        remove: [
            "TASK: OBJECT REMOVAL AND BACKGROUND INPAINTING.",
            "Completely remove the selected object. Do not preserve, redraw, deform, recolor, shrink, crop, relocate, or leave any fragment of it.",
            "Remove all selected text, logos, edges, outlines, color residue, contact shadows, reflections, and visual traces belonging to the removed object.",
            "Reconstruct the empty area from the immediately surrounding real background, continuing the same surface, wall, material texture, pattern, perspective lines, lighting, reflection, depth of field, and grain.",
            "Do not insert a replacement object and do not duplicate any nearby object.",
        ],
        recolor: [
            "TASK: RECOLOR THE SELECTED OBJECT.",
            `Target color: ${detail}.`,
            "Change only the color of the selected object while preserving its exact silhouette, geometry, proportions, topology, labels, logos, text, material, texture, transparency, highlights, reflections, and shadows.",
            "Every printed character, label, barcode, regulatory mark, serial number, and fine text on the product surface must remain in its original position, font, size, and content. If any text becomes illegible after recoloring, redraw it at the same location with the original font and layout, adjusting only its color for contrast against the new surface color.",
            "Preserve the original rendering style exactly: if the source is a flat illustration keep it flat, if photorealistic keep it photorealistic. Do not add or remove 3D shading, highlights, glossy reflections, or depth effects that were not present in the original.",
            "The result must look like the same physical product photographed in the target color.",
        ],
        material: [
            "TASK: CHANGE THE MATERIAL OF THE SELECTED OBJECT.",
            `Target material: ${detail}.`,
            "Preserve the selected object's exact silhouette, geometry, dimensions, proportions, topology, labels, logos, text, position, and orientation.",
            "All printed text, labels, logos, barcodes, and regulatory marks must remain fully legible after material change. Adjust text color if needed for contrast against the new material, but preserve original position, font, size, and content.",
            "Change only its surface material response, with physically plausible texture, roughness, highlights, transparency, reflections, and contact shadows.",
        ],
        replace: [
            "TASK: REPLACE THE SELECTED OBJECT.",
            `Replacement: ${detail}.`,
            "Completely remove the original selected object and insert only the requested replacement in the same masked location.",
            "Match the requested replacement to the scene's scale, camera angle, perspective, lighting direction, exposure, color temperature, contact shadow, reflection, focus, and grain.",
            "Do not alter or duplicate any unmasked object.",
        ],
        cleanup: [
            "TASK: CLEAN UP LOCAL IMPERFECTIONS.",
            "Remove only the selected dust, scratches, stains, unwanted marks, seams, compression artifacts, or small defects.",
            "Reconstruct the original underlying surface naturally while preserving the object's shape, color, material, texture, labels, logos, text, highlights, reflections, and shadows.",
        ],
        custom: [
            "TASK: APPLY THE USER'S LOCAL EDIT.",
            `Requested edit: ${detail}.`,
            "Perform exactly the requested change inside the mask and preserve all unrelated visual properties.",
        ],
    };
    return [...prompts[intent], ...sharedRules, detailLine].filter(Boolean).join("\n");
}

function buildDisplayPrompt(intent: MaskEditIntent, detail: string) {
    const label = maskEditIntents.find((item) => item.value === intent)?.label || "局部修改";
    if (!detail) return `${label}选区`;
    return `${label}：${detail}`.slice(0, 80);
}

function getDefaultBrushSize(image: { width: number; height: number }) {
    const shortSide = Math.min(image.width, image.height);
    return Math.max(24, Math.min(72, Math.round(shortSide * 0.055)));
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawMaskStroke(context: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, size: number) {
    if (from.x === to.x && from.y === to.y) {
        context.beginPath();
        context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
}

function canvasHasPaint(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) return false;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) return true;
    }
    return false;
}

function renderMaskPreview(maskCanvas: HTMLCanvasElement, previewCanvas: HTMLCanvasElement | null, withBorder = false) {
    const context = previewCanvas?.getContext("2d");
    if (!previewCanvas || !context) return;
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.fillStyle = maskFillColor;
    context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(maskCanvas, 0, 0);
    context.globalCompositeOperation = "source-over";
    if (withBorder) drawDashedMaskBorder(context, maskCanvas);
}

function drawDashedMaskBorder(context: CanvasRenderingContext2D, maskCanvas: HTMLCanvasElement) {
    const maskContext = maskCanvas.getContext("2d");
    if (!maskContext) return;
    const { width, height } = maskCanvas;
    const data = maskContext.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.round(Math.max(width, height) / 1200));
    const dash = step * 8;
    const gap = step * 5;
    const period = dash + gap;

    context.save();
    context.fillStyle = maskBorderColor;
    context.shadowColor = "rgba(0, 0, 0, .24)";
    context.shadowBlur = step * 1.5;
    for (let y = step; y < height - step; y += step) {
        for (let x = step; x < width - step; x += step) {
            const offset = (y * width + x) * 4 + 3;
            if (data[offset] === 0 || !isMaskEdge(data, width, x, y, step)) continue;
            if ((x + y) % period > dash) continue;
            context.fillRect(x - step / 2, y - step / 2, Math.max(1.5, step), Math.max(1.5, step));
        }
    }
    context.restore();
}

function isMaskEdge(data: Uint8ClampedArray, width: number, x: number, y: number, step: number) {
    return data[((y - step) * width + x) * 4 + 3] === 0 || data[((y + step) * width + x) * 4 + 3] === 0 || data[(y * width + x - step) * 4 + 3] === 0 || data[(y * width + x + step) * 4 + 3] === 0;
}

function buildEditMask(selectionCanvas: HTMLCanvasElement, intent: MaskEditIntent, brushSize: number) {
    const editSelection = intent === "remove" ? buildRemovalSelection(selectionCanvas, brushSize) : selectionCanvas;
    const canvas = document.createElement("canvas");
    canvas.width = editSelection.width;
    canvas.height = editSelection.height;
    const context = canvas.getContext("2d");
    if (!context) return editSelection.toDataURL("image/png");
    const selectionContext = editSelection.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!selectionContext) return canvas.toDataURL("image/png");
    const selection = selectionContext.getImageData(0, 0, canvas.width, canvas.height);
    const mask = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < mask.data.length; index += 4) {
        if (selection.data[index] > 0) mask.data[index] = 0;
    }
    context.putImageData(mask, 0, 0);
    return canvas.toDataURL("image/png");
}

type MaskPoint = { x: number; y: number };

/** Turn rough removal strokes into one closed editable region per painted object. */
function buildRemovalSelection(selectionCanvas: HTMLCanvasElement, brushSize: number) {
    const width = selectionCanvas.width;
    const height = selectionCanvas.height;
    const sourceContext = selectionCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) return selectionCanvas;

    const pixels = sourceContext.getImageData(0, 0, width, height).data;
    const sampleStep = Math.max(2, Math.ceil(Math.max(width, height) / 640));
    const gridWidth = Math.ceil(width / sampleStep);
    const gridHeight = Math.ceil(height / sampleStep);
    const selected = new Uint8Array(gridWidth * gridHeight);

    for (let gridY = 0; gridY < gridHeight; gridY += 1) {
        const startY = gridY * sampleStep;
        const endY = Math.min(height, startY + sampleStep);
        for (let gridX = 0; gridX < gridWidth; gridX += 1) {
            const startX = gridX * sampleStep;
            const endX = Math.min(width, startX + sampleStep);
            let painted = false;
            for (let y = startY; y < endY && !painted; y += 1) {
                for (let x = startX; x < endX; x += 1) {
                    if (pixels[(y * width + x) * 4 + 3] > 0) {
                        painted = true;
                        break;
                    }
                }
            }
            if (painted) selected[gridY * gridWidth + gridX] = 1;
        }
    }

    const components = mergeNearbyMaskComponents(readMaskComponents(selected, gridWidth, gridHeight, sampleStep, width, height), Math.max(brushSize * 1.8, Math.max(width, height) * 0.018));
    if (!components.length) return selectionCanvas;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return selectionCanvas;
    context.drawImage(selectionCanvas, 0, 0);
    context.fillStyle = "#000";
    context.strokeStyle = "#000";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = Math.max(brushSize * 1.15, Math.max(width, height) * 0.012);

    for (const component of components) {
        const hull = convexHull(component);
        if (!hull.length) continue;
        context.beginPath();
        context.moveTo(hull[0].x, hull[0].y);
        for (const point of hull.slice(1)) context.lineTo(point.x, point.y);
        if (hull.length >= 3) context.closePath();
        context.stroke();
        if (hull.length >= 3) context.fill();
    }

    return canvas;
}

function readMaskComponents(selected: Uint8Array, gridWidth: number, gridHeight: number, sampleStep: number, width: number, height: number) {
    const visited = new Uint8Array(selected.length);
    const components: MaskPoint[][] = [];
    const directions = [-1, 0, 1];

    for (let start = 0; start < selected.length; start += 1) {
        if (!selected[start] || visited[start]) continue;
        const queue = [start];
        const points: MaskPoint[] = [];
        visited[start] = 1;
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const index = queue[cursor];
            const gridX = index % gridWidth;
            const gridY = Math.floor(index / gridWidth);
            points.push({
                x: Math.min(width - 1, gridX * sampleStep + sampleStep / 2),
                y: Math.min(height - 1, gridY * sampleStep + sampleStep / 2),
            });
            for (const offsetY of directions) {
                for (const offsetX of directions) {
                    if (offsetX === 0 && offsetY === 0) continue;
                    const nextX = gridX + offsetX;
                    const nextY = gridY + offsetY;
                    if (nextX < 0 || nextX >= gridWidth || nextY < 0 || nextY >= gridHeight) continue;
                    const next = nextY * gridWidth + nextX;
                    if (!selected[next] || visited[next]) continue;
                    visited[next] = 1;
                    queue.push(next);
                }
            }
        }
        if (points.length) components.push(points);
    }

    return components;
}

function mergeNearbyMaskComponents(components: MaskPoint[][], distance: number) {
    const remaining = [...components];
    const merged: MaskPoint[][] = [];

    while (remaining.length) {
        const current = remaining.shift() || [];
        let didMerge = true;
        while (didMerge) {
            didMerge = false;
            const currentBox = maskPointBounds(current);
            for (let index = remaining.length - 1; index >= 0; index -= 1) {
                if (!boundsAreNear(currentBox, maskPointBounds(remaining[index]), distance)) continue;
                current.push(...remaining[index]);
                remaining.splice(index, 1);
                didMerge = true;
            }
        }
        merged.push(current);
    }

    return merged;
}

function maskPointBounds(points: MaskPoint[]) {
    return points.reduce(
        (bounds, point) => ({
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y),
        }),
        { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
    );
}

function boundsAreNear(a: ReturnType<typeof maskPointBounds>, b: ReturnType<typeof maskPointBounds>, distance: number) {
    const gapX = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
    const gapY = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
    return gapX <= distance && gapY <= distance;
}

function convexHull(points: MaskPoint[]) {
    if (points.length <= 2) return points;
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (origin: MaskPoint, a: MaskPoint, b: MaskPoint) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
    const lower: MaskPoint[] = [];
    for (const point of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
        lower.push(point);
    }
    const upper: MaskPoint[] = [];
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
        const point = sorted[index];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
        upper.push(point);
    }
    lower.pop();
    upper.pop();
    return [...lower, ...upper];
}
