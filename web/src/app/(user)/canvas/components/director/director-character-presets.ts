import type {
    DirectorCharacter,
    DirectorCharacterBodyType,
    DirectorCharacterPoseId,
    DirectorSceneSettings,
} from "./director-types";

export type DirectorBodyTypePreset = {
    id: DirectorCharacterBodyType;
    label: string;
    description: string;
};

export type DirectorPosePreset = {
    id: DirectorCharacterPoseId;
    label: string;
    action: string;
    description: string;
};

export type DirectorPoseGroup = {
    id: string;
    label: string;
    poses: DirectorPosePreset[];
};

export const DIRECTOR_BODY_TYPES: DirectorBodyTypePreset[] = [
    { id: "male", label: "男性素体", description: "标准男性比例" },
    { id: "female", label: "女性素体", description: "窄肩、轻量比例" },
    { id: "broad", label: "宽厚素体", description: "宽肩厚身体型" },
    { id: "strong", label: "健壮素体", description: "力量感更强" },
    { id: "slim", label: "纤细素体", description: "修长轻薄比例" },
    { id: "teen", label: "少年素体", description: "略矮、轻量比例" },
    { id: "child", label: "儿童素体", description: "小体型、大头比例" },
    { id: "chibi", label: "二头身", description: "夸张可爱比例" },
    { id: "geometric", label: "几何模型", description: "方块关节模型" },
];

// These pose labels map to the original CineFlow keyword pose engine.
// For requested poses that do not exist as separate original bone data, we reuse
// the closest original keyword transform instead of inventing new joint angles.
export const DIRECTOR_POSE_GROUPS: DirectorPoseGroup[] = [
    {
        id: "movement",
        label: "基础移动",
        poses: [
            { id: "stand", label: "停住", action: "站立", description: "原版站立绑定姿势" },
            { id: "walk", label: "走路", action: "行走", description: "原版行走骨骼姿势" },
            { id: "march", label: "正步", action: "行走 正步", description: "复用原版行走骨骼姿势" },
            { id: "jog", label: "慢跑", action: "慢跑", description: "复用原版跑步关键词姿势" },
            { id: "run", label: "奔跑", action: "奔跑", description: "原版奔跑骨骼姿势" },
            { id: "crouchWalk", label: "蹲走", action: "蹲走", description: "复用原版蹲姿骨骼姿势" },
            { id: "jump", label: "跳跃", action: "跳跃", description: "原版跳跃骨骼姿势" },
        ],
    },
    {
        id: "combat",
        label: "战斗动作",
        poses: [
            { id: "jab", label: "刺拳", action: "伸手指向 刺拳", description: "复用原版伸手指向骨骼姿势" },
            { id: "cross", label: "直拳", action: "伸手指向 直拳", description: "复用原版伸手指向骨骼姿势" },
            { id: "block", label: "推挡", action: "观察 推挡", description: "复用原版观察抬手骨骼姿势" },
            { id: "holdGun", label: "持枪", action: "伸手指向 持枪", description: "复用原版伸手指向骨骼姿势" },
            { id: "shoot", label: "射击", action: "伸手指向 射击", description: "复用原版伸手指向骨骼姿势" },
        ],
    },
    {
        id: "performance",
        label: "表演互动",
        poses: [
            { id: "sitTalk", label: "坐姿说话", action: "坐姿 对话", description: "原版坐姿骨骼姿势" },
            { id: "wave", label: "招手", action: "对话 招手", description: "复用原版对话手势骨骼姿势" },
            { id: "point", label: "指向", action: "伸手指向", description: "原版伸手指向骨骼姿势" },
            { id: "pickUp", label: "拾取", action: "半蹲 检查 拾取", description: "原版半蹲检查骨骼姿势" },
            { id: "dance", label: "跳舞", action: "跳跃 舞蹈", description: "复用原版跳跃动态姿势" },
        ],
    },
];

export const DIRECTOR_CHARACTER_COLORS = [
    "#60a5fa",
    "#f97316",
    "#22c55e",
    "#e879f9",
    "#facc15",
    "#38bdf8",
    "#fb7185",
    "#a78bfa",
];

export const DEFAULT_DIRECTOR_SCENE_SETTINGS: DirectorSceneSettings = {
    sceneZoom: 1,
    skyColor: "#151515",
    showGrid: true,
    showLabels: true,
};

export function createDirectorCharacter(index: number, bodyType: DirectorCharacterBodyType = "male"): DirectorCharacter {
    const column = index % 4;
    const row = Math.floor(index / 4);
    return {
        id: `director-character-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        name: `角色${index + 1}`,
        bodyType,
        poseId: "stand",
        visible: true,
        locked: false,
        color: DIRECTOR_CHARACTER_COLORS[index % DIRECTOR_CHARACTER_COLORS.length],
        position: {
            x: (column - 1.5) * 1.05,
            y: 0,
            z: row * 0.95,
        },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        uniformScale: 1,
    };
}

export function getDirectorPosePreset(id: DirectorCharacterPoseId): DirectorPosePreset {
    return DIRECTOR_POSE_GROUPS.flatMap((group) => group.poses).find((pose) => pose.id === id) ?? DIRECTOR_POSE_GROUPS[0].poses[0];
}

export function getDirectorBodyPreset(id: DirectorCharacterBodyType): DirectorBodyTypePreset {
    return DIRECTOR_BODY_TYPES.find((body) => body.id === id) ?? DIRECTOR_BODY_TYPES[0];
}
