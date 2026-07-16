import { BookOpen, FileText, ImagePlus, Images, Maximize2, Video, Volume2 } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        icon: Maximize2,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
    },
    {
        slug: "tts",
        label: "TTS配音",
        icon: Volume2,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
    },
    {
        slug: "learn",
        label: "学习文档",
        icon: BookOpen,
    },
    {
        slug: "assets",
        label: "我的素材",
        icon: Images,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
