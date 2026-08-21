"use client";

import { useEffect, useState } from "react";
import { App, Button, Input, Tag } from "antd";
import { Copy, Download, Edit3, Play, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { requestGeneration } from "@/services/api/image";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { CanvasNodeType } from "@/app/(user)/canvas/types";

type WorkflowVariable = { id: string; key: string; label: string; defaultValue: string };
type CreativeWorkflow = {
    id: string;
    name: string;
    description: string;
    category: string;
    promptTemplate: string;
    variables: WorkflowVariable[];
    updatedAt: number;
};
type WorkflowResult = { id: string; prompt: string; dataUrl: string; createdAt: number };

const STORAGE_KEY = "infinite-canvas:creative-workflows:test-v1";
const RESULT_KEY = "infinite-canvas:creative-workflow-results:test-v1";

const STARTERS: CreativeWorkflow[] = [
    {
        id: "starter-product",
        name: "商品电商主视觉",
        description: "把产品、场景和卖点组合成一张可直接投放的主视觉。",
        category: "电商",
        promptTemplate: "一张高端电商主视觉，产品：{{product}}，场景：{{scene}}，核心卖点：{{sellingPoint}}。真实摄影质感，清晰的产品细节，留出标题安全区，不要文字水印。",
        variables: [
            { id: "product", key: "product", label: "产品", defaultValue: "一款极简白色智能音箱" },
            { id: "scene", key: "scene", label: "场景", defaultValue: "晨光充足的现代客厅" },
            { id: "sellingPoint", key: "sellingPoint", label: "卖点", defaultValue: "小巧、低噪、沉浸式音质" },
        ],
        updatedAt: Date.now(),
    },
    {
        id: "starter-storyboard",
        name: "短视频分镜关键帧",
        description: "根据人物、动作和镜头要求生成一张分镜关键帧。",
        category: "视频",
        promptTemplate: "电影感短视频分镜关键帧，人物：{{character}}，动作：{{action}}，镜头：{{camera}}，光线：{{lighting}}。构图清楚，主体完整，保持人物和服装一致。",
        variables: [
            { id: "character", key: "character", label: "人物", defaultValue: "年轻女摄影师" },
            { id: "action", key: "action", label: "动作", defaultValue: "推门走进雨后的街道" },
            { id: "camera", key: "camera", label: "镜头", defaultValue: "35mm 中景，轻微低机位" },
            { id: "lighting", key: "lighting", label: "光线", defaultValue: "蓝调时刻，霓虹反射" },
        ],
        updatedAt: Date.now(),
    },
];

export function CreativeWorkflowWorkspace() {
    const { message } = App.useApp();
    const router = useRouter();
    const importProject = useCanvasStore((state) => state.importProject);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [workflows, setWorkflows] = useState<CreativeWorkflow[]>(STARTERS);
    const [selectedId, setSelectedId] = useState(STARTERS[0].id);
    const [draft, setDraft] = useState<CreativeWorkflow>(STARTERS[0]);
    const [results, setResults] = useState<WorkflowResult[]>([]);
    const [running, setRunning] = useState(false);
    useEffect(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            if (Array.isArray(stored) && stored.length) {
                setWorkflows(stored);
                setSelectedId(stored[0].id);
                setDraft(stored[0]);
            }
            const storedResults = JSON.parse(localStorage.getItem(RESULT_KEY) || "[]");
            if (Array.isArray(storedResults)) setResults(storedResults);
        } catch {
            // 本地测试数据损坏时回到内置模板。
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
    }, [workflows]);

    useEffect(() => {
        localStorage.setItem(RESULT_KEY, JSON.stringify(results.slice(0, 24)));
    }, [results]);

    const selectWorkflow = (workflow: CreativeWorkflow) => {
        setSelectedId(workflow.id);
        setDraft(workflow);
    };

    const saveDraft = () => {
        const next = { ...draft, name: draft.name.trim() || "未命名工作流", updatedAt: Date.now() };
        setWorkflows((items) => items.some((item) => item.id === next.id) ? items.map((item) => item.id === next.id ? next : item) : [next, ...items]);
        setDraft(next);
        setSelectedId(next.id);
        message.success("工作流已保存");
    };

    const createWorkflow = () => {
        const next: CreativeWorkflow = {
            id: `workflow-${Date.now()}`,
            name: "新建创作工作流",
            description: "可复用的图片创作流程",
            category: "未分类",
            promptTemplate: "请生成一张关于 {{subject}} 的图片，风格：{{style}}。",
            variables: [
                { id: "subject", key: "subject", label: "主题", defaultValue: "一个有故事感的场景" },
                { id: "style", key: "style", label: "风格", defaultValue: "电影感、自然光" },
            ],
            updatedAt: Date.now(),
        };
        setWorkflows((items) => [next, ...items]);
        setSelectedId(next.id);
        setDraft(next);
    };

    const duplicateWorkflow = () => {
        const next = { ...draft, id: `workflow-${Date.now()}`, name: `${draft.name} 副本`, updatedAt: Date.now() };
        setWorkflows((items) => [next, ...items]);
        setSelectedId(next.id);
        setDraft(next);
    };

    const deleteWorkflow = () => {
        if (workflows.length <= 1) return message.warning("至少保留一个工作流");
        const next = workflows.filter((item) => item.id !== draft.id);
        setWorkflows(next);
        selectWorkflow(next[0]);
    };

    const runWorkflow = async () => {
        if (!isAiConfigReady(effectiveConfig, effectiveConfig.imageModel || effectiveConfig.model)) {
            openConfigDialog(true);
            return;
        }
        const values = Object.fromEntries(draft.variables.map((item) => [item.key, item.defaultValue]));
        const prompt = draft.promptTemplate.replace(/{{\s*([\w-]+)\s*}}/g, (_, key: string) => values[key] || "");
        setRunning(true);
        try {
            const config = { ...effectiveConfig, model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" };
            const generated = await requestGeneration(config, prompt);
            const next = generated.map((item) => ({ id: item.id, prompt, dataUrl: item.dataUrl, createdAt: Date.now() }));
            setResults((items) => [...next, ...items].slice(0, 24));
            message.success("工作流生成完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "工作流生成失败");
        } finally {
            setRunning(false);
        }
    };

    const updateVariable = (id: string, patch: Partial<WorkflowVariable>) => setDraft((current) => ({ ...current, variables: current.variables.map((item) => item.id === id ? { ...item, ...patch } : item) }));

    const sendToCanvas = (result: WorkflowResult) => {
        const projectId = importProject({
            title: `${draft.name} 结果`,
            nodes: [{
                id: `workflow-image-${result.id}`,
                type: CanvasNodeType.Image,
                title: draft.name,
                position: { x: 120, y: 120 },
                width: 420,
                height: 420,
                metadata: { content: result.dataUrl, prompt: result.prompt, status: "success" },
            }],
            connections: [],
        });
        router.push(`/canvas/${projectId}`);
    };

    return (
        <div className="h-full overflow-auto bg-stone-950 px-6 py-6 text-stone-100">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-xl font-semibold"><Sparkles className="size-5 text-cyan-300" />创作工作流</div>
                        <p className="mt-1 text-sm text-stone-400">把提示词、变量和生成配置保存成可重复运行的流程。</p>
                    </div>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={createWorkflow}>新建工作流</Button>
                </div>

                <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
                    <div className="space-y-2">
                        {workflows.map((workflow) => (
                            <button key={workflow.id} type="button" onClick={() => selectWorkflow(workflow)} className={`w-full rounded-2xl border p-4 text-left transition ${workflow.id === selectedId ? "border-cyan-400/70 bg-cyan-400/10" : "border-stone-800 bg-stone-900 hover:border-stone-700"}`}>
                                <div className="flex items-center justify-between gap-2"><span className="font-medium">{workflow.name}</span><Tag>{workflow.category}</Tag></div>
                                <div className="mt-2 line-clamp-2 text-xs text-stone-400">{workflow.description}</div>
                                <div className="mt-3 text-[11px] text-stone-500">{workflow.variables.length} 个变量</div>
                            </button>
                        ))}
                    </div>

                    <div className="rounded-2xl border border-stone-800 bg-stone-900 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2"><Edit3 className="size-4 text-cyan-300" /><Input value={draft.name} onChange={(event) => setDraft((item) => ({ ...item, name: event.target.value }))} className="min-w-[220px]" /></div>
                            <div className="flex gap-2"><Button icon={<Copy className="size-4" />} onClick={duplicateWorkflow}>复制</Button><Button danger icon={<Trash2 className="size-4" />} onClick={deleteWorkflow}>删除</Button><Button onClick={saveDraft}>保存</Button><Button type="primary" loading={running} icon={<Play className="size-4" />} onClick={runWorkflow}>运行</Button></div>
                        </div>
                        <Input.TextArea className="mt-4" rows={2} value={draft.description} onChange={(event) => setDraft((item) => ({ ...item, description: event.target.value }))} placeholder="工作流说明" />
                        <div className="mt-4"><div className="mb-2 text-sm font-medium">提示词模板</div><Input.TextArea rows={6} value={draft.promptTemplate} onChange={(event) => setDraft((item) => ({ ...item, promptTemplate: event.target.value }))} placeholder="使用 {{变量名}} 插入变量" /></div>
                        <div className="mt-5"><div className="mb-2 text-sm font-medium">变量</div><div className="grid gap-3 md:grid-cols-2">{draft.variables.map((variable) => <div key={variable.id} className="rounded-xl border border-stone-800 p-3"><Input addonBefore={variable.label} value={variable.defaultValue} onChange={(event) => updateVariable(variable.id, { defaultValue: event.target.value })} /><div className="mt-2 text-xs text-stone-500">{`{{${variable.key}}}`}</div></div>)}</div></div>
                    </div>
                </div>

                <div className="mt-6"><div className="mb-3 flex items-center justify-between"><div className="font-medium">运行结果</div><span className="text-xs text-stone-500">{results.length} 条</span></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{results.map((result) => <div key={result.id} className="overflow-hidden rounded-2xl border border-stone-800 bg-stone-900"><img src={result.dataUrl} alt={result.prompt} className="aspect-square w-full object-cover" /><div className="p-3"><div className="line-clamp-2 text-xs text-stone-400">{result.prompt}</div><div className="mt-2 flex items-center gap-3"><a className="inline-flex items-center gap-1 text-xs text-cyan-300" href={result.dataUrl} download={`workflow-${result.id}.png`}><Download className="size-3.5" />下载</a><button type="button" className="inline-flex items-center gap-1 text-xs text-violet-300" onClick={() => sendToCanvas(result)}><Send className="size-3.5" />发送到画布</button></div></div></div>)}</div></div>
            </div>
        </div>
    );
}
