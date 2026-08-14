"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Table, Tag } from "antd";
import { Copy, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { createInvitation, fetchInvites, revokeInvitation } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import type { InviteSummary } from "@/lib/auth/types";

const statusLabels: Record<InviteSummary["status"], string> = {
    active: "可使用",
    used: "已用完",
    expired: "已过期",
    revoked: "已撤销",
};

const statusColors: Record<InviteSummary["status"], string> = {
    active: "green",
    used: "default",
    expired: "orange",
    revoked: "red",
};

export default function InvitationManagementPage() {
    const { message, modal } = App.useApp();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const [invites, setInvites] = useState<InviteSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [label, setLabel] = useState("");
    const [maxUses, setMaxUses] = useState(1);
    const [expiresInDays, setExpiresInDays] = useState(7);
    const [createdCode, setCreatedCode] = useState("");

    const loadInvites = useCallback(async () => {
        setLoading(true);
        try {
            const result = await fetchInvites();
            setInvites(result.invites);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取邀请码失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        if (!user) return;
        if (user.role !== "root" || user.username.trim().toLowerCase() !== "root") {
            router.replace("/");
            return;
        }
        void loadInvites();
    }, [loadInvites, router, user]);

    const create = async () => {
        setCreating(true);
        try {
            const result = await createInvitation({ label, maxUses, expiresInDays });
            setCreatedCode(result.code);
            setLabel("");
            setMaxUses(1);
            setExpiresInDays(7);
            await loadInvites();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建邀请码失败");
        } finally {
            setCreating(false);
        }
    };

    const revoke = (invite: InviteSummary) => {
        modal.confirm({
            title: "撤销邀请码？",
            content: "撤销后，该邀请码无法继续注册，不能恢复。",
            okText: "撤销",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await revokeInvitation(invite.id);
                message.success("邀请码已撤销");
                await loadInvites();
            },
        });
    };

    if (!user || user.role !== "root" || user.username.trim().toLowerCase() !== "root") return null;

    return (
        <main className="h-full overflow-y-auto bg-background px-5 py-8 sm:px-8">
            <div className="mx-auto max-w-5xl">
                <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-stone-500 dark:text-stone-400">
                            <ShieldCheck className="size-4" />
                            <span className="text-sm">Root 管理</span>
                        </div>
                        <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-100">邀请码管理</h1>
                        <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">所有新账号必须使用 root 创建的邀请码开通。邀请码原文只在创建后显示一次。</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void loadInvites()} loading={loading}>
                        刷新
                    </Button>
                </div>

                <section className="grid gap-4 border-y border-stone-200 py-6 dark:border-stone-800 md:grid-cols-[1fr_120px_140px_auto] md:items-end">
                    <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                        备注
                        <Input className="mt-2" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：张三 / 测试团队" maxLength={80} />
                    </label>
                    <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                        可使用次数
                        <InputNumber className="mt-2 !w-full" min={1} max={100} value={maxUses} onChange={(value) => setMaxUses(Number(value || 1))} />
                    </label>
                    <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                        有效天数
                        <InputNumber className="mt-2 !w-full" min={1} max={90} value={expiresInDays} onChange={(value) => setExpiresInDays(Number(value || 7))} />
                    </label>
                    <Button type="primary" icon={<KeyRound className="size-4" />} onClick={() => void create()} loading={creating}>
                        生成邀请码
                    </Button>
                </section>

                <section className="mt-6">
                    <Table<InviteSummary>
                        rowKey="id"
                        loading={loading}
                        pagination={{ pageSize: 10, hideOnSinglePage: true }}
                        scroll={{ x: 700 }}
                        dataSource={invites}
                        columns={[
                            { title: "备注", dataIndex: "label", key: "label", render: (value: string) => value || "未命名邀请码" },
                            { title: "状态", dataIndex: "status", key: "status", render: (status: InviteSummary["status"]) => <Tag color={statusColors[status]}>{statusLabels[status]}</Tag> },
                            { title: "使用情况", key: "uses", render: (_, invite) => `${invite.usedCount} / ${invite.maxUses}` },
                            { title: "过期时间", dataIndex: "expiresAt", key: "expiresAt", render: (value: string | null) => (value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "长期有效") },
                            {
                                title: "操作",
                                key: "actions",
                                render: (_, invite) =>
                                    invite.status === "active" ? (
                                        <Button type="text" danger icon={<Trash2 className="size-4" />} onClick={() => revoke(invite)}>
                                            撤销
                                        </Button>
                                    ) : null,
                            },
                        ]}
                    />
                </section>
            </div>

            <Modal
                open={Boolean(createdCode)}
                title="邀请码已生成"
                footer={
                    <Button type="primary" onClick={() => setCreatedCode("")}>
                        我已保存
                    </Button>
                }
                onCancel={() => setCreatedCode("")}
            >
                <p className="mb-4 text-sm leading-6 text-stone-500">请立即安全地发送给受邀用户。关闭后系统不会再次显示原始邀请码。</p>
                <div className="flex items-center gap-2 border border-stone-200 bg-stone-50 p-3 font-mono text-base font-semibold tracking-[0.08em] text-stone-950 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
                    <span className="min-w-0 flex-1 break-all">{createdCode}</span>
                    <Button
                        type="text"
                        icon={<Copy className="size-4" />}
                        aria-label="复制邀请码"
                        onClick={() => {
                            void navigator.clipboard.writeText(createdCode).then(() => message.success("邀请码已复制"));
                        }}
                    />
                </div>
            </Modal>
        </main>
    );
}
