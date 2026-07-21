"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { App, Typography } from "antd";

import { AssetCategoryMenu } from "@/components/assets/asset-category-menu";
import { assetCategoryOptions, defaultAssetCategory } from "@/lib/asset-categories";
import { useAssetStore, type AssetKind, type NewAsset } from "@/stores/use-asset-store";

type AssetDraft<K extends AssetKind> = Omit<Extract<NewAsset, { kind: K }>, "category">;

type PreparedAsset<K extends AssetKind> = {
    asset: AssetDraft<K>;
    rollback?: () => void | Promise<void>;
};

export type SaveAssetRequest<K extends AssetKind> = {
    kind: K;
    initialCategory?: string;
    prepare: () => PreparedAsset<K> | Promise<PreparedAsset<K>>;
};

function SaveAssetCategoryChooser({ initialCategory, options, onChange }: { initialCategory: string; options: readonly string[]; onChange: (category: string) => void }) {
    const [category, setCategory] = useState(initialCategory);

    return (
        <div className="grid gap-3 pt-2">
            <Typography.Text type="secondary">选择一个常用分类，或在下方输入自定义分类。</Typography.Text>
            <AssetCategoryMenu
                value={category}
                options={options}
                showCustomInput
                onChange={(value) => {
                    setCategory(value);
                    onChange(value);
                }}
            />
        </div>
    );
}

export function useSaveAsset() {
    const { message, modal } = App.useApp();
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const categoryOptions = useMemo(() => assetCategoryOptions(assets), [assets]);
    const activeModalRef = useRef<ReturnType<typeof modal.confirm> | null>(null);

    const saveAsset = useCallback(
        <K extends AssetKind>(request: SaveAssetRequest<K>) => {
            if (activeModalRef.current) return;

            const categoryRef = { current: request.initialCategory || defaultAssetCategory(request.kind) };
            let modalInstance: ReturnType<typeof modal.confirm>;

            modalInstance = modal.confirm({
                title: "选择素材分类",
                icon: null,
                width: 640,
                okText: "保存素材",
                cancelText: "取消",
                closable: false,
                keyboard: true,
                mask: { closable: false },
                content: <SaveAssetCategoryChooser initialCategory={categoryRef.current} options={categoryOptions} onChange={(category) => (categoryRef.current = category)} />,
                afterClose: () => {
                    if (activeModalRef.current === modalInstance) activeModalRef.current = null;
                },
                onOk: async () => {
                    const category = categoryRef.current.trim();
                    if (!category) {
                        message.warning("请选择或输入素材分类");
                        return Promise.reject(new Error("素材分类不能为空"));
                    }

                    modalInstance.update({ cancelButtonProps: { disabled: true }, keyboard: false });
                    let prepared: PreparedAsset<K> | undefined;
                    try {
                        prepared = await request.prepare();
                        addAsset({ ...prepared.asset, category } as NewAsset);
                        message.success("已加入我的素材");
                    } catch (error) {
                        try {
                            await prepared?.rollback?.();
                        } catch {
                            // 清理失败不覆盖原始保存错误。
                        }
                        message.error(error instanceof Error ? `保存素材失败：${error.message}` : "保存素材失败");
                        modalInstance.update({ cancelButtonProps: { disabled: false }, keyboard: true });
                        throw error;
                    }
                },
            });
            activeModalRef.current = modalInstance;
            void modalInstance.then(
                () => undefined,
                () => undefined,
            );
        },
        [addAsset, categoryOptions, message, modal],
    );

    return saveAsset;
}
