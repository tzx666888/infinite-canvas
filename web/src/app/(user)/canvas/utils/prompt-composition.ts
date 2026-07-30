function promptBlocks(value: string) {
    return String(value || "")
        .replace(/\r\n?/g, "\n")
        .split(/\n[ \t]*\n+/)
        .map((block) => block.trim())
        .filter(Boolean);
}

function promptBlockKey(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

export function composePromptWithUpstreamText(prompt: string, upstreamTexts: string[]) {
    const blocks: string[] = [];
    const seen = new Set<string>();

    [...promptBlocks(prompt), ...upstreamTexts.flatMap(promptBlocks)].forEach((block) => {
        const key = promptBlockKey(block);
        if (!key || seen.has(key)) return;
        seen.add(key);
        blocks.push(block);
    });

    return blocks.join("\n\n");
}
