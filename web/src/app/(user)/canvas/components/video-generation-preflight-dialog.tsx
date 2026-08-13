"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Typography } from "antd";
import { AudioLines, ImageIcon, Video } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import {
    prepareVideoGenerationPreflight,
    summarizeConnectedVideoMedia,
    type VideoGenerationPreflightReferences,
    type VideoGenerationPreflightResult,
} from "../utils/video-generation-preflight";

type VideoGenerationPreflightDialogProps = {
    open: boolean;
    config: AiConfig;
    prompt: string;
    references: VideoGenerationPreflightReferences;
    theme: CanvasTheme;
    onCancel: () => void;
    onConfirm: (result: VideoGenerationPreflightResult) => void;
    onMissingConfig?: () => void;
};

const mediaIcons = {
    images: ImageIcon,
    videos: Video,
    audios: AudioLines,
};

export function VideoGenerationPreflightDialog({ open, config, prompt, references, theme, onCancel, onConfirm, onMissingConfig }: VideoGenerationPreflightDialogProps) {
    const openedRef = useRef(false);
    const [draftPrompt, setDraftPrompt] = useState(prompt);
    const [draftConfig, setDraftConfig] = useState(config);

    useEffect(() => {
        if (open && !openedRef.current) {
            setDraftPrompt(prompt);
            setDraftConfig({ ...config });
        }
        openedRef.current = open;
    }, [config, open, prompt]);

    const result = useMemo(() => prepareVideoGenerationPreflight({ prompt: draftPrompt, config: draftConfig, references }), [draftConfig, draftPrompt, references]);
    const mediaSummary = useMemo(() => summarizeConnectedVideoMedia(references), [references]);
    const updateConfig = (key: "vquality" | "size" | "videoSeconds" | "videoProductScaleMode" | "videoGenerateAudio" | "videoWatermark", value: string) => {
        setDraftConfig((current) => ({ ...current, [key]: value }));
    };
    const updateModel = (model: string) => setDraftConfig((current) => ({ ...current, model, videoModel: model }));

    return (
        <Modal
            title="生成视频前确认"
            open={open}
            centered
            width={760}
            destroyOnHidden
            onCancel={onCancel}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto" } }}
            footer={
                <div className="flex items-center justify-between gap-3">
                    <Typography.Text type={result.errors.length ? "danger" : "success"}>{result.errors.length ? `还需补充 ${result.errors.length} 项` : "信息完整，可以生成"}</Typography.Text>
                    <div className="flex gap-2">
                        <Button onClick={onCancel}>取消</Button>
                        <Button type="primary" disabled={result.errors.length > 0} onClick={() => onConfirm(result)}>
                            确认生成
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-5" style={{ color: theme.node.text }}>
                <Typography.Paragraph type="secondary" className="!mb-0">
                    请确认提示词、模型、时长、画幅、清晰度和已连接素材。信息不完整时不会提交生成任务。
                </Typography.Paragraph>

                <section className="space-y-2.5">
                    <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                        视频提示词
                    </div>
                    <Input.TextArea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} autoSize={{ minRows: 4, maxRows: 10 }} showCount maxLength={3600} placeholder="描述画面、人物动作、产品展示、镜头和声音要求；也可以仅使用支持的参考素材生成。" />
                </section>

                <section className="space-y-2.5">
                    <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                        视频模型
                    </div>
                    <ModelPicker config={draftConfig} value={draftConfig.videoModel || draftConfig.model} onChange={updateModel} capability="video" fullWidth onMissingConfig={onMissingConfig} />
                </section>

                <section className="rounded-2xl border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    <VideoSettingsPanel config={draftConfig} onConfigChange={updateConfig} theme={theme} showTitle={false} className="w-full space-y-4" />
                </section>

                <section className="space-y-2.5">
                    <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                        已连接素材
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                        {mediaSummary.map((item) => {
                            const Icon = mediaIcons[item.kind];
                            return (
                                <div key={item.kind} className="min-w-0 rounded-xl border p-3" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        <Icon className="size-4" />
                                        <span>{item.label}</span>
                                        <span className="ml-auto text-xs" style={{ color: theme.node.muted }}>
                                            {item.count} 个
                                        </span>
                                    </div>
                                    <div className="mt-2 truncate text-xs" style={{ color: theme.node.muted }} title={item.names.join("、")}>
                                        {item.names.length ? item.names.join("、") : "未连接"}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {result.errors.length ? (
                    <Alert
                        type="error"
                        showIcon
                        message="生成条件尚未满足"
                        description={
                            <ul className="mb-0 list-disc space-y-1 pl-5">
                                {result.errors.map((error) => (
                                    <li key={error}>{error}</li>
                                ))}
                            </ul>
                        }
                    />
                ) : (
                    <Alert type="success" showIcon message="所有必填信息已完整，确认后将按以上参数生成视频。" />
                )}
            </div>
        </Modal>
    );
}

export type { VideoGenerationPreflightDialogProps };
