const CONTENT_POLICY_ERROR_PATTERN =
    /content[_ -]?moderated|content.?policy|policy violation|moderation|audio[_ -]?filtered|danger_filter|prominent_people_filter|safety|unsafe|privacy check|content filter|nudity|pornograph|sexually explicit|erotic content|裸露|色情|情色|成人内容|性内容|内容政策|安全政策|安全策略|隐私检查|隐私审核|防护限制|内容审核|审核未通过|违规内容|不适当内容|第三方内容相似|违反.{0,12}(?:政策|规定|限制)/i;

const IDENTIFIABLE_PERSON_REFERENCE_ERROR_PATTERN =
    /reference_image_unsafe|reference_person_safety|identifiable_person_safety|prominent_people|privacy check|参考图.{0,16}(?:可识别真人|隐私|肖像|安全审核)|可识别真人|隐私检查|隐私审核|肖像保护/i;

export function isContentPolicyErrorMessage(value: unknown) {
    const message = value instanceof Error ? value.message : String(value || "");
    return CONTENT_POLICY_ERROR_PATTERN.test(message.trim());
}

export function isIdentifiablePersonReferenceErrorMessage(value: unknown) {
    const message = value instanceof Error ? value.message : String(value || "");
    return IDENTIFIABLE_PERSON_REFERENCE_ERROR_PATTERN.test(message.trim());
}
