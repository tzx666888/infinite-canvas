"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Table, Tag } from "antd";
import { Copy, Plus, RefreshCw, ShieldCheck, Trash2, WalletCards } from "lucide-react";

import { adjustAccountCredits, createCanvasApiKey, fetchCanvasApiKeys, fetchWallet, revokeCanvasApiKey } from "@/services/api/auth";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasApiKeySummary, CreditLedgerEntry } from "@/lib/auth/types";

const ledgerLabels: Record<CreditLedgerEntry["type"], string> = {
    recharge: "充值",
    consume: "消费",
    refund: "退款",
    admin_adjust: "人工调整",
    registration_bonus: "注册赠送",
    migration_credit: "旧账户迁入",
};

export default function AccountPage() {
    const { message, modal } = App.useApp();
    const user = useUserStore((state) => state.user);
    const syncModelsFromKey = useConfigStore((state) => state.syncModelsFromKey);
    const [apiKeys, setApiKeys] = useState<CanvasApiKeySummary[]>([]);
    const [credits, setCredits] = useState(0);
    const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [createdKey, setCreatedKey] = useState("");
    const [createdKeyModelCount, setCreatedKeyModelCount] = useState<number | null>(null);
    const [keyName, setKeyName] = useState("默认画布 Key");
    const [adjustUsername, setAdjustUsername] = useState("");
    const [adjustAmount, setAdjustAmount] = useState(100);
    const [adjusting, setAdjusting] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [keyResult, wallet] = await Promise.all([fetchCanvasApiKeys(), fetchWallet()]);
            setApiKeys(keyResult.apiKeys);
            setCredits(wallet.credits);
            setLedger(wallet.ledger);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "账户信息读取失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const createKey = async () => {
        setCreating(true);
        try {
            const result = await createCanvasApiKey(keyName);
            setCreatedKey(result.key);
            setCreatedKeyModelCount(null);
            try {
                const count = await syncModelsFromKey(result.key);
                setCreatedKeyModelCount(count);
                message.success(`画布 Key 已创建，并同步 ${count} 个模型`);
            } catch (error) {
                message.warning(error instanceof Error ? `Key 已创建，模型同步失败：${error.message}` : "Key 已创建，模型同步失败，请稍后在设置中重试");
            }
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布 Key 创建失败");
        } finally {
            setCreating(false);
        }
    };

    const revokeKey = (apiKey: CanvasApiKeySummary) => {
        modal.confirm({
            title: "撤销这个画布 Key？",
            content: "撤销后，使用它的浏览器需要更换新 Key。此操作不可恢复。",
            okText: "撤销",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await revokeCanvasApiKey(apiKey.id);
                message.success("画布 Key 已撤销");
                await refresh();
            },
        });
    };

    const adjust = async () => {
        if (!adjustUsername.trim()) return message.warning("请输入用户名");
        setAdjusting(true);
        try {
            const result = await adjustAccountCredits({ username: adjustUsername, amount: adjustAmount, remark: "站内人工充值" });
            message.success(`${result.user.username} 当前余额 ${result.credits} 积分`);
            if (result.user.id === user?.id) await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "积分调整失败");
        } finally {
            setAdjusting(false);
        }
    };

    const openCreditTopUp = () => {
        if (user?.role === "root") {
            document.getElementById("credit-management")?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        modal.info({
            title: "增加积分",
            content: "请联系管理员确认充值，到账后积分会自动显示在本页。",
            okText: "知道了",
        });
    };

    return (
        <main className="h-full overflow-y-auto bg-background px-5 py-8 sm:px-8">
            <div className="mx-auto max-w-5xl space-y-9">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-stone-500 dark:text-stone-400">
                            <WalletCards className="size-4" />
                            <span className="text-sm">站内账户</span>
                        </div>
                        <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-100">账户与画布 Key</h1>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void refresh()} loading={loading}>
                        刷新
                    </Button>
                </header>

                <section className="grid gap-5 border-y border-stone-200 py-6 dark:border-stone-800 sm:grid-cols-2">
                    <div>
                        <div className="flex items-center gap-2 text-sm text-stone-500">
                            <span className="text-base leading-none" aria-hidden="true">✨</span>
                            可用积分
                        </div>
                        <div className="mt-2 text-3xl font-semibold tabular-nums">{credits}</div>
                    </div>
                    <div className="flex items-center sm:justify-end">
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreditTopUp}>
                            增加积分
                        </Button>
                    </div>
                </section>

                <section>
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-semibold">画布 Key</h2>
                            <p className="mt-1 text-sm text-stone-500">仅能调用本站模型入口，不能用于其他网站。原文只在创建时显示一次。</p>
                        </div>
                        <div className="flex gap-2">
                            <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} maxLength={50} className="w-44" />
                            <Button type="primary" icon={<Plus className="size-4" />} loading={creating} onClick={() => void createKey()}>
                                创建 Key
                            </Button>
                        </div>
                    </div>
                    <Table<CanvasApiKeySummary>
                        rowKey="id"
                        loading={loading}
                        pagination={false}
                        scroll={{ x: 720 }}
                        dataSource={apiKeys}
                        columns={[
                            { title: "名称", dataIndex: "name", key: "name" },
                            {
                                title: "Key",
                                key: "key",
                                render: (_, item) => (
                                    <code>
                                        {item.prefix}...{item.lastFour}
                                    </code>
                                ),
                            },
                            { title: "状态", key: "status", render: (_, item) => (item.revokedAt ? <Tag>已撤销</Tag> : <Tag color="green">可用</Tag>) },
                            { title: "最近使用", dataIndex: "lastUsedAt", key: "lastUsedAt", render: (value: string | null) => (value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未使用") },
                            {
                                title: "操作",
                                key: "actions",
                                render: (_, item) =>
                                    !item.revokedAt ? (
                                        <Button type="text" danger icon={<Trash2 className="size-4" />} onClick={() => revokeKey(item)}>
                                            撤销
                                        </Button>
                                    ) : null,
                            },
                        ]}
                    />
                </section>

                {user?.role === "root" ? (
                    <section id="credit-management" className="border-y border-stone-200 py-6 dark:border-stone-800">
                        <div className="mb-4 flex items-center gap-2">
                            <ShieldCheck className="size-4" />
                            <h2 className="text-lg font-semibold">积分管理</h2>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
                            <Input value={adjustUsername} onChange={(event) => setAdjustUsername(event.target.value)} placeholder="用户名" />
                            <InputNumber className="!w-full" value={adjustAmount} onChange={(value) => setAdjustAmount(Number(value || 0))} step={10} />
                            <Button type="primary" loading={adjusting} onClick={() => void adjust()}>
                                确认调整
                            </Button>
                        </div>
                        <p className="mt-2 text-xs text-stone-500">正数为充值，负数为扣减。</p>
                    </section>
                ) : null}

                <section>
                    <h2 className="mb-4 text-lg font-semibold">积分流水</h2>
                    <Table<CreditLedgerEntry>
                        rowKey="id"
                        loading={loading}
                        pagination={{ pageSize: 10, hideOnSinglePage: true }}
                        scroll={{ x: 680 }}
                        dataSource={ledger}
                        columns={[
                            { title: "时间", dataIndex: "createdAt", key: "createdAt", render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
                            { title: "类型", dataIndex: "type", key: "type", render: (value: CreditLedgerEntry["type"]) => ledgerLabels[value] },
                            { title: "变动", dataIndex: "amount", key: "amount", render: (value: number) => <span className={value >= 0 ? "text-emerald-600" : "text-red-500"}>{value >= 0 ? `+${value}` : value}</span> },
                            { title: "余额", dataIndex: "balanceAfter", key: "balanceAfter" },
                            { title: "说明", dataIndex: "remark", key: "remark" },
                        ]}
                    />
                </section>
            </div>

            <Modal
                open={Boolean(createdKey)}
                title="画布 Key 已创建"
                footer={
                    <Button type="primary" onClick={() => setCreatedKey("")}>
                        我已保存
                    </Button>
                }
                onCancel={() => setCreatedKey("")}
            >
                <p className="mb-4 text-sm leading-6 text-stone-500">
                    请立即保存。关闭后系统不会再次显示完整 Key。
                    {createdKeyModelCount !== null ? ` 当前浏览器已自动写入此 Key，并同步 ${createdKeyModelCount} 个模型。` : " 当前浏览器会保留此 Key，可稍后在设置中重新同步模型。"}
                </p>
                <div className="flex items-center gap-2 border border-stone-200 bg-stone-50 p-3 font-mono text-sm dark:border-stone-700 dark:bg-stone-900">
                    <span className="min-w-0 flex-1 break-all">{createdKey}</span>
                    <Button type="text" icon={<Copy className="size-4" />} aria-label="复制画布 Key" onClick={() => void navigator.clipboard.writeText(createdKey).then(() => message.success("画布 Key 已复制"))} />
                </div>
            </Modal>
        </main>
    );
}
