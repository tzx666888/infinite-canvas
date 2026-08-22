"use client";

import { useEffect } from "react";

export default function CanvasRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error("Canvas route crashed", error);
    }, [error]);

    return (
        <main className="grid min-h-screen place-items-center bg-[#090909] px-6 text-white">
            <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
                <h1 className="text-2xl font-semibold">画布没有正常显示</h1>
                <p className="mt-3 text-sm leading-6 text-white/60">现场数据没有被删除。你可以重新加载当前画布，或者先返回画布列表。</p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <button type="button" onClick={reset} className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black">
                        重新加载
                    </button>
                    <a href="/canvas" className="rounded-lg border border-white/20 px-5 py-2.5 text-sm text-white">
                        返回我的画布
                    </a>
                </div>
            </section>
        </main>
    );
}
