export type TokaxisIdentity = {
    id: number;
    username: string;
    displayName: string;
    role: number;
};

export function parseTokaxisIdentity(value: unknown): TokaxisIdentity | null {
    if (!value || typeof value !== "object") return null;
    const identity = value as Partial<TokaxisIdentity> & { display_name?: unknown };
    const displayName = typeof identity.displayName === "string" ? identity.displayName : identity.display_name;
    if (
        typeof identity.id !== "number" ||
        !Number.isInteger(identity.id) ||
        identity.id <= 0 ||
        typeof identity.username !== "string" ||
        typeof displayName !== "string" ||
        typeof identity.role !== "number" ||
        !Number.isInteger(identity.role)
    ) {
        return null;
    }
    return { id: identity.id, username: identity.username, displayName, role: identity.role };
}
