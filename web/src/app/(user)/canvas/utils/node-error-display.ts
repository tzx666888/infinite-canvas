import { isContentPolicyErrorMessage } from "../../../../lib/content-policy-error";

export type CanvasNodeErrorDisplay = {
    title: string;
    message: string;
};

const LEGACY_STORYBOARD_REVIEW_VIDEO_ERROR = "12宫格分镜候选不能直接生成视频";

/**
 * Convert provider diagnostics into customer-facing states. Raw adapter details
 * stay in server logs and must never be rendered on a canvas node.
 */
export function describeCanvasNodeError(errorDetails?: string): CanvasNodeErrorDisplay {
    const text = errorDetails?.trim() || "生成失败";
    const lower = text.toLowerCase();

    if (text.includes(LEGACY_STORYBOARD_REVIEW_VIDEO_ERROR)) {
        return {
            title: "宫格视频链路已更新",
            message: "现在支持用 12 宫格分镜作为视频参考，点重试会自动按新链路生成。",
        };
    }

    if (/预扣费|余额不足|额度不足|剩余(?:余额|额度)|insufficient.*(?:balance|credit)|remaining.*(?:balance|credit)|request.*(?:needs|requires).*\$/.test(lower) || /预扣费|余额不足|额度不足|剩余(?:余额|额度)/.test(text)) {
        return {
            title: "账户额度不足",
            message: "当前余额不足以发起本次生成，补充额度后再试。",
        };
    }

    if (/no available .*ult|当前模型需要.*账号|model_access_denied|does not have permission/.test(lower)) {
        return {
            title: "当前模型暂不可用",
            message: "当前选择的模型暂时没有可用资源，请切换模型或稍后再试。",
        };
    }

    if (/429|rate limit|too many|频率|限流|排队/.test(lower) || /限流|频率|排队/.test(text)) {
        return { title: "请求太密集", message: "系统已保留节点和提示词，稍等片刻后点重试即可。" };
    }

    if (/public_error_audio_filtered|audio[_ -]?filtered/.test(lower)) {
        return {
            title: "音频生成被模型过滤",
            message: "模型没有通过音频安全或处理检查。请检查口播内容后手动重试。",
        };
    }

    if (isContentPolicyErrorMessage(text) || /no final video url|风控|public_error_(?:unsafe|prominent_people|danger_filter|video_generation_safety)/.test(lower)) {
        return { title: "内容审核未通过", message: "这是模型内容安全限制，请调整提示词或参考图后重试。" };
    }

    if (/timeout|timed out|timed_out|524|504|deadline exceeded|connecttimeout|readtimeout|connection timed out|请求超时|生成超时|上游超时/.test(lower) || /请求超时|生成超时|上游超时/.test(text)) {
        return { title: "生成超时，请重试", message: "素材和参数已保留，可单独重新生成这一张。" };
    }

    if (/flow2api|project-scoped image upload|uploaduserimage|\/flow\/uploadimage|project_id=/.test(lower)) {
        return {
            title: "参考素材暂时无法提交",
            message: "系统未能提交当前参考素材，请稍后重试；仍失败可重新上传素材后再试。",
        };
    }

    if (/401|403|api key|token|permission|unauthorized|forbidden|令牌|权限|未开放/.test(lower) || /令牌|权限|未开放/.test(text)) {
        return { title: "令牌或模型权限不足", message: "检查当前令牌是否可用，或切换到已开放的模型再重试。" };
    }

    if (/404|not_found|model not found|模型不存在|模型不可用/.test(lower) || /模型不存在|模型不可用/.test(text)) {
        return { title: "模型不可用", message: "当前模型暂不可用，切换模型或稍后重试。" };
    }

    if (/reference|storage|mask|lost|missing|参考图片|素材|蒙版|丢失/.test(lower) || /参考图片|素材|蒙版|丢失/.test(text)) {
        return { title: "参考素材丢失", message: "重新上传或重新连接参考图后再生成。" };
    }

    if (/abort|canceled|cancelled|中断|取消/.test(lower) || /中断|取消/.test(text)) {
        return { title: "任务已中断", message: "节点已保留，可以重新生成。" };
    }

    return { title: "生成失败", message: "节点已保留，检查提示词或参考图后可直接重试。" };
}

/**
 * Safe text for toasts and other compact UI. Never pass provider responses
 * through these paths: adapter diagnostics belong in server logs only.
 */
export function canvasNodeErrorMessage(errorDetails?: string) {
    const display = describeCanvasNodeError(errorDetails);
    return display.title === "生成失败" ? display.message : `${display.title}：${display.message}`;
}
