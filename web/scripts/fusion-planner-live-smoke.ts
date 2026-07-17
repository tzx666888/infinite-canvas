import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { buildFusionPlannerMessages } from "../src/lib/fusion-plan-prompt.ts";

const [scenePath, ...rest] = process.argv.slice(2);
const reportFlagIndex = rest.indexOf("--report");
const reportPath = reportFlagIndex >= 0 ? rest[reportFlagIndex + 1] : "";
const productPaths = (reportFlagIndex >= 0 ? rest.slice(0, reportFlagIndex) : rest).filter(Boolean);
const apiKey = process.env.TOKAXIS_API_KEY?.trim();
const endpoint = process.env.FUSION_PLANNER_ENDPOINT || "https://gptimg.tokaxis.com/api/tokaxis/v1/chat/completions";
const model = process.env.FUSION_PLANNER_MODEL || "gpt-5.6-sol";

if (!scenePath || productPaths.length !== 3) {
    throw new Error("Usage: node fusion-planner-live-smoke.ts <scene> <product-1> <product-2> <product-3> [--report <path>]");
}
if (!apiKey) throw new Error("TOKAXIS_API_KEY is required");

const sceneImage = await imageReference(scenePath, "scene");
const productImages = await Promise.all(productPaths.map((path, index) => imageReference(path, `product-${index + 1}`)));
const startedAt = performance.now();
const response = await fetch(endpoint, {
    method: "POST",
    headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    },
    body: JSON.stringify({
        model,
        messages: buildFusionPlannerMessages(sceneImage, productImages, "把三个产品自然摆放在桌面上，保持真实比例并避免互相遮挡。"),
        stream: true,
        max_tokens: 2400,
        temperature: 0.12,
        response_format: { type: "json_object" },
    }),
});
const headersAt = performance.now();
const contentType = response.headers.get("content-type") || "";
if (!response.ok) throw new Error(`Planner request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
if (!contentType.toLowerCase().includes("text/event-stream")) throw new Error(`Expected text/event-stream, received ${contentType || "unknown"}`);

const reader = response.body?.getReader();
if (!reader) throw new Error("Planner response did not include a body stream");
const decoder = new TextDecoder();
let firstChunkAt = 0;
let chunkCount = 0;
let buffer = "";
let content = "";

for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!firstChunkAt) firstChunkAt = performance.now();
    chunkCount += 1;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    events.forEach(consumeEvent);
}
buffer += decoder.decode();
if (buffer.trim()) consumeEvent(buffer);

const completedAt = performance.now();
const plan = JSON.parse(content) as { products?: unknown[]; placements?: Array<{ imageIndex?: number }> };
const imageIndices = plan.placements?.map((placement) => placement.imageIndex) || [];
if (plan.products?.length !== 3 || plan.placements?.length !== 3 || imageIndices.join(",") !== "2,3,4") {
    throw new Error(`Invalid plan shape: products=${plan.products?.length || 0}, placements=${plan.placements?.length || 0}, imageIndices=${imageIndices.join(",")}`);
}

const report = {
    testedAt: new Date().toISOString(),
    endpoint,
    model,
    status: response.status,
    contentType,
    headersMs: rounded(headersAt - startedAt),
    firstChunkMs: rounded((firstChunkAt || completedAt) - startedAt),
    totalMs: rounded(completedAt - startedAt),
    chunkCount,
    productCount: plan.products.length,
    placementCount: plan.placements.length,
    imageIndices,
};

if (reportPath) await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

function consumeEvent(event: string) {
    const dataText = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
    if (!dataText || dataText === "[DONE]") return;
    try {
        const payload = JSON.parse(dataText) as { error?: { message?: string }; choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
        if (payload.error?.message) throw new Error(payload.error.message);
        content += payload.choices?.[0]?.delta?.content || payload.choices?.[0]?.message?.content || "";
    } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
    }
}

async function imageReference(path: string, id: string) {
    const bytes = await readFile(resolve(path));
    const mimeType = mimeTypeForPath(path);
    return { id, dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`, mimeType };
}

function mimeTypeForPath(path: string) {
    const extension = extname(path).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".webp") return "image/webp";
    return "image/png";
}

function rounded(value: number) {
    return Math.round(value * 10) / 10;
}
