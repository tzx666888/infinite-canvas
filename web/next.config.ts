import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseChangelog } from "@/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const localBuildId = process.env.NEXT_PUBLIC_APP_BUILD_ID || `${localVersion}-${Date.now()}`;

export default function nextConfig(phase: string): NextConfig {
    const isDev = phase === PHASE_DEVELOPMENT_SERVER;
    const releases = parseChangelog(localChangelog);

    return {
        output: "standalone",
        allowedDevOrigins: isDev ? ["*.*.*.*"] : [],
        env: {
            NEXT_PUBLIC_APP_VERSION: localVersion,
            NEXT_PUBLIC_APP_BUILD_ID: localBuildId,
            NEXT_PUBLIC_APP_RELEASES: JSON.stringify(releases),
        },
        async headers() {
            return [
                {
                    source: "/((?!_next/static|_next/image|api/prompts/image|favicon.ico|icon.png|apple-icon.png).*)",
                    headers: [
                        { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
                        { key: "Pragma", value: "no-cache" },
                        { key: "Expires", value: "0" },
                    ],
                },
            ];
        },
    };
}
