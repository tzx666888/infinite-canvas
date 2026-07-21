#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const DEFAULT_HOST_DIRECTORY = "/opt/infinite-canvas-data/telemetry";
const CAPABILITIES = [
    { id: 1, name: "优化提示词", patterns: [/(?:优化|润色|改写|改进).{0,12}(?:提示词|prompt)|(?:prompt).{0,12}(?:optimi[sz]e|polish|rewrite)/i] },
    { id: 2, name: "产品拆解", patterns: [/产品拆解|商品拆解|product\s*(?:breakdown|decomposition)/i] },
    { id: 3, name: "场景扩展", patterns: [/场景扩展|扩展.{0,8}场景|scene\s*(?:expansion|variation)/i] },
    { id: 4, name: "视频分镜", patterns: [/视频分镜|分镜|十二宫格|12\s*(?:格|panel)|storyboard/i] },
    { id: 5, name: "视频生成提示词", patterns: [/视频.{0,8}提示词|生成.{0,8}视频\s*prompt|video\s*prompt|grok.{0,8}prompt/i] },
    { id: 6, name: "一键流水线", patterns: [/一键.{0,8}(?:流水线|生成|处理)|全流程|流水线|pipeline/i] },
    { id: 7, name: "视频反推", patterns: [/视频反推|反推.{0,8}视频|从视频.{0,8}(?:提示词|prompt)|reverse.{0,8}video/i] },
    { id: 8, name: "批量排版", patterns: [/批量排版|自动排版|整理.{0,8}布局|auto.?layout|arrange.{0,8}nodes/i], tools: ["canvas_move_nodes"] },
    { id: 9, name: "批量连线", patterns: [/批量连线|一对多.{0,8}连线|全部连上|connect.{0,8}(?:all|multiple|nodes)/i], tools: ["canvas_connect_nodes"] },
    { id: 10, name: "多尺寸适配", patterns: [/多尺寸|尺寸适配|竖版.{0,12}方形.{0,12}横版|9\s*:\s*16.{0,20}1\s*:\s*1.{0,20}16\s*:\s*9|multi.?size/i] },
    { id: 11, name: "套图生成", patterns: [/套图|白底主图.{0,20}场景.{0,20}(?:细节|包装)|(?:hero|white.?background).{0,20}(?:detail|packaging).{0,20}(?:image|shot)/i] },
    { id: 12, name: "文案生成", patterns: [/生成.{0,8}(?:营销|广告|电商)?文案|营销文案|copywriting|marketing\s*copy/i] },
    { id: 13, name: "竞品分析", patterns: [/竞品分析|竞争对手|对标素材|competitor\s*analysis/i] },
    { id: 14, name: "A/B 测试图", patterns: [/(?:a\s*\/\s*b|a\s*-\s*b|ab)\s*(?:测试|对比)|测试图|split\s*test/i] },
    { id: 15, name: "智能配色", patterns: [/智能配色|主色调|背景色.{0,12}点缀色|配色方案|color\s*(?:palette|scheme)/i] },
];
const TECHNICAL_ERROR_KINDS = new Set([
    "timeout",
    "rate_limited",
    "auth_failed",
    "network",
    "invalid_args",
    "exec_failed",
    "planner_failed",
    "partial_failure",
    "cancelled",
    "user_cancelled",
]);

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
}

const inputs = args.filter((value) => !value.startsWith("--"));
const targets = inputs.length
    ? inputs
    : process.env.TELEMETRY_DIR
      ? [process.env.TELEMETRY_DIR]
      : [DEFAULT_HOST_DIRECTORY, join(tmpdir(), "infinite-canvas-telemetry")];
const files = await collectFiles(targets);
const eventCounts = new Map();
const capabilityCounts = new Map(CAPABILITIES.map((capability) => [capability.id, 0]));
const toolTotals = new Map();
const toolFailures = new Map();
const regenerationGroups = new Map();
const technicalRetryGroups = new Map();
const regenerationScopes = new Map();
const agentScopes = new Map();
const completedAgentSessions = [];
const edits = [];
let invalidLines = 0;
let unreadableFiles = 0;
let totalLines = 0;
let validEvents = 0;
let agentTurnCount = 0;
let unclassifiedTurns = 0;
let zeroOps = 0;
let unattributedRegenerationSignals = 0;
let earliestTimestamp = Number.POSITIVE_INFINITY;
let latestTimestamp = Number.NEGATIVE_INFINITY;

for (const file of files) {
    try {
        const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
        for await (const line of lines) {
            if (!line.trim()) continue;
            totalLines += 1;
            try {
                const event = JSON.parse(line);
                if (!event || typeof event !== "object" || Array.isArray(event)) {
                    invalidLines += 1;
                    continue;
                }
                validEvents += 1;
                processEvent(event);
            } catch {
                invalidLines += 1;
            }
        }
    } catch {
        unreadableFiles += 1;
    }
}

for (const scope of agentScopes.values()) closeAgentSegment(scope);
let unpairedRegenerationSignals = 0;
for (const scope of regenerationScopes.values()) unpairedRegenerationSignals += scope.pending.length;

const failureRows = [...toolFailures.entries()]
    .map(([key, failures]) => {
        const [name, errorKind] = key.split("\u0000");
        const total = toolTotals.get(name) || 0;
        return { name, errorKind, failures, total, rate: total ? failures / total : 0 };
    })
    .sort((a, b) => b.rate - a.rate || b.failures - a.failures || a.name.localeCompare(b.name));

const regenerationRows = [...regenerationGroups.entries()]
    .map(([group, counts]) => {
        const eligibleAttempts = Math.max(0, counts.attempts - counts.technicalRetries);
        return {
            group,
            attempts: counts.attempts,
            eligibleAttempts,
            qualityRegenerations: counts.qualityRegenerations,
            rate: eligibleAttempts ? counts.qualityRegenerations / eligibleAttempts : 0,
        };
    })
    .sort((a, b) => b.rate - a.rate || b.qualityRegenerations - a.qualityRegenerations || a.group.localeCompare(b.group));

const technicalRetryRows = [...technicalRetryGroups.entries()]
    .map(([key, retries]) => {
        const separator = key.lastIndexOf("\u0000");
        return { group: key.slice(0, separator), errorKind: key.slice(separator + 1), retries };
    })
    .sort((a, b) => b.retries - a.retries || a.group.localeCompare(b.group) || a.errorKind.localeCompare(b.errorKind));

const averageTurns = completedAgentSessions.length
    ? completedAgentSessions.reduce((sum, value) => sum + value, 0) / completedAgentSessions.length
    : 0;

console.log("画布 Agent 行为埋点报表");
console.log(`输入: ${targets.map((target) => resolve(target)).join(", ")}`);
console.log(`文件: ${files.length} | 无法读取: ${unreadableFiles} | 有效事件: ${validEvents} | 无效行: ${invalidLines} | 总非空行: ${totalLines}`);
console.log(
    `时间范围: ${Number.isFinite(earliestTimestamp) ? `${new Date(earliestTimestamp).toISOString()} .. ${new Date(latestTimestamp).toISOString()}` : "N/A"}`,
);
console.log("");

console.log("事件数量");
printTable(["eventType", "count"], sortedEntries(eventCounts).map(([name, count]) => [name, count]));
if (!eventCounts.size) console.log("（无事件）");
console.log("");

console.log("15 项能力使用分布（toolCalls + 用户消息规则聚类，多标签，合计可大于 Agent turn 数）");
printTable(
    ["#", "capability", "turns", "share"],
    CAPABILITIES.map((capability) => {
        const count = capabilityCounts.get(capability.id) || 0;
        return [capability.id, capability.name, count, percent(count, agentTurnCount)];
    }),
);
console.log(`未归类 Agent turn: ${unclassifiedTurns}/${agentTurnCount} (${percent(unclassifiedTurns, agentTurnCount)})`);
console.log("");

console.log("工具调用失败率排行（name + errorKind）");
printTable(
    ["tool", "errorKind", "failures", "toolCalls", "failureRate"],
    failureRows.map((row) => [row.name, row.errorKind, row.failures, row.total, percent(row.failures, row.total)]),
);
if (!failureRows.length) console.log("（无失败工具调用）");
console.log("");

console.log("各 sourceKind / templateId 的质量重生成尝试率");
console.log("口径: 同 sessionId + canvasId 按事件顺序，用下一条 generation 确认 node_regenerated 已形成重试，但将质量/技术重试归因到信号发生前最近一条 generation 的 sourceKind/templateId（旧稿来源）。分子是旧稿触发的质量重试动作数，分母是该来源的 generation 尝试数，并排除随后发生技术失败/主动取消重试的旧稿尝试；不是按唯一节点计算。该结果是无节点 ID 条件下的时序启发式估算。");
printTable(
    ["group", "allAttempts", "qualityEligible", "qualityRegens", "rate"],
    regenerationRows.map((row) => [row.group, row.attempts, row.eligibleAttempts, row.qualityRegenerations, percent(row.qualityRegenerations, row.eligibleAttempts)]),
);
if (!regenerationRows.length) console.log("（无可计算的 generation 事件）");
console.log(`未配对 node_regenerated: ${unpairedRegenerationSignals}`);
console.log(`已配对但缺少前序 generation、无法归因: ${unattributedRegenerationSignals}`);
console.log("");

console.log("技术失败后的重试（从质量重生成率中剥离）");
printTable(["group", "previousErrorKind", "retries"], technicalRetryRows.map((row) => [row.group, row.errorKind, row.retries]));
if (!technicalRetryRows.length) console.log("（无技术失败后重试）");
console.log("");

console.log("Agent 会话质量（同页面 sessionId + canvasId，turnIndex 回落或重置时分段估算）");
console.log(`Agent 会话数: ${completedAgentSessions.length}`);
console.log(`平均轮数: ${averageTurns.toFixed(2)}`);
console.log(`opsCount=0 空转: ${zeroOps}/${agentTurnCount} (${percent(zeroOps, agentTurnCount)})`);
console.log("");

console.log(`prompt_edited 样本导出（NDJSON，${edits.length} 条）`);
for (const event of edits) console.log(JSON.stringify(event));

function processEvent(event) {
    const eventType = string(event.eventType) || "unknown";
    eventCounts.set(eventType, (eventCounts.get(eventType) || 0) + 1);
    const timestamp = timestampNumber(event.ts);
    if (Number.isFinite(timestamp)) {
        earliestTimestamp = Math.min(earliestTimestamp, timestamp);
        latestTimestamp = Math.max(latestTimestamp, timestamp);
    }

    if (eventType === "agent_turn") processAgentTurn(event);
    if (eventType === "generation" || eventType === "node_regenerated") processGenerationTimeline(event);
    if (eventType === "prompt_edited") {
        edits.push({
            ts: event.ts,
            previousSourceKind: event.previousSourceKind,
            regenerated: event.regenerated,
            beforeText: event.beforeText,
            afterText: event.afterText,
        });
    }
}

function processAgentTurn(turn) {
    agentTurnCount += 1;
    if (number(turn.opsCount) === 0) zeroOps += 1;

    const message = string(turn.userMessageText);
    const tools = new Set(array(turn.toolCalls).map((call) => string(call?.name)).filter(Boolean));
    const matches = CAPABILITIES.filter(
        (capability) => capability.patterns.some((pattern) => pattern.test(message)) || capability.tools?.some((tool) => tools.has(tool)),
    );
    if (!matches.length) unclassifiedTurns += 1;
    matches.forEach((capability) => capabilityCounts.set(capability.id, (capabilityCounts.get(capability.id) || 0) + 1));

    for (const call of array(turn.toolCalls)) {
        const name = string(call?.name) || "unknown";
        toolTotals.set(name, (toolTotals.get(name) || 0) + 1);
        if (call?.ok === false) {
            const errorKind = string(call?.errorKind) || "unknown";
            const key = `${name}\u0000${errorKind}`;
            toolFailures.set(key, (toolFailures.get(key) || 0) + 1);
        }
    }

    const scopeKey = scopeFor(turn);
    const turnIndex = number(turn.turnIndex);
    let scope = agentScopes.get(scopeKey);
    if (!scope) {
        scope = { lastIndex: 0, currentMax: 0, currentCount: 0 };
        agentScopes.set(scopeKey, scope);
    }
    if (turnIndex > 0 && scope.lastIndex > 0 && turnIndex <= scope.lastIndex) closeAgentSegment(scope);
    scope.currentCount += 1;
    scope.currentMax = Math.max(scope.currentMax, turnIndex);
    if (turnIndex > 0) scope.lastIndex = turnIndex;
}

function closeAgentSegment(scope) {
    if (scope.currentCount > 0) completedAgentSessions.push(scope.currentMax || scope.currentCount);
    scope.lastIndex = 0;
    scope.currentMax = 0;
    scope.currentCount = 0;
}

function processGenerationTimeline(event) {
    const scopeKey = scopeFor(event);
    let scope = regenerationScopes.get(scopeKey);
    if (!scope) {
        scope = { lastGeneration: null, pending: [] };
        regenerationScopes.set(scopeKey, scope);
    }

    if (event.eventType === "node_regenerated") {
        scope.pending.push({ previousGeneration: scope.lastGeneration });
        return;
    }

    const groups = generationGroupKeys(event);
    for (const group of groups) getRegenerationCounts(group).attempts += 1;

    const pending = scope.pending.shift();
    if (pending) {
        const previous = pending.previousGeneration;
        if (!previous) {
            unattributedRegenerationSignals += 1;
        } else {
            const previousErrorKind = string(previous.errorKind);
            const technicalRetry = previous.ok === false && TECHNICAL_ERROR_KINDS.has(previousErrorKind);
            for (const group of previous.groups) {
                const counts = getRegenerationCounts(group);
                if (technicalRetry) {
                    counts.technicalRetries += 1;
                    const key = `${group}\u0000${previousErrorKind}`;
                    technicalRetryGroups.set(key, (technicalRetryGroups.get(key) || 0) + 1);
                } else {
                    counts.qualityRegenerations += 1;
                }
            }
        }
    }
    scope.lastGeneration = { ok: event.ok, errorKind: event.errorKind, groups };
}

function generationGroupKeys(event) {
    const sourceKind = string(event.sourceKind) || "unknown";
    const templateId = string(event.templateId);
    return [`sourceKind=${sourceKind}`, ...(templateId ? [`templateId=${templateId} (sourceKind=${sourceKind})`] : [])];
}

function getRegenerationCounts(group) {
    if (!regenerationGroups.has(group)) regenerationGroups.set(group, { attempts: 0, qualityRegenerations: 0, technicalRetries: 0 });
    return regenerationGroups.get(group);
}

function scopeFor(event) {
    return `${string(event.sessionId) || "unknown-session"}\u0000${string(event.canvasId) || "unknown-canvas"}`;
}

async function collectFiles(paths) {
    const output = [];
    for (const input of paths) {
        const path = resolve(input);
        let info;
        try {
            info = await stat(path);
        } catch {
            continue;
        }
        if (info.isFile()) {
            output.push(path);
            continue;
        }
        if (!info.isDirectory()) continue;
        const names = await readdir(path);
        output.push(...names.filter((name) => /^events-\d{8}\.jsonl$/.test(name)).map((name) => join(path, name)));
    }
    return [...new Set(output)].sort((a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b));
}

function printHelp() {
    console.log("用法: node scripts/telemetry-report.mjs [宿主机埋点目录或 JSONL 文件 ...]");
    console.log("");
    console.log(`生产宿主机示例: node scripts/telemetry-report.mjs ${DEFAULT_HOST_DIRECTORY}`);
    console.log(`未传参数时优先读取 TELEMETRY_DIR；若未设置，则同时探测宿主机目录 ${DEFAULT_HOST_DIRECTORY} 和本地临时目录。`);
    console.log(`容器内挂载路径是 /app/data/telemetry；本地开发端点默认目录是 ${join(tmpdir(), "infinite-canvas-telemetry")}。不存在的目录会自动跳过。`);
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

function string(value) {
    return typeof value === "string" ? value : "";
}

function number(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function timestampNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return Number.NaN;
    return new Date(value).getTime();
}

function sortedEntries(map) {
    return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function percent(value, total) {
    return total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
}

function printTable(headers, rows) {
    if (!rows.length) return;
    const textRows = [headers, ...rows].map((row) => row.map((cell) => String(cell)));
    const widths = headers.map((_, index) => Math.max(...textRows.map((row) => displayWidth(row[index] || ""))));
    textRows.forEach((row, rowIndex) => {
        console.log(row.map((cell, index) => cell + " ".repeat(widths[index] - displayWidth(cell))).join("  "));
        if (rowIndex === 0) console.log(widths.map((width) => "-".repeat(width)).join("  "));
    });
}

function displayWidth(value) {
    return [...value].reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1), 0);
}
