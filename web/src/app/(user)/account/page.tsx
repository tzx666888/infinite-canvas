"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Radio, Table, Tag } from "antd";
import { Copy, Plus, RefreshCw, ShieldCheck, Trash2, WalletCards } from "lucide-react";

import { adjustAccountCredits, createCanvasApiKey, createPaymentOrder, fetchCanvasApiKeys, fetchPaymentConfig, fetchPaymentOrder, fetchWallet, revokeCanvasApiKey } from "@/services/api/auth";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasApiKeySummary, CreditLedgerEntry, PaymentMethod, PaymentOrderSummary, PaymentPackage } from "@/lib/auth/types";

const ledgerLabels: Record<CreditLedgerEntry["type"], string> = {
    recharge: "充值",
    consume: "消费",
    refund: "退款",
    commission: "分销溢价",
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
    const [topUpOpen, setTopUpOpen] = useState(false);
    const [topUpPackages, setTopUpPackages] = useState<PaymentPackage[]>([]);
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
    const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
    const [loadingPaymentConfig, setLoadingPaymentConfig] = useState(false);
    const [creatingPayment, setCreatingPayment] = useState(false);
    const [pendingPayment, setPendingPayment] = useState<PaymentOrderSummary | null>(null);

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

    const openCreditTopUp = async () => {
        setLoadingPaymentConfig(true);
        try {
            const config = await fetchPaymentConfig();
            setTopUpPackages(config.packages);
            setPaymentMethods(config.methods);
            setSelectedPackage(config.packages[0]?.amountYuan || null);
            setSelectedPaymentMethod(config.methods[0]?.type || "");
            setTopUpOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "在线支付暂时不可用");
        } finally {
            setLoadingPaymentConfig(false);
        }
    };

    const beginPayment = async () => {
        if (!selectedPackage || !selectedPaymentMethod) return message.warning("请选择充值金额和支付方式");
        const paymentWindow = window.open("", "canvas-payment");
        if (paymentWindow) {
            paymentWindow.opener = null;
            paymentWindow.document.title = "正在前往支付";
            paymentWindow.document.body.textContent = "正在创建充值订单，请稍候...";
            paymentWindow.document.body.style.cssText = "margin:0;display:grid;place-items:center;min-height:100vh;font:14px system-ui;color:#555;background:#fff";
        }
        setCreatingPayment(true);
        try {
            const result = await createPaymentOrder({ amountYuan: selectedPackage, paymentMethod: selectedPaymentMethod });
            const checkoutUrl = new URL(result.checkoutUrl, window.location.origin).toString();
            if (paymentWindow && !paymentWindow.closed) paymentWindow.location.replace(checkoutUrl);
            else window.location.assign(checkoutUrl);
            setPendingPayment(result.order);
            setTopUpOpen(false);
            if (!paymentWindow) message.info("浏览器拦截了新窗口，已在当前页面打开支付。完成付款后会自动返回账户页。");
        } catch (error) {
            paymentWindow?.close();
            message.error(error instanceof Error ? error.message : "支付订单创建失败");
        } finally {
            setCreatingPayment(false);
        }
    };

    useEffect(() => {
        if (!pendingPayment || pendingPayment.status !== "pending") return;
        const timer = window.setInterval(() => {
            void fetchPaymentOrder(pendingPayment.id)
                .then(async ({ order }) => {
                    setPendingPayment(order.status === "pending" ? order : null);
                    if (order.status === "paid") {
                        message.success(`${order.credits} 积分已到账`);
                        await Promise.all([refresh(), useUserStore.getState().refreshUser()]);
                    }
                })
                .catch(() => undefined);
        }, 3_000);
        return () => window.clearInterval(timer);
    }, [message, pendingPayment, refresh]);

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
                            <span className="text-base leading-none" aria-hidden="true">
                                ✨
                            </span>
                            可用积分
                        </div>
                        <div className="mt-2 text-3xl font-semibold tabular-nums">{credits}</div>
                    </div>
                    <div className="flex items-center sm:justify-end">
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => void openCreditTopUp()} loading={loadingPaymentConfig}>
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

            <Modal title="增加积分" open={topUpOpen} onCancel={() => setTopUpOpen(false)} onOk={() => void beginPayment()} okText="去支付" cancelText="取消" confirmLoading={creatingPayment} destroyOnHidden>
                <div className="space-y-5">
                    <div>
                        <div className="mb-2 text-sm text-stone-500">充值金额</div>
                        <Radio.Group value={selectedPackage} onChange={(event) => setSelectedPackage(event.target.value)} className="flex flex-wrap gap-2">
                            {topUpPackages.map((item) => (
                                <Radio.Button key={item.amountYuan} value={item.amountYuan}>
                                    {item.credits.toLocaleString()} 积分 · ¥{item.amountYuan}
                                </Radio.Button>
                            ))}
                        </Radio.Group>
                    </div>
                    <div>
                        <div className="mb-2 text-sm text-stone-500">支付方式</div>
                        <Radio.Group value={selectedPaymentMethod} onChange={(event) => setSelectedPaymentMethod(event.target.value)} className="flex flex-wrap gap-2">
                            {paymentMethods.map((method) => (
                                <Radio.Button key={method.type} value={method.type}>
                                    {method.name}
                                </Radio.Button>
                            ))}
                        </Radio.Group>
                    </div>
                </div>
            </Modal>
        </main>
    );
}
