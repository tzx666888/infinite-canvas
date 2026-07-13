"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { getDirectorCameraPreset } from "./director-camera-presets";
import { getDirectorPosePreset } from "./director-character-presets";
import type { DirectorCameraPresetId, DirectorCharacter, DirectorSceneSettings } from "./director-types";

export type DirectorThreeSceneHandle = {
    capturePng: () => string | null;
    applyPreset: (presetId: DirectorCameraPresetId) => void;
    resetCamera: () => void;
};

type DirectorThreeSceneProps = {
    activePresetId: DirectorCameraPresetId;
    characters: DirectorCharacter[];
    selectedCharacterId: string | null;
    sceneSettings: DirectorSceneSettings;
    onSelectCharacter: (id: string) => void;
};

type DirectorBoneMap = {
    leftShoulder: THREE.Group;
    rightShoulder: THREE.Group;
    leftElbow: THREE.Group;
    rightElbow: THREE.Group;
    leftHip: THREE.Group;
    rightHip: THREE.Group;
    leftKnee: THREE.Group;
    rightKnee: THREE.Group;
    headGroup: THREE.Group;
    torsoMesh: THREE.Group;
    constants: { legH: number };
};

type BodyProportions = {
    height: number;
    torsoH: number;
    torsoR: number;
    shoulderHalfWidth: number;
    hipHalfWidth: number;
    legH: number;
    thighH: number;
    shinH: number;
    armH: number;
    upperArmH: number;
    forearmH: number;
    armR: number;
    legR: number;
    handR: number;
    footHalfW: number;
    footHalfL: number;
    footHalfH: number;
    headR: number;
    headStretchY: number;
    hair: "short" | "long" | "none";
    geometric: boolean;
};

export const DirectorThreeScene = forwardRef<DirectorThreeSceneHandle, DirectorThreeSceneProps>(function DirectorThreeScene(props, ref) {
    const { activePresetId, characters, selectedCharacterId, sceneSettings, onSelectCharacter } = props;
    const hostRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const frameRef = useRef<number | null>(null);
    const characterRootRef = useRef<THREE.Group | null>(null);
    const gridRef = useRef<THREE.GridHelper | null>(null);
    const floorRef = useRef<THREE.Mesh | null>(null);
    const backdropRef = useRef<THREE.Mesh | null>(null);
    const latestSettingsRef = useRef(sceneSettings);
    const selectCallbackRef = useRef(onSelectCharacter);

    latestSettingsRef.current = sceneSettings;
    selectCallbackRef.current = onSelectCharacter;

    const applyPreset = (presetId: DirectorCameraPresetId) => {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera || !controls) return;
        const preset = getDirectorCameraPreset(presetId);
        const zoom = Math.max(0.6, Math.min(1.8, latestSettingsRef.current.sceneZoom));
        camera.position.set(preset.position[0] / zoom, preset.position[1] / zoom, preset.position[2] / zoom);
        camera.fov = preset.fov;
        camera.updateProjectionMatrix();
        controls.target.set(...preset.target);
        controls.update();
    };

    useImperativeHandle(
        ref,
        () => ({
            capturePng: () => {
                const renderer = rendererRef.current;
                const scene = sceneRef.current;
                const camera = cameraRef.current;
                if (!renderer || !scene || !camera) return null;
                renderer.render(scene, camera);
                return renderer.domElement.toDataURL("image/png");
            },
            applyPreset,
            resetCamera: () => applyPreset("front"),
        }),
        [],
    );

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(sceneSettings.skyColor);
        scene.fog = new THREE.Fog(sceneSettings.skyColor, 10, 28);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.style.display = "block";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        rendererRef.current = renderer;
        host.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 2.2;
        controls.maxDistance = 14;
        controls.maxPolarAngle = Math.PI * 0.92;
        controlsRef.current = controls;

        addSceneLights(scene);
        const stage = addSceneStage(scene, sceneSettings.skyColor);
        gridRef.current = stage.grid;
        floorRef.current = stage.floor;
        backdropRef.current = stage.backdrop;

        const characterRoot = new THREE.Group();
        characterRoot.name = "director-character-root";
        characterRootRef.current = characterRoot;
        scene.add(characterRoot);

        const resize = () => {
            const rect = host.getBoundingClientRect();
            const width = Math.max(320, Math.floor(rect.width));
            const height = Math.max(320, Math.floor(rect.height));
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        };

        const pointerState = { x: 0, y: 0 };
        const handlePointerDown = (event: PointerEvent) => {
            pointerState.x = event.clientX;
            pointerState.y = event.clientY;
        };
        const handlePointerUp = (event: PointerEvent) => {
            const moved = Math.hypot(event.clientX - pointerState.x, event.clientY - pointerState.y);
            if (moved > 6) return;
            const selectedId = pickCharacterFromPointer(event, renderer, camera, characterRoot);
            if (selectedId) selectCallbackRef.current(selectedId);
        };

        resize();
        applyPreset(activePresetId);
        renderer.domElement.addEventListener("pointerdown", handlePointerDown);
        renderer.domElement.addEventListener("pointerup", handlePointerUp);
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);

        const animate = () => {
            controls.update();
            renderer.render(scene, camera);
            frameRef.current = window.requestAnimationFrame(animate);
        };
        animate();

        return () => {
            resizeObserver.disconnect();
            renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
            renderer.domElement.removeEventListener("pointerup", handlePointerUp);
            if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
            controls.dispose();
            scene.traverse(disposeObject3D);
            renderer.dispose();
            renderer.forceContextLoss();
            host.removeChild(renderer.domElement);
            rendererRef.current = null;
            sceneRef.current = null;
            cameraRef.current = null;
            controlsRef.current = null;
            characterRootRef.current = null;
            gridRef.current = null;
            floorRef.current = null;
            backdropRef.current = null;
        };
    }, []);

    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;
        scene.background = new THREE.Color(sceneSettings.skyColor);
        scene.fog = new THREE.Fog(sceneSettings.skyColor, 10, 28);
        if (gridRef.current) gridRef.current.visible = sceneSettings.showGrid;
        const floorMaterial = floorRef.current?.material as THREE.MeshStandardMaterial | undefined;
        floorMaterial?.color.set(sceneSettings.skyColor).lerp(new THREE.Color("#2a2a2a"), 0.74);
        const backdropMaterial = backdropRef.current?.material as THREE.MeshStandardMaterial | undefined;
        backdropMaterial?.color.set(sceneSettings.skyColor).lerp(new THREE.Color("#1d1d1d"), 0.68);
        characterRootRef.current?.scale.setScalar(sceneSettings.sceneZoom);
        applyPreset(activePresetId);
    }, [activePresetId, sceneSettings]);

    useEffect(() => {
        const root = characterRootRef.current;
        if (!root) return;
        clearGroup(root);
        characters.forEach((character) => {
            if (!character.visible) return;
            root.add(createCharacterObject(character, character.id === selectedCharacterId, sceneSettings.showLabels));
        });
    }, [characters, sceneSettings.showLabels, selectedCharacterId]);

    return (
        <div
            ref={hostRef}
            data-canvas-no-zoom
            className="h-full min-h-0 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#151515]"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        />
    );
});

function addSceneLights(scene: THREE.Scene) {
    scene.add(new THREE.HemisphereLight("#f8fafc", "#222222", 1.15));

    const key = new THREE.DirectionalLight("#fff7e6", 4.2);
    key.position.set(-3.8, 5.6, 4.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);

    const fill = new THREE.DirectionalLight("#cde7ff", 1.25);
    fill.position.set(4.4, 3.2, -3.4);
    scene.add(fill);

    const rim = new THREE.PointLight("#8ab4ff", 2.2, 10);
    rim.position.set(0, 2.6, -3.5);
    scene.add(rim);
}

function addSceneStage(scene: THREE.Scene, skyColor: string) {
    const floorMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(skyColor).lerp(new THREE.Color("#2a2a2a"), 0.74), roughness: 0.72, metalness: 0.04 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(14, 28, "#6b7280", "#303030");
    grid.position.y = 0.01;
    scene.add(grid);

    const backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 5.8),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(skyColor).lerp(new THREE.Color("#1d1d1d"), 0.68), roughness: 0.9 }),
    );
    backdrop.position.set(0, 2.9, -4.4);
    backdrop.receiveShadow = true;
    scene.add(backdrop);

    return { floor, grid, backdrop };
}

function createCharacterObject(character: DirectorCharacter, selected: boolean, showLabel: boolean) {
    const wrapper = new THREE.Group();
    wrapper.name = character.name;
    wrapper.userData.characterId = character.id;
    wrapper.position.set(character.position.x, character.position.y, character.position.z);
    wrapper.rotation.set(degToRad(character.rotation.x), degToRad(character.rotation.y), degToRad(character.rotation.z));
    wrapper.scale.set(
        character.scale.x * character.uniformScale,
        character.scale.y * character.uniformScale,
        character.scale.z * character.uniformScale,
    );

    const rig = createCharacterRig(character);
    applyDirectorPose(rig, getDirectorPosePreset(character.poseId).action);
    rig.position.y += rig.userData.poseYOffset ?? 0;
    wrapper.add(rig);

    if (selected) {
        const ringMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc", transparent: true, opacity: 0.9, depthTest: false });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.012, 8, 48), ringMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.035;
        ring.renderOrder = 50;
        wrapper.add(ring);
    }

    if (showLabel) {
        const label = createLabelSprite(character.name, selected ? "#ffffff" : character.color);
        label.position.set(0, 2.55, 0);
        wrapper.add(label);
    }

    wrapper.traverse((object) => {
        object.userData.characterId = character.id;
    });
    return wrapper;
}

function createCharacterRig(character: DirectorCharacter) {
    const p = bodyProportions(character.bodyType);
    const group = new THREE.Group();
    const bodyColor = new THREE.Color(character.color);
    const bodyMat = new THREE.MeshStandardMaterial({
        color: bodyColor,
        emissive: bodyColor.clone().multiplyScalar(0.35),
        emissiveIntensity: 0.08,
        roughness: 0.68,
        metalness: 0.02,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: "#111827", emissive: "#020617", emissiveIntensity: 0.04, roughness: 0.72 });

    const hipY = p.legH;
    const torsoCenterY = hipY + p.torsoH / 2;
    const torsoTopY = hipY + p.torsoH;
    const shoulderY = torsoTopY - p.torsoR * 0.5;
    const headCenterY = torsoTopY + p.headR * 0.92;

    const torsoMesh = new THREE.Group();
    const torsoGeometry = p.geometric
        ? new THREE.BoxGeometry(p.torsoR * 2.4, p.torsoH, p.torsoR * 1.45)
        : new THREE.CapsuleGeometry(p.torsoR, Math.max(0.01, p.torsoH - 2 * p.torsoR), 6, 12);
    const torso = new THREE.Mesh(torsoGeometry, bodyMat);
    torso.castShadow = true;
    torsoMesh.add(torso);
    torsoMesh.position.y = torsoCenterY;
    group.add(torsoMesh);

    const leftLeg = buildLeg(-p.hipHalfWidth, p, bodyMat, darkMat, p.geometric);
    const rightLeg = buildLeg(p.hipHalfWidth, p, bodyMat, darkMat, p.geometric);
    leftLeg.hip.position.set(-p.hipHalfWidth, hipY, 0);
    rightLeg.hip.position.set(p.hipHalfWidth, hipY, 0);
    leftLeg.hip.rotation.z = -0.05;
    rightLeg.hip.rotation.z = 0.05;
    group.add(leftLeg.hip);
    group.add(rightLeg.hip);

    const leftArm = buildArm(-p.shoulderHalfWidth, p, bodyMat, p.geometric);
    const rightArm = buildArm(p.shoulderHalfWidth, p, bodyMat, p.geometric);
    leftArm.shoulder.position.set(-p.shoulderHalfWidth, shoulderY, 0);
    rightArm.shoulder.position.set(p.shoulderHalfWidth, shoulderY, 0);
    leftArm.shoulder.rotation.z = -0.22;
    rightArm.shoulder.rotation.z = 0.22;
    group.add(leftArm.shoulder);
    group.add(rightArm.shoulder);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, headCenterY, 0);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(p.headR * 0.33, p.headR * 0.36, p.headR * 0.58, 10), bodyMat);
    neck.position.y = -p.headR * 0.82;
    neck.castShadow = true;
    headGroup.add(neck);

    const headGeometry = p.geometric ? new THREE.BoxGeometry(p.headR * 1.8, p.headR * 1.9, p.headR * 1.55) : new THREE.SphereGeometry(p.headR, 18, 14);
    const skull = new THREE.Mesh(headGeometry, bodyMat);
    skull.scale.y = p.headStretchY;
    skull.castShadow = true;
    headGroup.add(skull);

    if (p.hair !== "none") {
        const hairMat = new THREE.MeshStandardMaterial({
            color: bodyColor.clone().lerp(new THREE.Color("#111827"), 0.76),
            emissive: "#020617",
            emissiveIntensity: 0.05,
            roughness: 0.76,
        });
        const hair = new THREE.Mesh(new THREE.SphereGeometry(p.headR * 1.04, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
        hair.position.z = -p.headR * 0.03;
        hair.scale.set(1.04, p.headStretchY * 1.03, 1.02);
        headGroup.add(hair);
        if (p.hair === "long") {
            const backHair = new THREE.Mesh(new THREE.CapsuleGeometry(p.headR * 0.34, p.headR * 0.78, 6, 10), hairMat);
            backHair.position.set(0, -p.headR * 0.45, -p.headR * 0.32);
            backHair.scale.set(1.18, 1, 0.42);
            headGroup.add(backHair);
        }
    }
    group.add(headGroup);

    const bones: DirectorBoneMap = {
        leftShoulder: leftArm.shoulder,
        rightShoulder: rightArm.shoulder,
        leftElbow: leftArm.elbow,
        rightElbow: rightArm.elbow,
        leftHip: leftLeg.hip,
        rightHip: rightLeg.hip,
        leftKnee: leftLeg.knee,
        rightKnee: rightLeg.knee,
        headGroup,
        torsoMesh,
        constants: { legH: p.legH },
    };
    group.userData.bones = bones;
    group.userData.poseYOffset = 0;
    stashBindPose(group);
    return group;
}

function buildLeg(_sideX: number, p: BodyProportions, bodyMat: THREE.Material, footMat: THREE.Material, geometric: boolean) {
    const hip = new THREE.Group();
    const hipBall = new THREE.Mesh(geometric ? new THREE.BoxGeometry(p.legR * 1.8, p.legR * 1.8, p.legR * 1.8) : new THREE.SphereGeometry(p.legR * 0.95, 10, 8), bodyMat);
    hip.add(hipBall);

    const thigh = limbMesh(p.legR, p.thighH, bodyMat, geometric);
    thigh.position.y = -p.thighH / 2;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -p.thighH;
    hip.add(knee);
    const kneeBall = new THREE.Mesh(geometric ? new THREE.BoxGeometry(p.legR * 1.6, p.legR * 1.6, p.legR * 1.6) : new THREE.SphereGeometry(p.legR * 0.9, 10, 8), bodyMat);
    knee.add(kneeBall);

    const shin = limbMesh(p.legR * 0.9, p.shinH, bodyMat, geometric);
    shin.position.y = -p.shinH / 2;
    knee.add(shin);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(p.footHalfW * 2, p.footHalfH * 2, p.footHalfL * 2), footMat);
    foot.position.set(0, -p.shinH - p.footHalfH * 0.4, p.footHalfL * 0.42);
    foot.castShadow = true;
    knee.add(foot);
    return { hip, knee };
}

function buildArm(_sideX: number, p: BodyProportions, bodyMat: THREE.Material, geometric: boolean) {
    const shoulder = new THREE.Group();
    const shoulderBall = new THREE.Mesh(geometric ? new THREE.BoxGeometry(p.armR * 1.8, p.armR * 1.8, p.armR * 1.8) : new THREE.SphereGeometry(p.armR * 0.95, 10, 8), bodyMat);
    shoulder.add(shoulderBall);

    const upper = limbMesh(p.armR, p.upperArmH, bodyMat, geometric);
    upper.position.y = -p.upperArmH / 2;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -p.upperArmH;
    shoulder.add(elbow);
    const elbowBall = new THREE.Mesh(geometric ? new THREE.BoxGeometry(p.armR * 1.6, p.armR * 1.6, p.armR * 1.6) : new THREE.SphereGeometry(p.armR * 0.92, 10, 8), bodyMat);
    elbow.add(elbowBall);

    const forearm = limbMesh(p.armR * 0.9, p.forearmH, bodyMat, geometric);
    forearm.position.y = -p.forearmH / 2;
    elbow.add(forearm);

    const hand = new THREE.Mesh(geometric ? new THREE.BoxGeometry(p.handR * 1.55, p.handR * 1.55, p.handR * 1.55) : new THREE.SphereGeometry(p.handR, 12, 8), bodyMat);
    hand.position.set(0, -p.forearmH - p.handR * 0.7, 0);
    hand.castShadow = true;
    elbow.add(hand);
    return { shoulder, elbow };
}

function limbMesh(radius: number, length: number, material: THREE.Material, geometric: boolean) {
    const geometry = geometric
        ? new THREE.BoxGeometry(radius * 1.45, length, radius * 1.45)
        : new THREE.CapsuleGeometry(radius, Math.max(0.01, length * 0.78), 5, 10);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
}

function bodyProportions(bodyType: DirectorCharacter["bodyType"]): BodyProportions {
    const traits: Record<DirectorCharacter["bodyType"], { height: number; thick: number; torso: number; shoulder: number; hip: number; head: number; hair: BodyProportions["hair"]; geometric?: boolean }> = {
        male: { height: 1.75, thick: 1, torso: 1, shoulder: 1.06, hip: 0.96, head: 1, hair: "short" },
        female: { height: 1.68, thick: 0.86, torso: 0.9, shoulder: 0.76, hip: 1.18, head: 1, hair: "long" },
        broad: { height: 1.72, thick: 1.52, torso: 1.7, shoulder: 1.32, hip: 1.38, head: 0.98, hair: "short" },
        strong: { height: 1.82, thick: 1.26, torso: 1.18, shoulder: 1.46, hip: 1.08, head: 0.98, hair: "short" },
        slim: { height: 1.82, thick: 0.68, torso: 0.76, shoulder: 0.76, hip: 0.9, head: 1, hair: "short" },
        teen: { height: 1.48, thick: 0.78, torso: 0.86, shoulder: 0.84, hip: 0.88, head: 1.14, hair: "short" },
        child: { height: 1.08, thick: 0.82, torso: 0.92, shoulder: 0.78, hip: 0.92, head: 1.55, hair: "short" },
        chibi: { height: 0.96, thick: 0.98, torso: 1.08, shoulder: 0.9, hip: 0.94, head: 1.95, hair: "short" },
        geometric: { height: 1.68, thick: 1, torso: 1, shoulder: 1, hip: 1, head: 1.05, hair: "none", geometric: true },
    };
    const t = traits[bodyType];
    const h = t.height;
    const legH = h * 0.45;
    const armH = h * 0.36;
    return {
        height: h,
        legH,
        thighH: legH * 0.5,
        shinH: legH * 0.45,
        torsoH: h * 0.3,
        torsoR: h * 0.062 * t.thick * t.torso,
        shoulderHalfWidth: h * 0.075 * t.shoulder,
        hipHalfWidth: h * 0.062 * t.hip,
        armH,
        upperArmH: armH * 0.5,
        forearmH: armH * 0.48,
        armR: h * 0.03 * t.thick,
        legR: h * 0.038 * t.thick,
        handR: h * 0.042 * t.thick,
        footHalfW: h * 0.04 * t.thick,
        footHalfL: h * 0.076 * t.thick,
        footHalfH: h * 0.02 * t.thick,
        headR: h * 0.11 * t.head,
        headStretchY: bodyType === "geometric" ? 1 : 1.04,
        hair: t.hair,
        geometric: Boolean(t.geometric),
    };
}

function stashBindPose(group: THREE.Group) {
    const bones = group.userData.bones as DirectorBoneMap | undefined;
    if (!bones) return;
    for (const bone of Object.values(bones)) {
        if (!(bone instanceof THREE.Object3D)) continue;
        bone.userData.bindEuler = [bone.rotation.x, bone.rotation.y, bone.rotation.z];
    }
}

function resetDirectorPose(group: THREE.Group): DirectorBoneMap | null {
    const bones = group.userData.bones as DirectorBoneMap | undefined;
    if (!bones) return null;
    for (const bone of Object.values(bones)) {
        if (!(bone instanceof THREE.Object3D)) continue;
        const bind = bone.userData.bindEuler as [number, number, number] | undefined;
        if (bind) bone.rotation.set(bind[0], bind[1], bind[2]);
        else bone.rotation.set(0, 0, 0);
    }
    group.scale.set(1, 1, 1);
    group.rotation.set(0, 0, 0);
    group.userData.poseYOffset = 0;
    return bones;
}

function applyDirectorPose(group: THREE.Group, action: string) {
    const bones = resetDirectorPose(group);
    if (!bones) return;
    const lower = action.toLowerCase();
    const legH = bones.constants.legH;

    if (lower.includes("半蹲") || (lower.includes("蹲") && (lower.includes("检查") || lower.includes("inspect")))) {
        bones.leftHip.rotation.x += -0.9;
        bones.rightHip.rotation.x += -0.9;
        bones.leftKnee.rotation.x += 0.9;
        bones.rightKnee.rotation.x += 0.9;
        bones.rightShoulder.rotation.x += -1.4;
        bones.rightElbow.rotation.x += -0.2;
        bones.leftShoulder.rotation.x += -0.4;
        bones.leftElbow.rotation.x += -0.3;
        bones.headGroup.rotation.x += -0.3;
        bones.torsoMesh.rotation.x += -0.4;
        group.userData.poseYOffset = -legH * 0.24;
    } else if (lower.includes("坐") || lower.includes("sit")) {
        bones.leftHip.rotation.x += -Math.PI / 2;
        bones.rightHip.rotation.x += -Math.PI / 2;
        bones.leftKnee.rotation.x += Math.PI / 2 - 0.05;
        bones.rightKnee.rotation.x += Math.PI / 2 - 0.05;
        bones.leftShoulder.rotation.x += -0.4;
        bones.rightShoulder.rotation.x += -0.4;
        bones.leftElbow.rotation.x += -0.55;
        bones.rightElbow.rotation.x += -0.55;
        group.userData.poseYOffset = -legH * 0.5;
    } else if (lower.includes("蹲") || lower.includes("squat") || lower.includes("crouch")) {
        bones.leftHip.rotation.x += -1.8;
        bones.rightHip.rotation.x += -1.8;
        bones.leftKnee.rotation.x += 1.8;
        bones.rightKnee.rotation.x += 1.8;
        bones.torsoMesh.rotation.x += -0.4;
        bones.leftShoulder.rotation.x += -0.5;
        bones.rightShoulder.rotation.x += -0.5;
        bones.leftElbow.rotation.x += -0.4;
        bones.rightElbow.rotation.x += -0.4;
        group.userData.poseYOffset = -legH * 0.66;
    } else if (lower.includes("躺") || lower.includes("lying") || lower.includes("lie")) {
        group.rotation.x = -Math.PI / 2;
    } else if (lower.includes("跳") || lower.includes("jump")) {
        group.userData.poseYOffset = 0.4;
        bones.leftHip.rotation.x += -0.5;
        bones.rightHip.rotation.x += -0.5;
        bones.leftKnee.rotation.x += 1.0;
        bones.rightKnee.rotation.x += 1.0;
        bones.leftShoulder.rotation.x += -2.4;
        bones.rightShoulder.rotation.x += -2.4;
        bones.leftElbow.rotation.x += 0.1;
        bones.rightElbow.rotation.x += 0.1;
    } else if (lower.includes("奔跑") || lower.includes("跑") || lower.includes("run")) {
        bones.leftHip.rotation.x += -1.0;
        bones.rightHip.rotation.x += 0.6;
        bones.leftKnee.rotation.x += 1.5;
        bones.rightKnee.rotation.x += 0.2;
        bones.rightShoulder.rotation.x += -0.9;
        bones.rightElbow.rotation.x += -0.9;
        bones.leftShoulder.rotation.x += 0.7;
        bones.leftElbow.rotation.x += -0.9;
        bones.torsoMesh.rotation.x += -0.25;
        bones.headGroup.rotation.x += -0.1;
    } else if (lower.includes("行走") || lower.includes("走") || lower.includes("walk")) {
        bones.leftHip.rotation.x += -0.55;
        bones.rightHip.rotation.x += 0.3;
        bones.leftKnee.rotation.x += 0.55;
        bones.rightKnee.rotation.x += 0.1;
        bones.rightShoulder.rotation.x += -0.45;
        bones.rightElbow.rotation.x += -0.45;
        bones.leftShoulder.rotation.x += 0.4;
        bones.leftElbow.rotation.x += -0.4;
    } else if (lower.includes("伸手") || lower.includes("指向") || lower.includes("point") || lower.includes("reach")) {
        bones.rightShoulder.rotation.x += -Math.PI / 2;
        bones.rightElbow.rotation.x += -0.1;
        bones.headGroup.rotation.x += -0.05;
    } else if (lower.includes("对话") || lower.includes("talk") || lower.includes("chat") || lower.includes("speak")) {
        bones.rightShoulder.rotation.x += -0.5;
        bones.rightShoulder.rotation.z += -0.2;
        bones.rightElbow.rotation.x += -1.3;
        bones.headGroup.rotation.y += 0.25;
        bones.leftShoulder.rotation.x += 0.05;
    } else if (lower.includes("观察") || lower.includes("observe") || lower.includes("look")) {
        bones.rightShoulder.rotation.x += -1.7;
        bones.rightShoulder.rotation.z += 0.3;
        bones.rightElbow.rotation.x += -0.5;
        bones.headGroup.rotation.x += -0.18;
        bones.headGroup.rotation.y += 0.1;
    }
}

function createLabelSprite(text: string, color: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 72;
    const context = canvas.getContext("2d");
    if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "rgba(0,0,0,0.62)";
        roundRect(context, 16, 10, 224, 44, 14);
        context.fill();
        context.strokeStyle = color;
        context.lineWidth = 3;
        roundRect(context, 16, 10, 224, 44, 14);
        context.stroke();
        context.font = "600 26px sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#ffffff";
        context.fillText(text.slice(0, 12), 128, 33);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.06, 0.3, 1);
    sprite.renderOrder = 60;
    return sprite;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
}

function pickCharacterFromPointer(event: PointerEvent, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, root: THREE.Group) {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(root.children, true);
    for (const hit of intersections) {
        let current: THREE.Object3D | null = hit.object;
        while (current) {
            const id = current.userData.characterId;
            if (typeof id === "string") return id;
            current = current.parent;
        }
    }
    return null;
}

function clearGroup(group: THREE.Group) {
    while (group.children.length) {
        const child = group.children[0];
        group.remove(child);
        child.traverse(disposeObject3D);
    }
}

function disposeObject3D(object: THREE.Object3D) {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
}

function disposeMaterial(material: THREE.Material) {
    const textureKeys = ["map", "alphaMap", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"] as const;
    textureKeys.forEach((key) => {
        const texture = (material as THREE.Material & Partial<Record<typeof key, THREE.Texture>>)[key];
        texture?.dispose?.();
    });
    material.dispose();
}

function degToRad(value: number) {
    return (value * Math.PI) / 180;
}
