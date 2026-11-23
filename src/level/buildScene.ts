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
  playerLeftArmRoot: THREE.Group;
  joinedHandsLight: THREE.PointLight;
  updateEscortMotion: (
    dt: number,
    holdingBlend: number,
    stridePhase: number,
    strideAmp: number,
    elapsed: number
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
 * Scales the UV coordinates of a BoxGeometry so tiled PBR textures maintain true physical scale
 * across boxes of different dimensions while sharing a single Material (zero extra shader programs!).
 */
function makeTiledBoxGeo(w: number, h: number, d: number, tileU: number, tileV: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const norm = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (ny > 0.5) {
      // Top / bottom face (W x D)
      uv.setXY(i, u * (w / tileU), v * (d / tileV));
    } else if (nx > 0.5) {
      // Left / right face (D x H)
      uv.setXY(i, u * (d / tileU), v * (h / tileV));
    } else {
      // Front / back face (W x H)
      uv.setXY(i, u * (w / tileU), v * (h / tileV));
    }
  }
  uv.needsUpdate = true;
  return geo;
}

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

/**
 * Custom Warm-Gold Fresnel Backlit Silhouette Material for the Kind Stranger (Ref Image 4).
 * Deep dark velvet core with soft luminous sunset-gold translucent edge halo — zero blocky look!
 */
function createBacklitSilhouetteMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCoreColor: { value: new THREE.Color('#18110c') },
      uRimColor: { value: new THREE.Color('#ffbe62') },
      uOpacity: { value: 0.88 },
      uPulse: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      varying float vLocalY;
      void main() {
        vLocalY = position.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uCoreColor;
      uniform vec3 uRimColor;
      uniform float uOpacity;
      uniform float uPulse;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      varying float vLocalY;
      void main() {
        float ndotv = clamp(abs(dot(normalize(vWorldNormal), normalize(vViewDir))), 0.0, 1.0);
        float fresnel = pow(1.0 - ndotv, 2.15);
        float verticalWarm = smoothstep(0.0, 1.65, vLocalY);
        vec3 col = mix(uCoreColor, uRimColor * (1.55 * uPulse), fresnel * 0.92 + verticalWarm * 0.16);
        float alpha = clamp(uOpacity * (0.68 + fresnel * 0.42), 0.0, 0.96);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

function createTabbyFurTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7e6c5a';
  ctx.fillRect(0, 0, 256, 256);

  // Subtle dark tabby mackerel stripes
  ctx.strokeStyle = 'rgba(34, 26, 20, 0.58)';
  ctx.lineWidth = 10;
  for (let y = 14; y < 256; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(85, y + 10, 170, y - 10, 256, y + 4);
    ctx.stroke();
  }
  // Fine fur speckles
  for (let i = 0; i < 1400; i++) {
    const x = (i * 53) % 256;
    const y = (i * 97) % 256;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(180,158,132,0.16)' : 'rgba(30,22,16,0.16)';
    ctx.fillRect(x, y, 2, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
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

  // Normalize base repeat to 1x1 on textures where we use makeTiledBoxGeo for physical scaling
  tex.brickWall.map.repeat.set(1, 1);
  tex.brickWall.normalMap.repeat.set(1, 1);
  tex.brickWall.roughnessMap?.repeat.set(1, 1);
  tex.tactileLine.map.repeat.set(1, 1);
  tex.tactileLine.normalMap.repeat.set(1, 1);
  tex.tactileLine.roughnessMap?.repeat.set(1, 1);
  tex.tactileDot.map.repeat.set(1, 1);
  tex.tactileDot.normalMap.repeat.set(1, 1);
  tex.tactileDot.roughnessMap?.repeat.set(1, 1);
  tex.wetSidewalk.map.repeat.set(1, 1);
  tex.wetSidewalk.normalMap.repeat.set(1, 1);
  tex.wetSidewalk.roughnessMap?.repeat.set(1, 1);

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

  // =========================================================================
  // PERMANENT LIGHTING SETUP (All lights initialized at boot — zero runtime add/remove!)
  // =========================================================================
  const ambientHemiLight = new THREE.HemisphereLight('#8ba7cc', '#221c18', 0.85);
  scene.add(ambientHemiLight);

  const moonDirLight = new THREE.DirectionalLight('#b9d0ea', 0.68);
  moonDirLight.position.set(12, 18, 8);
  scene.add(moonDirLight);

  // Main Shadow-Casting Low-Angle Sunset Key Light (pours down -Z urban canyon centered on Leg 3 / Crosswalk!)
  const sunsetDirLight = new THREE.DirectionalLight('#ff9a3c', 0.25);
  sunsetDirLight.position.set(15.5, 9.0, -64);
  sunsetDirLight.target.position.set(10, 0, -24);
  sunsetDirLight.castShadow = true;
  sunsetDirLight.shadow.mapSize.set(1024, 1024);
  sunsetDirLight.shadow.camera.near = 2;
  sunsetDirLight.shadow.camera.far = 88;
  sunsetDirLight.shadow.camera.left = -22;
  sunsetDirLight.shadow.camera.right = 22;
  sunsetDirLight.shadow.camera.top = 18;
  sunsetDirLight.shadow.camera.bottom = -18;
  sunsetDirLight.shadow.bias = -0.0005;
  sunsetDirLight.shadow.normalBias = 0.02;
  scene.add(sunsetDirLight);
  scene.add(sunsetDirLight.target);

  // === Shared Enhanced PBR Materials ===
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
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: tex.plasterWall.roughnessMap,
      roughness: 0.86,
      metalness: 0.03,
    })
  );

  const matBrickWall = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.brickWall.map,
      normalMap: tex.brickWall.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: tex.brickWall.roughnessMap,
      roughness: 0.84,
      metalness: 0.04,
    })
  );

  const matDarkConcrete = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      color: '#2c3037',
      normalMap: tex.plasterWall.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.88,
      metalness: 0.04,
    })
  );

  const matSkylineBldg = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      color: '#181d25',
      roughness: 0.9,
      metalness: 0.06,
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

  const matWetSidewalk = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.wetSidewalk.map,
      normalMap: tex.wetSidewalk.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: tex.wetSidewalk.roughnessMap,
      roughness: 0.46,
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
      roughness: 0.36,
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

  const windowWarmMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.35, 0.9, 0.46),
  });
  const windowDimMat = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#1b2736', roughness: 0.15, metalness: 0.85 })
  );
  const streetLampCones: THREE.Mesh[] = [];
  const streetLampBulbs: THREE.MeshBasicMaterial[] = [];

  // =========================================================================
  // SCENE 1: LIVED-IN RAINY-EVENING FOYER (Ref Image 1, Z = +2.5 to -5.5)
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

  // Solid thick interior walls + outer building shell so looking back from street shows a real apartment block!
  const foyerLeftWall = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.9, 8.2), matPlasterWall);
  foyerLeftWall.position.set(-2.04, 1.45, -1.45);
  registerTarget(foyerLeftWall, 'wall', true, true);

  const foyerRightWall = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.9, 8.2), matPlasterWall);
  foyerRightWall.position.set(2.04, 1.45, -1.45);
  registerTarget(foyerRightWall, 'wall', true, true);

  const foyerBackWall = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.9, 0.3), matPlasterWall);
  foyerBackWall.position.set(0, 1.45, 2.6);
  registerTarget(foyerBackWall, 'wall', true, true);

  // Solid residential apartment upper massing above & flanking the foyer (eliminates paper-thin foyer walls!)
  const foyerUpperBlock = new THREE.Mesh(makeTiledBoxGeo(11.6, 8.2, 8.4, 3.2, 3.2), matBrickWall);
  foyerUpperBlock.position.set(-1.4, 6.95, -1.35);
  scene.add(foyerUpperBlock);

  const foyerWestWing = new THREE.Mesh(makeTiledBoxGeo(5.2, 2.9, 8.4, 3.2, 3.2), matBrickWall);
  foyerWestWing.position.set(-4.7, 1.45, -1.35);
  scene.add(foyerWestWing);

  const foyerEastWing = new THREE.Mesh(makeTiledBoxGeo(2.4, 2.9, 8.4, 3.2, 3.2), matBrickWall);
  foyerEastWing.position.set(3.25, 1.45, -1.35);
  scene.add(foyerEastWing);

  // Entry awning over front security door outside
  const entryCanopy = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.1), matDarkIron);
  entryCanopy.position.set(0, 2.65, -5.95);
  entryCanopy.rotation.x = 0.08;
  scene.add(entryCanopy);

  for (const sx of [-1.88, 1.88]) {
    const baseboard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 8.0), matDarkWood);
    baseboard.position.set(sx, 0.07, -1.45);
    scene.add(baseboard);
  }

  // Front Wall around Doorway
  const doorWallLeft = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.2, 0.28), matPlasterWall);
  doorWallLeft.position.set(-2.32, 1.6, -5.5);
  registerTarget(doorWallLeft, 'wall', true, true);

  const doorWallRight = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.2, 0.28), matPlasterWall);
  doorWallRight.position.set(2.32, 1.6, -5.5);
  registerTarget(doorWallRight, 'wall', true, true);

  const doorHeader = new THREE.Mesh(new THREE.BoxGeometry(1.32, 1.0, 0.28), matPlasterWall);
  doorHeader.position.set(0, 2.72, -5.5);
  registerTarget(doorHeader, 'wall', true, true);

  // Left Walnut Shoe Cabinet + Drawers + Handles + Toiletries + Slippers (Ref Image 1)
  const cabinetGroup = new THREE.Group();
  cabinetGroup.position.set(-1.62, 0, -2.25);

  const cabBody = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.98, 1.85), matDarkWood);
  cabBody.position.y = 0.59;
  cabinetGroup.add(cabBody);

  // Raised corner legs so slippers tuck naturally underneath!
  for (const lx of [-0.22, 0.22]) {
    for (const lz of [-0.85, 0.85]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.05), matDarkWood);
      leg.position.set(lx, 0.05, lz);
      cabinetGroup.add(leg);
    }
  }

  const cabTop = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 1.92), matDarkWood);
  cabTop.position.y = 1.1;
  cabinetGroup.add(cabTop);

  // 3 drawers + right side cabinet door panel with metallic handles
  for (let d = 0; d < 3; d++) {
    const dy = 0.28 + d * 0.27;
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.23, 1.06), matDarkWood);
    drawer.position.set(0.275, dy, 0.26);
    cabinetGroup.add(drawer);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.018, 0.18), matSecurityMetal);
    handle.position.set(0.305, dy + 0.02, 0.26);
    cabinetGroup.add(handle);
  }
  const sideDoor = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.82, 0.56), matDarkWood);
  sideDoor.position.set(0.275, 0.58, -0.6);
  cabinetGroup.add(sideDoor);
  const sideHandle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.16, 0.02), matSecurityMetal);
  sideHandle.position.set(0.305, 0.72, -0.38);
  cabinetGroup.add(sideHandle);

  // Cabinet-top daily items (key tray + skincare bottles + tissue box)
  const keyTray = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.3), matDarkIron);
  keyTray.position.set(0.04, 1.13, 0.45);
  cabinetGroup.add(keyTray);
  for (let b = 0; b < 5; b++) {
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028 + (b % 2) * 0.008, 0.034, 0.11 + (b % 3) * 0.045, 10),
      b % 2 === 0 ? matPorcelain : matDarkIron
    );
    bottle.position.set(-0.06 + (b % 2) * 0.11, 1.18, -0.62 + b * 0.22);
    cabinetGroup.add(bottle);
  }
  // 3 pairs of neatly aligned slippers underneath cabinet
  for (let s = 0; s < 3; s++) {
    for (const pairOff of [-0.055, 0.055]) {
      const slipper = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.15, 4, 8), matPorcelain);
      slipper.rotation.z = Math.PI / 2;
      slipper.scale.set(0.55, 1.0, 1.1);
      slipper.position.set(0.24, 0.028, -0.52 + s * 0.42 + pairOff);
      cabinetGroup.add(slipper);
    }
  }
  registerTarget(cabinetGroup, 'stall', true, true);

  // Intercom + Wall Switch (Ref Image 1)
  const wallSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.12), matPorcelain);
  wallSwitch.position.set(1.88, 1.32, -2.0);
  scene.add(wallSwitch);

  const intercom = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.2), matPorcelain);
  intercom.position.set(1.26, 1.48, -5.34);
  scene.add(intercom);
  const intercomLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.01, 8, 8),
    new THREE.MeshBasicMaterial({ color: '#7dd3fc' })
  );
  intercomLed.position.set(1.31, 1.56, -5.31);
  scene.add(intercomLed);

  // Right Wall Leaning Folding Guide Cane Pickup (Ref Image 1 — subtle sheen, NO floating neon tube!)
  const canePickupGroup = new THREE.Group();
  canePickupGroup.position.set(WAYPOINTS.canePickupPos.x, 0, WAYPOINTS.canePickupPos.z);

  const matCaneWhite = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.24, metalness: 0.18 }),
    { selfGlowBoost: 0.28 }
  );
  const matCaneRed = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.26, metalness: 0.22 }),
    { selfGlowBoost: 0.28 }
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

  // Folding metal joint collars
  for (const jy of [0.37, 0.72, 1.04]) {
    const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.022, 10), matSecurityMetal);
    joint.position.y = jy;
    leaningPivot.add(joint);
  }

  const gripMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.016, 0.22, 10), matCaneGrip);
  gripMesh.position.y = 1.16;
  leaningPivot.add(gripMesh);

  canePickupGroup.add(leaningPivot);
  registerTarget(canePickupGroup, 'cane_pickup', true, false);

  // Security Door with Peephole, Deadbolt & Soft Door-Gap Light (Ref Image 1)
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

  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(1.16, 2.2, 0.065), matSecurityMetal);
  doorLeaf.position.set(0.58, 1.11, 0);
  foyerDoorPivot.add(doorLeaf);

  // Peephole & deadbolt chain bar
  const peephole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.08, 12), matDarkIron);
  peephole.rotation.x = Math.PI / 2;
  peephole.position.set(0.58, 1.56, 0);
  foyerDoorPivot.add(peephole);

  const deadboltBar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.026, 0.085), matSecurityMetal);
  deadboltBar.position.set(1.02, 1.32, 0.01);
  foyerDoorPivot.add(deadboltBar);

  const doorHandlePlate = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.3, 0.09), matDarkIron);
  doorHandlePlate.position.set(1.04, 1.05, 0);
  foyerDoorPivot.add(doorHandlePlate);

  const doorLever = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.12), matPorcelain);
  doorLever.position.set(1.0, 1.05, 0.04);
  foyerDoorPivot.add(doorLever);

  registerTarget(foyerDoorPivot, 'door', true, true);

  // Softened vertical door-crack light sliver (no harsh fluorescent bar!)
  const doorSliverMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.055, 2.16),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.85, 1.25, 1.55),
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    })
  );
  doorSliverMesh.position.set(0.56, 1.1, -5.53);
  scene.add(doorSliverMesh);

  const doorShaftMesh = createVolumetricCone(0.04, 0.52, 2.0, '#7dd3fc', 0.09);
  doorShaftMesh.position.set(0.55, 1.22, -5.4);
  doorShaftMesh.rotation.x = Math.PI / 2 - 0.15;
  doorShaftMesh.rotation.z = 0.18;
  scene.add(doorShaftMesh);

  const doorCrackLight = new THREE.PointLight('#93c5fd', 1.25, 4.4, 1.8);
  doorCrackLight.position.set(0.45, 1.2, -5.25);
  scene.add(doorCrackLight);

  // =========================================================================
  // SCENE 2 & 3: Z-TURN URBAN STREET SIDEWALKS, CURBS & WET ASPHALT ROADWAY
  // =========================================================================
  // Continuous Wet Asphalt Roadbed covering entire urban block
  const streetAsphalt = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), matWetAsphalt);
  streetAsphalt.rotation.x = -Math.PI / 2;
  streetAsphalt.position.set(8.0, 0.0, -24.0);
  registerTarget(streetAsphalt, 'normal', false, true);
  reflectiveGroundMeshes.push(streetAsphalt);

  // Leg 1 Sidewalk: X in [-4.0, +2.6] (w=6.6), Z in [-18.4, -5.5] (d=12.9)
  const sidewalkLeg1 = new THREE.Mesh(makeTiledBoxGeo(6.6, 0.08, 12.9, 2.2, 2.2), matWetSidewalk);
  sidewalkLeg1.position.set(-0.7, 0.04, -11.95);
  registerTarget(sidewalkLeg1, 'normal', false, true);
  reflectiveGroundMeshes.push(sidewalkLeg1);

  // Leg 2 Sidewalk: X in [+2.6, +16.7] (w=14.1), Z in [-18.4, -12.6] (d=5.8)
  const sidewalkLeg2 = new THREE.Mesh(makeTiledBoxGeo(14.1, 0.08, 5.8, 2.2, 2.2), matWetSidewalk);
  sidewalkLeg2.position.set(9.65, 0.04, -15.5);
  registerTarget(sidewalkLeg2, 'normal', false, true);
  reflectiveGroundMeshes.push(sidewalkLeg2);

  // Leg 3 Sidewalk: X in [+9.8, +16.7] (w=6.9), Z in [-29.8, -18.4] (d=11.4)
  const sidewalkLeg3 = new THREE.Mesh(makeTiledBoxGeo(6.9, 0.08, 11.4, 2.2, 2.2), matWetSidewalk);
  sidewalkLeg3.position.set(13.25, 0.04, -24.1);
  registerTarget(sidewalkLeg3, 'normal', false, true);
  reflectiveGroundMeshes.push(sidewalkLeg3);

  // Raised Stone Curbs with physical height contrast
  const curbLeg1East = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 7.1), matStoneCurb);
  curbLeg1East.position.set(2.68, 0.06, -9.05);
  registerTarget(curbLeg1East, 'normal', true, true);

  const curbLeg2South = new THREE.Mesh(new THREE.BoxGeometry(14.3, 0.12, 0.2), matStoneCurb);
  curbLeg2South.position.set(9.75, 0.06, -12.52);
  registerTarget(curbLeg2South, 'normal', true, true);

  const curbLeg3East = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 17.4), matStoneCurb);
  curbLeg3East.position.set(16.78, 0.06, -21.2);
  registerTarget(curbLeg3East, 'normal', true, true);

  // Storm drain grates along curbs
  for (const [gx, gz, rotY] of [
    [2.95, -9.2, 0],
    [6.5, -12.2, Math.PI / 2],
    [12.2, -12.2, Math.PI / 2],
    [17.05, -20.5, 0],
    [17.05, -27.5, 0],
  ] as [number, number, number][]) {
    const grate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.018, 0.56), matDarkIron);
    grate.position.set(gx, 0.008, gz);
    grate.rotation.y = rotY;
    scene.add(grate);
  }

  // --- Z-TURN YELLOW TACTILE PATH (Entry -> Leg 1 -> Turn 1 -> Leg 2 -> Turn 2 -> Leg 3 -> Crosswalk) ---
  const entryDotPad = new THREE.Mesh(makeTiledBoxGeo(0.96, 0.024, 0.48, 0.48, 0.48), matTactileDot);
  entryDotPad.position.set(0, 0.092, -5.85);
  registerTarget(entryDotPad, 'tactile_dot', false, true);
  reflectiveGroundMeshes.push(entryDotPad);

  // Leg 1 straight guiding bricks (Z = -6.10 to -15.12, len = 9.02m)
  const tactileLeg1 = new THREE.Mesh(makeTiledBoxGeo(0.48, 0.024, 9.02, 0.48, 0.48), matTactileLine);
  tactileLeg1.position.set(0, 0.092, -10.61);
  registerTarget(tactileLeg1, 'tactile_line', false, true);
  reflectiveGroundMeshes.push(tactileLeg1);

  // Turn #1 Yellow 5x5 Blister-Dot Turning Pad at (0, -15.6)
  const turn1DotPad = new THREE.Mesh(makeTiledBoxGeo(0.96, 0.024, 0.96, 0.48, 0.48), matTactileDot);
  turn1DotPad.position.set(WAYPOINTS.turn1Pos.x, 0.092, WAYPOINTS.turn1Pos.z);
  registerTarget(turn1DotPad, 'tactile_dot', false, true);
  reflectiveGroundMeshes.push(turn1DotPad);

  // Leg 2 horizontal guiding bricks (+X along Z = -15.6, X = +0.48 to +13.52, len = 13.04m)
  const tactileLeg2 = new THREE.Mesh(makeTiledBoxGeo(0.48, 0.024, 13.04, 0.48, 0.48), matTactileLine);
  tactileLeg2.rotation.y = Math.PI / 2;
  tactileLeg2.position.set(7.0, 0.092, -15.6);
  registerTarget(tactileLeg2, 'tactile_line', false, true);
  reflectiveGroundMeshes.push(tactileLeg2);

  // Turn #2 Yellow 5x5 Blister-Dot Turning Pad at (14.0, -15.6)
  const turn2DotPad = new THREE.Mesh(makeTiledBoxGeo(0.96, 0.024, 0.96, 0.48, 0.48), matTactileDot);
  turn2DotPad.position.set(WAYPOINTS.turn2Pos.x, 0.092, WAYPOINTS.turn2Pos.z);
  registerTarget(turn2DotPad, 'tactile_dot', false, true);
  reflectiveGroundMeshes.push(turn2DotPad);

  // Leg 3 straight guiding bricks (-Z along X = 14.0, Z = -16.08 to -28.85, len = 12.77m)
  const tactileLeg3 = new THREE.Mesh(makeTiledBoxGeo(0.48, 0.024, 12.77, 0.48, 0.48), matTactileLine);
  tactileLeg3.position.set(14.0, 0.092, -22.465);
  registerTarget(tactileLeg3, 'tactile_line', false, true);
  reflectiveGroundMeshes.push(tactileLeg3);

  // =========================================================================
  // SOLID MULTI-STORY URBAN ARCHITECTURE & 360° HORIZON SKYLINE (NO PAPER WALLS!)
  // =========================================================================
  interface FacadeOpts {
    windowFace?: '+x' | '-x' | '+z' | '-z';
    shutters?: boolean;
    registerWall?: boolean;
  }

  const addSolidBuilding = (
    cx: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    opts: FacadeOpts = {}
  ) => {
    const bldg = new THREE.Group();
    const body = new THREE.Mesh(makeTiledBoxGeo(w, h, d, 3.6, 3.4), mat);
    body.position.set(cx, h / 2, cz);
    bldg.add(body);

    // Concrete floor cornice + parapet roof cap (solid architectural depth!)
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(w + 0.24, 0.22, d + 0.24), matStoneCurb);
    cornice.position.set(cx, 3.65, cz);
    bldg.add(cornice);

    const roofParapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.18, 0.34, d + 0.18), matDarkConcrete);
    roofParapet.position.set(cx, h + 0.15, cz);
    bldg.add(roofParapet);

    if (opts.windowFace) {
      const face = opts.windowFace;
      const isX = face === '+x' || face === '-x';
      const span = isX ? d : w;
      const sign = face === '+x' || face === '+z' ? 1 : -1;
      const faceCoord = isX ? cx + sign * (w / 2 + 0.05) : cz + sign * (d / 2 + 0.05);
      const paneRotY =
        face === '+x' ? Math.PI / 2 : face === '-x' ? -Math.PI / 2 : face === '+z' ? 0 : Math.PI;

      const floors = Math.min(3, Math.floor((h - 3.6) / 3.0));
      for (let fl = 0; fl < floors; fl++) {
        const wy = 5.15 + fl * 3.05;
        for (let off = -span / 2 + 1.9; off <= span / 2 - 1.9; off += 3.2) {
          const seed = Math.sin((cx + cz + off * 1.7 + fl * 3.3) * 1.9);
          const lit = seed > 0.38;
          const fx = isX ? faceCoord : cx + off;
          const fz = isX ? cz + off : faceCoord;

          const frame = new THREE.Mesh(
            new THREE.BoxGeometry(isX ? 0.14 : 1.38, 1.38, isX ? 1.38 : 0.14),
            matDarkIron
          );
          frame.position.set(fx, wy, fz);
          bldg.add(frame);

          const pane = new THREE.Mesh(
            new THREE.PlaneGeometry(1.24, 1.24),
            lit ? windowWarmMat : windowDimMat
          );
          pane.rotation.y = paneRotY;
          pane.position.set(
            fx + (isX ? sign * 0.08 : 0),
            wy,
            fz + (isX ? 0 : sign * 0.08)
          );
          bldg.add(pane);

          // Window sill + AC outdoor condenser unit
          if (fl === 0 && seed > -0.25) {
            const ac = new THREE.Mesh(
              new THREE.BoxGeometry(isX ? 0.34 : 0.72, 0.46, isX ? 0.72 : 0.34),
              matSecurityMetal
            );
            ac.position.set(
              fx + (isX ? sign * 0.18 : 0.85),
              wy - 0.92,
              fz + (isX ? 0.85 : sign * 0.18)
            );
            bldg.add(ac);
          }
        }
      }

      if (opts.shutters) {
        for (let off = -span / 2 + 2.6; off <= span / 2 - 2.6; off += 4.6) {
          const sx = isX ? faceCoord + sign * 0.04 : cx + off;
          const sz = isX ? cz + off : faceCoord + sign * 0.04;
          const shutter = new THREE.Mesh(
            new THREE.BoxGeometry(isX ? 0.12 : 3.2, 2.65, isX ? 3.2 : 0.12),
            matShutter
          );
          shutter.position.set(sx, 1.4, sz);
          bldg.add(shutter);

          const awning = new THREE.Mesh(
            new THREE.BoxGeometry(isX ? 0.95 : 3.45, 0.08, isX ? 3.45 : 0.95),
            matDarkIron
          );
          awning.position.set(
            sx + (isX ? sign * 0.42 : 0),
            2.88,
            sz + (isX ? 0 : sign * 0.42)
          );
          if (isX) awning.rotation.z = -sign * 0.16;
          else awning.rotation.x = sign * 0.16;
          bldg.add(awning);
        }
      }
    }

    if (opts.registerWall) {
      registerTarget(bldg, 'wall', true, true);
    } else {
      enableShadows(bldg, true, true);
      scene.add(bldg);
    }
  };

  // 1. Street-facing Hero Shophouses (Full 6m-7m thick enclosed buildings!)
  // Leg 1 West Shophouse (X in [-10.5, -3.9], Z in [-18.5, -5.5])
  addSolidBuilding(-7.2, -12.0, 6.6, 10.6, 13.0, matBrickWall, {
    windowFace: '+x',
    shutters: true,
    registerWall: true,
  });

  // Leg 2 North Corner Shophouse (X in [-10.5, +9.8], Z in [-25.5, -18.3])
  addSolidBuilding(-0.35, -21.9, 20.3, 11.4, 7.2, matBrickWall, {
    windowFace: '+z',
    shutters: true,
    registerWall: true,
  });

  // Leg 3 West Shophouse (X in [3.0, +9.8], Z in [-30.0, -18.3]) — hosts 24H Convenience Store & Breakfast Stall!
  addSolidBuilding(6.4, -24.15, 6.8, 10.2, 11.7, matBrickWall, {
    windowFace: '+x',
    shutters: false,
    registerWall: true,
  });

  // 24H Convenience Store Glowing Signboard on Leg 3 Corner (Ref Image 2!)
  const convSignMat = new THREE.MeshBasicMaterial({
    map: tex.convenienceSign,
    color: new THREE.Color(1.22, 1.18, 1.12),
  });
  const convSign = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 3.2), convSignMat);
  convSign.position.set(9.92, 3.22, -19.8);
  scene.add(convSign);

  const convShutter = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.65, 3.0), matShutter);
  convShutter.position.set(9.86, 1.4, -19.8);
  registerTarget(convShutter, 'wall', true, true);

  const convLight = new THREE.PointLight('#ffd699', 1.35, 7.2, 1.6);
  convLight.position.set(10.55, 2.9, -19.8);
  scene.add(convLight);

  // Opposite-Road Enclosed Shophouses (Facing Leg 1 East, Leg 2 South, Leg 3 East!)
  addSolidBuilding(11.6, -5.2, 11.0, 9.6, 8.8, matDarkConcrete, { windowFace: '-z' });
  addSolidBuilding(26.2, -19.5, 7.6, 11.2, 22.0, matBrickWall, { windowFace: '-x' });

  // Far Crosswalk Sunset Canyon Buildings (Framing the Golden Sunset along -Z at X = 14.0!)
  addSolidBuilding(6.4, -46.5, 7.2, 12.2, 13.0, matBrickWall, { windowFace: '+x' });
  addSolidBuilding(21.6, -46.5, 7.2, 12.6, 13.0, matBrickWall, { windowFace: '-x' });
  addSolidBuilding(6.0, -59.5, 6.8, 16.5, 11.0, matDarkConcrete, { windowFace: '+x' });
  addSolidBuilding(22.0, -59.5, 6.8, 15.8, 11.0, matDarkConcrete, { windowFace: '-x' });

  // 360° Perimeter Distant Urban Skyline Ring (14 varied-height towers — ZERO empty horizon in any direction!)
  const skylineSpecs: [number, number, number, number, number][] = [
    [-19, -8, 10, 15, 14],
    [-19, -24, 11, 18, 16],
    [-12, -38, 12, 14, 14],
    [-2, -40, 10, 17, 13],
    [-15, 11, 14, 14, 10],
    [0, 15, 15, 16, 10],
    [16, 14, 14, 15, 11],
    [32, 6, 12, 17, 14],
    [36, -12, 11, 19, 16],
    [36, -32, 12, 16, 16],
    [34, -50, 13, 20, 15],
    [-6, -56, 12, 19, 14],
    [14, -76, 10, 11, 8], // Low distant silhouette block far down the sunset horizon
    [28, -68, 12, 18, 12],
  ];
  for (const [sx, sz, sw, sh, sd] of skylineSpecs) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), matSkylineBldg);
    tower.position.set(sx, sh / 2, sz);
    scene.add(tower);
  }

  // Overhead Utility Cables Draped Across Street Canyons
  const cableMat = new THREE.LineBasicMaterial({ color: '#0f1318', transparent: true, opacity: 0.72 });
  const addCableSpan = (a: THREE.Vector3, b: THREE.Vector3) => {
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mid.y -= 0.78;
    const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(14);
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat));
  };
  for (const cz of [-19.0, -27.5, -40.2]) {
    addCableSpan(new THREE.Vector3(9.8, 6.2, cz), new THREE.Vector3(22.4, 6.3, cz));
    addCableSpan(new THREE.Vector3(9.8, 6.65, cz), new THREE.Vector3(22.4, 6.75, cz));
  }
  for (const cx of [3.5, 8.5]) {
    addCableSpan(new THREE.Vector3(cx, 6.2, -18.3), new THREE.Vector3(cx, 6.3, -9.6));
  }

  // Roadside Wrought-Iron Guardrails along Curbs
  const addGuardrail = (cx: number, cz: number, len: number, rotY = 0) => {
    const railGroup = new THREE.Group();
    railGroup.position.set(cx, 0.1, cz);
    railGroup.rotation.y = rotY;
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), matDarkIron);
    topBar.position.y = 0.78;
    railGroup.add(topBar);
    const midBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, len), matDarkIron);
    midBar.position.y = 0.42;
    railGroup.add(midBar);
    const posts = Math.max(2, Math.round(len / 1.3) + 1);
    for (let i = 0; i < posts; i++) {
      const pz = -len / 2 + (i / (posts - 1)) * len;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.82, 0.05), matDarkIron);
      post.position.set(0, 0.41, pz);
      railGroup.add(post);
    }
    scene.add(railGroup);
  };
  addGuardrail(2.65, -8.8, 5.4, 0);
  addGuardrail(6.4, -12.55, 6.4, Math.PI / 2);
  addGuardrail(13.2, -12.55, 5.6, Math.PI / 2);
  addGuardrail(16.72, -16.6, 6.6, 0);
  addGuardrail(16.72, -24.8, 6.8, 0);

  // =========================================================================
  // LEG 2 OBSTACLES: DETAILED SHARED BIKES & CONSTRUCTION BARRIER (Ref Image 2)
  // =========================================================================
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

    const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.78, 12), matFrame);
    downTube.position.set(0.14, 0.48, 0);
    downTube.rotation.z = 0.78;
    bike.add(downTube);

    const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 10), matFrame);
    topBar.position.set(0.12, 0.66, 0);
    topBar.rotation.z = 1.48;
    bike.add(topBar);

    const seatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 12), matFrame);
    seatTube.position.set(-0.16, 0.54, 0);
    seatTube.rotation.z = 0.22;
    bike.add(seatTube);

    const rearStay = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.48, 8), matFrame);
    rearStay.position.set(-0.34, 0.42, 0);
    rearStay.rotation.z = -0.58;
    bike.add(rearStay);

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

  // Two obliquely parked shared bikes blocking Leg 2 tactile strip at (4.8, -15.6)
  const bikeYellow = createSharedBike('#eab308');
  bikeYellow.position.set(WAYPOINTS.bikesCenter.x - 0.24, 0.08, WAYPOINTS.bikesCenter.z - 0.22);
  bikeYellow.rotation.y = 1.15;
  registerTarget(bikeYellow, 'bike', true, true);

  const bikeBlue = createSharedBike('#38bdf8');
  bikeBlue.position.set(WAYPOINTS.bikesCenter.x + 0.26, 0.08, WAYPOINTS.bikesCenter.z + 0.24);
  bikeBlue.rotation.y = 0.92;
  registerTarget(bikeBlue, 'bike', true, true);

  // Construction Barrier across Leg 2 tactile strip at (9.2, -15.6) — faces -X!
  const barrierGroup = new THREE.Group();
  barrierGroup.position.set(WAYPOINTS.barrierCenter.x, 0.08, WAYPOINTS.barrierCenter.z);
  barrierGroup.rotation.y = -Math.PI / 2 + 0.05;

  const topBoard = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.28, 0.065), matBarrierBoard);
  topBoard.position.y = 0.88;
  barrierGroup.add(topBoard);

  const botBoard = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.28, 0.065), matBarrierBoard);
  botBoard.position.y = 0.42;
  barrierGroup.add(botBoard);

  for (const sideX of [-0.8, 0.8]) {
    for (const tilt of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.14, 0.06), matSecurityMetal);
      leg.position.set(sideX, 0.54, tilt * 0.18);
      leg.rotation.x = tilt * 0.32;
      barrierGroup.add(leg);
    }
  }

  const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.09, 10), matDarkIron);
  beaconBase.position.set(0.74, 1.06, 0);
  barrierGroup.add(beaconBase);

  const barrierBeaconBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 1.35, 0.22) })
  );
  barrierBeaconBulb.position.set(0.74, 1.15, 0);
  barrierGroup.add(barrierBeaconBulb);

  const barrierBeaconLight = new THREE.PointLight('#ff8c1a', 1.6, 5.0, 1.7);
  barrierBeaconLight.position.set(WAYPOINTS.barrierCenter.x, 1.28, WAYPOINTS.barrierCenter.z - 0.72);
  scene.add(barrierBeaconLight);

  const matConeOrange = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#ea580c', roughness: 0.42, metalness: 0.08 })
  );
  const matConeWhite = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.3 }),
    { selfGlowBoost: 0.1 }
  );
  for (const cx of [-1.05, 1.05]) {
    const cone = new THREE.Group();
    cone.position.set(cx, 0, cx > 0 ? 0.32 : -0.26);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.3), matDarkIron);
    base.position.y = 0.018;
    cone.add(base);
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.54, 12), matConeOrange);
    body.position.y = 0.29;
    cone.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.082, 0.1, 12), matConeWhite);
    band.position.y = 0.35;
    cone.add(band);
    barrierGroup.add(cone);
  }
  registerTarget(barrierGroup, 'barrier', true, true);

  // --- Gooseneck Streetlamps Along All 3 Legs (Permanent Lights!) ---
  const lampSpecs: [number, number, number][] = [
    [2.25, -10.2, 0],
    [7.0, -13.0, Math.PI / 2],
    [16.15, -20.5, 0],
    [16.15, -26.7, 0],
  ];
  for (const [lx, lz, rotY] of lampSpecs) {
    const poleGroup = new THREE.Group();
    poleGroup.position.set(lx, 0.08, lz);
    poleGroup.rotation.y = rotY;

    const poleBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.105, 1.2, 12),
      matSecurityMetal
    );
    poleBase.position.y = 0.6;
    poleGroup.add(poleBase);
    const poleUpper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.078, 4.1, 12),
      matSecurityMetal
    );
    poleUpper.position.y = 3.25;
    poleGroup.add(poleUpper);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 1.15, 8), matDarkIron);
    arm.rotation.z = Math.PI / 2 - 0.18;
    arm.position.set(-0.52, 5.18, 0);
    poleGroup.add(arm);

    const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.18), matDarkIron);
    lampHead.position.set(-1.05, 5.26, 0);
    poleGroup.add(lampHead);

    const lampBulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.55, 0.76) });
    streetLampBulbs.push(lampBulbMat);
    const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), lampBulbMat);
    lampBulb.scale.set(1.2, 0.55, 1.0);
    lampBulb.position.set(-1.05, 5.2, 0);
    poleGroup.add(lampBulb);

    const cone = createVolumetricCone(0.18, 2.3, 5.1, '#ffcf86', 0.11);
    cone.position.set(-1.05, 5.18, 0);
    poleGroup.add(cone);
    streetLampCones.push(cone);

    const lampLight = new THREE.PointLight('#ffbf69', 1.9, 9.5, 1.6);
    const worldArmX = lx + Math.cos(rotY) * -1.05;
    const worldArmZ = lz - Math.sin(rotY) * -1.05;
    lampLight.position.set(worldArmX, 5.0, worldArmZ);
    scene.add(lampLight);

    registerTarget(poleGroup, 'normal', true, true);
  }

  // Scattered Wet Golden Autumn Leaves across the Z-Turn Sidewalk
  const leafMat = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#b97b26', roughness: 0.38, side: THREE.DoubleSide })
  );
  const leafGeo = new THREE.PlaneGeometry(0.1, 0.062);
  for (let i = 0; i < 90; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.rotation.x = -Math.PI / 2;
    leaf.rotation.z = (i * 1.7) % (Math.PI * 2);
    const seg = i % 3;
    let lx = 0;
    let lz = -10;
    if (seg === 0) {
      lx = -3.4 + ((i * 2.13) % 5.8);
      lz = -6.5 - ((i * 1.91) % 11.2);
    } else if (seg === 1) {
      lx = 1.2 + ((i * 2.71) % 14.8);
      lz = -18.0 + ((i * 1.37) % 5.2);
    } else {
      lx = 10.4 + ((i * 2.37) % 6.2);
      lz = -18.2 - ((i * 2.63) % 11.4);
    }
    leaf.position.set(lx, 0.09, lz);
    scene.add(leaf);
  }

  // =========================================================================
  // SCENE 3: WARM STREET-CORNER BREAKFAST STALL & TABBY CAT (Ref Image 3)
  // =========================================================================
  const stallGroup = new THREE.Group();
  stallGroup.position.set(10.85, 0.08, -23.6);

  const counterBase = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.96, 3.1), matWarmWood);
  counterBase.position.set(-0.1, 0.48, 0);
  stallGroup.add(counterBase);

  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.07, 3.28), matDarkWood);
  counterTop.position.set(-0.02, 0.99, 0);
  stallGroup.add(counterTop);

  // Small condiment jars & cash register silhouette on counter (Ref Image 3)
  const registerBox = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.36), matPorcelain);
  registerBox.position.set(0.18, 1.14, -0.95);
  stallGroup.add(registerBox);
  for (let cb = 0; cb < 3; cb++) {
    const cond = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.035, 0.17, 10), matDarkWood);
    cond.position.set(0.45, 1.11, -0.58 + cb * 0.14);
    stallGroup.add(cond);
  }

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

  const bannerMat = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ map: tex.stallBanner, roughness: 0.85 }),
    { selfGlowBoost: 0.32 }
  );
  const bannerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 1.2), bannerMat);
  bannerMesh.position.set(0.92, 2.28, 0.0);
  stallGroup.add(bannerMesh);

  const matNoren = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#47362b', roughness: 0.9 }),
    { selfGlowBoost: 0.16 }
  );
  for (const nz of [-1.15, 1.15]) {
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.46, 0.82), matNoren);
    curtain.position.set(0.9, 2.26, nz);
    stallGroup.add(curtain);
  }

  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.36, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.48, 0.52) })
  );
  lantern.position.set(0.92, 1.98, -1.42);
  stallGroup.add(lantern);

  const stallVolCone = createVolumetricCone(0.45, 2.35, 2.45, '#ffaa44', 0.14);
  stallVolCone.position.set(0.3, 2.48, 0);
  stallGroup.add(stallVolCone);

  const stallPointLight = new THREE.PointLight('#ff9e38', 4.4, 6.4, 1.45);
  stallPointLight.position.set(
    WAYPOINTS.stallLightPos.x,
    WAYPOINTS.stallLightPos.y,
    WAYPOINTS.stallLightPos.z
  );
  stallPointLight.castShadow = false;
  scene.add(stallPointLight);

  // Stacked Bamboo Steamers + Curling Steam Puffs
  const steamPuffs: THREE.Mesh[] = [];
  const steamMat = new THREE.MeshBasicMaterial({
    color: '#fde68a',
    transparent: true,
    opacity: 0.15,
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
    puff.position.set(10.85 + st.x, 1.25 + st.tiers * 0.135, -23.6 + st.z);
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

  // Refined Seated Tabby Street Cat (Ref Image 3 — rounded silhouette, tabby stripes, tucked paws!)
  const catGroup = new THREE.Group();
  catGroup.position.set(WAYPOINTS.catPos.x, WAYPOINTS.catPos.y, WAYPOINTS.catPos.z);
  catGroup.rotation.y = 0.95;

  const tabbyTex = createTabbyFurTexture();
  const matCatFur = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ map: tabbyTex, roughness: 0.86 }),
    { selfGlowBoost: 0.14 }
  );
  const matCatChest = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#e5dcd1', roughness: 0.86 }),
    { selfGlowBoost: 0.14 }
  );
  const matCatEye = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.5, 0.62) });

  // Rounded seated haunches & sloped torso
  const catHaunch = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 14), matCatFur);
  catHaunch.scale.set(0.95, 0.92, 1.12);
  catHaunch.position.set(0, 0.115, -0.02);
  catGroup.add(catHaunch);

  const catTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.092, 0.14, 8, 14), matCatFur);
  catTorso.position.set(0, 0.21, 0.025);
  catTorso.rotation.x = 0.22;
  catGroup.add(catTorso);

  const catChest = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 12), matCatChest);
  catChest.scale.set(0.9, 1.15, 0.82);
  catChest.position.set(0, 0.2, 0.072);
  catGroup.add(catChest);

  // Neat folded front legs & white paws
  for (const px of [-0.042, 0.042]) {
    const fLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.16, 10), matCatFur);
    fLeg.position.set(px, 0.09, 0.088);
    catGroup.add(fLeg);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), matCatChest);
    paw.scale.set(1.0, 0.65, 1.35);
    paw.position.set(px, 0.018, 0.105);
    catGroup.add(paw);
  }

  // Softly sculpted round head + muzzle + ears + eyes
  const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.094, 16, 14), matCatFur);
  catHead.scale.set(1.04, 0.96, 0.98);
  catHead.position.set(0, 0.34, 0.065);
  catGroup.add(catHead);

  const catMuzzle = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), matCatChest);
  catMuzzle.scale.set(1.15, 0.78, 0.95);
  catMuzzle.position.set(0, 0.315, 0.14);
  catGroup.add(catMuzzle);

  for (const ex of [-0.036, 0.036]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), matCatEye);
    eye.position.set(ex, 0.352, 0.146);
    catGroup.add(eye);
  }

  for (const ex of [-0.056, 0.056]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.072, 6), matCatFur);
    ear.position.set(ex, 0.425, 0.058);
    ear.rotation.z = ex < 0 ? 0.24 : -0.24;
    catGroup.add(ear);
  }

  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.06, -0.11),
    new THREE.Vector3(0.08, 0.04, -0.18),
    new THREE.Vector3(0.14, 0.09, -0.12),
    new THREE.Vector3(0.15, 0.15, -0.05),
  ]);
  const catTail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 0.018, 8, false), matCatFur);
  catGroup.add(catTail);

  registerTarget(catGroup, 'cat', true, true);

  const catPointLight = new THREE.PointLight('#fbbf24', 0.0, 2.8, 1.6);
  catPointLight.position.set(WAYPOINTS.catPos.x, 0.45, WAYPOINTS.catPos.z);
  scene.add(catPointLight);

  // =========================================================================
  // SCENE 4: SILENT CROSSWALK, TRAFFIC SIGNAL & GOLDEN SUNSET CANYON (Ref Image 4)
  // =========================================================================
  const cx = WAYPOINTS.crosswalkCenterX; // 14.0

  const curbDotWarning = new THREE.Mesh(makeTiledBoxGeo(3.6, 0.025, 0.94, 0.48, 0.48), matTactileDot);
  curbDotWarning.position.set(cx, 0.084, -29.32);
  registerTarget(curbDotWarning, 'tactile_dot', false, true);
  reflectiveGroundMeshes.push(curbDotWarning);

  const nearCurbLip = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.09, 0.22), matStoneCurb);
  nearCurbLip.position.set(cx - 0.75, 0.045, -29.85);
  registerTarget(nearCurbLip, 'normal', true, true);

  // Near-Curb Silent Signal Pole (Interactable Micro-Interaction #3)
  const nearPoleGroup = new THREE.Group();
  nearPoleGroup.position.set(WAYPOINTS.signalPolePos.x, 0.08, WAYPOINTS.signalPolePos.z);
  const nearPoleShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.08, 3.3, 12),
    matSecurityMetal
  );
  nearPoleShaft.position.y = 1.65;
  nearPoleGroup.add(nearPoleShaft);
  const emptyBracket = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.08), matDarkIron);
  emptyBracket.position.set(-0.08, 1.15, 0);
  nearPoleGroup.add(emptyBracket);
  registerTarget(nearPoleGroup, 'signal_pole', true, true);

  // 8 Weathered White Zebra Crosswalk Bars (Ref Image 4!)
  for (let i = 0; i < 8; i++) {
    const barZ = -30.95 - i * 1.12;
    const zebraBar = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.012, 0.58), matCrosswalkBar);
    zebraBar.position.set(cx, 0.008, barZ);
    registerTarget(zebraBar, 'crosswalk', false, true);
    reflectiveGroundMeshes.push(zebraBar);
  }

  // Opposite Safe Sidewalk & Tactile Ramp
  const farCurbLip = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.09, 0.22), matStoneCurb);
  farCurbLip.position.set(cx, 0.045, -39.75);
  registerTarget(farCurbLip, 'normal', true, true);

  const farSidewalk = new THREE.Mesh(makeTiledBoxGeo(11.0, 0.08, 7.0, 2.2, 2.2), matWetSidewalk);
  farSidewalk.position.set(cx, 0.04, -43.3);
  registerTarget(farSidewalk, 'normal', false, true);
  reflectiveGroundMeshes.push(farSidewalk);

  const farDotPad = new THREE.Mesh(makeTiledBoxGeo(3.6, 0.025, 0.88, 0.48, 0.48), matTactileDot);
  farDotPad.position.set(cx, 0.084, -40.25);
  registerTarget(farDotPad, 'tactile_dot', false, true);
  reflectiveGroundMeshes.push(farDotPad);

  const farTactileLine = new THREE.Mesh(makeTiledBoxGeo(0.48, 0.024, 4.2, 0.48, 0.48), matTactileLine);
  farTactileLine.position.set(cx, 0.092, -42.8);
  registerTarget(farTactileLine, 'tactile_line', false, true);
  reflectiveGroundMeshes.push(farTactileLine);

  // Opposite Crosswalk Pedestrian Signal Lamp
  const farSignalGroup = new THREE.Group();
  farSignalGroup.position.set(cx + 1.95, 0.08, -40.05);
  const farPole = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 3.6, 10), matDarkIron);
  farPole.position.y = 1.8;
  farSignalGroup.add(farPole);

  const signalHousing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.68, 0.24), matDarkIron);
  signalHousing.position.set(0, 3.15, 0.05);
  farSignalGroup.add(signalHousing);

  const signalRedLens = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.28, 0.18) })
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
  signalLight.position.set(cx + 1.95, 3.15, -39.5);
  scene.add(signalLight);

  const setPedestrianSignalGreen = (isGreen: boolean) => {
    const rMat = signalRedLens.material as THREE.MeshBasicMaterial;
    const gMat = signalGreenLens.material as THREE.MeshBasicMaterial;
    if (isGreen) {
      rMat.color.setRGB(0.18, 0.04, 0.03);
      gMat.color.setRGB(0.35, 2.9, 1.1);
      signalLight.color.set('#22c55e');
      signalLight.intensity = 2.3;
    } else {
      rMat.color.setRGB(3.0, 0.28, 0.18);
      gMat.color.setRGB(0.06, 0.14, 0.08);
      signalLight.color.set('#ff3b30');
      signalLight.intensity = 1.8;
    }
  };

  // Utility poles flanking the far sunset street canyon
  for (const side of [-1, 1]) {
    const utilityPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.095, 7.8, 10),
      matDarkIron
    );
    utilityPole.position.set(cx + side * 2.4, 3.9, -40.7);
    scene.add(utilityPole);
  }

  // Golden After-Rain Sunset Volumetric God-Ray Shafts down the Leg 3 Street Canyon!
  const sunsetGodRays = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const shaft = createVolumetricCone(1.8, 5.4, 24, '#ffb257', 0.0);
    shaft.position.set(cx + (i - 1) * 1.4, 8.2 - i * 0.4, -50);
    shaft.rotation.x = -Math.PI / 2 + 0.28;
    sunsetGodRays.add(shaft);
  }
  scene.add(sunsetGodRays);

  // =========================================================================
  // SLENDER WARM-GOLD BACKLIT SILHOUETTE ESCORT (Ref Image 4 — ZERO BLOCKY LIMBS!)
  // =========================================================================
  const pedestrianGroup = new THREE.Group();
  pedestrianGroup.position.set(
    WAYPOINTS.pedestrianPos.x,
    WAYPOINTS.pedestrianPos.y,
    WAYPOINTS.pedestrianPos.z
  );
  pedestrianGroup.visible = false;

  const silhouetteMat = createBacklitSilhouetteMaterial();

  // Sculpted graceful coat-and-shoulders profile via LatheGeometry (flowing, organic silhouette!)
  const torsoProfile: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.56),
    new THREE.Vector2(0.21, 0.58), // Coat hem
    new THREE.Vector2(0.185, 0.85), // Hips
    new THREE.Vector2(0.155, 1.08), // Waist
    new THREE.Vector2(0.195, 1.32), // Chest
    new THREE.Vector2(0.225, 1.46), // Soft rounded shoulders
    new THREE.Vector2(0.11, 1.52), // Collar
    new THREE.Vector2(0.058, 1.56), // Neck
    new THREE.Vector2(0.055, 1.6),
  ];
  const torsoLathe = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 24), silhouetteMat);
  torsoLathe.scale.set(1.06, 1.0, 0.68);
  pedestrianGroup.add(torsoLathe);

  // Graceful sculpted head
  const headProfile: THREE.Vector2[] = [
    new THREE.Vector2(0.001, 1.58),
    new THREE.Vector2(0.072, 1.62),
    new THREE.Vector2(0.098, 1.7),
    new THREE.Vector2(0.092, 1.79),
    new THREE.Vector2(0.05, 1.84),
    new THREE.Vector2(0.001, 1.855),
  ];
  const pedHead = new THREE.Mesh(new THREE.LatheGeometry(headProfile, 20), silhouetteMat);
  pedHead.scale.set(0.96, 1.0, 1.08);
  pedestrianGroup.add(pedHead);

  // Slender tapered legs (subtle walking glide!)
  const legGeo = new THREE.CylinderGeometry(0.054, 0.036, 0.64, 14);
  legGeo.translate(0, -0.32, 0);
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.085, 0.64, 0);
  leftLegPivot.add(new THREE.Mesh(legGeo, silhouetteMat));
  pedestrianGroup.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.085, 0.64, 0);
  rightLegPivot.add(new THREE.Mesh(legGeo, silhouetteMat));
  pedestrianGroup.add(rightLegPivot);

  // Soft warm-gold radial backlit halo plane behind figure
  const auraCanvas = document.createElement('canvas');
  auraCanvas.width = 128;
  auraCanvas.height = 128;
  const aCtx = auraCanvas.getContext('2d')!;
  const aGrad = aCtx.createRadialGradient(64, 64, 4, 64, 64, 62);
  aGrad.addColorStop(0, 'rgba(255, 232, 180, 0.85)');
  aGrad.addColorStop(0.38, 'rgba(255, 175, 70, 0.42)');
  aGrad.addColorStop(1, 'rgba(255, 140, 30, 0)');
  aCtx.fillStyle = aGrad;
  aCtx.fillRect(0, 0, 128, 128);
  const auraTex = new THREE.CanvasTexture(auraCanvas);

  const pedAura = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 3.0),
    new THREE.MeshBasicMaterial({
      map: auraTex,
      color: new THREE.Color(1.45, 0.96, 0.44),
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  pedAura.position.set(0, 1.18, -0.22);
  pedestrianGroup.add(pedAura);
  scene.add(pedestrianGroup);

  const pedestrianHaloLight = new THREE.PointLight('#ffb347', 0.0, 9.5, 1.4);
  pedestrianHaloLight.position.set(cx, 1.85, -40.5);
  scene.add(pedestrianHaloLight);

  // Kept as empty always-hidden placeholder for API compatibility (zero camera-blocking arm mesh!)
  const playerLeftArmRoot = new THREE.Group();
  playerLeftArmRoot.visible = false;
  camera.add(playerLeftArmRoot);

  // Permanent light on camera (intensity = 0 initially -> zero shader recompiles!)
  const joinedHandsLight = new THREE.PointLight('#ffc46b', 0.0, 2.6, 1.6);
  joinedHandsLight.position.set(0.25, -0.15, -0.55);
  camera.add(joinedHandsLight);

  const updateEscortMotion = (
    _dt: number,
    holdingBlend: number,
    stridePhase: number,
    strideAmp: number,
    elapsed: number
  ) => {
    const legSwing = Math.sin(stridePhase) * 0.34 * strideAmp;
    leftLegPivot.rotation.x = legSwing;
    rightLegPivot.rotation.x = -legSwing;
    // Gentle warm silhouette breathing pulse
    silhouetteMat.uniforms.uPulse.value = 0.92 + Math.sin(elapsed * 2.2) * 0.08;
    pedAura.lookAt(camera.position);
    joinedHandsLight.intensity = holdingBlend * 0.65;
  };

  const escortRig: EscortVisualRig = {
    pedestrianGroup,
    pedestrianHaloLight,
    playerLeftArmRoot,
    joinedHandsLight,
    updateEscortMotion,
  };

  // --- High-Speed Crosswalk Traffic Light-Trails (Pre-allocated & Pre-compiled!) ---
  const trafficStreaks: TrafficVisual[] = [];
  const createTrafficStreak = (laneZ: number, dir: 1 | -1): TrafficVisual => {
    const grp = new THREE.Group();
    grp.position.set(cx + dir * -26, 0.52, laneZ);
    grp.visible = false;

    const carHull = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 1.15, 1.72),
      new THREE.MeshBasicMaterial({ color: '#080a0f', transparent: true, opacity: 0.85 })
    );
    carHull.position.y = 0.2;
    grp.add(carHull);

    const tailMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.2, 0.32, 0.2),
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const headMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.0, 2.55, 1.85),
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (const tz of [-0.66, 0.66]) {
      const tailBeam = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 0.14), tailMat);
      tailBeam.position.set(-dir * 3.8, 0.18, tz);
      grp.add(tailBeam);

      const headBeam = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 0.2), headMat);
      headBeam.position.set(dir * 3.1, 0.12, tz);
      grp.add(headBeam);
    }

    scene.add(grp);
    return { group: grp, direction: dir, speed: 24, laneZ, active: false };
  };

  trafficStreaks.push(createTrafficStreak(-32.9, 1));
  trafficStreaks.push(createTrafficStreak(-36.7, -1));

  // =========================================================================
  // RESTRAINED MICRO-DUST SPARKLE POOL (Fixed Capacity — 80% Fewer, 65% Smaller!)
  // =========================================================================
  const MAX_SPARKLES = 24;
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
  spGrad.addColorStop(0.38, 'rgba(255,255,255,0.55)');
  spGrad.addColorStop(1, 'rgba(255,255,255,0)');
  spCtx.fillStyle = spGrad;
  spCtx.fillRect(0, 0, 32, 32);
  const spTex = new THREE.CanvasTexture(spCanvas);

  const sparklePoints = new THREE.Points(
    sparkleGeo,
    new THREE.PointsMaterial({
      size: 0.032, // 34% of original 0.095 -> ultra-fine delicate cane-tip dust motes!
      map: spTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  sparklePoints.frustumCulled = false;
  scene.add(sparklePoints);

  const spawnSparkles = (origin: THREE.Vector3, isWarm: boolean) => {
    // Only 4 micro dust motes right around cane tip impact (down from 22!)
    for (let i = 0; i < 4; i++) {
      const idx = sparkleCursor;
      sparkleCursor = (sparkleCursor + 1) % MAX_SPARKLES;

      const angle = Math.random() * Math.PI * 2;
      const rad = 0.06 + Math.random() * 0.42;
      sparklePositions[idx * 3] = origin.x + Math.cos(angle) * rad;
      sparklePositions[idx * 3 + 1] = origin.y + 0.03 + Math.random() * 0.14;
      sparklePositions[idx * 3 + 2] = origin.z + Math.sin(angle) * rad;

      if (isWarm) {
        sparkleColors[idx * 3] = 1.25;
        sparkleColors[idx * 3 + 1] = 0.88;
        sparkleColors[idx * 3 + 2] = 0.36;
      } else {
        sparkleColors[idx * 3] = 0.65;
        sparkleColors[idx * 3 + 1] = 1.08;
        sparkleColors[idx * 3 + 2] = 1.22;
      }
      sparkleLife[idx] = 0.85;
      sparkleVelY[idx] = 0.09 + Math.random() * 0.14;
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
    stallPointLight.castShadow = false;
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

    const vis = Math.max(0, Math.min(1, worldVisibility));
    const ambientEmissiveScale = 0.025 + vis * 0.975;
    windowWarmMat.color.setRGB(
      1.35 * ambientEmissiveScale,
      0.9 * ambientEmissiveScale,
      0.46 * ambientEmissiveScale
    );
    convSignMat.color.setRGB(
      1.22 * (0.04 + vis * 0.96),
      1.18 * (0.04 + vis * 0.96),
      1.12 * (0.04 + vis * 0.96)
    );
    for (const bm of streetLampBulbs) {
      bm.color.setRGB(
        2.2 * (0.05 + vis * 0.95),
        1.55 * (0.05 + vis * 0.95),
        0.76 * (0.05 + vis * 0.95)
      );
    }
    for (const cone of streetLampCones) {
      ((cone.material as THREE.ShaderMaterial).uniforms.uGain as { value: number }).value =
        0.11 * vis;
    }
    ((stallVolCone.material as THREE.ShaderMaterial).uniforms.uGain as { value: number }).value =
      0.03 + vis * 0.12;
    (lantern.material as THREE.MeshBasicMaterial).color.setRGB(
      2.6 * (0.28 + vis * 0.72),
      1.48 * (0.28 + vis * 0.72),
      0.52 * (0.28 + vis * 0.72)
    );
    steamMat.opacity = 0.03 + vis * 0.13;

    const pulse = 0.15 + 0.85 * Math.pow(Math.sin(elapsed * 3.8) * 0.5 + 0.5, 2.2);
    const beaconVis = 0.22 + vis * 0.78;
    barrierBeaconLight.intensity = (0.3 + pulse * 1.6) * beaconVis;
    (barrierBeaconBulb.material as THREE.MeshBasicMaterial).color.setRGB(
      (0.75 + pulse * 2.1) * beaconVis,
      (0.32 + pulse * 0.95) * beaconVis,
      (0.06 + pulse * 0.14) * beaconVis
    );

    // Tabby cat idle breathing & tail sway
    catGroup.scale.y = 1.0 + Math.sin(elapsed * 2.6) * 0.025;
    catTail.rotation.y = Math.sin(elapsed * 3.1) * 0.16;

    // Warm stall steamer puffs
    for (const puff of steamPuffs) {
      const cycle = (((elapsed * 0.55 + (puff.userData.phase as number)) % 1.0) + 1.0) % 1.0;
      puff.position.y = (puff.userData.baseY as number) + cycle * 0.7;
      const s = 0.6 + cycle * 1.1;
      puff.scale.set(s, s, s);
    }

    // Golden sunset volumetric god-ray gain
    sunsetGodRays.children.forEach((c) => {
      const m = (c as THREE.Mesh).material as THREE.ShaderMaterial;
      m.uniforms.uGain.value = sunsetFactor * 0.2;
    });

    // Traffic streaks motion across crosswalk (centered on X = cx)
    for (const tr of trafficStreaks) {
      if (!tr.active) continue;
      tr.group.position.x += tr.direction * tr.speed * dt;
      if (Math.abs(tr.group.position.x - cx) > 30) {
        tr.active = false;
        tr.group.visible = false;
      }
    }

    // Restrained cane-tip dust motes
    let dirty = false;
    for (let i = 0; i < MAX_SPARKLES; i++) {
      if (sparkleLife[i] > 0) {
        sparkleLife[i] -= dt * 0.95;
        if (sparkleLife[i] <= 0) {
          sparklePositions[i * 3 + 1] = -100;
        } else {
          sparklePositions[i * 3 + 1] += sparkleVelY[i] * dt;
          sparkleColors[i * 3] *= 0.975;
          sparkleColors[i * 3 + 1] *= 0.975;
          sparkleColors[i * 3 + 2] *= 0.975;
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
