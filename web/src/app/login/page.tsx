"use client";

import { useEffect, useMemo, useState } from "react";
import { App, Button, Form, Input, Segmented } from "antd";
import { KeyRound, LockKeyhole, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { BrandMark } from "@/components/brand/brand-mark";
import { AuthRequestError } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

type FormValues = { username: string; password: string; confirmPassword?: string; inviteCode?: string; code?: string };

function safeRedirect(value: string | null) {
    return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const isLoading = useUserStore((state) => state.isLoading);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const login = useUserStore((state) => state.login);
    const register = useUserStore((state) => state.register);
    const [mode, setMode] = useState<"login" | "register">("login");
    const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
    const redirect = useMemo(() => safeRedirect(searchParams.get("redirect")), [searchParams]);

    useEffect(() => {
        if (!isReady) void hydrateUser();
    }, [hydrateUser, isReady]);

    useEffect(() => {
        if (user) router.replace(redirect);
    }, [redirect, router, user]);

    const submit = async (values: FormValues) => {
        try {
            if (mode === "register") {
                if (values.password !== values.confirmPassword) {
                    message.error("两次输入的密码不一致");
                    return;
                }
                await register({ username: values.username, password: values.password, inviteCode: values.inviteCode || "" });
                message.success("账号已开通");
            } else {
                await login({ username: values.username, password: values.password, code: values.code });
                message.success("登录成功");
            }
            router.replace(redirect);
        } catch (error) {
            if (error instanceof AuthRequestError && error.code === "two_factor_required") {
                setRequiresTwoFactor(true);
                message.info("请输入中转站动态验证码或备用码");
                return;
            }
            message.error(error instanceof Error ? error.message : "账户操作失败");
        }
    };

    return (
        <main className="relative flex h-screen min-h-0 items-center justify-center overflow-y-auto bg-background px-6 py-10 text-foreground">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#e7e5e4_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.12)_1px,transparent_1px)]" />
            <section className="relative w-full max-w-md">
                <div className="mb-9 text-center">
                    <BrandMark className="mx-auto mb-6 [&>img]:size-14" />
                    <h1 className="text-3xl font-semibold text-stone-950 dark:text-stone-100">进入视觉画布</h1>
                    <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">已有中转站账号可直接登录；新账号仅通过邀请码开通。</p>
                </div>

                <Form<FormValues> layout="vertical" size="large" requiredMark={false} onFinish={submit}>
                    <Form.Item>
                        <Segmented
                            block
                            value={mode}
                            onChange={(value) => {
                                setMode(value as "login" | "register");
                                setRequiresTwoFactor(false);
                            }}
                            options={[
                                { label: "中转站账号登录", value: "login" },
                                { label: "邀请码注册", value: "register" },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="username" label={mode === "login" ? "用户名或邮箱" : "用户名"} rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input prefix={<UserRound className="size-4" />} autoComplete="username" placeholder={mode === "login" ? "输入中转站用户名或邮箱" : "3-20 位小写字母、数字或 _ -"} />
                    </Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password prefix={<LockKeyhole className="size-4" />} autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder="至少 12 位" />
                    </Form.Item>
                    {mode === "register" ? (
                        <>
                            <Form.Item name="confirmPassword" label="确认密码" rules={[{ required: true, message: "请再次输入密码" }]}>
                                <Input.Password prefix={<LockKeyhole className="size-4" />} autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item name="inviteCode" label="邀请码" rules={[{ required: true, message: "请输入邀请码" }]}>
                                <Input prefix={<KeyRound className="size-4" />} autoComplete="off" placeholder="VC-XXXX-XXXX-XXXX-XXXX" />
                            </Form.Item>
                        </>
                    ) : requiresTwoFactor ? (
                        <Form.Item name="code" label="动态验证码或备用码" rules={[{ required: true, message: "请输入验证码" }]}>
                            <Input prefix={<KeyRound className="size-4" />} autoComplete="one-time-code" placeholder="6 位动态码或备用码" />
                        </Form.Item>
                    ) : null}
                    <Button type="primary" block htmlType="submit" loading={isLoading}>
                        {mode === "login" ? "登录" : "开通账号"}
                    </Button>
                </Form>
            </section>
        </main>
    );
}
