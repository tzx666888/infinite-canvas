export function promptCoverUrl(value?: string) {
    const src = value?.trim();
    if (!src || /^(?:data:|blob:|\/)/i.test(src)) return src || "";
    if (!/^https?:\/\//i.test(src)) return src;
    return `/api/prompts/image?url=${encodeURIComponent(src)}`;
}
