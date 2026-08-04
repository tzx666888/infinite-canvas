export type PromptOrigin = "community" | "tokaxis";
export type PromptAction = "insert_prompt" | "agent_workflow";
export type PromptVisual = "workflow" | "script" | "portrait" | "product" | "image" | "storyboard" | "video";
export type PromptMedia = "text" | "image" | "video" | "mixed";
export type PromptIntent = "cinematic_workflow" | "script_ad" | "commercial_portrait" | "commerce_product" | "still_image" | "storyboard_emotion" | "commercial_video" | "commerce_scene_layout";

export type Prompt = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    githubUrl: string;
    preview: string;
    createdAt: string;
    updatedAt: string;
    origin?: PromptOrigin;
    intent?: PromptIntent;
    action?: PromptAction;
    visual?: PromptVisual;
    summary?: string;
    media?: PromptMedia;
};

export const TOKAXIS_PROMPTS: Prompt[] = [
    tokaxisPrompt({
        id: "tokaxis_cinematic_workflow_v1",
        title: "一键影视创作工作流",
        summary: "从一个主题或产品出发，按顺序完成剧本、真人视觉、静帧与分镜。",
        prompt: "请启动完整影视创作工作流。围绕我提供的主题、产品或素材，依次完成中文影视创意与剧本方案、真人角色视觉锚点、关键静帧的中英文图像提示词、融合人物情绪表演的分镜与视频提示词。开始前先核对素材并询问缺失的关键选择；执行时保持人物身份、产品、场景和叙事连续。我的需求是：",
        tags: ["广告创意", "人物肖像", "短视频"],
        category: "Tokaxis 创作",
        intent: "cinematic_workflow",
        action: "agent_workflow",
        visual: "workflow",
        media: "mixed",
    }),
    tokaxisPrompt({
        id: "tokaxis_script_ad_creative_v1",
        title: "商业剧本与广告创意",
        summary: "把品牌、产品或主题发展成可拍摄的概念、结构和对白。",
        prompt: "请担任中文影视编剧和广告创意策划。根据以下品牌、产品或主题，先明确受众、传播目标、核心冲突和情绪转折，再输出可拍摄的创意概念、故事梗概、分场结构和自然对白；如果信息不足，先向我提问。需求：",
        tags: ["广告创意", "短视频"],
        category: "Tokaxis 创作",
        intent: "script_ad",
        action: "agent_workflow",
        visual: "script",
        media: "mixed",
    }),
    tokaxisPrompt({
        id: "tokaxis_commercial_portrait_v1",
        title: "真人商业人物写真",
        summary: "保留真人身份特征，生成可用于品牌传播的专业人像。",
        prompt: "以已连接的成年人物参考图为身份基准，严格保留可辨识的脸型、五官比例、肤色与发型；拍摄一组用于品牌传播的真实商业人像，人物自然自信，妆发克制，服装与品牌定位一致，真实皮肤纹理，专业摄影棚布光，清晰眼神光，85mm 人像镜头，中浅景深，避免过度磨皮、塑料皮肤、五官漂移和多余肢体。品牌/职业/场景要求：",
        tags: ["人物肖像", "摄影写实", "需要参考图"],
        category: "Tokaxis 创作",
        intent: "commercial_portrait",
        action: "insert_prompt",
        visual: "portrait",
        media: "image",
    }),
    tokaxisPrompt({
        id: "tokaxis_product_visual_v1",
        title: "电商产品主视觉",
        summary: "锁定产品外观与包装，生成干净、可信的电商商业图。",
        prompt: "以已连接的产品参考图为唯一产品身份基准，严格保持外形、颜色、材质、比例、标识与包装文字位置；制作干净可信的电商产品主视觉，主体完整，卖点清晰，真实接触阴影与材质反光，商业棚拍光线，背景和道具仅服务产品，不增加未提供的配件或文案。产品卖点/目标场景：",
        tags: ["商品图", "广告创意", "品牌包装", "需要参考图"],
        category: "Tokaxis 创作",
        intent: "commerce_product",
        action: "insert_prompt",
        visual: "product",
        media: "image",
    }),
    tokaxisPrompt({
        id: "tokaxis_still_image_v1",
        title: "商业静态图像创作",
        summary: "把创意简报转成主体、构图、光线与质感明确的静帧。",
        prompt: "根据以下创意简报生成一张可直接交付的商业静态图像：明确主体、动作或陈列、环境、构图、镜头、光线、色调、材质与质量要求；画面只包含简报中确认的元素，文字需要时保持清楚可读，避免水印、乱码、重复主体和结构错误。创意简报：",
        tags: ["广告创意", "摄影写实"],
        category: "Tokaxis 创作",
        intent: "still_image",
        action: "insert_prompt",
        visual: "image",
        media: "image",
    }),
    tokaxisPrompt({
        id: "tokaxis_storyboard_emotion_v1",
        title: "分镜与人物情绪表演",
        summary: "将剧本拆成兼顾镜头调度、微表演和声音的可执行分镜。",
        prompt: "请把以下剧本、广告概念或场景拆解为中文影视分镜，并把人物情绪弧线和可见微表演融入每个镜头。先确认资产、空间调度、总时长和交付格式；随后逐镜输出景别、构图、动作、运镜、表情、音效和可执行的视频提示词，保持人物与场景连续。素材/剧本：",
        tags: ["人物肖像", "短视频", "广告创意"],
        category: "Tokaxis 创作",
        intent: "storyboard_emotion",
        action: "agent_workflow",
        visual: "storyboard",
        media: "mixed",
    }),
    tokaxisPrompt({
        id: "tokaxis_video_prompt_v1",
        title: "通用商业视频提示词",
        summary: "为商业短视频补齐节奏、运镜、声音、连续性与负向约束。",
        prompt: "根据以下创意生成一段商业视频：明确成年主体、动作节奏、场景、构图、镜头运动、光线、风格与声音；按目标时长安排起承转合，保持人物、产品与空间连续，动作符合物理规律，避免闪烁、身份漂移、结构变形、突兀切镜、乱码和水印。创意/产品/目标时长/画幅：",
        tags: ["短视频", "广告创意", "摄影写实"],
        category: "Tokaxis 创作",
        intent: "commercial_video",
        action: "insert_prompt",
        visual: "video",
        media: "video",
    }),
];

function tokaxisPrompt(input: Pick<Prompt, "id" | "title" | "summary" | "prompt" | "tags" | "category" | "intent" | "action" | "visual" | "media">): Prompt {
    return {
        ...input,
        coverUrl: "",
        githubUrl: "",
        preview: input.summary || "",
        createdAt: "",
        updatedAt: "",
        origin: "tokaxis",
    };
}
