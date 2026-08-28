"use client";

import { type ReactNode } from "react";
import { Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import {
    boolConfig,
    isSeedanceFastModel,
    isSeedanceFixed720pModel,
    isSeedanceVideoConfig,
    normalizeSeedanceDuration,
    normalizeSeedanceRatio,
    normalizeSeedanceResolution,
    seedanceDurationOptionsForModel,
    seedancePixelLabel,
    seedanceRatioOptions,
    seedanceRatioOptionsForModel,
    seedanceResolutionOptionsForModel,
    seedanceSupportsGeneratedAudio,
} from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { normalizeVideoProductScaleMode, videoProductScaleOptions } from "@/lib/video-product-scale";
import { fixedVideoDurationOptions, fixedVideoResolution, isGoogleVideoModel, normalizeModelVideoSeconds } from "@/lib/video-model-settings";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { isTokaxisMiniMaxH3VideoModel } from "@/lib/minimax-h3-video";
import { FACEBOOK_MEDIA_PRESETS, facebookMediaPreset, facebookMediaTargetSize, facebookVideoSourceSize } from "@/lib/facebook-media";

const baseResolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];
export const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    ...FACEBOOK_MEDIA_PRESETS.map((preset) => ({ value: preset.id, label: preset.id, width: preset.width, height: preset.height })),
    { value: "auto", label: "auto", width: 0, height: 0 },
];

const defaultSecondOptions = [6, 10, 12, 16, 20];

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoProductScaleMode" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    const model = modelOptionName(config.videoModel || config.model);
    const googleVideo = isGoogleVideoModel(model);
    const miniMaxH3 = isTokaxisMiniMaxH3VideoModel(model);
    const fixedSecondOptions = fixedVideoDurationOptions(model);
    const secondOptions = fixedSecondOptions || (miniMaxH3 ? [5, 10, 15] : defaultSecondOptions);
    const seconds = normalizeModelVideoSeconds(config.videoSeconds || "6", model);
    const selectedFacebookPreset = facebookMediaPreset(config.size);
    const size = selectedFacebookPreset?.id || (googleVideo && ["", "auto", "1:1"].includes(config.size) ? (model.toLowerCase().includes("portrait") ? "720x1280" : "1280x720") : normalizeVideoSizeValue(config.size));
    const dimensions = readSizeDimensions(size);
    const availableSizeOptions = googleVideo || miniMaxH3 ? sizeOptions.filter((item) => item.value === "1280x720" || item.value === "720x1280" || facebookMediaPreset(item.value)) : sizeOptions;
    const fixedResolution = fixedVideoResolution(model, seconds);
    const resolutionOptions = fixedResolution ? [{ value: fixedResolution, label: `${fixedResolution}p` }] : baseResolutionOptions;
    const resolution = normalizeVideoResolutionValue(config.vquality, model, seconds);
    const productScaleMode = normalizeVideoProductScaleMode(config.videoProductScaleMode);
    const durationGridClass = googleVideo ? (secondOptions.length > 1 ? "grid-cols-2" : "grid-cols-1") : secondOptions.length === 4 ? "grid-cols-4" : "grid-cols-3";
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className={`grid gap-2.5 ${fixedResolution ? "grid-cols-1" : "grid-cols-3"}`}>
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        {fixedResolution ? null : <ResolutionInput value={resolution} theme={theme} onChange={(value) => onConfigChange("vquality", value)} />}
                    </div>
                </SettingGroup>
                <SettingGroup title="尺寸" color={theme.node.muted}>
                    {googleVideo || miniMaxH3 ? null : (
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                            <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                            <span className="text-lg opacity-45">↔</span>
                            <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                        </div>
                    )}
                    <div className="grid grid-cols-3 gap-2.5">
                        {availableSizeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                                {item.value === "auto" ? null : <span className="text-[11px] leading-none opacity-55">{facebookMediaTargetSize(item.value)}</span>}
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="产品尺寸" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {videoProductScaleOptions.map((item) => (
                            <OptionPill key={item.value} selected={productScaleMode === item.value} theme={theme} onClick={() => onConfigChange("videoProductScaleMode", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <div className={`grid gap-2.5 ${durationGridClass}`}>
                        {secondOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {googleVideo ? googleVideoDurationOptionLabel(value, model) : `${value}s`}
                            </OptionPill>
                        ))}
                        {fixedSecondOptions ? null : <NumberInput value={seconds} min={miniMaxH3 ? 5 : 1} max={miniMaxH3 ? 15 : 20} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const model = modelOptionName(config.videoModel || config.model);
    const resolution = normalizeSeedanceResolution(config.vquality, model);
    const ratio = facebookMediaPreset(config.size)?.id || normalizeSeedanceRatio(config.size, model);
    const duration = normalizeSeedanceDuration(config.videoSeconds, model);
    const durationOptions = seedanceDurationOptionsForModel(model);
    const resolutionOptions = seedanceResolutionOptionsForModel(model);
    const ratioOptions = [...seedanceRatioOptionsForModel(model), ...FACEBOOK_MEDIA_PRESETS.map((preset) => ({ value: preset.id, label: preset.id }))];
    const supportsGeneratedAudio = seedanceSupportsGeneratedAudio(model);
    const generateAudio = supportsGeneratedAudio && boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                    {isSeedanceFixed720pModel(model) ? <div className="text-[11px] leading-4 opacity-55">该型号固定输出 720p。</div> : isSeedanceFastModel(model) ? <div className="text-[11px] leading-4 opacity-55">Fast 型号最高支持 720p。</div> : null}
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {ratioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">{facebookMediaPreset(item.value) ? facebookMediaTargetSize(item.value) : item.value === "adaptive" ? "adaptive" : seedancePixelLabel(resolution, item.value, model)}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <div className={`grid gap-2.5 ${durationOptions.length === 3 ? "grid-cols-3" : "grid-cols-4"}`}>
                        {durationOptions.map((value) => (
                            <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                    </div>
                    {isSeedanceFixed720pModel(model) ? <div className="text-[11px] leading-4 opacity-55">该路由仅支持 5、10 或 15 秒。</div> : <NumberInput value={String(duration)} min={5} max={15} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />}
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        {supportsGeneratedAudio ? (
                            <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        ) : (
                            <div className="px-1 py-0.5 text-xs leading-5 opacity-60">该型号不支持生成声音，将输出无声视频。</div>
                        )}
                        <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string, model = "", duration?: string | number) {
    return `${normalizeVideoResolutionValue(value, model, duration)}p`;
}

export function videoSizeLabel(value: string) {
    const preset = facebookMediaPreset(value);
    if (preset) return preset.id;
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    if (ratio === value) return seedanceRatioOptions.find((item) => item.value === ratio)?.label || ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string, model = "") {
    return `${normalizeModelVideoSeconds(value || "6", model)}s`;
}

function googleVideoDurationOptionLabel(value: number, model: string) {
    const resolution = fixedVideoResolution(model, value);
    return resolution ? `${value}s · ${resolution}p` : `${value}s`;
}

export function normalizeVideoSizeValue(value: string) {
    value = facebookVideoSourceSize(value);
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string, model = "", duration?: string | number) {
    const fixedResolution = fixedVideoResolution(model, duration);
    if (fixedResolution) return fixedResolution;
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    const resolution = value.replace(/p$/i, "") || "720";
    return resolution;
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
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
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <input
            type="number"
            min={min}
            max={max}
            className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
        />
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    const preset = facebookMediaPreset(ratio);
    if (preset) return { width: preset.width, height: preset.height };
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const preset = facebookMediaPreset(size);
    if (preset) return { width: preset.width, height: preset.height };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}
