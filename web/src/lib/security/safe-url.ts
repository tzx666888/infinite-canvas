import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

export async function assertSafeHttpUrl(url: URL) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("目标地址协议不受支持");

    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("目标地址不允许访问内网");

    const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("目标地址不允许访问内网");
}

export async function fetchWithSafeRedirects(input: URL, init: RequestInit) {
    let url = input;
    const headers = new Headers(init.headers);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        await assertSafeHttpUrl(url);
        const response = await fetch(url, { ...init, headers, redirect: "manual" });
        if (!REDIRECT_STATUSES.has(response.status)) return response;

        const location = response.headers.get("location");
        if (!location) throw new Error("目标地址重定向无效");
        const nextUrl = new URL(location, url);
        if (nextUrl.origin !== url.origin) headers.delete("Authorization");
        url = nextUrl;
    }

    throw new Error("目标地址重定向次数过多");
}

function isPrivateAddress(address: string) {
    const normalized = address.toLowerCase();
    const ipVersion = isIP(normalized);
    if (ipVersion === 4) {
        const [first, second] = normalized.split(".").map(Number);
        return (
            first === 0 ||
            first === 10 ||
            first === 127 ||
            (first === 100 && second >= 64 && second <= 127) ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) ||
            (first === 198 && (second === 18 || second === 19)) ||
            first >= 224
        );
    }
    if (ipVersion === 6) {
        if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
        return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^(?:fe[89ab]):/.test(normalized);
    }
    return true;
}
