export type DirectorCameraPresetId = "front" | "close" | "wide" | "overhead" | "low" | "side" | "back";

export type DirectorCameraPreset = {
    id: DirectorCameraPresetId;
    label: string;
    description: string;
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
    prompt: string;
    horizontal: number;
    vertical: number;
    shotSize: DirectorShotSize;
};

export type DirectorShotSize = "extreme close-up" | "close-up" | "medium close-up" | "medium shot" | "medium full shot" | "full shot" | "long shot";

export type DirectorMultiAngleMode = "universal" | "singlePerson" | "action" | "multiPerson";

export type DirectorCharacterBodyType =
    | "male"
    | "female"
    | "broad"
    | "strong"
    | "slim"
    | "teen"
    | "child"
    | "chibi"
    | "geometric";

export type DirectorCharacterPoseId =
    | "stand"
    | "walk"
    | "march"
    | "jog"
    | "run"
    | "crouchWalk"
    | "jump"
    | "jab"
    | "cross"
    | "block"
    | "holdGun"
    | "shoot"
    | "sitTalk"
    | "wave"
    | "point"
    | "pickUp"
    | "dance";

export type DirectorVector3 = {
    x: number;
    y: number;
    z: number;
};

export type DirectorCharacter = {
    id: string;
    name: string;
    bodyType: DirectorCharacterBodyType;
    poseId: DirectorCharacterPoseId;
    visible: boolean;
    locked: boolean;
    color: string;
    position: DirectorVector3;
    rotation: DirectorVector3;
    scale: DirectorVector3;
    uniformScale: number;
};

export type DirectorSceneSettings = {
    sceneZoom: number;
    skyColor: string;
    showGrid: boolean;
    showLabels: boolean;
};

export type DirectorSnapshotPayload = {
    dataUrl: string;
    prompt: string;
    presetId: DirectorCameraPresetId;
    presetLabel: string;
    mode: DirectorMultiAngleMode;
    shotSize: DirectorShotSize;
    horizontal: number;
    vertical: number;
};
