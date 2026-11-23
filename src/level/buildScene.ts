import * as THREE from 'three';
import { ColliderBox, SurfaceTag, WAYPOINTS } from './levelData';
import { createProceduralTextures } from './textures';
import { EchoShaderManager } from '../shaders/echoMaterial';

export interface TrafficVisual {
  group: THREE.Group;
  direction: 1 | -1;
  speed: number;
  laneZ: number;
  active: boolean;
}

export interface EscortVisualRig {
  pedestrianGroup: THREE.Group;
  pedestrianHaloLight: THREE.PointLight;
  headGroup: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  rightForearmMesh: THREE.Mesh;
  rightHandMesh: THREE.Mesh;
  playerLeftArmRoot: THREE.Group;
  playerLeftClaspMarker: THREE.Object3D;
  joinedHandsLight: THREE.PointLight;
  updateHandClasp: (
    dt: number,
    holdingBlend: number,
    stridePhase: number,
    strideAmp: number,
    camera: THREE.PerspectiveCamera
  ) => void;
}

export interface BuiltSceneResult {
  raycastTargets: THREE.Object3D[];
  reflectiveGroundMeshes: THREE.Object3D[];
  foyerDoorPivot: THREE.Group;
  doorCrackLight: THREE.PointLight;
  doorSliverMesh: THREE.Mesh;
  doorShaftMesh: THREE.Mesh;
  canePickupGroup: THREE.Group;
  catGroup: THREE.Group;
  catPointLight: THREE.PointLight;
  stallPointLight: THREE.PointLight;
  barrierBeaconLight: THREE.PointLight;
  barrierBeaconBulb: THREE.Mesh;
  pedestrianGroup: THREE.Group;
  pedestrianHaloLight: THREE.PointLight;
  escortRig: EscortVisualRig;
  signalRedLens: THREE.Mesh;
  signalGreenLens: THREE.Mesh;
  signalLight: THREE.PointLight;
  sunsetDirLight: THREE.DirectionalLight;
  moonDirLight: THREE.DirectionalLight;
  ambientHemiLight: THREE.HemisphereLight;
  sunsetGodRays: THREE.Group;
  debugWireframeGroup: THREE.Group;
  trafficStreaks: TrafficVisual[];
  spawnSparkles: (origin: THREE.Vector3, isWarm: boolean) => void;
  setPedestrianSignalGreen: (isGreen: boolean) => void;
  setShadowsEnabled: (enabled: boolean, mapSize: number) => void;
  updateParticlesAndProps: (
    dt: number,
    elapsed: number,
    doorOpenTarget: number,
    sunsetFactor: number,
    worldVisibility: number
  ) => void;
  rebuildDebugWireframes: (colliders: ColliderBox[]) => void;
}

function tagObjectTree(obj: THREE.Object3D, tag: SurfaceTag): void {
  obj.userData.surfaceTag = tag;
  obj.traverse((child) => {
    child.userData.surfaceTag = tag;
  });
}

function enableShadows(obj: THREE.Object3D, cast: boolean, receive: boolean): void {
  obj.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });
}

/**
 * Fresnel-faded additive volumetric light cone shader (adapted from baks/index.html SHADER 39).
 */
function createVolumetricCone(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  colorHex: string,
  gain = 0.22
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 20, 1, true);
  geo.translate(0, -height / 2, 0);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uGain: { value: gain },
    },
    vertexShader: /* glsl */ `
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vT = 1.0 - uv.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uGain;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        f = f * f * (3.0 - 2.0 * f);
        float t = clamp(vT, 0.0, 1.0);
        float k = pow(1.0 - t, 1.75) * (0.3 + 0.7 * smoothstep(0.0, 0.08, t));
        gl_FragColor = vec4(uColor * (uGain * f * k), 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  return mesh;
}

export function buildGameScene(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  echoManager: EchoShaderManager,
  colliders: ColliderBox[]
): BuiltSceneResult {
  const tex = createProceduralTextures();
  const raycastTargets: THREE.Object3D[] = [];
  const reflectiveGroundMeshes: THREE.Object3D[] = [];

  const registerTarget = (
    obj: THREE.Object3D,
    tag: SurfaceTag,
    castShadow = true,
    receiveShadow = true
  ) => {
    tagObjectTree(obj, tag);
    enableShadows(obj, castShadow, receiveShadow);
    scene.add(obj);
    raycastTargets.push(obj);
  };

  // === Lighting Setup ===
  const ambientHemiLight = new THREE.HemisphereLight('#8ba7cc', '#221c18', 0.85);
  scene.add(ambientHemiLight);

  const moonDirLight = new THREE.DirectionalLight('#b9d0ea', 0.72);
  moonDirLight.position.set(6, 15, 4);
  scene.add(moonDirLight);

  // Main Shadow-Casting Low-Angle Sunset Key Light (pours down -Z urban canyon!)
  const sunsetDirLight = new THREE.DirectionalLight('#ff9a3c', 0.25);
  sunsetDirLight.position.set(1.5, 8.5, -56);
  sunsetDirLight.target.position.set(0, 0, -24);
  sunsetDirLight.castShadow = true;
  sunsetDirLight.shadow.mapSize.set(2048, 2048);
  sunsetDirLight.shadow.camera.near = 2;
  sunsetDirLight.shadow.camera.far = 75;
  sunsetDirLight.shadow.camera.left = -12;
  sunsetDirLight.shadow.camera.right = 12;
  sunsetDirLight.shadow.camera.top = 12;
  sunsetDirLight.shadow.camera.bottom = -12;
  sunsetDirLight.shadow.bias = -0.0005;
  sunsetDirLight.shadow.normalBias = 0.02;
  scene.add(sunsetDirLight);
  scene.add(sunsetDirLight.target);

  // === Shared Enhanced PBR Materials (True Tangent-Space NormalMaps!) ===
  const matInteriorFloor = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.interiorTile.map,
      normalMap: tex.interiorTile.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: tex.interiorTile.roughnessMap,
      roughness: 0.72,
      metalness: 0.1,
    })
  );

  const matPlasterWall = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.plasterWall.map,
      normalMap: tex.plasterWall.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.86,
      metalness: 0.03,
    })
  );

  const matBrickWall = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.brickWall.map,
      normalMap: tex.brickWall.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 0.82,
      metalness: 0.05,
    })
  );

  const matShutter = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.shutterMetal.map,
      normalMap: tex.shutterMetal.normalMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: tex.shutterMetal.roughnessMap,
      roughness: 0.55,
      metalness: 0.52,
    })
  );

  // Wet Reflective Ground Materials (inject dynamic puddles + rain ripples + planar reflection!)
  const matWetSidewalk = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.wetSidewalk.map,
      normalMap: tex.wetSidewalk.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: tex.wetSidewalk.roughnessMap,
      roughness: 0.48,
      metalness: 0.16,
    }),
    { isWetGround: true }
  );

  const matWetAsphalt = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.wetAsphalt.map,
      normalMap: tex.wetAsphalt.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: tex.wetAsphalt.roughnessMap,
      roughness: 0.38,
      metalness: 0.2,
    }),
    { isWetGround: true }
  );

  const matTactileLine = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.tactileLine.map,
      normalMap: tex.tactileLine.normalMap,
      normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: tex.tactileLine.roughnessMap,
      roughness: 0.42,
      metalness: 0.12,
    }),
    { isWetGround: true }
  );

  const matTactileDot = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.tactileDot.map,
      normalMap: tex.tactileDot.normalMap,
      normalScale: new THREE.Vector2(1.5, 1.5),
      roughnessMap: tex.tactileDot.roughnessMap,
      roughness: 0.42,
      metalness: 0.12,
    }),
    { isWetGround: true }
  );

  const matCrosswalkBar = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.crosswalk.map,
      normalMap: tex.crosswalk.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: tex.crosswalk.roughnessMap,
      roughness: 0.36,
      metalness: 0.14,
    }),
    { isWetGround: true }
  );

  const matDarkWood = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.darkWood.map,
      normalMap: tex.darkWood.normalMap,
      roughness: 0.62,
      metalness: 0.08,
    })
  );

  const matWarmWood = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.warmWood.map,
      normalMap: tex.warmWood.normalMap,
      roughness: 0.66,
      metalness: 0.06,
    })
  );

  const matBamboo = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.bamboo.map,
      normalMap: tex.bamboo.normalMap,
      roughness: 0.74,
      metalness: 0.04,
    })
  );

  const matBarrierBoard = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.barrierStripe.map,
      normalMap: tex.barrierStripe.normalMap,
      roughness: 0.48,
      metalness: 0.16,
    })
  );

  const matSecurityMetal = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      color: '#636d7c',
      roughness: 0.36,
      metalness: 0.72,
    }),
    { selfGlowBoost: 0.04 }
  );

  const matDarkIron = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      color: '#252b34',
      roughness: 0.42,
      metalness: 0.78,
    })
  );

  const matStoneCurb = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      color: '#525965',
      roughness: 0.58,
      metalness: 0.1,
    })
  );

  const matPorcelain = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.32, metalness: 0.08 })
  );

  // =========================================================================
  // SCENE 1: LIVED-IN RAINY-EVENING FOYER (Z = +2.5 to -5.5)
  // =========================================================================
  const foyerFloor = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 8.2), matInteriorFloor);
  foyerFloor.rotation.x = -Math.PI / 2;
  foyerFloor.position.set(0, 0.01, -1.45);
  registerTarget(foyerFloor, 'interior_tile', false, true);

  const matDoormat = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#4a3b2e', roughness: 0.96 })
  );
  const doormat = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.02, 0.72), matDoormat);
  doormat.position.set(0, 0.02, -4.75);
  registerTarget(doormat, 'interior_tile', false, true);

  const foyerCeiling = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 8.2), matPlasterWall);
  foyerCeiling.rotation.x = Math.PI / 2;
  foyerCeiling.position.set(0, 2.8, -1.45);
  scene.add(foyerCeiling);

  // Walls + Baseboard Trim
  const foyerLeftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 8.2), matPlasterWall);
  foyerLeftWall.position.set(-1.98, 1.4, -1.45);
  registerTarget(foyerLeftWall, 'wall', true, true);

  const foyerRightWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 8.2), matPlasterWall);
  foyerRightWall.position.set(1.98, 1.4, -1.45);
  registerTarget(foyerRightWall, 'wall', true, true);

  const foyerBackWall = new THREE.Mesh(new THREE.BoxGeometry(4.1, 2.8, 0.2), matPlasterWall);
  foyerBackWall.position.set(0, 1.4, 2.55);
  registerTarget(foyerBackWall, 'wall', true, true);

  for (const sx of [-1.88, 1.88]) {
    const baseboard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 8.0), matDarkWood);
    baseboard.position.set(sx, 0.07, -1.45);
    scene.add(baseboard);
  }

  // Front Wall around Doorway
  const doorWallLeft = new THREE.Mesh(new THREE.BoxGeometry(3.9, 3.6, 0.26), matPlasterWall);
  doorWallLeft.position.set(-2.57, 1.8, -5.5);
  registerTarget(doorWallLeft, 'wall', true, true);

  const doorWallRight = new THREE.Mesh(new THREE.BoxGeometry(3.9, 3.6, 0.26), matPlasterWall);
  doorWallRight.position.set(2.57, 1.8, -5.5);
  registerTarget(doorWallRight, 'wall', true, true);

  const doorHeader = new THREE.Mesh(new THREE.BoxGeometry(1.32, 1.38, 0.26), matPlasterWall);
  doorHeader.position.set(0, 2.91, -5.5);
  registerTarget(doorHeader, 'wall', true, true);

  // Left Walnut Shoe Cabinet + Slippers + Umbrella Stand (Ref Image 1)
  const cabinetGroup = new THREE.Group();
  cabinetGroup.position.set(-1.62, 0, -2.25);

  const cabBody = new THREE.Mesh(new THREE.BoxGeometry(0.54, 1.04, 1.85), matDarkWood);
  cabBody.position.y = 0.56;
  cabinetGroup.add(cabBody);

  const cabTop = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 1.92), matDarkWood);
  cabTop.position.y = 1.09;
  cabinetGroup.add(cabTop);

  for (let d = 0; d < 3; d++) {
    const dy = 0.24 + d * 0.28;
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 1.12), matDarkWood);
    drawer.position.set(0.275, dy, 0.28);
    cabinetGroup.add(drawer);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.18), matSecurityMetal);
    handle.position.set(0.3, dy + 0.03, 0.28);
    cabinetGroup.add(handle);
  }
  for (let b = 0; b < 4; b++) {
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.04, 0.14 + (b % 2) * 0.06, 10),
      matPorcelain
    );
    bottle.position.set(-0.04 + (b % 2) * 0.1, 1.18, -0.55 + b * 0.26);
    cabinetGroup.add(bottle);
  }
  for (let s = 0; s < 3; s++) {
    const slipper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.11), matPorcelain);
    slipper.position.set(0.26, 0.03, -0.5 + s * 0.35);
    cabinetGroup.add(slipper);
  }
  registerTarget(cabinetGroup, 'stall', true, true);

  // Intercom with tiny emerald standby LED + wall switch
  const wallSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.12), matPorcelain);
  wallSwitch.position.set(1.88, 1.32, -2.0);
  scene.add(wallSwitch);

  const intercom = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.2), matPorcelain);
  intercom.position.set(1.26, 1.48, -5.35);
  scene.add(intercom);
  const intercomLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 8),
    new THREE.MeshBasicMaterial({ color: '#38bdf8' })
  );
  intercomLed.position.set(1.31, 1.56, -5.32);
  scene.add(intercomLed);

  // Right Wall Leaning Guide Cane Pickup
  const canePickupGroup = new THREE.Group();
  canePickupGroup.position.set(WAYPOINTS.canePickupPos.x, 0, WAYPOINTS.canePickupPos.z);

  const matCaneWhite = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.24, metalness: 0.18 }),
    { selfGlowBoost: 0.38 }
  );
  const matCaneRed = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.26, metalness: 0.22 }),
    { selfGlowBoost: 0.38 }
  );
  const matCaneGrip = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.8 })
  );

  const leaningPivot = new THREE.Group();
  leaningPivot.rotation.z = -0.21;
  leaningPivot.rotation.x = 0.06;

  const rollerBall = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), matCaneWhite);
  rollerBall.position.y = 0.028;
  leaningPivot.add(rollerBall);

  const redShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.34, 10), matCaneRed);
  redShaft.position.y = 0.2;
  leaningPivot.add(redShaft);

  const whiteShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.013, 0.013, 0.68, 10),
    matCaneWhite
  );
  whiteShaft.position.y = 0.71;
  leaningPivot.add(whiteShaft);

  const gripMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.016, 0.22, 10), matCaneGrip);
  gripMesh.position.y = 1.16;
  leaningPivot.add(gripMesh);

  const caneHintAura = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, 1.24, 12),
    new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  caneHintAura.position.y = 0.64;
  leaningPivot.add(caneHintAura);

  canePickupGroup.add(leaningPivot);
  registerTarget(canePickupGroup, 'cane_pickup', true, false);

  // Security Door + Cold Volumetric Light Sliver
  for (const fx of [-0.62, 0.62]) {
    const fbar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.26, 0.28), matDarkIron);
    fbar.position.set(fx, 1.13, -5.5);
    scene.add(fbar);
  }
  const fTop = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.07, 0.28), matDarkIron);
  fTop.position.set(0, 2.24, -5.5);
  scene.add(fTop);

  const foyerDoorPivot = new THREE.Group();
  foyerDoorPivot.position.set(-0.58, 0, -5.5);
  foyerDoorPivot.rotation.y = 0.14;

  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(1.16, 2.2, 0.06), matSecurityMetal);
  doorLeaf.position.set(0.58, 1.11, 0);
  foyerDoorPivot.add(doorLeaf);

  const doorHandlePlate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.09), matDarkIron);
  doorHandlePlate.position.set(1.04, 1.05, 0);
  foyerDoorPivot.add(doorHandlePlate);

  const doorLever = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.12), matPorcelain);
  doorLever.position.set(1.0, 1.05, 0.04);
  foyerDoorPivot.add(doorLever);

  registerTarget(foyerDoorPivot, 'door', true, true);

  const doorSliverMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.08, 2.18),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.4, 2.1, 2.8),
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    })
  );
  doorSliverMesh.position.set(0.56, 1.1, -5.53);
  scene.add(doorSliverMesh);

  // Subtle volumetric light blade spilling inside from door crack!
  const doorShaftMesh = createVolumetricCone(0.05, 0.65, 2.4, '#7dd3fc', 0.16);
  doorShaftMesh.position.set(0.55, 1.25, -5.4);
  doorShaftMesh.rotation.x = Math.PI / 2 - 0.15;
  doorShaftMesh.rotation.z = 0.18;
  scene.add(doorShaftMesh);

  const doorCrackLight = new THREE.PointLight('#7dd3fc', 1.4, 4.6, 1.7);
  doorCrackLight.position.set(0.45, 1.2, -5.25);
  scene.add(doorCrackLight);

  // =========================================================================
  // SCENE 2: RAIN-SLICKED URBAN OLD-STREET CANYON (Z = -5.5 to -32.3)
  // =========================================================================
  const sidewalkMain = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 26.9), matWetSidewalk);
  sidewalkMain.position.set(-0.8, 0.04, -18.95);
  registerTarget(sidewalkMain, 'normal', false, true);
  reflectiveGroundMeshes.push(sidewalkMain);

  const rightCurb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 26.9), matStoneCurb);
  rightCurb.position.set(2.86, 0.06, -18.95);
  registerTarget(rightCurb, 'normal', true, true);

  // Storm drain grates along curb
  for (const gz of [-9.0, -16.5, -24.5, -30.5]) {
    const grate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.018, 0.56), matDarkIron);
    grate.position.set(3.15, 0.008, gz);
    scene.add(grate);
  }

  // Wet Asphalt Street & Wide Crosswalk Roadway
  const streetAsphalt = new THREE.Mesh(new THREE.PlaneGeometry(68, 56), matWetAsphalt);
  streetAsphalt.rotation.x = -Math.PI / 2;
  streetAsphalt.position.set(4.0, 0.0, -29.5);
  registerTarget(streetAsphalt, 'normal', false, true);
  reflectiveGroundMeshes.push(streetAsphalt);

  // Raised Yellow Tactile Guiding Strip along X = 0
  const tactileStripLen = 25.25;
  const tactileStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.024, tactileStripLen),
    matTactileLine
  );
  tactileStrip.position.set(0, 0.092, -6.1 - tactileStripLen / 2);
  registerTarget(tactileStrip, 'tactile_line', false, true);
  reflectiveGroundMeshes.push(tactileStrip);

  const entryDotPad = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.024, 0.48), matTactileDot);
  entryDotPad.position.set(0, 0.092, -5.85);
  registerTarget(entryDotPad, 'tactile_dot', false, true);
  reflectiveGroundMeshes.push(entryDotPad);

  // --- Architectural Left Shophouse Facades (Layered 3-Story Old Street!) ---
  const leftFacade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8.8, 27.2), matBrickWall);
  leftFacade.position.set(-4.45, 4.4, -19.0);
  registerTarget(leftFacade, 'wall', true, true);

  // Upper floor architectural concrete ledge & glowing apartment windows
  const facadeCornice = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.24, 27.2), matStoneCurb);
  facadeCornice.position.set(-4.2, 3.65, -19.0);
  scene.add(facadeCornice);

  const windowWarmMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.4, 0.95, 0.48),
  });
  const streetLampCones: THREE.Mesh[] = [];
  const streetLampBulbs: THREE.MeshBasicMaterial[] = [];
  const windowDimMat = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#1b2736', roughness: 0.15, metalness: 0.85 })
  );

  for (let wz = -8.5; wz >= -29.5; wz -= 3.6) {
    // 2nd floor windows (some warmly lit to reflect in wet street!)
    const lit = Math.abs(Math.sin(wz * 1.7)) > 0.45;
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.35, 1.45), matDarkIron);
    winFrame.position.set(-4.22, 5.1, wz);
    scene.add(winFrame);

    const winPane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 1.2),
      lit ? windowWarmMat : windowDimMat
    );
    winPane.rotation.y = Math.PI / 2;
    winPane.position.set(-4.15, 5.1, wz);
    scene.add(winPane);

    // AC outdoor condenser box below window
    if (Math.sin(wz * 3.1) > -0.2) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.48, 0.72), matSecurityMetal);
      ac.position.set(-4.1, 4.15, wz + 0.9);
      scene.add(ac);
    }
  }

  // Ground-floor rolling metal shutters (Z = -9.5 and Z = -16.5)
  for (const sz of [-9.5, -17.5]) {
    const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.65, 3.4), matShutter);
    shutter.position.set(-4.2, 1.4, sz);
    registerTarget(shutter, 'wall', true, true);

    const awning = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 3.6), matDarkIron);
    awning.position.set(-3.8, 2.85, sz);
    awning.rotation.z = -0.18;
    scene.add(awning);
  }

  // Glowing 24H Convenience Store Signboard (Ref Image 2!)
  const convSignMat = new THREE.MeshBasicMaterial({
    map: tex.convenienceSign,
    color: new THREE.Color(1.25, 1.2, 1.15),
  });
  const convSign = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 3.2), convSignMat);
  convSign.position.set(-4.12, 3.18, -19.2);
  scene.add(convSign);

  const convLight = new THREE.PointLight('#ffd699', 1.45, 7.5, 1.6);
  convLight.position.set(-3.5, 2.9, -19.2);
  scene.add(convLight);

  // Opposite Street Low Shopfront Silhouette (Right side X = +10.8 so sky canyon feels real!)
  const rightCityBlock = new THREE.Mesh(new THREE.BoxGeometry(3.2, 8.2, 30.0), matBrickWall);
  rightCityBlock.position.set(12.2, 4.1, -18.5);
  scene.add(rightCityBlock);

  for (let wz = -9; wz >= -29; wz -= 4.5) {
    if (Math.cos(wz * 2.1) > 0.1) {
      const rWin = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), windowWarmMat);
      rWin.rotation.y = -Math.PI / 2;
      rWin.position.set(10.55, 4.8, wz);
      scene.add(rWin);
    }
  }

  // Overhead Utility Cables Draped Across Street Canyon!
  const cableMat = new THREE.LineBasicMaterial({ color: '#0f1318', transparent: true, opacity: 0.75 });
  for (const cz of [-12.0, -21.0, -30.0, -42.6]) {
    for (const cy of [6.1, 6.55]) {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-4.2, cy, cz),
        new THREE.Vector3(3.2, cy - 0.85, cz - 0.4),
        new THREE.Vector3(10.6, cy + 0.15, cz)
      );
      const pts = curve.getPoints(16);
      const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat);
      scene.add(cable);
    }
  }

  // Roadside Wrought-Iron Guardrail Segments (Right Sidewalk Edge)
  for (const gz of [-8.0, -14.2, -23.0, -29.2]) {
    const railGroup = new THREE.Group();
    railGroup.position.set(2.92, 0.1, gz);
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 2.4), matDarkIron);
    topBar.position.y = 0.78;
    railGroup.add(topBar);
    const midBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 2.4), matDarkIron);
    midBar.position.y = 0.42;
    railGroup.add(midBar);
    for (const pz of [-1.1, 0, 1.1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.82, 0.05), matDarkIron);
      post.position.set(0, 0.41, pz);
      railGroup.add(post);
    }
    scene.add(railGroup);
  }

  // --- Hero Shared Bikes (Z = -13.5, Detailed Metal Frames + Blinking Smart Lock LED!) ---
  const createSharedBike = (hexColor: string): THREE.Group => {
    const bike = new THREE.Group();
    const matFrame = echoManager.enhanceMaterial(
      new THREE.MeshStandardMaterial({
        color: hexColor,
        roughness: 0.24,
        metalness: 0.72,
      })
    );
    const matTire = echoManager.enhanceMaterial(
      new THREE.MeshStandardMaterial({ color: '#14171c', roughness: 0.82 })
    );

    const wheelRadius = 0.31;
    for (const wx of [-0.52, 0.52]) {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(wx, wheelRadius, 0);

      wheelGroup.add(new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, 0.032, 12, 28), matTire));
      wheelGroup.add(
        new THREE.Mesh(new THREE.TorusGeometry(wheelRadius - 0.024, 0.013, 8, 24), matFrame)
      );
      wheelGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10), matSecurityMetal));

      for (let s = 0; s < 8; s++) {
        const spoke = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0028, 0.0028, wheelRadius * 1.9, 6),
          matSecurityMetal
        );
        spoke.rotation.z = (s * Math.PI) / 8;
        wheelGroup.add(spoke);
      }
      bike.add(wheelGroup);
    }

    const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.78, 12), matFrame);
    downTube.position.set(0.14, 0.48, 0);
    downTube.rotation.z = 0.78;
    bike.add(downTube);

    const seatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 12), matFrame);
    seatTube.position.set(-0.16, 0.54, 0);
    seatTube.rotation.z = 0.22;
    bike.add(seatTube);

    const rearStay = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.48, 8), matFrame);
    rearStay.position.set(-0.34, 0.42, 0);
    rearStay.rotation.z = -0.58;
    bike.add(rearStay);

    // Rear smart-lock housing + glowing tiny cyan status LED
    const lockBox = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.08), matDarkIron);
    lockBox.position.set(-0.34, 0.55, 0);
    bike.add(lockBox);

    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.68, 10), matFrame);
    fork.position.set(0.46, 0.58, 0);
    fork.rotation.z = 0.2;
    bike.add(fork);

    const handlebar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.56, 10),
      matDarkIron
    );
    handlebar.rotation.x = Math.PI / 2;
    handlebar.position.set(0.39, 0.92, 0);
    bike.add(handlebar);

    // Front basket (wireframe + solid bottom tray)
    const basket = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.22, 0.32),
      echoManager.enhanceMaterial(
        new THREE.MeshStandardMaterial({
          color: '#1e252e',
          roughness: 0.45,
          metalness: 0.75,
          wireframe: true,
        })
      )
    );
    basket.position.set(0.56, 0.78, 0);
    bike.add(basket);

    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.065, 0.16), matTire);
    saddle.position.set(-0.22, 0.85, 0);
    bike.add(saddle);

    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 6), matDarkIron);
    stand.position.set(-0.08, 0.16, 0.09);
    stand.rotation.x = 0.35;
    bike.add(stand);

    return bike;
  };

  const bikeYellow = createSharedBike('#eab308');
  bikeYellow.position.set(-0.22, 0.08, -13.25);
  bikeYellow.rotation.y = 0.68;
  registerTarget(bikeYellow, 'bike', true, true);

  const bikeBlue = createSharedBike('#38bdf8');
  bikeBlue.position.set(0.32, 0.08, -13.78);
  bikeBlue.rotation.y = 0.48;
  registerTarget(bikeBlue, 'bike', true, true);

  // --- Construction Barrier (Z = -21.5) + Blinking Amber Warning Beacon + Traffic Cones! ---
  const barrierGroup = new THREE.Group();
  barrierGroup.position.set(0, 0.08, -21.5);
  barrierGroup.rotation.y = -0.06;

  const topBoard = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.28, 0.065), matBarrierBoard);
  topBoard.position.y = 0.88;
  barrierGroup.add(topBoard);

  const botBoard = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.28, 0.065), matBarrierBoard);
  botBoard.position.y = 0.42;
  barrierGroup.add(botBoard);

  for (const sideX of [-0.82, 0.82]) {
    for (const tilt of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.14, 0.06), matSecurityMetal);
      leg.position.set(sideX, 0.54, tilt * 0.18);
      leg.rotation.x = tilt * 0.32;
      barrierGroup.add(leg);
    }
  }

  // Blinking Amber Construction Warning Beacon on top (HDR bloom + puddle reflection!)
  const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.09, 10), matDarkIron);
  beaconBase.position.set(0.76, 1.06, 0);
  barrierGroup.add(beaconBase);

  const barrierBeaconBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.062, 12, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.35, 0.2) })
  );
  barrierBeaconBulb.position.set(0.76, 1.15, 0);
  barrierGroup.add(barrierBeaconBulb);

  const barrierBeaconLight = new THREE.PointLight('#ff8c1a', 1.8, 5.2, 1.7);
  barrierBeaconLight.position.set(0.76, 1.28, -21.45);
  scene.add(barrierBeaconLight);

  // Flanking Traffic Cones (inspired by baks/index.html!)
  const matConeOrange = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#ea580c', roughness: 0.42, metalness: 0.08 })
  );
  const matConeWhite = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.3 }),
    { selfGlowBoost: 0.12 }
  );
  for (const cx of [-1.25, 1.25]) {
    const cone = new THREE.Group();
    cone.position.set(cx, 0, cx > 0 ? 0.35 : -0.25);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.32), matDarkIron);
    base.position.y = 0.018;
    cone.add(base);
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.56, 12), matConeOrange);
    body.position.y = 0.3;
    cone.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 0.11, 12), matConeWhite);
    band.position.y = 0.36;
    cone.add(band);
    barrierGroup.add(cone);
  }
  registerTarget(barrierGroup, 'barrier', true, true);

  // --- Gooseneck Streetlamps with Volumetric Light Cones! ---
  for (const lz of [-16.8, -28.2]) {
    const poleGroup = new THREE.Group();
    poleGroup.position.set(1.62, 0.08, lz);
    const poleBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 1.2, 12),
      matSecurityMetal
    );
    poleBase.position.y = 0.6;
    poleGroup.add(poleBase);
    const poleUpper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.08, 4.1, 12),
      matSecurityMetal
    );
    poleUpper.position.y = 3.25;
    poleGroup.add(poleUpper);

    // Overhanging lamp arm toward tactile path
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 1.15, 8), matDarkIron);
    arm.rotation.z = Math.PI / 2 - 0.18;
    arm.position.set(-0.52, 5.18, 0);
    poleGroup.add(arm);

    const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.18), matDarkIron);
    lampHead.position.set(-1.05, 5.26, 0);
    poleGroup.add(lampHead);

    const lampBulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.65, 0.78) });
    streetLampBulbs.push(lampBulbMat);
    const lampBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 8),
      lampBulbMat
    );
    lampBulb.scale.set(1.2, 0.55, 1.0);
    lampBulb.position.set(-1.05, 5.2, 0);
    poleGroup.add(lampBulb);

    // Volumetric mist cone under lamp!
    const cone = createVolumetricCone(0.18, 2.35, 5.1, '#ffcf86', 0.12);
    cone.position.set(-1.05, 5.18, 0);
    poleGroup.add(cone);
    streetLampCones.push(cone);

    const lampLight = new THREE.PointLight('#ffbf69', 2.2, 9.5, 1.6);
    lampLight.position.set(1.62 - 1.05, 5.0, lz);
    scene.add(lampLight);

    registerTarget(poleGroup, 'normal', true, true);
  }

  // --- Street Trees with Rain-Glistening Autumn Foliage ---
  const matLeafFoliage = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#424d36', roughness: 0.72 })
  );
  for (const tz of [-10.2, -18.6]) {
    const treeGroup = new THREE.Group();
    treeGroup.position.set(2.75, 0.08, tz);
    const pitRim = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.08, 0.76), matStoneCurb);
    pitRim.position.y = 0.04;
    treeGroup.add(pitRim);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 3.6, 8), matDarkWood);
    trunk.position.y = 1.8;
    treeGroup.add(trunk);
    for (let c = 0; c < 4; c++) {
      const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.95 + (c % 2) * 0.25, 1), matLeafFoliage);
      crown.position.set((c - 1.5) * 0.35, 3.8 + (c % 2) * 0.45, ((c * 1.3) % 1 - 0.5) * 0.5);
      treeGroup.add(crown);
    }
    registerTarget(treeGroup, 'normal', true, true);
  }

  // Scattered Wet Golden Ginkgo Leaves on Sidewalk & Curb
  const leafMat = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#c48329', roughness: 0.35, side: THREE.DoubleSide })
  );
  const leafGeo = new THREE.PlaneGeometry(0.11, 0.068);
  for (let i = 0; i < 85; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.rotation.x = -Math.PI / 2;
    leaf.rotation.z = (i * 1.7) % (Math.PI * 2);
    const lx = -3.4 + ((i * 2.37) % 7.2);
    const lz = -7.2 - ((i * 3.91) % 25.0);
    leaf.position.set(lx, lx > 2.85 ? 0.012 : 0.09, lz);
    scene.add(leaf);
  }

  // =========================================================================
  // SCENE 3: WARM STREET-CORNER BREAKFAST STALL & STREET CAT (Z = -24.6)
  // =========================================================================
  const stallGroup = new THREE.Group();
  stallGroup.position.set(-3.15, 0.08, -24.6);

  const counterBase = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.96, 3.1), matWarmWood);
  counterBase.position.set(-0.1, 0.48, 0);
  stallGroup.add(counterBase);

  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.07, 3.28), matDarkWood);
  counterTop.position.set(-0.02, 0.99, 0);
  stallGroup.add(counterTop);

  for (const px of [-0.9, 0.84]) {
    for (const pz of [-1.48, 1.48]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.58, 0.1), matDarkWood);
      post.position.set(px, 1.29, pz);
      stallGroup.add(post);
    }
  }
  const stallRoof = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.1, 3.65), matDarkWood);
  stallRoof.position.set(0.12, 2.6, 0);
  stallRoof.rotation.z = -0.11;
  stallGroup.add(stallRoof);

  // Cloth Signboard Banner ("早点 · 热包") & Hanging Noren Curtains
  const bannerMat = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ map: tex.stallBanner, roughness: 0.85 }),
    { selfGlowBoost: 0.35 }
  );
  const bannerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 1.2), bannerMat);
  bannerMesh.position.set(0.92, 2.28, 0.0);
  stallGroup.add(bannerMesh);

  const matNoren = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#47362b', roughness: 0.9 }),
    { selfGlowBoost: 0.18 }
  );
  for (const nz of [-1.15, 1.15]) {
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.46, 0.82), matNoren);
    curtain.position.set(0.9, 2.26, nz);
    stallGroup.add(curtain);
  }

  // Glowing Warm Paper Lantern (HDR emissive bloom + wet puddle mirror reflection!)
  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.38, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 1.55, 0.55) })
  );
  lantern.position.set(0.92, 1.98, -1.42);
  stallGroup.add(lantern);

  // Warm volumetric halo cone under stall canopy!
  const stallVolCone = createVolumetricCone(0.45, 2.4, 2.45, '#ffaa44', 0.16);
  stallVolCone.position.set(0.3, 2.48, 0);
  stallGroup.add(stallVolCone);

  const stallPointLight = new THREE.PointLight('#ff9e38', 4.6, 6.2, 1.45);
  stallPointLight.position.set(
    WAYPOINTS.stallLightPos.x,
    WAYPOINTS.stallLightPos.y,
    WAYPOINTS.stallLightPos.z
  );
  stallPointLight.castShadow = true;
  stallPointLight.shadow.mapSize.set(512, 512);
  stallPointLight.shadow.bias = -0.002;
  scene.add(stallPointLight);

  // Stacked Bamboo Steamers + Curling Steam Puffs
  const steamPuffs: THREE.Mesh[] = [];
  const steamMat = new THREE.MeshBasicMaterial({
    color: '#fde68a',
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });

  const steamerOffsets = [
    { x: 0.25, z: 0.95, tiers: 4 },
    { x: 0.18, z: 0.38, tiers: 3 },
    { x: 0.3, z: -0.18, tiers: 4 },
  ];
  for (const st of steamerOffsets) {
    for (let t = 0; t < st.tiers; t++) {
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.13, 16), matBamboo);
      tier.position.set(st.x, 1.09 + t * 0.135, st.z);
      stallGroup.add(tier);
    }
    const lid = new THREE.Mesh(new THREE.ConeGeometry(0.225, 0.09, 16), matBamboo);
    lid.position.set(st.x, 1.09 + st.tiers * 0.135 + 0.02, st.z);
    stallGroup.add(lid);

    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), steamMat);
    puff.position.set(-3.15 + st.x, 1.25 + st.tiers * 0.135, -24.6 + st.z);
    puff.userData.baseY = puff.position.y;
    puff.userData.phase = st.z * 2.3;
    scene.add(puff);
    steamPuffs.push(puff);
  }

  for (const sz of [0.55, -0.55]) {
    const stool = new THREE.Group();
    stool.position.set(1.25, 0, sz);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 14), matWarmWood);
    seat.position.y = 0.45;
    stool.add(seat);
    for (let l = 0; l < 4; l++) {
      const ang = (l * Math.PI) / 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.018, 0.45, 8), matDarkWood);
      leg.position.set(Math.cos(ang) * 0.12, 0.22, Math.sin(ang) * 0.12);
      stool.add(leg);
    }
    stallGroup.add(stool);
  }
  registerTarget(stallGroup, 'stall', true, true);

  // Expressive Street Cat (Ref Image 3)
  const catGroup = new THREE.Group();
  catGroup.position.set(WAYPOINTS.catPos.x, WAYPOINTS.catPos.y, WAYPOINTS.catPos.z);
  catGroup.rotation.y = 0.95;

  const matCatFur = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#7c6b5d', roughness: 0.85 }),
    { selfGlowBoost: 0.14 }
  );
  const matCatChest = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#e2d7cc', roughness: 0.85 }),
    { selfGlowBoost: 0.14 }
  );
  const matCatEye = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.7, 0.65) });

  const catBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.16, 6, 10), matCatFur);
  catBody.position.set(0, 0.17, 0);
  catBody.rotation.x = 0.25;
  catGroup.add(catBody);

  const catChest = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 10), matCatChest);
  catChest.position.set(0, 0.2, 0.05);
  catGroup.add(catChest);

  const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 10), matCatFur);
  catHead.position.set(0, 0.33, 0.06);
  catGroup.add(catHead);

  for (const ex of [-0.036, 0.036]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), matCatEye);
    eye.position.set(ex, 0.35, 0.145);
    catGroup.add(eye);
  }

  for (const ex of [-0.055, 0.055]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.075, 5), matCatFur);
    ear.position.set(ex, 0.42, 0.055);
    ear.rotation.z = ex < 0 ? 0.22 : -0.22;
    catGroup.add(ear);
  }

  const catTail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.24, 8), matCatFur);
  catTail.position.set(0.06, 0.08, -0.14);
  catTail.rotation.x = 1.25;
  catTail.rotation.z = 0.4;
  catGroup.add(catTail);

  registerTarget(catGroup, 'cat', true, true);

  const catPointLight = new THREE.PointLight('#fbbf24', 0.0, 2.8, 1.6);
  catPointLight.position.set(WAYPOINTS.catPos.x, 0.45, WAYPOINTS.catPos.z);
  scene.add(catPointLight);

  // =========================================================================
  // SCENE 4: SILENT CROSSWALK, TRAFFIC SIGNAL & GOLDEN SUNSET CANYON
  // =========================================================================
  const curbDotWarning = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.025, 0.94), matTactileDot);
  curbDotWarning.position.set(0, 0.084, -31.82);
  registerTarget(curbDotWarning, 'tactile_dot', false, true);
  reflectiveGroundMeshes.push(curbDotWarning);

  const nearCurbLip = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.09, 0.22), matStoneCurb);
  nearCurbLip.position.set(0, 0.045, -32.35);
  registerTarget(nearCurbLip, 'normal', true, true);

  // Near-Curb Silent Signal Pole (Interactable Micro-Interaction #3!)
  const nearPoleGroup = new THREE.Group();
  nearPoleGroup.position.set(WAYPOINTS.signalPolePos.x, 0.08, WAYPOINTS.signalPolePos.z);
  const nearPoleShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.08, 3.3, 12),
    matSecurityMetal
  );
  nearPoleShaft.position.y = 1.65;
  nearPoleGroup.add(nearPoleShaft);
  // Empty bracket showing missing acoustic buzzer box!
  const emptyBracket = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.08), matDarkIron);
  emptyBracket.position.set(-0.08, 1.15, 0);
  nearPoleGroup.add(emptyBracket);
  registerTarget(nearPoleGroup, 'signal_pole', true, true);

  // 8 Weathered White Zebra Crosswalk Bars (Reflective wet paint!)
  for (let i = 0; i < 8; i++) {
    const barZ = -33.45 - i * 1.12;
    const zebraBar = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.012, 0.58), matCrosswalkBar);
    zebraBar.position.set(0, 0.008, barZ);
    registerTarget(zebraBar, 'crosswalk', false, true);
    reflectiveGroundMeshes.push(zebraBar);
  }

  // Opposite Safe Sidewalk & Tactile Ramp
  const farCurbLip = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.09, 0.22), matStoneCurb);
  farCurbLip.position.set(0, 0.045, -42.25);
  registerTarget(farCurbLip, 'normal', true, true);

  const farSidewalk = new THREE.Mesh(new THREE.BoxGeometry(11.0, 0.08, 7.0), matWetSidewalk);
  farSidewalk.position.set(0, 0.04, -45.8);
  registerTarget(farSidewalk, 'normal', false, true);
  reflectiveGroundMeshes.push(farSidewalk);

  const farDotPad = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.025, 0.88), matTactileDot);
  farDotPad.position.set(0, 0.084, -42.75);
  registerTarget(farDotPad, 'tactile_dot', false, true);
  reflectiveGroundMeshes.push(farDotPad);

  const farTactileLine = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.024, 4.2), matTactileLine);
  farTactileLine.position.set(0, 0.092, -45.3);
  registerTarget(farTactileLine, 'tactile_line', false, true);
  reflectiveGroundMeshes.push(farTactileLine);

  // Opposite Crosswalk Pedestrian Signal Lamp (Red -> Emerald Green on 3rd Help Call!)
  const farSignalGroup = new THREE.Group();
  farSignalGroup.position.set(1.95, 0.08, -42.55);
  const farPole = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 3.6, 10), matDarkIron);
  farPole.position.y = 1.8;
  farSignalGroup.add(farPole);

  const signalHousing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.68, 0.24), matDarkIron);
  signalHousing.position.set(0, 3.15, 0.05);
  farSignalGroup.add(signalHousing);

  const signalRedLens = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.28, 0.18) })
  );
  signalRedLens.position.set(0, 3.31, 0.18);
  farSignalGroup.add(signalRedLens);

  const signalGreenLens = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.16, 0.1) })
  );
  signalGreenLens.position.set(0, 2.99, 0.18);
  farSignalGroup.add(signalGreenLens);
  scene.add(farSignalGroup);

  const signalLight = new THREE.PointLight('#ff3b30', 1.8, 6.5, 1.5);
  signalLight.position.set(1.95, 3.15, -42.0);
  scene.add(signalLight);

  const setPedestrianSignalGreen = (isGreen: boolean) => {
    const rMat = signalRedLens.material as THREE.MeshBasicMaterial;
    const gMat = signalGreenLens.material as THREE.MeshBasicMaterial;
    if (isGreen) {
      rMat.color.setRGB(0.18, 0.04, 0.03);
      gMat.color.setRGB(0.35, 3.1, 1.15);
      signalLight.color.set('#22c55e');
      signalLight.intensity = 2.4;
    } else {
      rMat.color.setRGB(3.2, 0.28, 0.18);
      gMat.color.setRGB(0.06, 0.14, 0.08);
      signalLight.color.set('#ff3b30');
      signalLight.intensity = 1.8;
    }
  };

  // Far Urban Canyon Buildings & Horizon Skyline (Framing the Golden Sunset Sun!)
  for (const side of [-1, 1]) {
    const bldg1 = new THREE.Mesh(new THREE.BoxGeometry(6.2, 11.5, 14.0), matBrickWall);
    bldg1.position.set(side * 6.0, 5.75, -48.0);
    enableShadows(bldg1, true, true);
    scene.add(bldg1);

    const bldg2 = new THREE.Mesh(new THREE.BoxGeometry(5.8, 15.0, 12.0), matPlasterWall);
    bldg2.position.set(side * 5.6, 7.5, -60.0);
    scene.add(bldg2);

    const utilityPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.095, 7.8, 10),
      matDarkIron
    );
    utilityPole.position.set(side * 2.4, 3.9, -43.2);
    scene.add(utilityPole);
  }

  // Golden After-Rain Sunset Volumetric God-Ray Shafts down the Street Canyon!
  const sunsetGodRays = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const shaft = createVolumetricCone(1.8, 5.4, 24, '#ffb257', 0.0);
    shaft.position.set((i - 1) * 1.4, 8.2 - i * 0.4, -52);
    shaft.rotation.x = -Math.PI / 2 + 0.28;
    sunsetGodRays.add(shaft);
  }
  scene.add(sunsetGodRays);

  // =========================================================================
  // ARTICULATED KIND STRANGER + FIRST-PERSON JOINED LEFT HAND (SIGHTED GUIDE!)
  // =========================================================================
  const pedestrianGroup = new THREE.Group();
  pedestrianGroup.position.set(
    WAYPOINTS.pedestrianPos.x,
    WAYPOINTS.pedestrianPos.y,
    WAYPOINTS.pedestrianPos.z
  );
  pedestrianGroup.visible = false;

  const matPedCoat = new THREE.MeshStandardMaterial({
    color: '#2a2420',
    emissive: '#4d2c12',
    emissiveIntensity: 0.42,
    roughness: 0.78,
  });
  const matPedScarf = new THREE.MeshStandardMaterial({
    color: '#d97706',
    emissive: '#78350f',
    emissiveIntensity: 0.55,
    roughness: 0.82,
  });
  const matPedPants = new THREE.MeshStandardMaterial({
    color: '#191d24',
    emissive: '#1e1610',
    emissiveIntensity: 0.28,
    roughness: 0.82,
  });
  const matPedSkin = new THREE.MeshStandardMaterial({
    color: '#d8a98a',
    emissive: '#593318',
    emissiveIntensity: 0.4,
    roughness: 0.62,
  });

  // Head + warm knit collar/scarf
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.56, 0);
  const pedHead = new THREE.Mesh(new THREE.SphereGeometry(0.112, 14, 14), matPedSkin);
  pedHead.position.y = 0.09;
  headGroup.add(pedHead);
  const pedHair = new THREE.Mesh(
    new THREE.SphereGeometry(0.118, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
    matPedPants
  );
  pedHair.position.set(0, 0.1, -0.01);
  headGroup.add(pedHair);
  pedestrianGroup.add(headGroup);

  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.042, 10, 18), matPedScarf);
  scarfRing.rotation.x = Math.PI / 2;
  scarfRing.position.set(0, 1.49, 0.01);
  pedestrianGroup.add(scarfRing);

  // Warm winter coat torso
  const pedTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.52, 8, 14), matPedCoat);
  pedTorso.scale.set(1.06, 1.0, 0.82);
  pedTorso.position.y = 1.15;
  pedestrianGroup.add(pedTorso);

  // Articulated Legs (hip pivots at Y = 0.84)
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.095, 0.84, 0);
  const leftLegMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.64, 6, 10), matPedPants);
  leftLegMesh.position.y = -0.39;
  leftLegPivot.add(leftLegMesh);
  pedestrianGroup.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.095, 0.84, 0);
  const rightLegMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.64, 6, 10), matPedPants);
  rightLegMesh.position.y = -0.39;
  rightLegPivot.add(rightLegMesh);
  pedestrianGroup.add(rightLegPivot);

  // Left Arm (shoulder pivot at X = -0.23, Y = 1.42)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.23, 1.42, 0);
  const leftArmMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.48, 6, 10), matPedCoat);
  leftArmMesh.position.y = -0.28;
  leftArmPivot.add(leftArmMesh);
  pedestrianGroup.add(leftArmPivot);

  // Right Arm (shoulder pivot at X = +0.23, Y = 1.42) — dynamically reaches to clasp Player's Left Hand!
  // Built along +Z axis so `rightArmPivot.lookAt(claspWorldPos)` points arm & hand directly into player's hand!
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.23, 1.42, 0);

  const rightForearmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.054, 1.0, 12), matPedCoat);
  rightForearmMesh.rotation.x = Math.PI / 2;
  rightForearmMesh.position.z = 0.5;
  rightArmPivot.add(rightForearmMesh);

  const rightHandMesh = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), matPedSkin);
  rightHandMesh.scale.set(0.95, 0.78, 1.25);
  rightHandMesh.position.z = 1.0;
  rightArmPivot.add(rightHandMesh);

  pedestrianGroup.add(rightArmPivot);

  // Warm golden aura glow behind stranger
  const auraCanvas = document.createElement('canvas');
  auraCanvas.width = 128;
  auraCanvas.height = 128;
  const aCtx = auraCanvas.getContext('2d')!;
  const aGrad = aCtx.createRadialGradient(64, 64, 4, 64, 64, 62);
  aGrad.addColorStop(0, 'rgba(255, 240, 200, 0.95)');
  aGrad.addColorStop(0.4, 'rgba(255, 175, 70, 0.55)');
  aGrad.addColorStop(1, 'rgba(255, 140, 30, 0)');
  aCtx.fillStyle = aGrad;
  aCtx.fillRect(0, 0, 128, 128);
  const auraTex = new THREE.CanvasTexture(auraCanvas);

  const pedAura = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 3.2),
    new THREE.MeshBasicMaterial({
      map: auraTex,
      color: new THREE.Color(1.75, 1.15, 0.52),
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  pedAura.position.set(0, 1.25, -0.25);
  pedestrianGroup.add(pedAura);
  scene.add(pedestrianGroup);

  const pedestrianHaloLight = new THREE.PointLight('#ffb347', 0.0, 10.5, 1.35);
  pedestrianHaloLight.position.set(0, 1.85, -43.0);
  scene.add(pedestrianHaloLight);

  // --- First-Person Player Left Arm & Outstretched Hand (Mounted on Camera, appears when holding hands!) ---
  const playerLeftArmRoot = new THREE.Group();
  playerLeftArmRoot.visible = false;
  playerLeftArmRoot.position.set(-0.34, -0.26, -0.44);

  const playerLeftSleeveMat = new THREE.MeshStandardMaterial({
    color: '#1b2230',
    emissive: '#2b1b0e',
    emissiveIntensity: 0.3,
    roughness: 0.8,
  });
  const playerLeftSkinMat = new THREE.MeshStandardMaterial({
    color: '#c69474',
    emissive: '#4d2b12',
    emissiveIntensity: 0.35,
    roughness: 0.62,
  });

  const leftSleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.048, 0.062, 0.44, 12),
    playerLeftSleeveMat
  );
  leftSleeve.rotation.x = Math.PI / 2 - 0.14;
  leftSleeve.rotation.z = -0.22;
  leftSleeve.position.set(-0.08, -0.06, 0.18);
  playerLeftArmRoot.add(leftSleeve);

  const leftPalm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), playerLeftSkinMat);
  leftPalm.scale.set(0.95, 0.72, 1.28);
  leftPalm.position.set(0.01, -0.01, -0.05);
  playerLeftArmRoot.add(leftPalm);

  // Curled fingers gently gripping the stranger's warm hand
  for (let fi = 0; fi < 4; fi++) {
    const finger = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.01, 0.036, 4, 6),
      playerLeftSkinMat
    );
    finger.rotation.x = Math.PI / 2 + 0.35;
    finger.position.set(-0.025 + fi * 0.017, -0.005, -0.1);
    playerLeftArmRoot.add(finger);
  }

  const playerLeftClaspMarker = new THREE.Object3D();
  playerLeftClaspMarker.position.set(0.0, 0.0, -0.09);
  playerLeftArmRoot.add(playerLeftClaspMarker);

  // Intimate warm golden point light right where the two hands clasp together!
  const joinedHandsLight = new THREE.PointLight('#ffc46b', 0.0, 2.6, 1.6);
  joinedHandsLight.position.set(0.02, 0.08, -0.08);
  playerLeftArmRoot.add(joinedHandsLight);

  camera.add(playerLeftArmRoot);

  // Real-time Inverse Kinematics Clasp Updater (keeps Stranger's Right Hand locked onto Player's Left Hand!)
  const tmpClaspWorld = new THREE.Vector3();
  const tmpShoulderWorld = new THREE.Vector3();

  const updateHandClasp = (
    _dt: number,
    holdingBlend: number,
    stridePhase: number,
    strideAmp: number,
    cam: THREE.PerspectiveCamera
  ) => {
    // Animate synchronized walking legs & free left arm
    const legSwing = Math.sin(stridePhase) * 0.44 * strideAmp;
    leftLegPivot.rotation.x = legSwing;
    rightLegPivot.rotation.x = -legSwing;
    leftArmPivot.rotation.x = -legSwing * 0.65;
    // Gentle reassuring head turn toward player on right
    headGroup.rotation.y = holdingBlend * -0.28 + Math.sin(stridePhase * 0.5) * 0.05;

    // Show & extend Player's Left Hand smoothly as holdingBlend -> 1
    playerLeftArmRoot.visible = holdingBlend > 0.02;
    const armBobY = Math.sin(stridePhase * 2.0) * 0.014 * strideAmp;
    playerLeftArmRoot.position.set(
      THREE.MathUtils.lerp(-0.55, -0.32, holdingBlend),
      THREE.MathUtils.lerp(-0.52, -0.24, holdingBlend) + armBobY,
      THREE.MathUtils.lerp(-0.18, -0.44, holdingBlend)
    );
    joinedHandsLight.intensity = holdingBlend * 1.45;

    if (holdingBlend > 0.05) {
      cam.updateMatrixWorld(true);
      pedestrianGroup.updateMatrixWorld(true);
      playerLeftClaspMarker.getWorldPosition(tmpClaspWorld);
      rightArmPivot.getWorldPosition(tmpShoulderWorld);

      const dist = Math.max(0.28, Math.min(0.95, tmpShoulderWorld.distanceTo(tmpClaspWorld)));
      rightArmPivot.lookAt(tmpClaspWorld);
      rightForearmMesh.scale.set(1, dist, 1);
      rightForearmMesh.position.set(0, 0, dist * 0.5);
      rightHandMesh.position.set(0, 0, dist);
    } else {
      // Relaxed resting right arm pointing down along side
      rightArmPivot.rotation.set(Math.PI / 2 + legSwing * 0.5, 0, 0);
      rightForearmMesh.scale.set(1, 0.55, 1);
      rightForearmMesh.position.set(0, 0, 0.275);
      rightHandMesh.position.set(0, 0, 0.56);
    }
  };

  const escortRig: EscortVisualRig = {
    pedestrianGroup,
    pedestrianHaloLight,
    headGroup,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot,
    rightArmPivot,
    rightForearmMesh,
    rightHandMesh,
    playerLeftArmRoot,
    playerLeftClaspMarker,
    joinedHandsLight,
    updateHandClasp,
  };

  // --- High-Speed Crosswalk Traffic Light-Trails (HDR Bloom + Planar Wet Reflections!) ---
  const trafficStreaks: TrafficVisual[] = [];
  const createTrafficStreak = (laneZ: number, dir: 1 | -1): TrafficVisual => {
    const grp = new THREE.Group();
    grp.position.set(dir * -26, 0.52, laneZ);
    grp.visible = false;

    const carHull = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 1.15, 1.72),
      new THREE.MeshBasicMaterial({ color: '#080a0f', transparent: true, opacity: 0.85 })
    );
    carHull.position.y = 0.2;
    grp.add(carHull);

    // Long glowing crimson tail-light trails
    const tailMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.5, 0.35, 0.22),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // Warm-white headlight streaks
    const headMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.2, 2.75, 2.0),
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (const tz of [-0.66, 0.66]) {
      const tailBeam = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 0.16), tailMat);
      tailBeam.position.set(-dir * 3.8, 0.18, tz);
      grp.add(tailBeam);

      const headBeam = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 0.22), headMat);
      headBeam.position.set(dir * 3.1, 0.12, tz);
      grp.add(headBeam);
    }

    scene.add(grp);
    return { group: grp, direction: dir, speed: 24, laneZ, active: false };
  };

  trafficStreaks.push(createTrafficStreak(-35.4, 1));
  trafficStreaks.push(createTrafficStreak(-39.2, -1));

  // =========================================================================
  // SOFT RADIAL BOKEH SPARKLE MOTES (Spawned on Cane Taps!)
  // =========================================================================
  const MAX_SPARKLES = 120;
  const sparklePositions = new Float32Array(MAX_SPARKLES * 3);
  const sparkleColors = new Float32Array(MAX_SPARKLES * 3);
  const sparkleLife = new Float32Array(MAX_SPARKLES);
  const sparkleVelY = new Float32Array(MAX_SPARKLES);
  let sparkleCursor = 0;

  for (let i = 0; i < MAX_SPARKLES; i++) sparklePositions[i * 3 + 1] = -100;

  const sparkleGeo = new THREE.BufferGeometry();
  sparkleGeo.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
  sparkleGeo.setAttribute('color', new THREE.BufferAttribute(sparkleColors, 3));

  const spCanvas = document.createElement('canvas');
  spCanvas.width = 32;
  spCanvas.height = 32;
  const spCtx = spCanvas.getContext('2d')!;
  const spGrad = spCtx.createRadialGradient(16, 16, 1, 16, 16, 15);
  spGrad.addColorStop(0, 'rgba(255,255,255,1)');
  spGrad.addColorStop(0.42, 'rgba(255,255,255,0.68)');
  spGrad.addColorStop(1, 'rgba(255,255,255,0)');
  spCtx.fillStyle = spGrad;
  spCtx.fillRect(0, 0, 32, 32);
  const spTex = new THREE.CanvasTexture(spCanvas);

  const sparklePoints = new THREE.Points(
    sparkleGeo,
    new THREE.PointsMaterial({
      size: 0.095,
      map: spTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  sparklePoints.frustumCulled = false;
  scene.add(sparklePoints);

  const spawnSparkles = (origin: THREE.Vector3, isWarm: boolean) => {
    for (let i = 0; i < 22; i++) {
      const idx = sparkleCursor;
      sparkleCursor = (sparkleCursor + 1) % MAX_SPARKLES;

      const angle = Math.random() * Math.PI * 2;
      const rad = 0.25 + Math.random() * 1.9;
      sparklePositions[idx * 3] = origin.x + Math.cos(angle) * rad;
      sparklePositions[idx * 3 + 1] = origin.y + 0.06 + Math.random() * 0.28;
      sparklePositions[idx * 3 + 2] = origin.z + Math.sin(angle) * rad;

      const warmMix = isWarm ? Math.random() > 0.22 : Math.random() > 0.7;
      if (warmMix) {
        sparkleColors[idx * 3] = 1.65;
        sparkleColors[idx * 3 + 1] = 1.1;
        sparkleColors[idx * 3 + 2] = 0.35;
      } else {
        sparkleColors[idx * 3] = 0.45;
        sparkleColors[idx * 3 + 1] = 1.35;
        sparkleColors[idx * 3 + 2] = 1.85;
      }
      sparkleLife[idx] = 1.0;
      sparkleVelY[idx] = 0.16 + Math.random() * 0.28;
    }
    sparkleGeo.attributes.position.needsUpdate = true;
    sparkleGeo.attributes.color.needsUpdate = true;
  };

  // =========================================================================
  // DEBUG COLLISION WIREFRAMES
  // =========================================================================
  const debugWireframeGroup = new THREE.Group();
  debugWireframeGroup.visible = false;
  scene.add(debugWireframeGroup);

  const rebuildDebugWireframes = (cols: ColliderBox[]) => {
    while (debugWireframeGroup.children.length > 0) {
      const line = debugWireframeGroup.children[0] as THREE.LineSegments<
        THREE.EdgesGeometry,
        THREE.LineBasicMaterial
      >;
      debugWireframeGroup.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    for (const c of cols) {
      if (!c.enabled) continue;
      const boxGeo = new THREE.BoxGeometry(c.maxX - c.minX, c.height, c.maxZ - c.minZ);
      const edges = new THREE.EdgesGeometry(boxGeo);
      boxGeo.dispose();
      const color = c.isObstacle
        ? '#f97316'
        : c.id === 'crosswalk_airwall'
          ? '#eab308'
          : '#38bdf8';
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.78 })
      );
      line.position.set((c.minX + c.maxX) / 2, c.height / 2, (c.minZ + c.maxZ) / 2);
      debugWireframeGroup.add(line);
    }
  };
  rebuildDebugWireframes(colliders);

  const setShadowsEnabled = (enabled: boolean, mapSize: number) => {
    sunsetDirLight.castShadow = enabled;
    stallPointLight.castShadow = enabled;
    if (sunsetDirLight.shadow.mapSize.x !== mapSize) {
      sunsetDirLight.shadow.mapSize.set(mapSize, mapSize);
      sunsetDirLight.shadow.map?.dispose();
      sunsetDirLight.shadow.map = null;
    }
  };

  const updateParticlesAndProps = (
    dt: number,
    elapsed: number,
    doorOpenTarget: number,
    sunsetFactor: number,
    worldVisibility: number
  ) => {
    foyerDoorPivot.rotation.y += (doorOpenTarget - foyerDoorPivot.rotation.y) * Math.min(1, dt * 4.2);

    // Dim static unmasked city glows (upstairs windows, neon sign, lamp cones) to near-zero in blind dark mode!
    const vis = Math.max(0, Math.min(1, worldVisibility));
    const ambientEmissiveScale = 0.025 + vis * 0.975;
    windowWarmMat.color.setRGB(
      1.4 * ambientEmissiveScale,
      0.95 * ambientEmissiveScale,
      0.48 * ambientEmissiveScale
    );
    convSignMat.color.setRGB(
      1.25 * (0.04 + vis * 0.96),
      1.2 * (0.04 + vis * 0.96),
      1.15 * (0.04 + vis * 0.96)
    );
    for (const bm of streetLampBulbs) {
      bm.color.setRGB(
        2.4 * (0.05 + vis * 0.95),
        1.65 * (0.05 + vis * 0.95),
        0.78 * (0.05 + vis * 0.95)
      );
    }
    for (const cone of streetLampCones) {
      ((cone.material as THREE.ShaderMaterial).uniforms.uGain as { value: number }).value =
        0.13 * vis;
    }
    ((stallVolCone.material as THREE.ShaderMaterial).uniforms.uGain as { value: number }).value =
      0.035 + vis * 0.14;
    (lantern.material as THREE.MeshBasicMaterial).color.setRGB(
      2.8 * (0.28 + vis * 0.72),
      1.55 * (0.28 + vis * 0.72),
      0.55 * (0.28 + vis * 0.72)
    );
    steamMat.opacity = 0.03 + vis * 0.14;

    // Blinking construction barrier hazard beacon (subtle amber pulse in blind mode, vivid in attract/peek)
    const pulse = 0.15 + 0.85 * Math.pow(Math.sin(elapsed * 3.8) * 0.5 + 0.5, 2.2);
    const beaconVis = 0.22 + vis * 0.78;
    barrierBeaconLight.intensity = (0.35 + pulse * 1.9) * beaconVis;
    (barrierBeaconBulb.material as THREE.MeshBasicMaterial).color.setRGB(
      (0.8 + pulse * 2.4) * beaconVis,
      (0.32 + pulse * 1.0) * beaconVis,
      (0.06 + pulse * 0.14) * beaconVis
    );

    // Cat idle breathing & tail sway
    catGroup.scale.y = 1.0 + Math.sin(elapsed * 2.8) * 0.028;
    catTail.rotation.z = 0.4 + Math.sin(elapsed * 3.4) * 0.2;

    // Warm stall steamer puffs
    for (const puff of steamPuffs) {
      const cycle = (((elapsed * 0.55 + (puff.userData.phase as number)) % 1.0) + 1.0) % 1.0;
      puff.position.y = (puff.userData.baseY as number) + cycle * 0.72;
      const s = 0.6 + cycle * 1.15;
      puff.scale.set(s, s, s);
    }

    // Golden sunset volumetric god-ray gain
    sunsetGodRays.children.forEach((c) => {
      const m = (c as THREE.Mesh).material as THREE.ShaderMaterial;
      m.uniforms.uGain.value = sunsetFactor * 0.22;
    });

    // Traffic streaks motion
    for (const tr of trafficStreaks) {
      if (!tr.active) continue;
      tr.group.position.x += tr.direction * tr.speed * dt;
      if (Math.abs(tr.group.position.x) > 30) {
        tr.active = false;
        tr.group.visible = false;
      }
    }

    // Sparkle motes
    let dirty = false;
    for (let i = 0; i < MAX_SPARKLES; i++) {
      if (sparkleLife[i] > 0) {
        sparkleLife[i] -= dt * 0.58;
        if (sparkleLife[i] <= 0) {
          sparklePositions[i * 3 + 1] = -100;
        } else {
          sparklePositions[i * 3 + 1] += sparkleVelY[i] * dt;
          sparkleColors[i * 3] *= 0.99;
          sparkleColors[i * 3 + 1] *= 0.99;
          sparkleColors[i * 3 + 2] *= 0.99;
        }
        dirty = true;
      }
    }
    if (dirty) {
      sparkleGeo.attributes.position.needsUpdate = true;
      sparkleGeo.attributes.color.needsUpdate = true;
    }
  };

  return {
    raycastTargets,
    reflectiveGroundMeshes,
    foyerDoorPivot,
    doorCrackLight,
    doorSliverMesh,
    doorShaftMesh,
    canePickupGroup,
    catGroup,
    catPointLight,
    stallPointLight,
    barrierBeaconLight,
    barrierBeaconBulb,
    pedestrianGroup,
    pedestrianHaloLight,
    escortRig,
    signalRedLens,
    signalGreenLens,
    signalLight,
    sunsetDirLight,
    moonDirLight,
    ambientHemiLight,
    sunsetGodRays,
    debugWireframeGroup,
    trafficStreaks,
    spawnSparkles,
    setPedestrianSignalGreen,
    setShadowsEnabled,
    updateParticlesAndProps,
    rebuildDebugWireframes,
  };
}
