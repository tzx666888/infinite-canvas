export const ASSET_CATEGORY_PRESETS = ["场景", "人物", "男模", "女模", "商品", "服装", "道具", "动作姿势", "镜头构图", "风格参考", "品牌素材", "提示词", "其他"] as const;
export const ALL_ASSET_CATEGORIES = -1 as const;

type CategorizableAsset = {
    kind: "text" | "image" | "video";
    category?: unknown;
};

export function defaultAssetCategory(kind: CategorizableAsset["kind"]) {
    return kind === "text" ? "提示词" : "其他";
}

export function assetCategory(asset: CategorizableAsset) {
    const category = typeof asset.category === "string" ? asset.category.trim() : "";
    return category || defaultAssetCategory(asset.kind);
}

export function normalizeAssetCategory<T extends CategorizableAsset>(asset: T): T & { category: string } {
    return { ...asset, category: assetCategory(asset) };
}

export function assetCategoryOptions(assets: readonly CategorizableAsset[]) {
    const preset = new Set<string>(ASSET_CATEGORY_PRESETS);
    const custom = new Set<string>();
    assets.forEach((asset) => {
        const category = assetCategory(asset);
        if (!preset.has(category)) custom.add(category);
    });
    return [...ASSET_CATEGORY_PRESETS, ...Array.from(custom).sort((a, b) => a.localeCompare(b, "zh-CN"))];
}
