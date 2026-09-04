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
const commonSecurityHeaders = [
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self), usb=()" },
    {
        key: "Content-Security-Policy",
        value: "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self' https://api.payqixiang.cn; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' blob: https: wss:; worker-src 'self' blob:; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'none'",
    },
];
const directorSecurityHeaders = commonSecurityHeaders.map((header) =>
    header.key === "Content-Security-Policy" ? { ...header, value: header.value.replace("frame-ancestors 'none'", "frame-ancestors 'self'") } : header,
);

export default function nextConfig(phase: string): NextConfig {
    const isDev = phase === PHASE_DEVELOPMENT_SERVER;
    const releases = parseChangelog(localChangelog);

    return {
        output: "standalone",
        poweredByHeader: false,
        serverExternalPackages: ["better-sqlite3"],
        allowedDevOrigins: isDev ? ["*.*.*.*"] : [],
        env: {
            NEXT_PUBLIC_APP_VERSION: localVersion,
            NEXT_PUBLIC_APP_BUILD_ID: localBuildId,
            NEXT_PUBLIC_APP_RELEASES: JSON.stringify(releases),
        },
        async headers() {
            return [
                {
                    source: "/director/:path*",
                    headers: [
                        { key: "X-Frame-Options", value: "SAMEORIGIN" },
                        ...directorSecurityHeaders,
                    ],
                },
                {
                    source: "/((?!_next/static|_next/image|api/prompts/image|director|favicon.ico|icon.png|apple-icon.png).*)",
                    headers: [
                        { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
                        { key: "Pragma", value: "no-cache" },
                        { key: "Expires", value: "0" },
                        { key: "X-Frame-Options", value: "DENY" },
                        ...commonSecurityHeaders,
                    ],
                },
            ];
        },
    };
}
