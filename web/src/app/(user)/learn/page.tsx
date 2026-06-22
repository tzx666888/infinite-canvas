import { ArrowRight, BookOpen, FolderOpen, ImagePlus, LayoutTemplate, Sparkles } from "lucide-react";
import Link from "next/link";

const gettingStarted = [
    {
        title: "先填好 API Key",
        description: "点右上角配置，填入你的 API Key。Base URL 已固定，正常情况下不用自己再配地址。",
        icon: Sparkles,
    },
    {
        title: "先从生图工作台开始",
        description: "第一次使用建议先在生图工作台写提示词、选模型、选比例，确认能稳定出图后再进画布联动。",
        icon: ImagePlus,
    },
    {
        title: "需要连续迭代时再上画布",
        description: "当你想把文本、参考图、结果图和多轮修改串在一起时，再用视觉画布组织整套工作流。",
        icon: LayoutTemplate,
    },
];

const workflow = [
    {
        step: "01",
        title: "提示词起稿",
        description: "可以自己写，也可以先去提示词库找一个接近的案例当起点。",
    },
    {
        step: "02",
        title: "生成首版结果",
        description: "在生图工作台先出第一版，确定模型、比例、分辨率和整体方向。",
    },
    {
        step: "03",
        title: "把好结果沉淀下来",
        description: "满意的图片、提示词和参考图都可以加入我的素材，后续复用会非常省事。",
    },
    {
        step: "04",
        title: "进画布做连续推演",
        description: "当需要多节点拆解、串联修改、并行尝试不同方案时，再进入画布继续推进。",
    },
];

const entrances = [
    {
        title: "我的画布",
        href: "/canvas",
        description: "把文本、图片、结果和分支方案放到同一张画布里持续迭代。",
        icon: LayoutTemplate,
    },
    {
        title: "生图工作台",
        href: "/image",
        description: "最适合新手上手的入口，先把基础生成流程跑通。",
        icon: ImagePlus,
    },
    {
        title: "提示词库",
        href: "/prompts",
        description: "找案例、抄结构、快速起稿，比从空白开始更省时间。",
        icon: BookOpen,
    },
    {
        title: "我的素材",
        href: "/assets",
        description: "把图片、视频、参考图和可复用结果统一沉淀，后面创作会越来越快。",
        icon: FolderOpen,
    },
];

const commonQuestions = [
    {
        title: "为什么会提示鉴权失败？",
        answer: "通常是 API Key 没填对、额度不足，或者当前 Key 没有你所选模型的权限。",
    },
    {
        title: "为什么有些模型看得到却不能用？",
        answer: "系统现在会优先隐藏已确认无权限的模型，但不同 Key 的权限范围还是可能不一样，换模型更稳。",
    },
    {
        title: "什么时候该用画布，什么时候该用工作台？",
        answer: "单次生成、快速试图用工作台；需要多轮修改、分支方案和节点关系时再用画布。",
    },
];

export default function LearnPage() {
    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <section className="mx-auto max-w-7xl px-6 py-10">
                <div className="rounded-[28px] border border-stone-200/80 bg-background/85 p-8 shadow-sm backdrop-blur dark:border-stone-800 dark:bg-stone-950/80 md:p-10">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 px-3 py-1 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                            <BookOpen className="size-3.5" />
                            学习文档
                        </div>
                        <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-5xl">从会用，到顺手，再到稳定出结果</h1>
                        <p className="mt-4 max-w-2xl text-base leading-7 text-stone-500 dark:text-stone-400">
                            这份学习页专门给第一次接触视觉画布的人用。先学怎么快速出第一张图，再学怎么把提示词、参考图、结果图和画布工作流串起来。
                        </p>
                        <div className="mt-7 flex flex-wrap gap-3">
                            <Link
                                href="/image"
                                className="inline-flex items-center gap-2 rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                            >
                                先去生图工作台
                                <ArrowRight className="size-4" />
                            </Link>
                            <Link
                                href="/canvas"
                                className="inline-flex items-center gap-2 rounded-full border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-700 transition hover:border-stone-500 hover:text-stone-950 dark:border-stone-700 dark:text-stone-200 dark:hover:border-stone-500 dark:hover:text-white"
                            >
                                再去打开画布
                            </Link>
                        </div>
                    </div>
                </div>

                <section className="mt-10">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 className="text-2xl font-semibold">三步上手</h2>
                        <p className="text-sm text-stone-500 dark:text-stone-400">按这个顺序最不容易绕路。</p>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                        {gettingStarted.map((item) => {
                            const Icon = item.icon;
                            return (
                                <article key={item.title} className="rounded-3xl border border-stone-200 bg-card p-6 shadow-sm dark:border-stone-800">
                                    <div className="flex size-11 items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
                                        <Icon className="size-5" />
                                    </div>
                                    <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
                                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{item.description}</p>
                                </article>
                            );
                        })}
                    </div>
                </section>

                <section className="mt-10 grid gap-10 xl:grid-cols-[1.15fr_.85fr]">
                    <div className="rounded-3xl border border-stone-200 bg-card p-6 shadow-sm dark:border-stone-800">
                        <h2 className="text-2xl font-semibold">推荐学习路线</h2>
                        <div className="mt-6 space-y-4">
                            {workflow.map((item) => (
                                <div key={item.step} className="flex gap-4 rounded-2xl border border-stone-200/80 p-4 dark:border-stone-800">
                                    <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-sm font-semibold text-white dark:bg-stone-100 dark:text-stone-950">
                                        {item.step}
                                    </div>
                                    <div>
                                        <h3 className="text-base font-semibold">{item.title}</h3>
                                        <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">{item.description}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-3xl border border-stone-200 bg-card p-6 shadow-sm dark:border-stone-800">
                        <h2 className="text-2xl font-semibold">常见问题</h2>
                        <div className="mt-6 space-y-4">
                            {commonQuestions.map((item) => (
                                <article key={item.title} className="rounded-2xl border border-stone-200/80 p-4 dark:border-stone-800">
                                    <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</h3>
                                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{item.answer}</p>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="mt-10 rounded-3xl border border-stone-200 bg-card p-6 shadow-sm dark:border-stone-800">
                    <div className="mb-5 flex items-center justify-between gap-3">
                        <h2 className="text-2xl font-semibold">功能入口说明</h2>
                        <p className="text-sm text-stone-500 dark:text-stone-400">每个入口解决的问题不一样。</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        {entrances.map((item) => {
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.title}
                                    href={item.href}
                                    className="group rounded-3xl border border-stone-200 p-5 transition hover:border-stone-400 hover:bg-stone-50 dark:border-stone-800 dark:hover:border-stone-600 dark:hover:bg-stone-900"
                                >
                                    <div className="flex size-10 items-center justify-center rounded-2xl border border-stone-200 bg-background dark:border-stone-800">
                                        <Icon className="size-5" />
                                    </div>
                                    <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{item.description}</p>
                                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-stone-700 transition group-hover:text-stone-950 dark:text-stone-300 dark:group-hover:text-white">
                                        打开入口
                                        <ArrowRight className="size-4" />
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </section>
            </section>
        </main>
    );
}
