"use client";

import { useState } from "react";
import { Button, Tooltip } from "antd";
import { BookOpen } from "lucide-react";

import { PromptSelectDialog, type PromptSelectContext } from "@/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@/lib/canvas-theme";
import type { Prompt } from "@/services/api/prompts";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasPromptSelection = Prompt;

export function CanvasPromptLibrary({ onSelect, context = "direct" }: { onSelect: (prompt: string, selection?: CanvasPromptSelection) => void; context?: PromptSelectContext }) {
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <Tooltip title="提示词库">
                <Button type="text" className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0" style={{ color: theme.node.text }} icon={<BookOpen className="size-3.5" />} onClick={() => setOpen(true)} aria-label="提示词库" />
            </Tooltip>
            <PromptSelectDialog open={open} onOpenChange={setOpen} context={context} onSelect={(prompt, item) => onSelect(prompt, item)} />
        </>
    );
}
