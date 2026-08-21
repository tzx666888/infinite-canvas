"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Select, Switch, Table, Tag } from "antd";
import { BadgeDollarSign, Copy, Link2, Pencil, Plus, RefreshCw, Users } from "lucide-react";
import { useRouter } from "next/navigation";

import type { BillingPriceRule, BillingProfile } from "@/lib/auth/types";
import { createBillingProfile, createInvitation, fetchBillingProfiles, updateBillingProfile } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

type Draft = { id?: string; name: string; rules: BillingPriceRule[]; active: boolean };
type InviteDraft = { label: string; maxUses: number; expiresInDays: number; billingProfileId?: string };
const unitLabels = { request: "次", image: "张", second: "秒" } as const;
const distributorWholesaleMultiplier = 0.7;

export default function DistributorBillingPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const [profiles, setProfiles] = useState<BillingProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [inviteDraft, setInviteDraft] = useState<InviteDraft | null>(null);
    const [createdInviteLink, setCreatedInviteLink] = useState("");
    const [inviting, setInviting] = useState(false);
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
        const rules = Object.entries(result.basePrices).map(([model, rule]) => {
            const baseCredits = Number((rule.credits * distributorWholesaleMultiplier).toFixed(6));
            return { model, baseCredits, creditsPerUnit: baseCredits, unit: rule.unit };
        });
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

    const createInviteLink = async () => {
        if (!inviteDraft) return;
        setInviting(true);
        try {
            const result = await createInvitation(inviteDraft);
            const link = `${window.location.origin}/login?mode=register&invite=${encodeURIComponent(result.code)}`;
            setCreatedInviteLink(link);
            setInviteDraft(null);
            message.success("邀请链接已生成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建邀请链接失败");
        } finally {
            setInviting(false);
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
                        <p className="mt-2 text-sm text-stone-500">
                            {user.role === "root" ? "查看各分销管理员的售价、客户和溢价收益。分销批发底价按平台原价 7 折计算。" : "分销批发底价按平台原价 7 折计算，你可自定义客户售价；生成成功后，售价与批发底价的差额自动返回你的积分账户。"}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                            刷新
                        </Button>
                        {user.role === "admin" ? (
                            <>
                                <Button icon={<Link2 className="size-4" />} onClick={() => setInviteDraft({ label: "", maxUses: 1, expiresInDays: 7, billingProfileId: profiles.find((profile) => profile.active)?.id })}>
                                    创建邀请链接
                                </Button>
                                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => void openNew()}>
                                    新建计费方案
                                </Button>
                            </>
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
                                { title: "分销批发底价", width: 150, render: (_, rule) => `¥${(rule.baseCredits / 10).toFixed(2)} / ${unitLabels[rule.unit]}` },
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
                        <p className="mt-3 text-xs leading-5 text-stone-500">分销售价不能低于平台原价的 7 折批发底价。客户生成成功后才结算溢价；失败退回客户全额积分，不产生分销收益。</p>
                    </div>
                ) : null}
            </Modal>

            <Modal open={Boolean(inviteDraft)} title="创建邀请链接" okText="生成链接" cancelText="取消" confirmLoading={inviting} onOk={() => void createInviteLink()} onCancel={() => setInviteDraft(null)}>
                {inviteDraft ? (
                    <div className="space-y-4 pt-3">
                        <label className="block text-sm font-medium">
                            邀请备注
                            <Input className="mt-2" value={inviteDraft.label} maxLength={80} placeholder="例如：客户 A / 代理团队" onChange={(event) => setInviteDraft({ ...inviteDraft, label: event.target.value })} />
                        </label>
                        <label className="block text-sm font-medium">
                            计费方案
                            <Select
                                className="mt-2 w-full"
                                value={inviteDraft.billingProfileId}
                                options={profiles.filter((profile) => profile.active).map((profile) => ({ value: profile.id, label: profile.name }))}
                                onChange={(billingProfileId) => setInviteDraft({ ...inviteDraft, billingProfileId })}
                            />
                        </label>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <label className="block text-sm font-medium">
                                可用次数
                                <InputNumber className="mt-2 !w-full" min={1} max={100} value={inviteDraft.maxUses} onChange={(value) => setInviteDraft({ ...inviteDraft, maxUses: Number(value || 1) })} />
                            </label>
                            <label className="block text-sm font-medium">
                                有效天数
                                <InputNumber className="mt-2 !w-full" min={1} max={90} value={inviteDraft.expiresInDays} onChange={(value) => setInviteDraft({ ...inviteDraft, expiresInDays: Number(value || 7) })} />
                            </label>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal
                open={Boolean(createdInviteLink)}
                title="邀请链接已生成"
                footer={
                    <Button type="primary" onClick={() => setCreatedInviteLink("")}>
                        完成
                    </Button>
                }
                onCancel={() => setCreatedInviteLink("")}
            >
                <p className="mb-3 text-sm leading-6 text-stone-500">把这个链接发给客户，打开后会自动进入邀请码注册并绑定当前计费方案。</p>
                <div className="flex items-start gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-700 dark:bg-stone-900">
                    <span className="min-w-0 flex-1 break-all">{createdInviteLink}</span>
                    <Button type="text" icon={<Copy className="size-4" />} aria-label="复制邀请链接" onClick={() => void navigator.clipboard.writeText(createdInviteLink).then(() => message.success("邀请链接已复制"))} />
                </div>
            </Modal>
        </main>
    );
}
