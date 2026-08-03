const CONTENT_POLICY_ERROR_PATTERN =
    /content[_ -]?moderated|content.?policy|policy violation|moderation|audio[_ -]?filtered|danger_filter|prominent_people_filter|safety|unsafe|content filter|nudity|pornograph|sexually explicit|erotic content|裸露|色情|情色|成人内容|性内容|内容政策|安全政策|安全策略|防护限制|内容审核|审核未通过|违规内容|不适当内容|第三方内容相似|违反.{0,12}(?:政策|规定|限制)/i;

export function isContentPolicyErrorMessage(value: unknown) {
    const message = value instanceof Error ? value.message : String(value || "");
    return CONTENT_POLICY_ERROR_PATTERN.test(message.trim());
}
