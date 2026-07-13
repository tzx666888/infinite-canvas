import type { DirectorMultiAngleMode, DirectorShotSize } from "./director-types";

export const DIRECTOR_MULTI_ANGLE_MODES: { id: DirectorMultiAngleMode; label: string; hint: string }[] = [
    { id: "universal", label: "通用", hint: "大多数图先试这个，整体最稳" },
    { id: "singlePerson", label: "单人", hint: "单人图更稳住身份、脸和朝向" },
    { id: "action", label: "动作", hint: "动作图更稳住姿势、手势和肢体" },
    { id: "multiPerson", label: "多人", hint: "双人/多人图更稳住人数和关系" },
];

export const DIRECTOR_SHOT_SIZES: { id: DirectorShotSize; label: string; prompt: string }[] = [
    { id: "extreme close-up", label: "特写", prompt: "extreme close-up, ECU, detail shot, intimate framing" },
    { id: "close-up", label: "近景", prompt: "close-up, CU, headshot, emotional portrait, tight framing" },
    { id: "medium close-up", label: "中近景", prompt: "medium close-up, MCU, chest up framing, conversational shot" },
    { id: "medium shot", label: "中景", prompt: "medium shot, MS, waist up framing, standard coverage" },
    { id: "medium full shot", label: "中全景", prompt: "medium full shot, MFS, three-quarter length, knees up framing" },
    { id: "full shot", label: "全景", prompt: "full shot, FS, full body in frame, environmental context" },
    { id: "long shot", label: "远景", prompt: "long shot, LS, establishing shot, wide establishing, extreme wide" },
];

function applyTemplate(template: string, values: Record<string, string>): string {
    const rendered = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? "");
    return rendered
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .join(", ");
}

function buildMultiAnglePromptFromTemplate(input: { template: string; consistencyPrompt: string; presetPrompt: string; horizontalPrompt: string; verticalPrompt: string; shotSizePrompt: string; cameraMeta: string }): string {
    return applyTemplate(input.template, {
        consistencyPrompt: input.consistencyPrompt,
        presetPrompt: input.presetPrompt,
        horizontalPrompt: input.horizontalPrompt,
        verticalPrompt: input.verticalPrompt,
        shotSizePrompt: input.shotSizePrompt,
        cameraMeta: input.cameraMeta,
    });
}

function resolveModePrompt(mode: DirectorMultiAngleMode): string {
    switch (mode) {
        case "singlePerson":
            return "single person only, preserve the same face identity, facial structure, hairstyle, clothing silhouette, and portrait likeness";
        case "action":
            return "preserve the original action moment, gesture silhouette, body pose, limb placement, hand structure, and shoulder-arm connection, no missing limbs or fused hands";
        case "multiPerson":
            return "keep exactly the same number of people as the reference image, and when the source is a two-person confrontation preserve exactly one left subject and one right subject only, preserve each character as a separate individual with stable identity, preserve left-right order, relative distance, facing direction, eyeline relationship, and confrontation geometry, no extra people, no duplicated people, no cloned faces or bodies, no mirrored extra pair, no repeated confrontation pair, no duplicated opponent, no identity swapping between subjects, no merged characters, and no collapsed two-person scene into one person";
        default:
            return "preserve the main subject, overall scene identity, and composition logic from the input image";
    }
}

function resolveModeCameraConstraint(mode: DirectorMultiAngleMode): string {
    switch (mode) {
        case "singlePerson":
            return "prioritize facial identity and correct head rotation for the requested camera angle";
        case "action":
            return "prioritize body action fidelity and anatomically correct pose changes over stylized reinterpretation";
        case "multiPerson":
            return "prioritize exact subject count, stable per-subject identity, clear per-person separation, and confrontation relationship fidelity over stylized composition changes";
        default:
            return "balance identity, scene continuity, and camera-angle fidelity";
    }
}

function resolveModeShotPrompt(mode: DirectorMultiAngleMode): string {
    switch (mode) {
        case "singlePerson":
            return "do not accidentally convert the image into a generic ID photo or beauty portrait";
        case "action":
            return "do not collapse the image into a static portrait study";
        case "multiPerson":
            return "do not collapse the scene into a single-person portrait, do not duplicate the group, and do not replace a confrontation pair with mirrored, cloned, identity-swapped, or overlapping fused subjects";
        default:
            return "do not replace the scene with a generic restaged portrait";
    }
}

function resolveCameraMeta(horizontal: number, vertical: number, mode: DirectorMultiAngleMode): string {
    return `[camera H:${horizontal}° V:${vertical}° mode:${mode}]`;
}

function resolveConsistencyPrompt(horizontal: number, vertical: number, mode: DirectorMultiAngleMode): string {
    const normalizedHorizontal = ((horizontal % 360) + 360) % 360;
    const horizontalAllowancePrompt =
        normalizedHorizontal >= 165 && normalizedHorizontal <= 195
            ? "rotate the subject into a real back-facing composition, head and torso turned away together, no frontal face visible, no cheating eye contact"
            : normalizedHorizontal >= 105 && normalizedHorizontal < 165
              ? "allow natural rotation into a rear three-quarter composition, with facial features mostly hidden from camera"
              : normalizedHorizontal >= 75 && normalizedHorizontal <= 105
                ? "rotate the subject into a true profile side view, head and torso aligned, only one side of the face visible, not looking toward camera"
                : normalizedHorizontal > 195 && normalizedHorizontal < 255
                  ? "allow natural rotation into a rear three-quarter composition from the opposite side, with facial features mostly hidden from camera"
                  : normalizedHorizontal > 15 && normalizedHorizontal < 345
                    ? "allow subtle pose and head-turn changes for the requested camera orbit while keeping the same subject and scene"
                    : "keep the pose close to the source image while changing camera angle";

    const verticalAllowancePrompt =
        vertical >= 45
            ? "viewer is clearly above the subject, keep the subject seen from above, eyes should not look into the camera, gaze should stay downward or away, do not lift the chin or tilt the face up to fake a frontal view"
            : vertical <= -25
              ? "viewer is clearly below the subject, allow natural low-angle perspective while keeping body orientation consistent"
              : "keep the perspective close to the source image";

    return [
        "this is a camera-angle edit of the reference image: the same scene, same people, same action, viewed from a different viewer angle",
        "the following instructions describe only where the viewer is looking from, they are not new objects to add to the scene",
        "do not add any camera, lens, tripod, viewfinder, screen, or photography equipment into the image",
        "your job is to preserve the original people, action, scene, and relationship structure and only change the viewer angle and shot framing",
        "the output must stay in the same world and same moment as the reference image, not a different person, not a different place",
        "preserve identity, outfit, hairstyle, and the overall scene from the input image",
        resolveModePrompt(mode),
        "preserve body pose, hand gesture, limb placement, and action from the input image",
        "preserve complete anatomy, especially hands, arms, shoulders, and body connections, with no missing limbs, fused hands, or malformed gesture silhouettes",
        "if multiple people are present, preserve the same number of people, keep each person as a clearly separate individual, preserve their left-right order, relative spacing, facing direction, eyeline relationship, confrontation geometry, and subject-to-subject separation, do not merge characters, do not replace one subject with another, do not duplicate or clone any subject, do not create an extra mirrored or repeated opponent, and do not collapse a two-person confrontation into a single dominant subject",
        "keep background, lighting, and color mood broadly consistent while changing viewer angle and framing",
        resolveModeCameraConstraint(mode),
        "interpret the requested horizontal angle, vertical angle, shot size, and preset as instructions for where the viewer is looking from, not as objects inside the image",
        resolveModeShotPrompt(mode),
        horizontalAllowancePrompt,
        verticalAllowancePrompt,
    ].join(", ");
}

function resolveHorizontalPrompt(horizontal: number): string {
    const normalizedHorizontal = ((horizontal % 360) + 360) % 360;
    if (normalizedHorizontal >= 345 || normalizedHorizontal <= 15) return "frontal portrait view, straight-on viewer angle";
    if (normalizedHorizontal > 15 && normalizedHorizontal < 75) return "front three-quarter portrait view, partial side rotation, head and torso turning together";
    if (normalizedHorizontal >= 75 && normalizedHorizontal <= 105) return "true side-profile portrait view, 90 degree profile angle, only one side of the face visible";
    if (normalizedHorizontal > 105 && normalizedHorizontal < 165) return "rear three-quarter portrait view, viewer positioned behind the subject, face mostly hidden";
    if (normalizedHorizontal >= 165 && normalizedHorizontal <= 195) return "back-view portrait, viewer positioned directly behind the subject, zero facial features visible";
    if (normalizedHorizontal > 195 && normalizedHorizontal < 255) return "rear three-quarter portrait view from the opposite side, face mostly hidden";
    if (normalizedHorizontal >= 255 && normalizedHorizontal <= 285) return "true side-profile portrait view from the opposite side, 90 degree profile angle";
    return "front three-quarter portrait view from the opposite side, head and torso turning together";
}

function resolveVerticalPrompt(vertical: number): string {
    if (vertical >= 60) return "strong overhead perspective, steep high angle, subject seen from above, eyes looking downward or away, no direct eye contact with the viewer";
    if (vertical >= 30) return "high-angle perspective, viewer positioned above the subject, gaze lowered or turned away, avoid direct eye contact";
    if (vertical <= -45) return "strong low-angle perspective, viewer looking up from below";
    if (vertical <= -15) return "low-angle perspective, viewer slightly below the subject";
    return "eye-level perspective";
}

export function buildDirectorMultiAnglePrompt(horizontal: number, vertical: number, shotSize: DirectorShotSize, mode: DirectorMultiAngleMode = "universal", presetPrompt = ""): string {
    return buildMultiAnglePromptFromTemplate({
        template: "{{consistencyPrompt}}, {{presetPrompt}}, {{horizontalPrompt}}, {{verticalPrompt}}, {{shotSizePrompt}}, {{cameraMeta}}",
        consistencyPrompt: resolveConsistencyPrompt(horizontal, vertical, mode),
        presetPrompt,
        horizontalPrompt: resolveHorizontalPrompt(horizontal),
        verticalPrompt: resolveVerticalPrompt(vertical),
        shotSizePrompt: DIRECTOR_SHOT_SIZES.find((shot) => shot.id === shotSize)?.prompt ?? "",
        cameraMeta: resolveCameraMeta(horizontal, vertical, mode),
    });
}
