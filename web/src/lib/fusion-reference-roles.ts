import type { ReferenceImage } from "@/types/image";

export const MAX_FUSION_PRODUCT_REFERENCES = 5;

export type FusionReferenceRoles = {
    sceneImage: ReferenceImage;
    productImages: ReferenceImage[];
    orderedImages: ReferenceImage[];
    prompt: string;
    originalSceneIndex: number;
};

type ResolveFusionReferenceRolesOptions = {
    prompt: string;
    references: ReferenceImage[];
    explicitSceneImageId?: string;
    force?: boolean;
};

export function resolveFusionReferenceRoles({ prompt, references, explicitSceneImageId, force = false }: ResolveFusionReferenceRolesOptions): FusionReferenceRoles | null {
    if (references.length < 2) return null;

    const explicitSceneIndex = explicitSceneImageId ? references.findIndex((image) => image.id === explicitSceneImageId) : -1;
    if (!force && explicitSceneIndex < 0 && !isLikelyFusionPrompt(prompt)) return null;

    const inferredSceneIndex = explicitSceneIndex >= 0 ? explicitSceneIndex : inferSceneReferenceIndex(prompt, references.length);
    const originalSceneIndex = inferredSceneIndex ?? 0;
    const productImages = references.filter((_, index) => index !== originalSceneIndex);
    if (productImages.length > MAX_FUSION_PRODUCT_REFERENCES) {
        throw new Error(`一次最多融合 ${MAX_FUSION_PRODUCT_REFERENCES} 张产品图，请减少连接后重试`);
    }

    const orderedImages = [references[originalSceneIndex], ...productImages];
    const originalIndexes = [originalSceneIndex, ...references.map((_, index) => index).filter((index) => index !== originalSceneIndex)];

    return {
        sceneImage: orderedImages[0],
        productImages,
        orderedImages,
        prompt: remapImageReferenceLabels(prompt, originalIndexes),
        originalSceneIndex,
    };
}

export function isLikelyFusionPrompt(prompt: string) {
    return /(?:融图|融合|融入|合成|植入|置入|摆放|放入|放到|放在|加入|添加到|手持|拿着|带着|展示产品|商品|产品|composite|integrat(?:e|ion)|insert|place|put|holding|hold the product|with the product)/i.test(prompt);
}

export function inferSceneReferenceIndex(prompt: string, referenceCount: number) {
    const text = normalizeImageLabels(prompt);
    const explicitScenePatterns = [/图片(\d+)[^\n。，,]{0,24}(?:作为|就是|是|为)(?:目标图|底图|场景图|背景图|场景|背景)/i, /(?:目标图|底图|场景图|背景图|场景|背景)(?:是|为|用)?\s*图片(\d+)/i];
    for (const pattern of explicitScenePatterns) {
        const match = text.match(pattern);
        const index = validReferenceIndex(match?.[1], referenceCount);
        if (index !== null) return index;
    }

    const productIntoScenePatterns = [
        /(?:把|将)\s*图片(\d+)[\s\S]{0,80}?(?:融入|融合到|合成到|放入|放到|置于|摆到|加入到|添加到|植入)\s*(?:到|进|在|至)?\s*图片(\d+)/i,
        /(?:put|place|insert|integrate|composite)\s+(?:the\s+)?图片(\d+)[\s\S]{0,80}?(?:into|onto|inside|in)\s+(?:the\s+)?图片(\d+)/i,
    ];
    for (const pattern of productIntoScenePatterns) {
        const match = text.match(pattern);
        const index = validReferenceIndex(match?.[2], referenceCount);
        if (index !== null) return index;
    }

    const sceneActsWithProductPatterns = [
        /(?:让|使|用|以)?\s*图片(\d+)[\s\S]{0,60}?(?:手持|拿着|带着|使用|展示|搭配)\s*图片(\d+)/i,
        /(?:在|以)\s*图片(\d+)[\s\S]{0,50}?(?:中|里|作为场景|为背景)[\s\S]{0,50}?(?:加入|添加|放入|融入)\s*图片(\d+)/i,
        /图片(\d+)[\s\S]{0,40}?(?:holds?|holding|uses?|using|shows?|showing|wears?|wearing)[\s\S]{0,20}?图片(\d+)/i,
    ];
    for (const pattern of sceneActsWithProductPatterns) {
        const match = text.match(pattern);
        const index = validReferenceIndex(match?.[1], referenceCount);
        if (index !== null) return index;
    }

    return null;
}

function normalizeImageLabels(prompt: string) {
    return prompt.replace(/<IMAGE_(\d+)>/gi, "图片$1").replace(/(?:图片|图像|图|image|img|photo|picture)\s*#?\s*(\d+)/gi, "图片$1");
}

function remapImageReferenceLabels(prompt: string, originalIndexes: number[]) {
    const newIndexByOriginal = new Map(originalIndexes.map((originalIndex, newIndex) => [originalIndex + 1, newIndex + 1]));
    return prompt
        .replace(/<IMAGE_(\d+)>/gi, (match, value: string) => {
            const next = newIndexByOriginal.get(Number(value));
            return next ? `<IMAGE_${next}>` : match;
        })
        .replace(/((?:图片|图像|图|image|img|photo|picture)\s*#?\s*)(\d+)/gi, (match, prefix: string, value: string) => {
            const next = newIndexByOriginal.get(Number(value));
            return next ? `${prefix}${next}` : match;
        });
}

function validReferenceIndex(value: string | undefined, referenceCount: number) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > referenceCount) return null;
    return parsed - 1;
}
