const DIRECTOR_PROJECT_MAX_CHARACTERS = 4_000_000;
const DIRECTOR_PANORAMA_MAX_CHARACTERS = 8_000_000;
const DIRECTOR_PANORAMAS_MAX_CHARACTERS = 24_000_000;
const DIRECTOR_PANORAMAS_MAX_COUNT = 8;

export function prepareDirectorSessionPayload(input: { instanceId: string; theme: "dark" | "light"; project?: unknown }) {
    const project = serializableClone(input.project, DIRECTOR_PROJECT_MAX_CHARACTERS);
    return {
        instanceId: input.instanceId,
        theme: input.theme,
        ...(project && typeof project === "object" && !Array.isArray(project) ? { project } : {}),
    };
}

export function prepareDirectorPanoramas<T>(panoramas: T[]) {
    const result: T[] = [];
    let totalCharacters = 0;
    for (const panorama of panoramas.slice(0, DIRECTOR_PANORAMAS_MAX_COUNT)) {
        const cloned = serializableClone(panorama, DIRECTOR_PANORAMA_MAX_CHARACTERS);
        if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) continue;
        const characters = JSON.stringify(cloned).length;
        if (totalCharacters + characters > DIRECTOR_PANORAMAS_MAX_CHARACTERS) break;
        result.push(cloned as T);
        totalCharacters += characters;
    }
    return result;
}

function serializableClone(value: unknown, maxCharacters: number) {
    if (value === undefined || value === null) return undefined;
    try {
        const serialized = JSON.stringify(value);
        if (!serialized || serialized.length > maxCharacters) return undefined;
        return JSON.parse(serialized) as unknown;
    } catch {
        return undefined;
    }
}
