"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Col, Row, Table, Tag } from "antd";
import { BarChart3, Link2, RefreshCw, Users } from "lucide-react";
import { useRouter } from "next/navigation";

import type { AdminDistributorOverview, AdminInviteOverview, AdminOverview } from "@/lib/auth/types";
import { fetchAdminOverview } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

function number(value: number) {
    return value.toLocaleString("zh-CN");
}

function yuan(value: number) {
    return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function date(value: string | null) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "永不过期";
}

export default function AdminOverviewPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const [overview, setOverview] = useState<AdminOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const canOpen = user?.role === "root" && user.username.trim().toLowerCase() === "root";

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setOverview(await fetchAdminOverview());
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取整站统计失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        if (!isReady) return;
        if (!canOpen) {
            router.replace("/");
            return;
        }
        void load();
    }, [canOpen, isReady, load, router]);

    if (!isReady || !canOpen) return null;
    const totals = overview?.totals;
    return (
        <main className="h-full overflow-y-auto bg-background px-4 py-7 sm:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                            <BarChart3 className="size-4" />
                            运营总览
                        </div>
                        <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-100">整站积分与分销统计</h1>
                        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">汇总所有账号余额、模型消耗、在线充值和分销邀请情况。</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                </div>

                <Row gutter={[12, 12]} className="mb-5">
                    {[
                        ["当前积分总额", totals ? number(totals.currentCredits) : "—", "所有账号当前余额合计"],
                        ["累计模型消耗", totals ? number(totals.totalConsumedCredits) : "—", "已成功扣除的模型积分"],
                        ["累计充值", totals ? yuan(totals.rechargeAmountYuan) : "—", totals ? `${number(totals.rechargeCredits)} 积分 · ${totals.rechargeOrderCount} 笔` : "—"],
                        ["分销溢价", totals ? number(totals.commissionCredits) : "—", "已结算返入分销账号"],
                    ].map(([title, value, description]) => (
                        <Col xs={24} sm={12} lg={6} key={title}>
                            <Card size="small" loading={loading}>
                                <div className="text-xs text-stone-500">{title}</div>
                                <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
                                <div className="mt-1 text-xs text-stone-500">{description}</div>
                            </Card>
                        </Col>
                    ))}
                </Row>

                <Row gutter={[12, 12]} className="mb-5">
                    {[
                        ["账号", totals ? `${number(totals.accountCount)} 个` : "—", totals ? `${number(totals.activeAccountCount)} 个启用` : "—"],
                        ["分销成员", totals ? `${number(totals.distributorCount)} 个` : "—", totals ? `${number(totals.distributedCustomerCount)} 个分销客户` : "—"],
                        ["邀请链接", totals ? `${number(totals.inviteCount)} 条` : "—", totals ? `${number(totals.usedInviteCount)} 次已使用` : "—"],
                        ["累计加分", totals ? number(totals.totalAddedCredits) : "—", "充值、赠送、退款及返佣等正向流水"],
                    ].map(([title, value, description]) => (
                        <Col xs={24} sm={12} lg={6} key={title}>
                            <Card size="small" loading={loading}>
                                <div className="text-xs text-stone-500">{title}</div>
                                <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
                                <div className="mt-1 text-xs text-stone-500">{description}</div>
                            </Card>
                        </Col>
                    ))}
                </Row>

                <Card
                    title={
                        <span className="inline-flex items-center gap-2">
                            <Users className="size-4" />
                            分销成员邀请与收益
                        </span>
                    }
                    className="mb-5"
                    bodyStyle={{ padding: 0 }}
                >
                    <Table<AdminDistributorOverview>
                        rowKey="id"
                        loading={loading}
                        dataSource={overview?.distributors || []}
                        pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 个分销成员` }}
                        scroll={{ x: 1100 }}
                        columns={[
                            {
                                title: "分销成员",
                                dataIndex: "username",
                                fixed: "left",
                                width: 150,
                                render: (value, row) => (
                                    <div>
                                        <div className="font-medium">{value}</div>
                                        <div className="text-xs text-stone-500">{row.displayName}</div>
                                    </div>
                                ),
                            },
                            { title: "状态", dataIndex: "status", width: 80, render: (value) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "启用" : "停用"}</Tag> },
                            { title: "邀请链接", dataIndex: "inviteCount", width: 100, render: (value, row) => `${number(value)} 条 / ${number(row.usedInviteCount)} 次使用` },
                            { title: "分销客户", dataIndex: "customerCount", width: 90 },
                            { title: "客户余额", dataIndex: "customerCredits", width: 110, render: (value) => number(value) },
                            { title: "客户消耗", dataIndex: "customerConsumedCredits", width: 110, render: (value) => number(value) },
                            {
                                title: "客户充值",
                                dataIndex: "customerRechargeAmountYuan",
                                width: 120,
                                render: (value, row) => (
                                    <div>
                                        {yuan(value)}
                                        <div className="text-xs text-stone-500">{number(row.customerRechargeCredits)} 积分</div>
                                    </div>
                                ),
                            },
                            { title: "已返溢价", dataIndex: "commissionCredits", width: 100, render: (value) => <span className="text-emerald-600">+{number(value)}</span> },
                        ]}
                    />
                </Card>

                <Card
                    title={
                        <span className="inline-flex items-center gap-2">
                            <Link2 className="size-4" />
                            邀请明细
                        </span>
                    }
                    bodyStyle={{ padding: 0 }}
                >
                    <Table<AdminInviteOverview>
                        rowKey="id"
                        loading={loading}
                        dataSource={overview?.invites || []}
                        pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条邀请` }}
                        scroll={{ x: 1000 }}
                        columns={[
                            { title: "备注", dataIndex: "label", width: 180, render: (value) => value || "未命名邀请码" },
                            { title: "创建人", dataIndex: "createdByUsername", width: 140 },
                            { title: "计费方案", dataIndex: "billingProfileName", width: 160, render: (value) => value || "平台原价" },
                            { title: "注册数", dataIndex: "registeredCount", width: 90, render: (value, row) => `${number(value)} / ${number(row.maxUses)}` },
                            {
                                title: "状态",
                                dataIndex: "status",
                                width: 90,
                                render: (value) => <Tag color={value === "active" ? "green" : value === "used" ? "blue" : "default"}>{value === "active" ? "有效" : value === "used" ? "已用完" : value === "expired" ? "已过期" : "已撤销"}</Tag>,
                            },
                            { title: "创建时间", dataIndex: "createdAt", width: 180, render: (value) => date(value) },
                            { title: "有效期至", dataIndex: "expiresAt", width: 180, render: (value) => date(value) },
                        ]}
                    />
                </Card>
            </div>
        </main>
    );
}
