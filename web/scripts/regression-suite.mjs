import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
// Only these explicitly live/billable integration scripts require a separate authorized environment.
const live = new Set(["test:fusion-live", "test:private-gateway", "test:payment-gateway-e2e"]);
const results = [];
for (const name of Object.keys(scripts).filter(name => name.startsWith("test:") && name !== "test:regression" && !live.has(name))) {
    const result = spawnSync("bun", ["run", name], { encoding: "utf8", timeout: 180_000 });
    results.push({ name, passed: result.status === 0 });
    console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${name}`);
    if (result.status !== 0) console.log(result.stdout, result.stderr, result.error || "");
}
console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, total: results.length, failed: results.filter(r => !r.passed).map(r => r.name) }));
if (results.some(r => !r.passed)) process.exitCode = 1;
