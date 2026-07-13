"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Input, Modal, Slider, Switch, Tooltip } from "antd";
import {
    Camera,
    Eye,
    EyeOff,
    ImagePlus,
    Lock,
    Maximize2,
    MoveDiagonal2,
    Plus,
    RotateCcw,
    Sparkles,
    Trash2,
    Unlock,
    UserRound,
} from "lucide-react";

import { DIRECTOR_CAMERA_PRESETS, getDirectorCameraPreset } from "./director-camera-presets";
import {
    DEFAULT_DIRECTOR_SCENE_SETTINGS,
    DIRECTOR_BODY_TYPES,
    DIRECTOR_POSE_GROUPS,
    createDirectorCharacter,
    getDirectorBodyPreset,
    getDirectorPosePreset,
} from "./director-character-presets";
import { DIRECTOR_MULTI_ANGLE_MODES, DIRECTOR_SHOT_SIZES, buildDirectorMultiAnglePrompt } from "./multi-angle-prompts";
import { DirectorThreeScene, type DirectorThreeSceneHandle } from "./director-three-scene";
import type {
    DirectorCameraPresetId,
    DirectorCharacter,
    DirectorCharacterBodyType,
    DirectorCharacterPoseId,
    DirectorMultiAngleMode,
    DirectorSceneSettings,
    DirectorShotSize,
    DirectorSnapshotPayload,
    DirectorVector3,
} from "./director-types";

type DirectorStudioDialogProps = {
    open: boolean;
    onClose: () => void;
    onSnapshot: (payload: DirectorSnapshotPayload) => Promise<void> | void;
};

const MAX_DIRECTOR_CHARACTERS = 8;
const COLOR_SWATCHES = ["#60a5fa", "#f97316", "#22c55e", "#e879f9", "#facc15", "#38bdf8", "#fb7185", "#a78bfa", "#f8fafc", "#94a3b8"];
const DEFAULT_DIRECTOR_DIALOG_SIZE = { width: 1500, height: 900 };
const MIN_DIRECTOR_DIALOG_WIDTH = 960;
const MIN_DIRECTOR_DIALOG_HEIGHT = 620;

type DirectorDialogSize = typeof DEFAULT_DIRECTOR_DIALOG_SIZE;

function clampDirectorDialogSize(size: DirectorDialogSize): DirectorDialogSize {
    if (typeof window === "undefined") return size;
    const maxWidth = Math.max(640, window.innerWidth - 32);
    const maxHeight = Math.max(520, window.innerHeight - 32);
    const minWidth = Math.min(MIN_DIRECTOR_DIALOG_WIDTH, maxWidth);
    const minHeight = Math.min(MIN_DIRECTOR_DIALOG_HEIGHT, maxHeight);
    return {
        width: Math.min(Math.max(size.width, minWidth), maxWidth),
        height: Math.min(Math.max(size.height, minHeight), maxHeight),
    };
}

function getFittedDirectorDialogSize(): DirectorDialogSize {
    if (typeof window === "undefined") return DEFAULT_DIRECTOR_DIALOG_SIZE;
    return clampDirectorDialogSize({
        width: Math.min(Math.floor(window.innerWidth * 0.94), 2200),
        height: Math.min(Math.floor(window.innerHeight * 0.9), 1200),
    });
}

export function DirectorStudioDialog({ open, onClose, onSnapshot }: DirectorStudioDialogProps) {
    const sceneRef = useRef<DirectorThreeSceneHandle>(null);
    const [activePresetId, setActivePresetId] = useState<DirectorCameraPresetId>("front");
    const [mode, setMode] = useState<DirectorMultiAngleMode>("universal");
    const [shotSize, setShotSize] = useState<DirectorShotSize>("medium shot");
    const [extraPrompt, setExtraPrompt] = useState("");
    const [busy, setBusy] = useState(false);
    const [bodyTypeToAdd, setBodyTypeToAdd] = useState<DirectorCharacterBodyType>("male");
    const [sceneSettings, setSceneSettings] = useState<DirectorSceneSettings>(DEFAULT_DIRECTOR_SCENE_SETTINGS);
    const [characters, setCharacters] = useState<DirectorCharacter[]>(() => [createDirectorCharacter(0, "female")]);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [dialogSize, setDialogSize] = useState<DirectorDialogSize>(DEFAULT_DIRECTOR_DIALOG_SIZE);
    const [fitDialogToWindow, setFitDialogToWindow] = useState(true);
    const dialogResizeRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        startWidth: number;
        startHeight: number;
    } | null>(null);

    useEffect(() => {
        setCharacters((current) => current.length > 0 ? current : [createDirectorCharacter(0, "female")]);
    }, []);

    useEffect(() => {
        if (!characters.some((character) => character.id === selectedCharacterId)) {
            setSelectedCharacterId(characters[0]?.id ?? null);
        }
    }, [characters, selectedCharacterId]);

    useEffect(() => {
        if (!open) return;
        const handleWindowResize = () => {
            setDialogSize((current) => fitDialogToWindow ? getFittedDirectorDialogSize() : clampDirectorDialogSize(current));
        };
        handleWindowResize();
        window.addEventListener("resize", handleWindowResize);
        return () => window.removeEventListener("resize", handleWindowResize);
    }, [fitDialogToWindow, open]);

    useEffect(() => {
        if (!open) return;
        const handlePointerMove = (event: PointerEvent) => {
            const resizeState = dialogResizeRef.current;
            if (!resizeState || resizeState.pointerId !== event.pointerId) return;
            setDialogSize(clampDirectorDialogSize({
                width: resizeState.startWidth + event.clientX - resizeState.startX,
                height: resizeState.startHeight + event.clientY - resizeState.startY,
            }));
        };
        const handlePointerUp = (event: PointerEvent) => {
            if (dialogResizeRef.current?.pointerId === event.pointerId) dialogResizeRef.current = null;
        };
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            dialogResizeRef.current = null;
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };
    }, [open]);

    const selectedCharacter = useMemo(
        () => characters.find((character) => character.id === selectedCharacterId) ?? null,
        [characters, selectedCharacterId],
    );
    const activePreset = getDirectorCameraPreset(activePresetId);
    const modeHint = DIRECTOR_MULTI_ANGLE_MODES.find((item) => item.id === mode)?.hint || "";
    const visibleCharacters = characters.filter((character) => character.visible);

    const directorCharacterPrompt = useMemo(() => {
        if (visibleCharacters.length === 0) return "Director setup has no visible characters.";
        return [
            `Director setup contains ${visibleCharacters.length} visible procedural mannequin character(s). Use their relative positions, body types, colors, labels, and poses only as staging guidance; do not render UI labels, grid lines, or mannequin seams.`,
            ...visibleCharacters.map((character, index) => {
                const body = getDirectorBodyPreset(character.bodyType);
                const pose = getDirectorPosePreset(character.poseId);
                return `${index + 1}. ${character.name}: ${body.label}, ${pose.label}, color ${character.color}, position x=${character.position.x.toFixed(2)} y=${character.position.y.toFixed(2)} z=${character.position.z.toFixed(2)}, rotation y=${character.rotation.y.toFixed(0)} degrees.`;
            }),
        ].join("\n");
    }, [visibleCharacters]);

    const generatedPrompt = useMemo(
        () =>
            [
                "Create a polished final image from this director setup. Use the screenshot as camera, layout, pose, staging, and lighting guidance.",
                directorCharacterPrompt,
                activePreset.prompt,
                buildDirectorMultiAnglePrompt(activePreset.horizontal, activePreset.vertical, shotSize, mode, activePreset.prompt),
                extraPrompt.trim(),
            ]
                .filter(Boolean)
                .join("\n"),
        [activePreset, directorCharacterPrompt, extraPrompt, mode, shotSize],
    );

    const handlePresetClick = (presetId: DirectorCameraPresetId) => {
        const preset = getDirectorCameraPreset(presetId);
        setActivePresetId(preset.id);
        setShotSize(preset.shotSize);
        sceneRef.current?.applyPreset(preset.id);
    };

    const handleFitDialogToWindow = () => {
        setFitDialogToWindow(true);
        setDialogSize(getFittedDirectorDialogSize());
    };

    const handleDialogResizeStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setFitDialogToWindow(false);
        dialogResizeRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: dialogSize.width,
            startHeight: dialogSize.height,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const updateCharacter = (characterId: string, updater: (character: DirectorCharacter) => DirectorCharacter) => {
        setCharacters((current) => current.map((character) => (character.id === characterId ? updater(character) : character)));
    };

    const updateSelectedCharacter = (updater: (character: DirectorCharacter) => DirectorCharacter) => {
        if (!selectedCharacter) return;
        if (selectedCharacter.locked) return;
        updateCharacter(selectedCharacter.id, updater);
    };

    const handleAddCharacter = () => {
        if (characters.length >= MAX_DIRECTOR_CHARACTERS) return;
        const next = createDirectorCharacter(characters.length, bodyTypeToAdd);
        setCharacters((current) => [...current, next]);
        setSelectedCharacterId(next.id);
    };

    const handleDeleteSelected = () => {
        if (!selectedCharacter || selectedCharacter.locked || characters.length <= 1) return;
        setCharacters((current) => current.filter((character) => character.id !== selectedCharacter.id));
    };

    const handleSnapshot = async () => {
        const dataUrl = sceneRef.current?.capturePng();
        if (!dataUrl) return;
        setBusy(true);
        try {
            await onSnapshot({
                dataUrl,
                prompt: generatedPrompt,
                presetId: activePreset.id,
                presetLabel: activePreset.label,
                mode,
                shotSize,
                horizontal: activePreset.horizontal,
                vertical: activePreset.vertical,
            });
            onClose();
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            title={null}
            open={open}
            centered
            footer={null}
            width={dialogSize.width}
            onCancel={onClose}
            destroyOnHidden
            styles={{ body: { height: dialogSize.height, overflow: "hidden", padding: 0 } }}
            className="director-studio-modal"
        >
            <div data-canvas-no-zoom className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-[#101010] text-white">
                <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
                    <div>
                        <div className="flex items-center gap-2 text-lg font-semibold">
                            <Camera className="size-5" />
                            导演台
                        </div>
                        <div className="mt-1 text-xs text-white/48">多人摆位、动作和机位会截图成参考帧，自动放回画布。</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Tooltip title="适应窗口">
                            <Button icon={<Maximize2 className="size-4" />} onClick={handleFitDialogToWindow} />
                        </Tooltip>
                        <Button icon={<RotateCcw className="size-4" />} onClick={() => sceneRef.current?.resetCamera()}>
                            重置机位
                        </Button>
                        <Button type="primary" icon={<ImagePlus className="size-4" />} loading={busy} onClick={handleSnapshot}>
                            截图到画布
                        </Button>
                    </div>
                </div>

                <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[260px_minmax(0,1fr)_360px]">
                    <CharacterListPanel
                        characters={characters}
                        selectedCharacterId={selectedCharacterId}
                        bodyTypeToAdd={bodyTypeToAdd}
                        onBodyTypeToAddChange={setBodyTypeToAdd}
                        onAdd={handleAddCharacter}
                        onSelect={setSelectedCharacterId}
                        onRename={(id, name) => updateCharacter(id, (character) => ({ ...character, name }))}
                        onToggleVisible={(id) => updateCharacter(id, (character) => ({ ...character, visible: !character.visible }))}
                        onToggleLocked={(id) => updateCharacter(id, (character) => ({ ...character, locked: !character.locked }))}
                    />

                    <div className="min-h-0 min-w-0 p-4">
                        <DirectorThreeScene
                            ref={sceneRef}
                            activePresetId={activePresetId}
                            characters={characters}
                            selectedCharacterId={selectedCharacterId}
                            sceneSettings={sceneSettings}
                            onSelectCharacter={setSelectedCharacterId}
                        />
                    </div>

                    <div className="ui-scrollbar flex min-h-0 min-w-0 flex-col gap-4 overflow-x-hidden overflow-y-auto border-l border-white/10 p-4">
                        <SelectedCharacterPanel
                            character={selectedCharacter}
                            characterCount={characters.length}
                            onUpdate={updateSelectedCharacter}
                            onDelete={handleDeleteSelected}
                        />

                        <PosePanel
                            selectedPoseId={selectedCharacter?.poseId ?? "stand"}
                            disabled={!selectedCharacter || selectedCharacter.locked}
                            onSelect={(poseId) => updateSelectedCharacter((character) => ({ ...character, poseId }))}
                        />

                        <SceneSettingsPanel settings={sceneSettings} onChange={setSceneSettings} />

                        <CameraAndPromptPanel
                            activePresetId={activePresetId}
                            mode={mode}
                            shotSize={shotSize}
                            modeHint={modeHint}
                            extraPrompt={extraPrompt}
                            generatedPrompt={generatedPrompt}
                            onPresetClick={handlePresetClick}
                            onModeChange={setMode}
                            onShotSizeChange={setShotSize}
                            onExtraPromptChange={setExtraPrompt}
                        />
                    </div>
                </div>

                <Tooltip title="拖动调整大小，双击适应窗口" placement="left">
                    <button
                        type="button"
                        aria-label="调整导演台大小"
                        className="absolute bottom-1 right-1 z-20 grid size-8 cursor-nwse-resize place-items-center rounded-md border border-white/10 bg-black/55 text-white/55 shadow-lg backdrop-blur transition hover:border-white/25 hover:bg-black/75 hover:text-white"
                        style={{ touchAction: "none" }}
                        onPointerDown={handleDialogResizeStart}
                        onDoubleClick={handleFitDialogToWindow}
                    >
                        <MoveDiagonal2 className="size-4" />
                    </button>
                </Tooltip>
            </div>
        </Modal>
    );
}

function CharacterListPanel(props: {
    characters: DirectorCharacter[];
    selectedCharacterId: string | null;
    bodyTypeToAdd: DirectorCharacterBodyType;
    onBodyTypeToAddChange: (next: DirectorCharacterBodyType) => void;
    onAdd: () => void;
    onSelect: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onToggleVisible: (id: string) => void;
    onToggleLocked: (id: string) => void;
}) {
    const { characters, selectedCharacterId, bodyTypeToAdd, onBodyTypeToAddChange, onAdd, onSelect, onRename, onToggleVisible, onToggleLocked } = props;
    return (
        <div className="flex min-h-0 flex-col border-r border-white/10 p-4">
            <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">角色列表</div>
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-white/45">{characters.length}/8</span>
            </div>

            <div className="mt-3 text-xs text-white/45">新增体型</div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
                {DIRECTOR_BODY_TYPES.map((body) => (
                    <Tooltip key={body.id} title={body.description} placement="top">
                        <button
                            type="button"
                            onClick={() => onBodyTypeToAddChange(body.id)}
                            className={`rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                                bodyTypeToAdd === body.id ? "border-white/50 bg-white text-black" : "border-white/10 bg-white/5 text-white/70 hover:border-white/25"
                            }`}
                        >
                            {body.label}
                        </button>
                    </Tooltip>
                ))}
            </div>
            <Button className="mt-3" icon={<Plus className="size-4" />} block disabled={characters.length >= MAX_DIRECTOR_CHARACTERS} onClick={onAdd}>
                添加角色
            </Button>

            <div className="ui-scrollbar mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {characters.map((character, index) => {
                    const selected = character.id === selectedCharacterId;
                    return (
                        <div
                            key={character.id}
                            className={`rounded-xl border p-2 transition ${
                                selected ? "border-white/45 bg-white/12" : "border-white/10 bg-white/[0.035] hover:border-white/22"
                            }`}
                        >
                            <button type="button" className="mb-2 flex w-full items-center gap-2 text-left" onClick={() => onSelect(character.id)}>
                                <span className="grid size-7 place-items-center rounded-full text-xs font-semibold text-black" style={{ backgroundColor: character.color }}>
                                    {index + 1}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-semibold text-white/86">{character.name}</span>
                                    <span className="block truncate text-[10px] text-white/38">{getDirectorBodyPreset(character.bodyType).label}</span>
                                </span>
                            </button>
                            <div className="flex items-center gap-1.5">
                                <Input
                                    size="small"
                                    value={character.name}
                                    onChange={(event) => onRename(character.id, event.target.value)}
                                    className="min-w-0 flex-1"
                                />
                                <Tooltip title={character.visible ? "隐藏" : "显示"}>
                                    <Button size="small" icon={character.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} onClick={() => onToggleVisible(character.id)} />
                                </Tooltip>
                                <Tooltip title={character.locked ? "解锁" : "锁定"}>
                                    <Button size="small" icon={character.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />} onClick={() => onToggleLocked(character.id)} />
                                </Tooltip>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SelectedCharacterPanel(props: {
    character: DirectorCharacter | null;
    characterCount: number;
    onUpdate: (updater: (character: DirectorCharacter) => DirectorCharacter) => void;
    onDelete: () => void;
}) {
    const { character, characterCount, onUpdate, onDelete } = props;
    const disabled = !character || character.locked;
    if (!character) {
        return (
            <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/52">
                选择一个角色后编辑属性。
            </section>
        );
    }

    return (
        <section className="min-w-0 rounded-xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <UserRound className="size-4" />
                    角色属性
                </div>
                <Tooltip title={character.locked ? "角色已锁定" : "删除角色"}>
                    <Button
                        danger
                        size="small"
                        icon={<Trash2 className="size-3.5" />}
                        disabled={character.locked || characterCount <= 1}
                        onClick={onDelete}
                    />
                </Tooltip>
            </div>

            <div className="mt-3 space-y-3">
                <FieldLabel label="名称">
                    <Input
                        value={character.name}
                        disabled={disabled}
                        onChange={(event) => onUpdate((current) => ({ ...current, name: event.target.value }))}
                    />
                </FieldLabel>

                <div>
                    <div className="mb-2 text-xs text-white/50">体型</div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {DIRECTOR_BODY_TYPES.map((body) => (
                            <button
                                key={body.id}
                                type="button"
                                disabled={disabled}
                                onClick={() => onUpdate((current) => ({ ...current, bodyType: body.id }))}
                                className={`rounded-md border px-2 py-1.5 text-[11px] transition ${
                                    character.bodyType === body.id ? "border-white/50 bg-white text-black" : "border-white/10 bg-white/5 text-white/66 hover:border-white/25 disabled:opacity-40"
                                }`}
                            >
                                {body.label.replace("素体", "")}
                            </button>
                        ))}
                    </div>
                </div>

                <VectorEditor title="位置 XYZ" value={character.position} disabled={disabled} step={0.1} min={-6} max={6} onChange={(position) => onUpdate((current) => ({ ...current, position }))} />
                <VectorEditor title="旋转 XYZ" value={character.rotation} disabled={disabled} step={5} min={-180} max={180} onChange={(rotation) => onUpdate((current) => ({ ...current, rotation }))} />
                <VectorEditor title="缩放 XYZ" value={character.scale} disabled={disabled} step={0.05} min={0.35} max={2.4} onChange={(scale) => onUpdate((current) => ({ ...current, scale }))} />

                <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-white/50">
                        <span>统一缩放</span>
                        <span>{character.uniformScale.toFixed(2)}x</span>
                    </div>
                    <Slider
                        min={0.5}
                        max={2}
                        step={0.05}
                        value={character.uniformScale}
                        disabled={disabled}
                        onChange={(value) => onUpdate((current) => ({ ...current, uniformScale: Number(value) }))}
                    />
                </div>

                <div>
                    <div className="mb-2 text-xs text-white/50">颜色</div>
                    <div className="flex flex-wrap gap-1.5">
                        {COLOR_SWATCHES.map((color) => (
                            <button
                                key={color}
                                type="button"
                                disabled={disabled}
                                aria-label={color}
                                onClick={() => onUpdate((current) => ({ ...current, color }))}
                                className={`size-7 rounded-full border transition ${character.color.toLowerCase() === color.toLowerCase() ? "border-white ring-2 ring-white/35" : "border-white/18 hover:border-white/55 disabled:opacity-35"}`}
                                style={{ backgroundColor: color }}
                            />
                        ))}
                    </div>
                    <Input
                        className="mt-2"
                        value={character.color}
                        disabled={disabled}
                        onChange={(event) => onUpdate((current) => ({ ...current, color: normalizeHexDraft(event.target.value, current.color) }))}
                    />
                </div>
            </div>
        </section>
    );
}

function PosePanel(props: {
    selectedPoseId: DirectorCharacterPoseId;
    disabled: boolean;
    onSelect: (poseId: DirectorCharacterPoseId) => void;
}) {
    return (
        <section className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
            <div className="text-sm font-semibold">动作库</div>
            <div className="mt-3 space-y-3">
                {DIRECTOR_POSE_GROUPS.map((group) => (
                    <div key={group.id}>
                        <div className="mb-1.5 text-xs text-white/45">{group.label}</div>
                        <div className="grid grid-cols-3 gap-1.5">
                            {group.poses.map((pose) => (
                                <Tooltip key={pose.id} title={pose.description}>
                                    <button
                                        type="button"
                                        disabled={props.disabled}
                                        onClick={() => props.onSelect(pose.id)}
                                        className={`rounded-md border px-2 py-1.5 text-[11px] transition ${
                                            props.selectedPoseId === pose.id ? "border-white/55 bg-white text-black" : "border-white/10 bg-white/5 text-white/66 hover:border-white/25 disabled:opacity-40"
                                        }`}
                                    >
                                        {pose.label}
                                    </button>
                                </Tooltip>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

function SceneSettingsPanel(props: {
    settings: DirectorSceneSettings;
    onChange: (next: DirectorSceneSettings) => void;
}) {
    const { settings, onChange } = props;
    return (
        <section className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
            <div className="text-sm font-semibold">3D 场景</div>
            <div className="mt-3 space-y-3">
                <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-white/50">
                        <span>场景缩放</span>
                        <span>{settings.sceneZoom.toFixed(2)}x</span>
                    </div>
                    <Slider min={0.65} max={1.6} step={0.05} value={settings.sceneZoom} onChange={(value) => onChange({ ...settings, sceneZoom: Number(value) })} />
                </div>
                <FieldLabel label="天空颜色">
                    <Input value={settings.skyColor} onChange={(event) => onChange({ ...settings, skyColor: normalizeHexDraft(event.target.value, settings.skyColor) })} />
                </FieldLabel>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/72">
                    <span>地面网格</span>
                    <Switch size="small" checked={settings.showGrid} onChange={(checked) => onChange({ ...settings, showGrid: checked })} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/72">
                    <span>角色标签</span>
                    <Switch size="small" checked={settings.showLabels} onChange={(checked) => onChange({ ...settings, showLabels: checked })} />
                </div>
            </div>
        </section>
    );
}

function CameraAndPromptPanel(props: {
    activePresetId: DirectorCameraPresetId;
    mode: DirectorMultiAngleMode;
    shotSize: DirectorShotSize;
    modeHint: string;
    extraPrompt: string;
    generatedPrompt: string;
    onPresetClick: (presetId: DirectorCameraPresetId) => void;
    onModeChange: (mode: DirectorMultiAngleMode) => void;
    onShotSizeChange: (shotSize: DirectorShotSize) => void;
    onExtraPromptChange: (value: string) => void;
}) {
    return (
        <section className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
            <div className="text-sm font-semibold">机位与生图</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
                {DIRECTOR_CAMERA_PRESETS.map((preset) => (
                    <button
                        key={preset.id}
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-left transition ${props.activePresetId === preset.id ? "border-white/45 bg-white text-black" : "border-white/10 bg-white/5 text-white hover:bg-white/10"}`}
                        onClick={() => props.onPresetClick(preset.id)}
                    >
                        <span className="block text-sm font-semibold">{preset.label}</span>
                        <span className={`mt-1 block text-[11px] leading-4 ${props.activePresetId === preset.id ? "text-black/55" : "text-white/42"}`}>{preset.description}</span>
                    </button>
                ))}
            </div>

            <div className="mt-5 text-sm font-semibold">多角度模式</div>
            <div className="mt-3 flex flex-wrap gap-2">
                {DIRECTOR_MULTI_ANGLE_MODES.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${props.mode === item.id ? "border-white/45 bg-white text-black" : "border-white/10 bg-white/5 text-white/72 hover:bg-white/10"}`}
                        onClick={() => props.onModeChange(item.id)}
                        title={item.hint}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            <div className="mt-2 text-xs leading-5 text-white/38">建议：{props.modeHint}</div>

            <div className="mt-5 text-sm font-semibold">景别</div>
            <div role="radiogroup" aria-label="景别" className="mt-3 grid w-full grid-cols-4 gap-1.5">
                {DIRECTOR_SHOT_SIZES.map((item) => {
                    const selected = props.shotSize === item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className={`min-w-0 whitespace-nowrap rounded-lg border px-1.5 py-1.5 text-xs transition ${selected ? "border-white/45 bg-white text-black" : "border-white/10 bg-white/5 text-white/72 hover:bg-white/10"}`}
                            onClick={() => props.onShotSizeChange(item.id)}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </div>

            <div className="mt-5 text-sm font-semibold">补充要求</div>
            <Input.TextArea
                value={props.extraPrompt}
                onChange={(event) => props.onExtraPromptChange(event.target.value)}
                placeholder="例如：改成印尼本地带货场景、商品放在手里、阳光室内、真实广告质感"
                autoSize={{ minRows: 3, maxRows: 5 }}
                className="mt-3"
            />

            <div className="mt-5 min-h-24 rounded-xl border border-white/10 bg-black/24 p-3 text-[11px] leading-5 text-white/48">
                <div className="mb-1 flex items-center gap-1.5 font-semibold text-white/72">
                    <Sparkles className="size-3.5" />
                    将写入生图配置
                </div>
                <div className="line-clamp-6 break-words whitespace-pre-wrap">{props.generatedPrompt}</div>
            </div>
        </section>
    );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block">
            <div className="mb-1.5 text-xs text-white/50">{label}</div>
            {children}
        </label>
    );
}

function VectorEditor(props: {
    title: string;
    value: DirectorVector3;
    disabled?: boolean;
    step: number;
    min: number;
    max: number;
    onChange: (next: DirectorVector3) => void;
}) {
    const { title, value, disabled, step, min, max, onChange } = props;
    const setAxis = (axis: keyof DirectorVector3, nextValue: number) => onChange({ ...value, [axis]: nextValue });
    return (
        <div>
            <div className="mb-1.5 text-xs text-white/50">{title}</div>
            <div className="grid grid-cols-3 gap-1.5">
                {(["x", "y", "z"] as const).map((axis) => (
                    <label key={axis} className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-[11px] text-white/46">
                        <span className="uppercase">{axis}</span>
                        <input
                            type="number"
                            min={min}
                            max={max}
                            step={step}
                            value={roundForInput(value[axis])}
                            disabled={disabled}
                            onChange={(event) => setAxis(axis, Number(event.target.value))}
                            className="min-w-0 flex-1 bg-transparent text-right text-white/85 outline-none disabled:opacity-40"
                        />
                    </label>
                ))}
            </div>
        </div>
    );
}

function roundForInput(value: number) {
    return Math.round(value * 100) / 100;
}

function normalizeHexDraft(value: string, fallback: string) {
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{0,6}$/.test(trimmed)) return trimmed;
    if (/^[0-9a-fA-F]{0,6}$/.test(trimmed)) return `#${trimmed}`;
    return fallback;
}
