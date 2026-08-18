"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Switch, Table, Tag } from "antd";
import { BadgeDollarSign, Pencil, Plus, RefreshCw, Users } from "lucide-react";
import { useRouter } from "next/navigation";

import type { BillingPriceRule, BillingProfile } from "@/lib/auth/types";
import { createBillingProfile, fetchBillingProfiles, updateBillingProfile } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

type Draft = { id?: string; name: string; rules: BillingPriceRule[]; active: boolean };
const unitLabels = { request: "次", image: "张", second: "秒" } as const;

export default function DistributorBillingPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const [profiles, setProfiles] = useState<BillingProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const canOpen = user?.role === "root" || user?.role === "admin";

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await fetchBillingProfiles();
            setProfiles(result.profiles);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取计费方案失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        if (!isReady) return;
        if (!canOpen) return router.replace("/");
        void load();
    }, [canOpen, isReady, load, router]);

    const totals = useMemo(() => ({ users: profiles.reduce((sum, profile) => sum + profile.invitedUsers, 0), earned: profiles.reduce((sum, profile) => sum + profile.earnedCredits, 0) }), [profiles]);

    const openNew = async () => {
        const result = await fetchBillingProfiles();
        const rules = Object.entries(result.basePrices).map(([model, rule]) => ({ model, baseCredits: rule.credits, creditsPerUnit: rule.credits, unit: rule.unit }));
        setDraft({ name: "默认分销价", rules, active: true });
    };

    const save = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const input = { name: draft.name, active: draft.active, rules: draft.rules.map((rule) => ({ model: rule.model, creditsPerUnit: rule.creditsPerUnit })) };
            if (draft.id) await updateBillingProfile(draft.id, input);
            else await createBillingProfile(input);
            message.success(draft.id ? "计费方案已更新" : "计费方案已创建");
            setDraft(null);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    if (!isReady || !canOpen) return null;
    return (
        <main className="h-full overflow-y-auto bg-background px-4 py-7 sm:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-sm text-stone-500">
                            <BadgeDollarSign className="size-4" />
                            分销计费
                        </div>
                        <h1 className="mt-2 text-2xl font-semibold">分销中心</h1>
                        <p className="mt-2 text-sm text-stone-500">{user.role === "root" ? "查看各分销管理员的售价、客户和溢价收益。" : "平台成本不变，你可自定义售价；生成成功后，差价自动返回你的积分账户。"}</p>
                    </div>
                    <div className="flex gap-2">
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                            刷新
                        </Button>
                        {user.role === "admin" ? (
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => void openNew()}>
                                新建计费方案
                            </Button>
                        ) : null}
                    </div>
                </div>

                <section className="mb-6 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-stone-200 p-5 dark:border-stone-800">
                        <div className="text-xs text-stone-500">计费方案</div>
                        <div className="mt-2 text-2xl font-semibold">{profiles.length}</div>
                    </div>
                    <div className="rounded-2xl border border-stone-200 p-5 dark:border-stone-800">
                        <div className="text-xs text-stone-500">邀请客户</div>
                        <div className="mt-2 flex items-center gap-2 text-2xl font-semibold">
                            <Users className="size-5" />
                            {totals.users}
                        </div>
                    </div>
                    <div className="rounded-2xl border border-stone-200 p-5 dark:border-stone-800">
                        <div className="text-xs text-stone-500">已入账溢价</div>
                        <div className="mt-2 text-2xl font-semibold text-emerald-600">+{totals.earned} 积分</div>
                    </div>
                </section>

                <Table<BillingProfile>
                    rowKey="id"
                    loading={loading}
                    dataSource={profiles}
                    pagination={{ pageSize: 20 }}
                    scroll={{ x: 950 }}
                    columns={[
                        {
                            title: "方案",
                            dataIndex: "name",
                            width: 180,
                            render: (name, profile) => (
                                <div>
                                    <div className="font-medium">{name}</div>
                                    <div className="text-xs text-stone-500">{profile.adminUsername}</div>
                                </div>
                            ),
                        },
                        { title: "状态", dataIndex: "active", width: 90, render: (active) => <Tag color={active ? "green" : "default"}>{active ? "使用中" : "已停用"}</Tag> },
                        { title: "客户", dataIndex: "invitedUsers", width: 80 },
                        { title: "已入账溢价", dataIndex: "earnedCredits", width: 130, render: (value) => `+${value} 积分` },
                        {
                            title: "主要售价",
                            key: "prices",
                            render: (_, profile) =>
                                profile.rules.slice(0, 4).map((rule) => (
                                    <Tag key={rule.model}>
                                        {rule.model}: ¥{(rule.creditsPerUnit / 10).toFixed(2)}/{unitLabels[rule.unit]}
                                    </Tag>
                                )),
                        },
                        {
                            title: "操作",
                            width: 90,
                            fixed: "right",
                            render: (_, profile) =>
                                user.role === "admin" ? (
                                    <Button type="text" icon={<Pencil className="size-4" />} onClick={() => setDraft({ id: profile.id, name: profile.name, active: profile.active, rules: profile.rules })}>
                                        编辑
                                    </Button>
                                ) : null,
                        },
                    ]}
                />
            </div>

            <Modal open={Boolean(draft)} width={880} title={draft?.id ? "编辑计费方案" : "新建计费方案"} okText="保存" cancelText="取消" confirmLoading={saving} onOk={() => void save()} onCancel={() => setDraft(null)}>
                {draft ? (
                    <div className="pt-3">
                        <div className="mb-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                            <label className="text-sm font-medium">
                                方案名称
                                <Input className="mt-2" value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                            </label>
                            <label className="flex items-center gap-2 pb-1 text-sm">
                                <Switch checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} />
                                允许新邀请使用
                            </label>
                        </div>
                        <Table<BillingPriceRule>
                            rowKey="model"
                            size="small"
                            pagination={false}
                            scroll={{ y: 420 }}
                            dataSource={draft.rules}
                            columns={[
                                { title: "模型", dataIndex: "model", width: 250 },
                                { title: "平台成本", width: 150, render: (_, rule) => `¥${(rule.baseCredits / 10).toFixed(2)} / ${unitLabels[rule.unit]}` },
                                {
                                    title: "你的售价",
                                    width: 210,
                                    render: (_, rule, index) => (
                                        <InputNumber
                                            min={rule.baseCredits}
                                            precision={2}
                                            step={0.1}
                                            value={rule.creditsPerUnit}
                                            addonAfter={`积分/${unitLabels[rule.unit]}`}
                                            onChange={(value) => {
                                                const rules = [...draft.rules];
                                                rules[index] = { ...rule, creditsPerUnit: Number(value ?? rule.baseCredits) };
                                                setDraft({ ...draft, rules });
                                            }}
                                        />
                                    ),
                                },
                                { title: "每单位溢价", render: (_, rule) => <span className="text-emerald-600">+{Math.max(0, rule.creditsPerUnit - rule.baseCredits).toFixed(2)} 积分</span> },
                            ]}
                        />
                        <p className="mt-3 text-xs leading-5 text-stone-500">售价不能低于平台成本。客户生成成功后才结算溢价；失败退回客户全额积分，不产生分销收益。</p>
                    </div>
                ) : null}
            </Modal>
        </main>
    );
}
