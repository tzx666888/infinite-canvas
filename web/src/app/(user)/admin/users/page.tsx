"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Select, Table, Tag } from "antd";
import { Ban, Coins, KeyRound, Pencil, RefreshCw, Search, ShieldCheck, UserCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";

import type { ManagedUserSummary } from "@/lib/auth/types";
import { adjustAccountCredits, fetchManagedUsers, revokeManagedUserKeys, updateManagedUser } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

type EditForm = {
    user: ManagedUserSummary;
    displayName: string;
    role: "root" | "member";
    status: "active" | "disabled";
};

type CreditForm = {
    user: ManagedUserSummary;
    amount: number;
    remark: string;
};

const providerLabels: Record<ManagedUserSummary["provider"], string> = {
    local: "站内注册",
    migrated: "旧账号迁入",
    tokaxis: "旧站账号",
};

function isPrimaryRoot(user: Pick<ManagedUserSummary, "username">) {
    return user.username.trim().toLowerCase() === "root";
}

function formatDate(value: string | null) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "从未登录";
}

export default function UserManagementPage() {
    const { message, modal } = App.useApp();
    const router = useRouter();
    const currentUser = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const [users, setUsers] = useState<ManagedUserSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [query, setQuery] = useState("");
    const [editForm, setEditForm] = useState<EditForm | null>(null);
    const [creditForm, setCreditForm] = useState<CreditForm | null>(null);
    const canManage = currentUser?.role === "root" && currentUser.username.trim().toLowerCase() === "root";

    const loadUsers = useCallback(
        async (search = "") => {
            setLoading(true);
            try {
                const result = await fetchManagedUsers(search);
                setUsers(result.users);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "读取用户失败");
            } finally {
                setLoading(false);
            }
        },
        [message],
    );

    useEffect(() => {
        if (!isReady) return;
        if (!canManage) {
            router.replace("/");
            return;
        }
        void loadUsers();
    }, [canManage, isReady, loadUsers, router]);

    const activeCount = useMemo(() => users.filter((user) => user.status === "active").length, [users]);

    const saveUser = async () => {
        if (!editForm) return;
        setSaving(true);
        try {
            await updateManagedUser(editForm.user.id, {
                displayName: editForm.displayName,
                role: editForm.role,
                status: editForm.status,
            });
            message.success("用户资料已更新");
            setEditForm(null);
            await loadUsers(query);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新用户失败");
        } finally {
            setSaving(false);
        }
    };

    const adjustCredits = async () => {
        if (!creditForm) return;
        if (!Number.isInteger(creditForm.amount) || creditForm.amount === 0) {
            message.warning("请输入不为 0 的整数积分");
            return;
        }
        setSaving(true);
        try {
            await adjustAccountCredits({ username: creditForm.user.username, amount: creditForm.amount, remark: creditForm.remark || "用户管理调整积分" });
            message.success(creditForm.amount > 0 ? "积分已增加" : "积分已扣减");
            setCreditForm(null);
            await loadUsers(query);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "调整积分失败");
        } finally {
            setSaving(false);
        }
    };

    const toggleStatus = (target: ManagedUserSummary) => {
        const disabling = target.status === "active";
        modal.confirm({
            title: disabling ? `禁用 ${target.username}？` : `启用 ${target.username}？`,
            content: disabling ? "禁用后，该用户会立即退出登录，名下画布 Key 也无法继续调用。" : "启用后，该用户可以重新登录并使用仍然有效的画布 Key。",
            okText: disabling ? "确认禁用" : "确认启用",
            okButtonProps: { danger: disabling },
            cancelText: "取消",
            onOk: async () => {
                await updateManagedUser(target.id, { status: disabling ? "disabled" : "active" });
                message.success(disabling ? "用户已禁用" : "用户已启用");
                await loadUsers(query);
            },
        });
    };

    const revokeKeys = (target: ManagedUserSummary) => {
        modal.confirm({
            title: `撤销 ${target.username} 的全部 Key？`,
            content: `将撤销 ${target.activeKeyCount} 个有效 Key，撤销后不能恢复，用户可在账户页重新创建。`,
            okText: "全部撤销",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                const result = await revokeManagedUserKeys(target.id);
                message.success(`已撤销 ${result.revokedCount} 个 Key`);
                await loadUsers(query);
            },
        });
    };

    if (!isReady || !canManage) return null;

    return (
        <main className="h-full overflow-y-auto bg-background px-4 py-7 sm:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-stone-500 dark:text-stone-400">
                            <ShieldCheck className="size-4" />
                            <span className="text-sm">仅主 root 账号可操作</span>
                        </div>
                        <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-stone-950 dark:text-stone-100">
                            <Users className="size-6" />
                            用户管理
                        </h1>
                        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                            共 {users.length} 个账号，{activeCount} 个正在使用。
                        </p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void loadUsers(query)} loading={loading}>
                        刷新
                    </Button>
                </div>

                <div className="mb-5 flex max-w-md gap-2">
                    <Input allowClear prefix={<Search className="size-4 text-stone-400" />} value={query} placeholder="搜索用户名或显示名称" onChange={(event) => setQuery(event.target.value)} onPressEnter={() => void loadUsers(query)} />
                    <Button onClick={() => void loadUsers(query)}>查询</Button>
                </div>

                <Table<ManagedUserSummary>
                    rowKey="id"
                    loading={loading}
                    dataSource={users}
                    pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total) => `共 ${total} 个用户` }}
                    scroll={{ x: 1500 }}
                    columns={[
                        {
                            title: "用户",
                            key: "user",
                            fixed: "left",
                            width: 190,
                            render: (_, target) => (
                                <div className="min-w-0">
                                    <div className="truncate font-medium text-stone-950 dark:text-stone-100">{target.username}</div>
                                    <div className="mt-0.5 truncate text-xs text-stone-500">{target.displayName}</div>
                                </div>
                            ),
                        },
                        {
                            title: "状态",
                            dataIndex: "status",
                            width: 90,
                            render: (status: ManagedUserSummary["status"]) => <Tag color={status === "active" ? "green" : "red"}>{status === "active" ? "已启用" : "已禁用"}</Tag>,
                        },
                        { title: "积分", dataIndex: "credits", width: 120, render: (credits: number) => <span className="tabular-nums">✨ {credits.toLocaleString("zh-CN")}</span> },
                        { title: "角色", dataIndex: "role", width: 100, render: (role: ManagedUserSummary["role"]) => (role === "root" ? <Tag color="gold">Root</Tag> : <Tag>普通用户</Tag>) },
                        { title: "来源", dataIndex: "provider", width: 110, render: (provider: ManagedUserSummary["provider"]) => providerLabels[provider] },
                        { title: "有效 Key", dataIndex: "activeKeyCount", width: 90, align: "center" },
                        { title: "最近登录", dataIndex: "lastLoginAt", width: 175, render: (value: string | null) => formatDate(value) },
                        { title: "注册时间", dataIndex: "createdAt", width: 175, render: (value: string) => formatDate(value) },
                        {
                            title: "操作",
                            key: "actions",
                            fixed: "right",
                            width: 360,
                            render: (_, target) => {
                                const primaryRoot = isPrimaryRoot(target);
                                return (
                                    <div className="flex min-w-[340px] items-center gap-1 whitespace-nowrap">
                                        <Button type="text" size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditForm({ user: target, displayName: target.displayName, role: target.role, status: target.status })}>
                                            编辑
                                        </Button>
                                        <Button type="text" size="small" icon={<Coins className="size-3.5" />} onClick={() => setCreditForm({ user: target, amount: 100, remark: "" })}>
                                            积分
                                        </Button>
                                        <Button
                                            type="text"
                                            size="small"
                                            danger={target.status === "active"}
                                            disabled={primaryRoot}
                                            icon={target.status === "active" ? <Ban className="size-3.5" /> : <UserCheck className="size-3.5" />}
                                            onClick={() => toggleStatus(target)}
                                        >
                                            {target.status === "active" ? "禁用" : "启用"}
                                        </Button>
                                        <Button type="text" size="small" danger disabled={primaryRoot || target.activeKeyCount === 0} icon={<KeyRound className="size-3.5" />} onClick={() => revokeKeys(target)}>
                                            撤销 Key
                                        </Button>
                                    </div>
                                );
                            },
                        },
                    ]}
                />
            </div>

            <Modal open={Boolean(editForm)} title={editForm ? `编辑用户：${editForm.user.username}` : "编辑用户"} okText="保存" cancelText="取消" confirmLoading={saving} onOk={() => void saveUser()} onCancel={() => setEditForm(null)}>
                {editForm ? (
                    <div className="space-y-5 pt-3">
                        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                            显示名称
                            <Input className="mt-2" maxLength={80} value={editForm.displayName} onChange={(event) => setEditForm({ ...editForm, displayName: event.target.value })} />
                        </label>
                        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                            角色
                            <Select
                                className="mt-2 w-full"
                                value={editForm.role}
                                disabled={isPrimaryRoot(editForm.user)}
                                options={[
                                    { value: "member", label: "普通用户" },
                                    { value: "root", label: "Root 角色" },
                                ]}
                                onChange={(role) => setEditForm({ ...editForm, role })}
                            />
                        </label>
                        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                            状态
                            <Select
                                className="mt-2 w-full"
                                value={editForm.status}
                                disabled={isPrimaryRoot(editForm.user)}
                                options={[
                                    { value: "active", label: "已启用" },
                                    { value: "disabled", label: "已禁用" },
                                ]}
                                onChange={(status) => setEditForm({ ...editForm, status })}
                            />
                        </label>
                        {isPrimaryRoot(editForm.user) ? <p className="text-xs leading-5 text-amber-600 dark:text-amber-400">主 root 账号不能被禁用或降级。</p> : null}
                    </div>
                ) : null}
            </Modal>

            <Modal open={Boolean(creditForm)} title={creditForm ? `调整积分：${creditForm.user.username}` : "调整积分"} okText="确认调整" cancelText="取消" confirmLoading={saving} onOk={() => void adjustCredits()} onCancel={() => setCreditForm(null)}>
                {creditForm ? (
                    <div className="space-y-5 pt-3">
                        <div className="text-sm text-stone-500">当前积分：{creditForm.user.credits.toLocaleString("zh-CN")}</div>
                        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                            调整数值
                            <InputNumber className="mt-2 !w-full" precision={0} value={creditForm.amount} onChange={(value) => setCreditForm({ ...creditForm, amount: Number(value || 0) })} />
                            <span className="mt-1 block text-xs font-normal text-stone-500">正数增加，负数扣减。</span>
                        </label>
                        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                            备注
                            <Input className="mt-2" maxLength={120} value={creditForm.remark} placeholder="例如：活动赠送 / 误充值修正" onChange={(event) => setCreditForm({ ...creditForm, remark: event.target.value })} />
                        </label>
                    </div>
                ) : null}
            </Modal>
        </main>
    );
}
