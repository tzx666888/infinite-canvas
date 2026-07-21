import assert from "node:assert/strict";
import test from "node:test";

import { prepareToolArguments, ToolArgumentValidationError } from "../src/app/(user)/canvas/utils/canvas-assistant-tool-arguments.ts";

const generateTextSchema = {
    type: "object",
    properties: {
        prompt: { type: "string" },
        title: { type: "string" },
    },
    required: ["prompt"],
    additionalProperties: false,
};

test("strips unknown top-level keys and keeps declared arguments", () => {
    const result = prepareToolArguments(JSON.stringify({ prompt: "竞品分析", title: "报告", mode: "text" }), generateTextSchema);

    assert.deepEqual(result.args, { prompt: "竞品分析", title: "报告" });
    assert.equal(result.strippedCount, 1);
    assert.deepEqual(result.strippedPaths, ["$.mode"]);
});

test("reports a missing required argument with a stable error kind", () => {
    assert.throws(
        () => prepareToolArguments(JSON.stringify({ title: "报告" }), generateTextSchema),
        (error: unknown) => error instanceof ToolArgumentValidationError && error.errorKind === "missing_required" && error.path === "$.prompt",
    );
});

test("validates and strips recursively inside arrays", () => {
    const schema = {
        type: "object",
        properties: {
            ops: {
                type: "array",
                minItems: 1,
                items: {
                    type: "object",
                    properties: { type: { type: "string", enum: ["add_node"] }, title: { type: "string" } },
                    required: ["type"],
                    additionalProperties: false,
                },
            },
        },
        required: ["ops"],
        additionalProperties: false,
    };
    const result = prepareToolArguments(JSON.stringify({ ops: [{ type: "add_node", title: "A", surprise: 1 }], topLevelExtra: true }), schema);

    assert.deepEqual(result.args, { ops: [{ type: "add_node", title: "A" }] });
    assert.deepEqual(result.strippedPaths, ["$.ops[0].surprise", "$.topLevelExtra"]);
});

test("rejects wrong types, enum values, and arrays below minItems", () => {
    const schema = {
        type: "object",
        properties: {
            direction: { type: "string", enum: ["row", "column"] },
            ids: { type: "array", minItems: 1, items: { type: "string" } },
        },
        required: ["direction", "ids"],
        additionalProperties: false,
    };

    for (const value of [{ direction: "diagonal", ids: ["1"] }, { direction: "row", ids: [] }, { direction: "row", ids: [1] }]) {
        assert.throws(
            () => prepareToolArguments(JSON.stringify(value), schema),
            (error: unknown) => error instanceof ToolArgumentValidationError && error.errorKind === "invalid_args",
        );
    }
});

test("preserves declared open records while stripping prototype-related keys", () => {
    const schema = {
        type: "object",
        properties: { metadata: { type: "object", additionalProperties: true } },
        required: ["metadata"],
        additionalProperties: false,
    };
    const result = prepareToolArguments('{"metadata":{"safe":1,"__proto__":{"polluted":true},"nested":{"constructor":"bad","ok":true}}}', schema);

    assert.deepEqual(result.args, { metadata: { safe: 1, nested: { ok: true } } });
    assert.deepEqual(result.strippedPaths, ["$.metadata.__proto__", "$.metadata.nested.constructor"]);
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});
