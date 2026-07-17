"use client";

import { type ReactNode, useState } from "react";
import { ConfigProvider, Switch } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { isTokaxisGoogleImageModel, TOKAXIS_GOOGLE_NATIVE_SIZES, tokaxisGoogleImageSizeFromModel, tokaxisGoogleModelForSize, type TokaxisGoogleImageSize } from "@/lib/tokaxis-google-image";
import type { AiConfig } from "@/stores/use-config-store";

const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];
const resolutionOptions = [
    { value: "1k", label: "1K" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
] as const;
type Resolution = (typeof resolutionOptions)[number]["value"];
type NativeSizes = Record<Resolution, string>;
type AspectOption = { value: string; label: string; size?: string; width: number; height: number; icon: string; nativeOnly?: boolean; nativeSizes?: NativeSizes };
const DIMENSION_STEP = 16;
const MAX_IMAGE_EDGE = 3840;
const MAX_IMAGE_PIXELS = MAX_IMAGE_EDGE * MAX_IMAGE_EDGE;

const aspectOptions: AspectOption[] = [
    nativeAspect("1:1", "square"),
    nativeAspect("1:4", "portrait", true),
    nativeAspect("1:8", "portrait", true),
    nativeAspect("2:3", "portrait"),
    nativeAspect("3:2", "landscape"),
    nativeAspect("3:4", "portrait"),
    nativeAspect("4:1", "landscape", true),
    nativeAspect("4:3", "landscape"),
    nativeAspect("4:5", "portrait", true),
    nativeAspect("5:4", "landscape", true),
    nativeAspect("8:1", "landscape", true),
    nativeAspect("9:16", "portrait"),
    nativeAspect("16:9", "landscape"),
    nativeAspect("21:9", "landscape", true),
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "imageModel", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const activeModel = config.imageModel || config.model;
    const usesNativeGoogleSizes = isTokaxisGoogleImageModel(activeModel);
    const availableAspectOptions = aspectOptions.filter((item) => !item.nativeOnly || usesNativeGoogleSizes);
    const resolution = googleResolution(activeModel) || readResolution(activeSize);
    const selectedAspect = findSelectedAspect(activeSize);
    const displayedSize = usesNativeGoogleSizes && selectedAspect ? sizeForAspect(selectedAspect, resolution, true) : activeSize;
    const dimensions = readSizeDimensions(displayedSize, selectedAspect || aspectOptions[0]);
    const syncGoogleModel = (nextResolution: Resolution) => {
        if (!usesNativeGoogleSizes) return;
        const nextModel = tokaxisGoogleModelForSize(activeModel, nextResolution.toUpperCase() as TokaxisGoogleImageSize);
        if (nextModel !== activeModel) onConfigChange("imageModel", nextModel);
    };
    const selectAspect = (value: string) => {
        const option = availableAspectOptions.find((item) => item.value === value);
        onConfigChange("size", option ? sizeForAspect(option, resolution, usesNativeGoogleSizes) : "auto");
    };
    const selectResolution = (value: Resolution) => {
        if (activeSize === "auto") return;
        onConfigChange("size", selectedAspect ? sizeForAspect(selectedAspect, value, usesNativeGoogleSizes) : resizeDimensionsForResolution(dimensions.width, dimensions.height, value));
        syncGoogleModel(value);
    };
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        const nextSize = `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`;
        onConfigChange("size", nextSize);
        if (usesNativeGoogleSizes) syncGoogleModel(readResolution(nextSize));
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>质量</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {qualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>分辨率</SettingTitle>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value && activeSize !== "auto"} theme={theme} onClick={() => selectResolution(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <SettingTitle color={theme.node.muted}>尺寸</SettingTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                16倍数对齐
                            </span>
                            <span title="输入完成后自动向上补成 16 的倍数" onMouseDown={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {availableAspectOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedAspect?.value === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {Array.from({ length: quickCount }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {value} 张
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ({ auto: "自动", high: "高", medium: "中", low: "低" } as Record<string, string>)[value] || value;
}

export function imageSizeLabel(size: string) {
    if (!size || size === "auto") return "auto";
    const aspect = findSelectedAspect(size);
    const resolution = readResolution(size);
    const resolutionLabel = resolution === "1k" ? "" : ` · ${resolution.toUpperCase()}`;
    return `${aspect?.label || size}${resolutionLabel}`;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
        width: match ? Number(match[1]) : fallback.width,
        height: match ? Number(match[2]) : fallback.height,
    };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}

function findSelectedAspect(size: string) {
    return aspectOptions.find((item) => (item.size || item.value) === size || item.value === size) || aspectOptions.find((item) => sameAspectRatio(size, item));
}

function sameAspectRatio(size: string, option: (typeof aspectOptions)[number]) {
    if (option.value === "auto") return size === "auto";
    const dimensions = readParsedDimensions(size);
    if (!dimensions) return false;
    return Math.abs(dimensions.width / dimensions.height - option.width / option.height) < 0.01;
}

function readParsedDimensions(size: string) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function readResolution(size: string): Resolution {
    for (const option of aspectOptions) {
        if (!option.nativeSizes) continue;
        const match = (Object.entries(option.nativeSizes) as Array<[Resolution, string]>).find(([, dimensions]) => dimensions === size);
        if (match) return match[0];
    }
    const dimensions = readParsedDimensions(size);
    if (!dimensions) return "1k";
    const longEdge = Math.max(dimensions.width, dimensions.height);
    const shortEdge = Math.min(dimensions.width, dimensions.height);
    if (longEdge >= MAX_IMAGE_EDGE) return "4k";
    if (shortEdge >= 1152 || longEdge >= 2048) return "2k";
    return "1k";
}

function sizeForAspect(option: AspectOption, resolution: Resolution, usesNativeGoogleSizes = false) {
    if (option.value === "auto") return "auto";
    if (usesNativeGoogleSizes && option.nativeSizes) return option.nativeSizes[resolution];
    if (resolution === "1k") return option.size || `${option.width}x${option.height}`;
    return resizeDimensionsForResolution(option.width, option.height, resolution);
}

function resizeDimensionsForResolution(width: number, height: number, resolution: Resolution) {
    if (resolution === "1k") return `${alignDimension(width, true)}x${alignDimension(height, true)}`;
    const ratio = width / Math.max(1, height);
    const landscape = width >= height;
    const targetLongEdge = resolution === "4k" ? MAX_IMAGE_EDGE : 2048;
    const rawWidth = landscape ? targetLongEdge : targetLongEdge * ratio;
    const rawHeight = landscape ? targetLongEdge / ratio : targetLongEdge;
    const pixelScale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / Math.max(1, rawWidth * rawHeight)));
    const nextWidth = alignDimensionDown(Math.max(1, Math.floor(rawWidth * pixelScale)));
    const nextHeight = alignDimensionDown(Math.max(1, Math.floor(rawHeight * pixelScale)));
    return `${nextWidth}x${nextHeight}`;
}

function nativeAspect(value: keyof typeof TOKAXIS_GOOGLE_NATIVE_SIZES, icon: string, nativeOnly = false): AspectOption {
    const sizes = TOKAXIS_GOOGLE_NATIVE_SIZES[value];
    const [width, height] = sizes["1K"].split("x").map(Number);
    return {
        value,
        label: value,
        size: sizes["1K"],
        width,
        height,
        icon,
        nativeOnly,
        nativeSizes: { "1k": sizes["1K"], "2k": sizes["2K"], "4k": sizes["4K"] },
    };
}

function googleResolution(model: string): Resolution | undefined {
    return tokaxisGoogleImageSizeFromModel(model)?.toLowerCase() as Resolution | undefined;
}

function alignDimensionDown(value: number) {
    return Math.max(DIMENSION_STEP, Math.floor(value / DIMENSION_STEP) * DIMENSION_STEP);
}
