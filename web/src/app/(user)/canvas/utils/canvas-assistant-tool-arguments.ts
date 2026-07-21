type JsonSchema = {
    type?: string | string[];
    enum?: unknown[];
    properties?: Record<string, unknown>;
    required?: unknown;
    additionalProperties?: boolean | unknown;
    items?: unknown;
    minItems?: number;
    minLength?: number;
    minimum?: number;
    maximum?: number;
};

export type ToolArgumentErrorKind = "invalid_args" | "missing_required";

export class ToolArgumentValidationError extends Error {
    readonly errorKind: ToolArgumentErrorKind;
    readonly path: string;

    constructor(errorKind: ToolArgumentErrorKind, message: string, path = "$") {
        super(message);
        this.name = "ToolArgumentValidationError";
        this.errorKind = errorKind;
        this.path = path;
    }
}

type ValidationContext = {
    strippedPaths: string[];
    visitedNodes: number;
};

const MAX_DEPTH = 32;
const MAX_VISITED_NODES = 10_000;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function prepareToolArguments(value: string, schema: unknown) {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value || "{}");
    } catch {
        throw new ToolArgumentValidationError("invalid_args", "工具参数不是合法 JSON 对象");
    }
    if (!isRecord(parsed)) throw new ToolArgumentValidationError("invalid_args", "工具参数必须是 JSON 对象");
    if (!isRecord(schema)) throw new ToolArgumentValidationError("invalid_args", "工具没有可用的参数 schema");

    const context: ValidationContext = { strippedPaths: [], visitedNodes: 0 };
    const args = validateAndCopy(parsed, schema, "$", 0, context);
    if (!isRecord(args)) throw new ToolArgumentValidationError("invalid_args", "工具参数必须是 JSON 对象");
    return { args, strippedPaths: context.strippedPaths, strippedCount: context.strippedPaths.length };
}

function validateAndCopy(value: unknown, rawSchema: unknown, path: string, depth: number, context: ValidationContext): unknown {
    if (depth > MAX_DEPTH || ++context.visitedNodes > MAX_VISITED_NODES) {
        throw new ToolArgumentValidationError("invalid_args", `工具参数过于复杂：${path}`, path);
    }
    if (!isRecord(rawSchema)) throw new ToolArgumentValidationError("invalid_args", `工具参数 schema 无效：${path}`, path);
    const schema = rawSchema as JsonSchema;

    if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
        throw new ToolArgumentValidationError("invalid_args", `工具参数不在允许范围内：${path}`, path);
    }

    const schemaTypes = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
    if (schemaTypes.length && !schemaTypes.some((type) => matchesType(value, type))) {
        throw new ToolArgumentValidationError("invalid_args", `工具参数类型错误：${path}`, path);
    }

    if (schemaTypes.includes("object")) return validateObject(value, schema, path, depth, context);
    if (schemaTypes.includes("array")) return validateArray(value, schema, path, depth, context);
    if (typeof value === "string" && typeof schema.minLength === "number" && value.length < schema.minLength) {
        throw new ToolArgumentValidationError("invalid_args", `工具参数长度不足：${path}`, path);
    }
    if (typeof value === "number") {
        if (typeof schema.minimum === "number" && value < schema.minimum) throw new ToolArgumentValidationError("invalid_args", `工具参数小于最小值：${path}`, path);
        if (typeof schema.maximum === "number" && value > schema.maximum) throw new ToolArgumentValidationError("invalid_args", `工具参数大于最大值：${path}`, path);
    }
    return value;
}

function validateObject(value: unknown, schema: JsonSchema, path: string, depth: number, context: ValidationContext) {
    if (!isRecord(value)) throw new ToolArgumentValidationError("invalid_args", `工具参数类型错误：${path}`, path);
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            const missingPath = propertyPath(path, key);
            throw new ToolArgumentValidationError("missing_required", `缺少必填工具参数：${missingPath}`, missingPath);
        }
    }

    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        const childPath = propertyPath(path, key);
        if (UNSAFE_KEYS.has(key)) {
            context.strippedPaths.push(childPath);
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
            output[key] = validateAndCopy(child, properties[key], childPath, depth + 1, context);
            continue;
        }
        if (schema.additionalProperties === false) {
            context.strippedPaths.push(childPath);
            continue;
        }
        if (isRecord(schema.additionalProperties)) {
            output[key] = validateAndCopy(child, schema.additionalProperties, childPath, depth + 1, context);
            continue;
        }
        output[key] = copyJsonValue(child, childPath, depth + 1, context);
    }
    return output;
}

function validateArray(value: unknown, schema: JsonSchema, path: string, depth: number, context: ValidationContext) {
    if (!Array.isArray(value)) throw new ToolArgumentValidationError("invalid_args", `工具参数类型错误：${path}`, path);
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
        throw new ToolArgumentValidationError("invalid_args", `工具参数数组项目不足：${path}`, path);
    }
    if (!schema.items) return value.map((item, index) => copyJsonValue(item, `${path}[${index}]`, depth + 1, context));
    return value.map((item, index) => validateAndCopy(item, schema.items, `${path}[${index}]`, depth + 1, context));
}

function copyJsonValue(value: unknown, path: string, depth: number, context: ValidationContext): unknown {
    if (depth > MAX_DEPTH || ++context.visitedNodes > MAX_VISITED_NODES) {
        throw new ToolArgumentValidationError("invalid_args", `工具参数过于复杂：${path}`, path);
    }
    if (Array.isArray(value)) return value.map((item, index) => copyJsonValue(item, `${path}[${index}]`, depth + 1, context));
    if (!isRecord(value)) return value;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        const childPath = propertyPath(path, key);
        if (UNSAFE_KEYS.has(key)) {
            context.strippedPaths.push(childPath);
            continue;
        }
        output[key] = copyJsonValue(child, childPath, depth + 1, context);
    }
    return output;
}

function matchesType(value: unknown, type: string) {
    if (type === "object") return isRecord(value);
    if (type === "array") return Array.isArray(value);
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    if (type === "null") return value === null;
    return typeof value === type;
}

function propertyPath(parent: string, key: string) {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
