import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);

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
    load(url, context, nextLoad) {
        if (!/\.tsx?$/u.test(url)) return nextLoad(url, context);
        const loaded = nextLoad(url, { ...context, format: "module" });
        const result = ts.transpileModule(String(loaded.source), {
            fileName: new URL(url).pathname,
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        });
        return { format: "module", source: result.outputText, shortCircuit: true };
    },
});
