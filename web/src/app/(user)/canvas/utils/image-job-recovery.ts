import type { CanvasNodeMetadata } from "../types";

const CANVAS_IMAGE_JOB_RESULT_PATTERN = /^\/api\/image-jobs\/[A-Za-z0-9_-]+\/result\/\d+(?:[?#].*)?$/;

export function isCanvasImageJobResultUrl(value?: string) {
    return Boolean(value && CANVAS_IMAGE_JOB_RESULT_PATTERN.test(value));
}

export function stageCanvasImageJobResult(metadata: CanvasNodeMetadata | undefined, resultUrl: string): CanvasNodeMetadata {
    return {
        ...metadata,
        content: resultUrl,
        storageKey: undefined,
        status: "loading",
        statusMessage: "图片已生成，正在保存到画布...",
        errorDetails: undefined,
        naturalWidth: undefined,
        naturalHeight: undefined,
        bytes: undefined,
        mimeType: undefined,
    };
}

export function shouldRecoverCanvasImageJob(metadata?: CanvasNodeMetadata) {
    return Boolean(metadata?.pendingImageJobId);
}

export function imageJobFailureMetadata(metadata: CanvasNodeMetadata | undefined, errorDetails: string, terminal: boolean): CanvasNodeMetadata {
    if (!terminal && metadata?.pendingImageJobId && isCanvasImageJobResultUrl(metadata.content)) {
        return {
            ...metadata,
            status: "success",
            statusMessage: "图片已生成，刷新后将继续完成本地保存",
            errorDetails: undefined,
        };
    }

    return {
        ...metadata,
        status: "error",
        statusMessage: undefined,
        errorDetails,
        pendingImageJobId: terminal ? undefined : metadata?.pendingImageJobId,
    };
}
