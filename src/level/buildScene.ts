import * as THREE from 'three';
import { ColliderBox, SurfaceTag, WAYPOINTS } from './levelData';
import { createProceduralTextures } from './textures';
import { EchoShaderManager } from '../shaders/echoMaterial';

export interface TrafficVisual {
  group: THREE.Group;
  direction: 1 | -1; // 1: Left(-X) -> Right(+X), -1: Right(+X) -> Left(-X)
  speed: number;
  laneZ: number;
  active: boolean;
}

export interface BuiltSceneResult {
  raycastTargets: THREE.Object3D[];
  foyerDoorPivot: THREE.Group;
  doorCrackLight: THREE.PointLight;
  doorSliverMesh: THREE.Mesh;
  canePickupGroup: THREE.Group;
  catGroup: THREE.Group;
  catPointLight: THREE.PointLight;
  stallPointLight: THREE.PointLight;
  pedestrianGroup: THREE.Group;
  pedestrianHaloLight: THREE.PointLight;
  sunsetDirLight: THREE.DirectionalLight;
  ambientHemiLight: THREE.HemisphereLight;
  sunsetBackdrop: THREE.Mesh;
  debugWireframeGroup: THREE.Group;
  steamPuffs: THREE.Mesh[];
  trafficStreaks: TrafficVisual[];
  spawnSparkles: (origin: THREE.Vector3, isWarm: boolean) => void;
  updateParticlesAndProps: (dt: number, elapsed: number, doorOpenTarget: number) => void;
  rebuildDebugWireframes: (colliders: ColliderBox[]) => void;
}

function tagObjectTree(obj: THREE.Object3D, tag: SurfaceTag): void {
  obj.userData.surfaceTag = tag;
  obj.traverse((child) => {
    child.userData.surfaceTag = tag;
  });
}

export function buildGameScene(
  scene: THREE.Scene,
  echoManager: EchoShaderManager,
  colliders: ColliderBox[]
): BuiltSceneResult {
  const tex = createProceduralTextures();
  const raycastTargets: THREE.Object3D[] = [];

  const registerTarget = (obj: THREE.Object3D, tag: SurfaceTag) => {
    tagObjectTree(obj, tag);
    scene.add(obj);
    raycastTargets.push(obj);
  };

  // === Lighting Setup (PBR base lit in linear space; EchoShader masks darkness when uDebugPeek==0) ===
  const ambientHemiLight = new THREE.HemisphereLight('#9db4d8', '#2a2420', 0.95);
  scene.add(ambientHemiLight);

  const moonDirLight = new THREE.DirectionalLight('#cbd5e1', 0.85);
  moonDirLight.position.set(4, 12, 6);
  scene.add(moonDirLight);

  // Sunset Golden Directional Light (ramps up in Node 05/06!)
  const sunsetDirLight = new THREE.DirectionalLight('#ff9e44', 0.15);
  sunsetDirLight.position.set(0, 5.5, -58);
  scene.add(sunsetDirLight);

  // === Shared Enhanced PBR Materials ===
  const matInteriorFloor = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.interiorTile.map,
      bumpMap: tex.interiorTile.bumpMap,
      bumpScale: 0.015,
      roughnessMap: tex.interiorTile.roughnessMap,
      roughness: 0.78,
      metalness: 0.08,
    })
  );

  const matPlasterWall = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.plasterWall.map,
      bumpMap: tex.plasterWall.bumpMap,
      bumpScale: 0.02,
      roughness: 0.88,
      metalness: 0.02,
    })
  );

  const matBrickWall = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.brickWall.map,
      bumpMap: tex.brickWall.bumpMap,
      bumpScale: 0.035,
      roughness: 0.85,
      metalness: 0.04,
    })
  );

  const matWetSidewalk = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.wetSidewalk.map,
      bumpMap: tex.wetSidewalk.bumpMap,
      bumpScale: 0.02,
      roughnessMap: tex.wetSidewalk.roughnessMap,
      roughness: 0.55,
      metalness: 0.14,
    })
  );

  const matWetAsphalt = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.wetAsphalt.map,
      bumpMap: tex.wetAsphalt.bumpMap,
      bumpScale: 0.018,
      roughnessMap: tex.wetAsphalt.roughnessMap,
      roughness: 0.42,
      metalness: 0.18,
    })
  );

  const matTactileLine = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.tactileLine.map,
      bumpMap: tex.tactileLine.bumpMap,
      bumpScale: 0.045,
      roughnessMap: tex.tactileLine.roughnessMap,
      roughness: 0.52,
      metalness: 0.08,
    })
  );

  const matTactileDot = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.tactileDot.map,
      bumpMap: tex.tactileDot.bumpMap,
      bumpScale: 0.05,
      roughnessMap: tex.tactileDot.roughnessMap,
      roughness: 0.5,
      metalness: 0.08,
    })
  );

  const matDarkWood = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.darkWood.map,
      bumpMap: tex.darkWood.bumpMap,
      bumpScale: 0.018,
      roughness: 0.65,
      metalness: 0.06,
    })
  );

  const matWarmWood = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.warmWood.map,
      bumpMap: tex.warmWood.bumpMap,
      bumpScale: 0.02,
      roughness: 0.7,
      metalness: 0.05,
    })
  );

  const matBamboo = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.bamboo.map,
      bumpMap: tex.bamboo.bumpMap,
      bumpScale: 0.025,
      roughness: 0.76,
      metalness: 0.02,
    })
  );

  const matBarrierBoard = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.barrierStripe.map,
      bumpMap: tex.barrierStripe.bumpMap,
      bumpScale: 0.02,
      roughness: 0.55,
      metalness: 0.12,
    })
  );

  const matCrosswalkBar = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      map: tex.crosswalk.map,
      bumpMap: tex.crosswalk.bumpMap,
      bumpScale: 0.016,
      roughnessMap: tex.crosswalk.roughnessMap,
      roughness: 0.45,
      metalness: 0.12,
    })
  );

  const matSecurityMetal = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      color: '#5c6470',
      roughness: 0.42,
      metalness: 0.65,
    }),
    { selfGlowBoost: 0.04 }
  );

  const matDarkIron = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      color: '#262b33',
      roughness: 0.48,
      metalness: 0.72,
    })
  );

  const matStoneCurb = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({
      color: '#525862',
      roughness: 0.68,
      metalness: 0.08,
    })
  );

  // =========================================================================
  // SCENE 1: DIM FOYER (Z = +2.5 to -5.5, X = -1.95 to +1.95)
  // =========================================================================
  const foyerFloor = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 8.2), matInteriorFloor);
  foyerFloor.rotation.x = -Math.PI / 2;
  foyerFloor.position.set(0, 0.01, -1.45);
  registerTarget(foyerFloor, 'interior_tile');

  // Coir doormat before front security door
  const matDoormat = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#4a3b2e', roughness: 0.95 })
  );
  const doormat = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.018, 0.68), matDoormat);
  doormat.position.set(0, 0.018, -4.75);
  registerTarget(doormat, 'interior_tile');

  // Foyer Ceiling & Walls
  const foyerCeiling = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 8.2), matPlasterWall);
  foyerCeiling.rotation.x = Math.PI / 2;
  foyerCeiling.position.set(0, 2.8, -1.45);
  scene.add(foyerCeiling);

  const foyerLeftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 8.2), matPlasterWall);
  foyerLeftWall.position.set(-1.98, 1.4, -1.45);
  registerTarget(foyerLeftWall, 'wall');

  const foyerRightWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 8.2), matPlasterWall);
  foyerRightWall.position.set(1.98, 1.4, -1.45);
  registerTarget(foyerRightWall, 'wall');

  const foyerBackWall = new THREE.Mesh(new THREE.BoxGeometry(4.1, 2.8, 0.2), matPlasterWall);
  foyerBackWall.position.set(0, 1.4, 2.55);
  registerTarget(foyerBackWall, 'wall');

  // Front Wall around Doorway (Z = -5.5, opening X = -0.62..+0.62, Y = 0..2.22)
  const doorWallLeft = new THREE.Mesh(new THREE.BoxGeometry(3.9, 3.0, 0.24), matPlasterWall);
  doorWallLeft.position.set(-2.57, 1.5, -5.5);
  registerTarget(doorWallLeft, 'wall');

  const doorWallRight = new THREE.Mesh(new THREE.BoxGeometry(3.9, 3.0, 0.24), matPlasterWall);
  doorWallRight.position.set(2.57, 1.5, -5.5);
  registerTarget(doorWallRight, 'wall');

  const doorHeader = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.78, 0.24), matPlasterWall);
  doorHeader.position.set(0, 2.61, -5.5);
  registerTarget(doorHeader, 'wall');

  // Left Dark Wood Shoe Cabinet (Ref Image 1)
  const cabinetGroup = new THREE.Group();
  cabinetGroup.position.set(-1.62, 0, -2.25);

  const cabBody = new THREE.Mesh(new THREE.BoxGeometry(0.54, 1.04, 1.85), matDarkWood);
  cabBody.position.y = 0.56;
  cabinetGroup.add(cabBody);

  const cabTop = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 1.92), matDarkWood);
  cabTop.position.y = 1.09;
  cabinetGroup.add(cabTop);

  // Drawer fronts & metallic handles
  for (let d = 0; d < 3; d++) {
    const dy = 0.24 + d * 0.28;
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 1.1), matDarkWood);
    drawer.position.set(0.275, dy, 0.28);
    cabinetGroup.add(drawer);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.18), matSecurityMetal);
    handle.position.set(0.3, dy + 0.03, 0.28);
    cabinetGroup.add(handle);
  }

  // Small bottles/tray on top of shoe cabinet + slippers underneath
  const matPorcelain = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.35 })
  );
  for (let b = 0; b < 4; b++) {
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.04, 0.14 + (b % 2) * 0.06, 10),
      matPorcelain
    );
    bottle.position.set(-0.04 + (b % 2) * 0.1, 1.18, -0.55 + b * 0.26);
    cabinetGroup.add(bottle);
  }
  for (let s = 0; s < 3; s++) {
    const slipper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.11), matPorcelain);
    slipper.position.set(0.26, 0.025, -0.5 + s * 0.35);
    cabinetGroup.add(slipper);
  }
  registerTarget(cabinetGroup, 'stall');

  // Right Wall Switch & Intercom Panel (Ref Image 1)
  const wallSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.12), matPorcelain);
  wallSwitch.position.set(1.88, 1.32, -2.0);
  scene.add(wallSwitch);

  const intercom = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.2), matPorcelain);
  intercom.position.set(1.3, 1.48, -5.36);
  scene.add(intercom);

  // Right Wall Leaning Red-White Guide Cane Pickup (Ref Image 1)
  const canePickupGroup = new THREE.Group();
  canePickupGroup.position.set(
    WAYPOINTS.canePickupPos.x,
    0,
    WAYPOINTS.canePickupPos.z
  );

  const matCaneWhite = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.28, metalness: 0.15 }),
    { selfGlowBoost: 0.35 }
  );
  const matCaneRed = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.3, metalness: 0.2 }),
    { selfGlowBoost: 0.35 }
  );
  const matCaneGrip = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.82 })
  );

  const leaningPivot = new THREE.Group();
  leaningPivot.rotation.z = -0.21; // Leaning top toward right wall (+X)
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

  // Subtle cyan outline glow tube so player perceives faint silhouette on right wall
  const caneHintMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const caneHintAura = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, 1.24, 12),
    caneHintMat
  );
  caneHintAura.position.y = 0.64;
  leaningPivot.add(caneHintAura);

  canePickupGroup.add(leaningPivot);
  registerTarget(canePickupGroup, 'cane_pickup');

  // Metallic Security Door (slightly ajar with cold light sliver at Z = -5.5)
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.34, 2.28, 0.26), matDarkIron);
  doorFrame.position.set(0, 1.14, -5.5);
  // Carve hollow look by placing left/right/top frame bars instead of solid block
  scene.remove(doorFrame);
  const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.26, 0.26), matDarkIron);
  frameL.position.set(-0.62, 1.13, -5.5);
  scene.add(frameL);
  const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.26, 0.26), matDarkIron);
  frameR.position.set(0.62, 1.13, -5.5);
  scene.add(frameR);
  const frameT = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.07, 0.26), matDarkIron);
  frameT.position.set(0, 2.24, -5.5);
  scene.add(frameT);

  const foyerDoorPivot = new THREE.Group();
  foyerDoorPivot.position.set(-0.58, 0, -5.5);
  foyerDoorPivot.rotation.y = 0.14; // Slightly ajar showing cold light crack!

  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(1.16, 2.2, 0.06), matSecurityMetal);
  doorLeaf.position.set(0.58, 1.11, 0);
  foyerDoorPivot.add(doorLeaf);

  const doorHandlePlate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.09), matDarkIron);
  doorHandlePlate.position.set(1.04, 1.05, 0);
  foyerDoorPivot.add(doorHandlePlate);

  const doorLever = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.12), matPorcelain);
  doorLever.position.set(1.0, 1.05, 0.04);
  foyerDoorPivot.add(doorLever);

  registerTarget(foyerDoorPivot, 'door');

  // Cold sliver light through door crack (implicit directional cue in Scene 1!)
  const doorSliverMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 2.18),
    new THREE.MeshBasicMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    })
  );
  doorSliverMesh.position.set(0.56, 1.1, -5.53);
  scene.add(doorSliverMesh);

  const doorCrackLight = new THREE.PointLight('#7dd3fc', 1.15, 4.2, 1.8);
  doorCrackLight.position.set(0.45, 1.2, -5.3);
  scene.add(doorCrackLight);

  // =========================================================================
  // SCENE 2: OCCUPIED TACTILE SIDEWALK & WET STREET (Z = -5.5 to -32.3)
  // =========================================================================
  // Sidewalk platform (X = -4.4 to +2.8, Z = -5.5 to -32.3)
  const sidewalkMain = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 26.9), matWetSidewalk);
  sidewalkMain.position.set(-0.8, 0.04, -18.95);
  registerTarget(sidewalkMain, 'normal');

  // Stone Curb along right edge of sidewalk (X = +2.85)
  const rightCurb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 26.9), matStoneCurb);
  rightCurb.position.set(2.86, 0.06, -18.95);
  registerTarget(rightCurb, 'normal');

  // Parallel Wet Asphalt Roadway on far right (X = +2.9 to +9.5) + Crosswalk intersection
  const streetAsphalt = new THREE.Mesh(new THREE.PlaneGeometry(54, 48), matWetAsphalt);
  streetAsphalt.rotation.x = -Math.PI / 2;
  streetAsphalt.position.set(2.0, 0.0, -28.5);
  registerTarget(streetAsphalt, 'normal');

  // Continuous Raised Yellow Tactile Guiding Strip along X = 0 (Z = -6.1 to -31.35)
  const tactileStripLen = 25.25;
  const tactileStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.022, tactileStripLen),
    matTactileLine
  );
  tactileStrip.position.set(0, 0.091, -6.1 - tactileStripLen / 2);
  registerTarget(tactileStrip, 'tactile_line');

  // Entry Yellow Dot Brick right outside foyer door (Z = -5.85)
  const entryDotPad = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.022, 0.46), matTactileDot);
  entryDotPad.position.set(0, 0.091, -5.85);
  registerTarget(entryDotPad, 'tactile_dot');

  // Left Exterior Brick Shopfront Walls (X = -4.35, Z = -5.5 to -32.0)
  const leftStreetWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.6, 26.6), matBrickWall);
  leftStreetWall.position.set(-4.4, 2.3, -18.8);
  registerTarget(leftStreetWall, 'wall');

  // Subtle Street Posters & Drainpipe on Left Brick Wall (Ref Image 2)
  const posterColors = ['#991b1b', '#1e3a8a', '#92400e'];
  for (let p = 0; p < 3; p++) {
    const pMat = echoManager.enhanceMaterial(
      new THREE.MeshStandardMaterial({ color: posterColors[p], roughness: 0.75 })
    );
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.76), pMat);
    poster.rotation.y = Math.PI / 2;
    poster.position.set(-4.23, 1.65, -10.2 - p * 0.72);
    scene.add(poster);
  }
  const drainPipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 4.6, 10),
    matSecurityMetal
  );
  drainPipe.position.set(-4.18, 2.3, -22.5);
  scene.add(drainPipe);

  // --- Helper: Detailed Shared Bike (Ref Image 2: Yellow & Blue Metal Bikes) ---
  const createSharedBike = (hexColor: string): THREE.Group => {
    const bike = new THREE.Group();
    const matFrame = echoManager.enhanceMaterial(
      new THREE.MeshStandardMaterial({
        color: hexColor,
        roughness: 0.28,
        metalness: 0.62,
      })
    );
    const matTire = echoManager.enhanceMaterial(
      new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.86 })
    );

    const wheelRadius = 0.31;
    for (const wx of [-0.52, 0.52]) {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(wx, wheelRadius, 0);

      const tire = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, 0.032, 10, 24), matTire);
      wheelGroup.add(tire);

      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(wheelRadius - 0.025, 0.012, 8, 24),
        matFrame
      );
      wheelGroup.add(rim);

      // Spokes
      for (let s = 0; s < 6; s++) {
        const spoke = new THREE.Mesh(
          new THREE.CylinderGeometry(0.003, 0.003, wheelRadius * 1.9, 6),
          matSecurityMetal
        );
        spoke.rotation.z = (s * Math.PI) / 6;
        wheelGroup.add(spoke);
      }
      bike.add(wheelGroup);
    }

    // Main tubular step-through frame
    const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.76, 10), matFrame);
    downTube.position.set(0.14, 0.48, 0);
    downTube.rotation.z = 0.78;
    bike.add(downTube);

    const seatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.58, 10), matFrame);
    seatTube.position.set(-0.16, 0.54, 0);
    seatTube.rotation.z = 0.22;
    bike.add(seatTube);

    const rearStay = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.46, 8), matFrame);
    rearStay.position.set(-0.34, 0.42, 0);
    rearStay.rotation.z = -0.58;
    bike.add(rearStay);

    // Front fork & handlebar stem
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.68, 10), matFrame);
    fork.position.set(0.46, 0.58, 0);
    fork.rotation.z = 0.2;
    bike.add(fork);

    const handlebar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.54, 10),
      matDarkIron
    );
    handlebar.rotation.x = Math.PI / 2;
    handlebar.position.set(0.39, 0.92, 0);
    bike.add(handlebar);

    // Front wire basket
    const basket = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.2, 0.3),
      echoManager.enhanceMaterial(
        new THREE.MeshStandardMaterial({
          color: '#1e242c',
          roughness: 0.5,
          metalness: 0.7,
          wireframe: true,
        })
      )
    );
    basket.position.set(0.56, 0.78, 0);
    bike.add(basket);

    // Black saddle
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.15), matTire);
    saddle.position.set(-0.22, 0.84, 0);
    bike.add(saddle);

    // Kickstand
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.34, 6),
      matDarkIron
    );
    stand.position.set(-0.08, 0.16, 0.09);
    stand.rotation.x = 0.35;
    bike.add(stand);

    return bike;
  };

  // Place 2 Shared Bikes Diagonally Blocking Tactile Path at Z = -13.5
  const bikeYellow = createSharedBike('#eab308');
  bikeYellow.position.set(-0.22, 0.08, -13.25);
  bikeYellow.rotation.y = 0.68;
  registerTarget(bikeYellow, 'bike');

  const bikeBlue = createSharedBike('#38bdf8');
  bikeBlue.position.set(0.32, 0.08, -13.78);
  bikeBlue.rotation.y = 0.48;
  registerTarget(bikeBlue, 'bike');

  // Place Orange-White Construction Barrier Blocking Tactile Path at Z = -21.5 (Ref Image 2)
  const barrierGroup = new THREE.Group();
  barrierGroup.position.set(0, 0.08, -21.5);
  barrierGroup.rotation.y = -0.06;

  // Top & Bottom striped boards
  const topBoard = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.28, 0.06), matBarrierBoard);
  topBoard.position.y = 0.88;
  barrierGroup.add(topBoard);

  const botBoard = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.28, 0.06), matBarrierBoard);
  botBoard.position.y = 0.42;
  barrierGroup.add(botBoard);

  // A-frame side legs
  for (const sideX of [-0.82, 0.82]) {
    for (const tilt of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.14, 0.06), matSecurityMetal);
      leg.position.set(sideX, 0.54, tilt * 0.18);
      leg.rotation.x = tilt * 0.32;
      barrierGroup.add(leg);
    }
  }
  registerTarget(barrierGroup, 'barrier');

  // Streetlamp Poles & Tree Pits + Scattered Fallen Leaves (Ref Images 2 & 3)
  for (const lz of [-16.8, -28.2]) {
    const poleGroup = new THREE.Group();
    poleGroup.position.set(1.35, 0.08, lz);
    const poleBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 1.2, 12),
      matSecurityMetal
    );
    poleBase.position.y = 0.6;
    poleGroup.add(poleBase);
    const poleUpper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 3.6, 12),
      matSecurityMetal
    );
    poleUpper.position.y = 3.0;
    poleGroup.add(poleUpper);
    registerTarget(poleGroup, 'normal');
  }

  for (const tz of [-10.2, -18.6]) {
    const treeGroup = new THREE.Group();
    treeGroup.position.set(2.85, 0.08, tz);
    const pitRim = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.08, 0.76), matStoneCurb);
    pitRim.position.y = 0.04;
    treeGroup.add(pitRim);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 3.4, 8), matDarkWood);
    trunk.position.y = 1.7;
    treeGroup.add(trunk);
    registerTarget(treeGroup, 'normal');
  }

  // Scattered wet autumn leaves
  const leafMat = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#b47828', roughness: 0.55, side: THREE.DoubleSide })
  );
  const leafGeo = new THREE.PlaneGeometry(0.12, 0.07);
  for (let i = 0; i < 65; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.rotation.x = -Math.PI / 2;
    leaf.rotation.z = (i * 1.7) % (Math.PI * 2);
    const lx = -3.2 + ((i * 2.37) % 6.8);
    const lz = -7.5 - ((i * 3.91) % 24.5);
    leaf.position.set(lx, lx > 2.85 ? 0.012 : 0.088, lz);
    scene.add(leaf);
  }

  // =========================================================================
  // SCENE 3: WARM BREAKFAST STALL & STREET CAT (Z = -24.6, Left Sidewalk)
  // =========================================================================
  const stallGroup = new THREE.Group();
  stallGroup.position.set(-3.15, 0.08, -24.6);

  // Wooden Counter Base & Top Ledge
  const counterBase = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.96, 3.1), matWarmWood);
  counterBase.position.set(-0.1, 0.48, 0);
  stallGroup.add(counterBase);

  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.07, 3.25), matDarkWood);
  counterTop.position.set(-0.02, 0.99, 0);
  stallGroup.add(counterTop);

  // 4 Timber Canopy Posts & Pitched Eave Roof
  for (const px of [-0.9, 0.82]) {
    for (const pz of [-1.48, 1.48]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.55, 0.1), matDarkWood);
      post.position.set(px, 1.28, pz);
      stallGroup.add(post);
    }
  }
  const stallRoof = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.1, 3.55), matDarkWood);
  stallRoof.position.set(0.05, 2.58, 0);
  stallRoof.rotation.z = -0.1;
  stallGroup.add(stallRoof);

  // Hanging Noren Curtains along front eave (Ref Image 3)
  const matNoren = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#47362b', roughness: 0.9 }),
    { selfGlowBoost: 0.15 }
  );
  for (let n = 0; n < 4; n++) {
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.46, 0.68), matNoren);
    curtain.position.set(0.88, 2.26, -1.12 + n * 0.75);
    stallGroup.add(curtain);
  }

  // Hanging Warm Paper Lantern + 4m Warm Yellow PointLight
  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.34, 14),
    new THREE.MeshBasicMaterial({ color: '#ffbe66' })
  );
  lantern.position.set(0.88, 2.02, -1.42);
  stallGroup.add(lantern);

  const stallPointLight = new THREE.PointLight('#ffaa44', 3.4, 4.8, 1.5);
  stallPointLight.position.set(
    WAYPOINTS.stallLightPos.x,
    WAYPOINTS.stallLightPos.y,
    WAYPOINTS.stallLightPos.z
  );
  scene.add(stallPointLight);

  // Stacked Bamboo Steamers (3 stacks on counter!) + Steam Puffs
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
      const tier = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.13, 16),
        matBamboo
      );
      tier.position.set(st.x, 1.09 + t * 0.135, st.z);
      stallGroup.add(tier);
    }
    const lid = new THREE.Mesh(new THREE.ConeGeometry(0.225, 0.09, 16), matBamboo);
    lid.position.set(st.x, 1.09 + st.tiers * 0.135 + 0.02, st.z);
    stallGroup.add(lid);

    // Rising steam puff
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), steamMat);
    puff.position.set(-3.15 + st.x, 1.25 + st.tiers * 0.135, -24.6 + st.z);
    puff.userData.baseY = puff.position.y;
    puff.userData.phase = st.z * 2.3;
    scene.add(puff);
    steamPuffs.push(puff);
  }

  // Two Wooden Stools in front of stall counter (Ref Image 3)
  for (const sz of [0.55, -0.55]) {
    const stool = new THREE.Group();
    stool.position.set(1.25, 0, sz);
    const seat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.19, 0.04, 14),
      matWarmWood
    );
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
  registerTarget(stallGroup, 'stall');

  // Low-Poly Tabby Cat near Tactile Path Edge (Ref Image 3: X = -0.92, Z = -24.6)
  const catGroup = new THREE.Group();
  catGroup.position.set(WAYPOINTS.catPos.x, WAYPOINTS.catPos.y, WAYPOINTS.catPos.z);
  catGroup.rotation.y = 0.95; // Facing toward approaching player & tactile strip

  const matCatFur = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#78685a', roughness: 0.85 }),
    { selfGlowBoost: 0.12 }
  );
  const matCatChest = echoManager.enhanceMaterial(
    new THREE.MeshStandardMaterial({ color: '#d6ccc2', roughness: 0.85 }),
    { selfGlowBoost: 0.12 }
  );

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

  registerTarget(catGroup, 'cat');

  const catPointLight = new THREE.PointLight('#fbbf24', 0.0, 2.6, 1.6);
  catPointLight.position.set(WAYPOINTS.catPos.x, 0.45, WAYPOINTS.catPos.z);
  scene.add(catPointLight);

  // =========================================================================
  // SCENE 4: SILENT CROSSWALK, TRAFFIC STREAKS & SUNSET FINALE (Z = -31.4 to -46)
  // =========================================================================
  // Curb Cut Warning Blister Dot Pad (Z = -31.85)
  const curbDotWarning = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.025, 0.92),
    matTactileDot
  );
  curbDotWarning.position.set(0, 0.082, -31.82);
  registerTarget(curbDotWarning, 'tactile_dot');

  const nearCurbLip = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.09, 0.22), matStoneCurb);
  nearCurbLip.position.set(0, 0.045, -32.35);
  registerTarget(nearCurbLip, 'normal');

  // 8 Weathered White Zebra Crosswalk Bars (Z = -33.5 to -41.3, Ref Image 4)
  for (let i = 0; i < 8; i++) {
    const barZ = -33.45 - i * 1.12;
    const zebraBar = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.012, 0.58), matCrosswalkBar);
    zebraBar.position.set(0, 0.008, barZ);
    registerTarget(zebraBar, 'crosswalk');
  }

  // Opposite Safe Sidewalk (Z = -42.3 to -47.0)
  const farCurbLip = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.09, 0.22), matStoneCurb);
  farCurbLip.position.set(0, 0.045, -42.25);
  registerTarget(farCurbLip, 'normal');

  const farSidewalk = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.08, 6.0), matWetSidewalk);
  farSidewalk.position.set(0, 0.04, -45.3);
  registerTarget(farSidewalk, 'normal');

  const farDotPad = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.025, 0.85), matTactileDot);
  farDotPad.position.set(0, 0.082, -42.75);
  registerTarget(farDotPad, 'tactile_dot');

  const farTactileLine = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.022, 3.6), matTactileLine);
  farTactileLine.position.set(0, 0.091, -45.0);
  registerTarget(farTactileLine, 'tactile_line');

  // Far Street Canyon Buildings & Utility Poles (Framing Sunset Horizon like Ref Image 4!)
  for (const side of [-1, 1]) {
    const bldg = new THREE.Mesh(new THREE.BoxGeometry(5.5, 9.5, 12.0), matBrickWall);
    bldg.position.set(side * 5.8, 4.75, -46.5);
    scene.add(bldg);

    const utilityPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 7.5, 10),
      matDarkIron
    );
    utilityPole.position.set(side * 2.1, 3.75, -42.8);
    scene.add(utilityPole);
  }

  // Sunset Horizon Glow Backdrop (Revealed smoothly in Node 06!)
  const sunsetCanvas = document.createElement('canvas');
  sunsetCanvas.width = 256;
  sunsetCanvas.height = 256;
  const sCtx = sunsetCanvas.getContext('2d')!;
  const sGrad = sCtx.createRadialGradient(128, 175, 10, 128, 165, 165);
  sGrad.addColorStop(0, '#fff7ed');
  sGrad.addColorStop(0.25, '#fdba74');
  sGrad.addColorStop(0.6, '#ea580c');
  sGrad.addColorStop(1, 'rgba(15, 12, 18, 0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 256, 256);
  const sunsetTex = new THREE.CanvasTexture(sunsetCanvas);
  sunsetTex.colorSpace = THREE.SRGBColorSpace;

  const sunsetBackdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 22),
    new THREE.MeshBasicMaterial({
      map: sunsetTex,
      transparent: true,
      opacity: 0.0,
      fog: false,
      depthWrite: false,
    })
  );
  sunsetBackdrop.position.set(0, 6.2, -56.0);
  scene.add(sunsetBackdrop);

  // Backlit Helpful Pedestrian Silhouette (Ref Image 4, initially hidden until 3rd help call!)
  const pedestrianGroup = new THREE.Group();
  pedestrianGroup.position.set(
    WAYPOINTS.pedestrianPos.x,
    WAYPOINTS.pedestrianPos.y,
    WAYPOINTS.pedestrianPos.z
  );
  pedestrianGroup.visible = false;

  const matPedestrian = new THREE.MeshStandardMaterial({
    color: '#1e1b18',
    emissive: '#45270d',
    emissiveIntensity: 0.45,
    roughness: 0.7,
  });

  const pedHead = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 12), matPedestrian);
  pedHead.position.y = 1.64;
  pedestrianGroup.add(pedHead);

  const pedTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.48, 8, 12), matPedestrian);
  pedTorso.position.y = 1.18;
  pedestrianGroup.add(pedTorso);

  for (const lx of [-0.09, 0.09]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.68, 6, 8), matPedestrian);
    leg.position.set(lx, 0.44, 0);
    pedestrianGroup.add(leg);
  }
  for (const ax of [-0.24, 0.24]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.48, 6, 8), matPedestrian);
    arm.position.set(ax, 1.15, 0);
    arm.rotation.z = ax < 0 ? 0.12 : -0.12;
    pedestrianGroup.add(arm);
  }

  // Warm golden aura disc behind pedestrian
  const pedAura = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.4),
    new THREE.MeshBasicMaterial({
      map: sunsetTex,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  pedAura.position.set(0, 1.25, -0.25);
  pedestrianGroup.add(pedAura);

  scene.add(pedestrianGroup);

  const pedestrianHaloLight = new THREE.PointLight('#fbbf24', 0.0, 9.0, 1.4);
  pedestrianHaloLight.position.set(0, 1.9, -43.0);
  scene.add(pedestrianHaloLight);

  // High-Speed Red Tail-Light Streak Pool for Crosswalk Traffic (Ref Image 4!)
  const trafficStreaks: TrafficVisual[] = [];
  const createTrafficStreak = (laneZ: number, dir: 1 | -1): TrafficVisual => {
    const grp = new THREE.Group();
    grp.position.set(dir * -24, 0.55, laneZ);
    grp.visible = false;

    // Subtle dark car hull silhouette
    const carHull = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.1, 1.65),
      new THREE.MeshBasicMaterial({ color: '#090b10', transparent: true, opacity: 0.78 })
    );
    carHull.position.y = 0.18;
    grp.add(carHull);

    // Long glowing red motion-blur tail-light streaks (unaffected by dark echo mask!)
    const streakMat = new THREE.MeshBasicMaterial({
      color: '#ef4444',
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const tz of [-0.62, 0.62]) {
      const tailBeam = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 0.14), streakMat);
      tailBeam.position.set(-dir * 3.2, 0.15, tz);
      grp.add(tailBeam);

      const tailCore = new THREE.Mesh(
        new THREE.PlaneGeometry(4.2, 0.06),
        new THREE.MeshBasicMaterial({
          color: '#fca5a5',
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      tailCore.position.set(-dir * 1.8, 0.15, tz);
      grp.add(tailCore);
    }

    scene.add(grp);
    return { group: grp, direction: dir, speed: 22, laneZ, active: false };
  };

  trafficStreaks.push(createTrafficStreak(-35.4, 1));
  trafficStreaks.push(createTrafficStreak(-39.2, -1));

  // =========================================================================
  // FLOATING SONIC SPARKLE MOTES (Matching Reference Images 2, 3, 4!)
  // =========================================================================
  const MAX_SPARKLES = 90;
  const sparklePositions = new Float32Array(MAX_SPARKLES * 3);
  const sparkleColors = new Float32Array(MAX_SPARKLES * 3);
  const sparkleLife = new Float32Array(MAX_SPARKLES);
  const sparkleVelY = new Float32Array(MAX_SPARKLES);
  let sparkleCursor = 0;

  for (let i = 0; i < MAX_SPARKLES; i++) {
    sparklePositions[i * 3 + 1] = -100;
  }

  const sparkleGeo = new THREE.BufferGeometry();
  sparkleGeo.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
  sparkleGeo.setAttribute('color', new THREE.BufferAttribute(sparkleColors, 3));

  // Soft radial bokeh sprite texture so sparkles render as glowing orbs instead of squares
  const spCanvas = document.createElement('canvas');
  spCanvas.width = 32;
  spCanvas.height = 32;
  const spCtx = spCanvas.getContext('2d')!;
  const spGrad = spCtx.createRadialGradient(16, 16, 1, 16, 16, 15);
  spGrad.addColorStop(0, 'rgba(255,255,255,1)');
  spGrad.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  spGrad.addColorStop(1, 'rgba(255,255,255,0)');
  spCtx.fillStyle = spGrad;
  spCtx.fillRect(0, 0, 32, 32);
  const spTex = new THREE.CanvasTexture(spCanvas);

  const sparkleMat = new THREE.PointsMaterial({
    size: 0.085,
    map: spTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sparklePoints = new THREE.Points(sparkleGeo, sparkleMat);
  sparklePoints.frustumCulled = false;
  scene.add(sparklePoints);

  const spawnSparkles = (origin: THREE.Vector3, isWarm: boolean) => {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const idx = sparkleCursor;
      sparkleCursor = (sparkleCursor + 1) % MAX_SPARKLES;

      const angle = Math.random() * Math.PI * 2;
      const rad = 0.25 + Math.random() * 1.65;
      sparklePositions[idx * 3] = origin.x + Math.cos(angle) * rad;
      sparklePositions[idx * 3 + 1] = origin.y + 0.05 + Math.random() * 0.22;
      sparklePositions[idx * 3 + 2] = origin.z + Math.sin(angle) * rad;

      const warmMix = isWarm ? Math.random() > 0.25 : Math.random() > 0.72;
      if (warmMix) {
        sparkleColors[idx * 3] = 0.98;
        sparkleColors[idx * 3 + 1] = 0.72;
        sparkleColors[idx * 3 + 2] = 0.22;
      } else {
        sparkleColors[idx * 3] = 0.32;
        sparkleColors[idx * 3 + 1] = 0.82;
        sparkleColors[idx * 3 + 2] = 0.98;
      }

      sparkleLife[idx] = 1.0;
      sparkleVelY[idx] = 0.16 + Math.random() * 0.24;
    }
    sparkleGeo.attributes.position.needsUpdate = true;
    sparkleGeo.attributes.color.needsUpdate = true;
  };

  // =========================================================================
  // DEBUG COLLISION WIREFRAMES (Peek Mode)
  // =========================================================================
  const debugWireframeGroup = new THREE.Group();
  debugWireframeGroup.visible = false;
  scene.add(debugWireframeGroup);

  const rebuildDebugWireframes = (cols: ColliderBox[]) => {
    while (debugWireframeGroup.children.length > 0) {
      debugWireframeGroup.remove(debugWireframeGroup.children[0]);
    }
    for (const c of cols) {
      if (!c.enabled) continue;
      const w = c.maxX - c.minX;
      const d = c.maxZ - c.minZ;
      const boxGeo = new THREE.BoxGeometry(w, c.height, d);
      const edges = new THREE.EdgesGeometry(boxGeo);
      const color = c.isObstacle
        ? '#f97316'
        : c.id === 'crosswalk_airwall'
          ? '#eab308'
          : '#38bdf8';
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 })
      );
      line.position.set((c.minX + c.maxX) / 2, c.height / 2, (c.minZ + c.maxZ) / 2);
      debugWireframeGroup.add(line);
    }
  };
  rebuildDebugWireframes(colliders);

  // Per-frame animations for door swing, steam puffs, cat breathing, traffic streaks & sparkles
  const updateParticlesAndProps = (dt: number, elapsed: number, doorOpenTarget: number) => {
    // Smoothly swing foyer security door
    foyerDoorPivot.rotation.y += (doorOpenTarget - foyerDoorPivot.rotation.y) * Math.min(1, dt * 4.2);

    // Subtle breathing & tail sway on street cat
    catGroup.scale.y = 1.0 + Math.sin(elapsed * 2.8) * 0.025;
    catTail.rotation.z = 0.4 + Math.sin(elapsed * 3.4) * 0.18;

    // Rising steam puffs on bamboo steamers
    for (const puff of steamPuffs) {
      const cycle = ((elapsed * 0.55 + (puff.userData.phase as number)) % 1.0 + 1.0) % 1.0;
      puff.position.y = (puff.userData.baseY as number) + cycle * 0.65;
      const s = 0.65 + cycle * 1.1;
      puff.scale.set(s, s, s);
    }

    // Traffic streaks motion
    for (const tr of trafficStreaks) {
      if (!tr.active) continue;
      tr.group.position.x += tr.direction * tr.speed * dt;
      if (Math.abs(tr.group.position.x) > 28) {
        tr.active = false;
        tr.group.visible = false;
      }
    }

    // Sparkle particles drift
    let dirty = false;
    for (let i = 0; i < MAX_SPARKLES; i++) {
      if (sparkleLife[i] > 0) {
        sparkleLife[i] -= dt * 0.62;
        if (sparkleLife[i] <= 0) {
          sparklePositions[i * 3 + 1] = -100;
        } else {
          sparklePositions[i * 3 + 1] += sparkleVelY[i] * dt;
          sparkleColors[i * 3] *= 0.992;
          sparkleColors[i * 3 + 1] *= 0.992;
          sparkleColors[i * 3 + 2] *= 0.992;
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
    foyerDoorPivot,
    doorCrackLight,
    doorSliverMesh,
    canePickupGroup,
    catGroup,
    catPointLight,
    stallPointLight,
    pedestrianGroup,
    pedestrianHaloLight,
    sunsetDirLight,
    ambientHemiLight,
    sunsetBackdrop,
    debugWireframeGroup,
    steamPuffs,
    trafficStreaks,
    spawnSparkles,
    updateParticlesAndProps,
    rebuildDebugWireframes,
  };
}
