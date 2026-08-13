const SENSITIVE_TERMS = [/flow2api/gi, /tokaxis/gi, /oneapi/gi, /new\.yumeng\.co/gi, /ai\.tokaxis\.com/gi, /https?:\/\/[^\s"']+/gi];

export function sanitizeGatewayErrorResponse(text: string, status: number) {
    const rawMessage = errorMessage(parseJson(text)) || plainMessage(text) || `模型服务请求失败（${status}）`;
    const message = sanitizeMessage(rawMessage, status);
    return JSON.stringify({ error: { code: publicErrorCode(rawMessage, status), message }, message });
}

export function sanitizeMessage(value: string, status = 500) {
    let message = value.trim().slice(0, 500);
    for (const pattern of SENSITIVE_TERMS) message = message.replace(pattern, "模型服务");
    message = message.replace(/\b(?:project|channel|upstream|provider|credential|account)[_\s-]*id\s*[=:]\s*[\w-]+/gi, "");
    if (/quota|resource.?exhausted|余额不足|额度不足/i.test(message)) return "当前模型服务额度不足，请稍后重试或更换模型";
    if (/unsafe|moderated|moderation|safety|content.?policy|内容审核|违规|敏感/i.test(message)) return "提交的内容或参考素材未通过安全审核，请调整后重试";
    if (/timeout|timed out|超时/i.test(message)) return "模型服务响应超时，请稍后重试";
    if (/unauthorized|invalid.?key|authentication|forbidden|权限/i.test(message) || status === 401 || status === 403) return "模型服务授权暂时不可用，请联系管理员";
    return message || `模型服务请求失败（${status}）`;
}

function publicErrorCode(message: string, status: number) {
    if (/unsafe|moderated|moderation|safety|content.?policy|内容审核|违规|敏感/i.test(message)) return "content_rejected";
    if (/quota|resource.?exhausted|余额不足|额度不足/i.test(message)) return "model_capacity_unavailable";
    if (/timeout|timed out|超时/i.test(message)) return "model_timeout";
    return status >= 500 ? "model_service_error" : "model_request_rejected";
}

function errorMessage(value: unknown): string {
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of ["error", "message", "msg", "detail", "reason"]) {
        const item = record[key];
        if (typeof item === "string" && item.trim()) return item.trim();
        const nested = errorMessage(item);
        if (nested) return nested;
    }
    return "";
}

function plainMessage(value: string) {
    const text = value.trim();
    return text && text.length < 500 && !text.startsWith("<") ? text : "";
}

function parseJson(value: string) {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
}
