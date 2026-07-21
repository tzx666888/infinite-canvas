"use client";

import { AutoComplete, Tag } from "antd";

import { ALL_ASSET_CATEGORIES, ASSET_CATEGORY_PRESETS } from "@/lib/asset-categories";
import { cn } from "@/lib/utils";

type CategoryMenuValue = string | typeof ALL_ASSET_CATEGORIES;

type AssetCategoryMenuProps<T extends CategoryMenuValue> = {
    value?: T;
    options: readonly string[];
    includeAll?: boolean;
    showCustomInput?: boolean;
    onChange?: (value: T) => void;
};

export function AssetCategoryMenu<T extends CategoryMenuValue>({ value, options, includeAll = false, showCustomInput = false, onChange }: AssetCategoryMenuProps<T>) {
    const customValue = typeof value === "string" && !ASSET_CATEGORY_PRESETS.some((category) => category === value) ? value : "";

    return (
        <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
                {includeAll ? (
                    <Tag.CheckableTag checked={value === ALL_ASSET_CATEGORIES} className={cn("prompt-filter-tag", value === ALL_ASSET_CATEGORIES && "is-active")} onChange={() => onChange?.(ALL_ASSET_CATEGORIES as T)}>
                        全部
                    </Tag.CheckableTag>
                ) : null}
                {options.map((category) => (
                    <Tag.CheckableTag key={category} checked={value === category} className={cn("prompt-filter-tag max-w-40 truncate", value === category && "is-active")} onChange={() => onChange?.(category as T)}>
                        <span title={category}>{category}</span>
                    </Tag.CheckableTag>
                ))}
            </div>
            {showCustomInput ? (
                <AutoComplete className="w-full" allowClear value={customValue} options={options.map((category) => ({ label: category, value: category }))} placeholder="输入自定义分类名称" onChange={(category) => onChange?.(category as T)} />
            ) : null}
        </div>
    );
}
