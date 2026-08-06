import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const sourceRoot = process.env.AGENT_VIDEO_SOURCE_ROOT ? pathToFileURL(`${process.env.AGENT_VIDEO_SOURCE_ROOT.replace(/\/$/u, "")}/`) : new URL("../src/", import.meta.url);

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("@/")) {
            const target = new URL(specifier.slice(2), sourceRoot);
            for (const url of [target, new URL(`${target.href}.ts`), new URL(`${target.href}.tsx`)]) {
                if (existsSync(url)) return { url: url.href, shortCircuit: true };
            }
        }
        if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL && !/\.[cm]?[jt]sx?$/u.test(specifier)) {
            for (const suffix of [".ts", ".tsx"]) {
                const target = new URL(`${specifier}${suffix}`, context.parentURL);
                if (existsSync(target)) return { url: target.href, shortCircuit: true };
            }
        }
        return nextResolve(specifier, context);
    },
});
