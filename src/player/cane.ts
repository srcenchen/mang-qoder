import * as THREE from 'three';
import { SurfaceTag } from '../level/levelData';

export interface CaneHitEvent {
  point: THREE.Vector3;
  tag: SurfaceTag;
  pan: number;
  isManualTap: boolean;
  isHeavyEcho: boolean;
  side: -1 | 1; // -1 = Left tap, +1 = Right tap
}

export class GuideCaneSystem {
  public readonly handRoot = new THREE.Group();
  public equipped = false;
  public totalTaps = 0;
  public chargeProgress = 0;

  private canePivot = new THREE.Group();
  private tipMarker = new THREE.Object3D();
  private camera: THREE.PerspectiveCamera;
  private raycastTargets: THREE.Object3D[];
  private onHit: (event: CaneHitEvent) => void;

  private raycaster = new THREE.Raycaster();

  /** Rhythmic Two-Point Touch: single/timed-out tap hits aimed center (0); continuous taps alternate subtly Left (-1) / Right (+1) */
  private nextComboSide: -1 | 1 = -1;
  private lastTapTimeSec = -10;
  private readonly comboTimeoutSec = 0.85;
  private currentSidePos = 0; // 0 = aimed center, subtle ±0.34 during continuous alternating taps
  private targetSidePos = 0;

  private tapAnimTimer = 0;
  private readonly tapAnimDuration = 0.3;

  private isCharging = false;
  private chargeHoldSec = 0;
  private readonly heavyThresholdSec = 0.36;

  private tipWorldPos = new THREE.Vector3();
  private handWorldPos = new THREE.Vector3();
  private rayDir = new THREE.Vector3();
  private elapsed = 0;

  private whiteShaftMat!: THREE.MeshStandardMaterial;
  private redReflectiveMat!: THREE.MeshStandardMaterial;

  constructor(
    camera: THREE.PerspectiveCamera,
    raycastTargets: THREE.Object3D[],
    onHit: (event: CaneHitEvent) => void
  ) {
    this.camera = camera;
    this.raycastTargets = raycastTargets;
    this.onHit = onHit;

    this.buildFirstPersonCaneModel();
    this.handRoot.visible = false;
    this.camera.add(this.handRoot);
  }

  private buildFirstPersonCaneModel(): void {
    // Framed bottom-right pointing naturally forward-downward toward ground ahead
    this.handRoot.position.set(0.32, -0.34, -0.42);

    const sleeveMat = new THREE.MeshStandardMaterial({
      color: '#19202d',
      roughness: 0.82,
      metalness: 0.06,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: '#c69474',
      roughness: 0.65,
    });
    const gripMat = new THREE.MeshStandardMaterial({
      color: '#0e1218',
      roughness: 0.72,
      metalness: 0.12,
    });
    const collarMat = new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.28,
      metalness: 0.85,
    });
    this.whiteShaftMat = new THREE.MeshStandardMaterial({
      color: '#f1f5f9',
      emissive: '#334155',
      emissiveIntensity: 0.16,
      roughness: 0.2,
      metalness: 0.28,
    });
    this.redReflectiveMat = new THREE.MeshStandardMaterial({
      color: '#e11d48',
      emissive: '#7f1d1d',
      emissiveIntensity: 0.24,
      roughness: 0.22,
      metalness: 0.3,
    });

    const handLight = new THREE.PointLight('#bae6fd', 0.22, 1.5);
    handLight.position.set(-0.1, 0.24, 0.2);
    this.handRoot.add(handLight);

    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.064, 0.34, 14), sleeveMat);
    sleeve.rotation.x = Math.PI / 2 - 0.18;
    sleeve.rotation.z = 0.24;
    sleeve.position.set(0.1, -0.04, 0.15);
    this.canePivot.add(sleeve);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.044, 14, 12), skinMat);
    hand.scale.set(0.95, 0.78, 1.25);
    hand.position.set(0.015, -0.008, 0.015);
    this.canePivot.add(hand);

    // Cane shaft pitched forward-downward toward ground ahead
    const shaftGroup = new THREE.Group();
    shaftGroup.rotation.x = -1.78;
    shaftGroup.rotation.z = 0.18;

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.015, 0.25, 14), gripMat);
    grip.position.y = 0.05;
    shaftGroup.add(grip);

    for (const cy of [0.18, 0.62, 1.08]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.025, 12), collarMat);
      collar.position.y = cy;
      shaftGroup.add(collar);
    }

    const upperWhite = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0115, 0.011, 0.92, 14),
      this.whiteShaftMat
    );
    upperWhite.position.y = 0.63;
    shaftGroup.add(upperWhite);

    const lowerRed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.01, 0.42, 14),
      this.redReflectiveMat
    );
    lowerRed.position.y = 1.3;
    shaftGroup.add(lowerRed);

    const rollerTip = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 16), this.whiteShaftMat);
    rollerTip.position.y = 1.52;
    shaftGroup.add(rollerTip);

    this.tipMarker.position.set(0, 1.54, 0);
    shaftGroup.add(this.tipMarker);

    this.canePivot.add(shaftGroup);
    this.handRoot.add(this.canePivot);
  }

  public setEquipped(equipped: boolean): void {
    this.equipped = equipped;
    this.handRoot.visible = equipped;
  }

  public reset(): void {
    this.equipped = false;
    this.handRoot.visible = false;
    this.totalTaps = 0;
    this.nextComboSide = -1;
    this.lastTapTimeSec = -10;
    this.currentSidePos = 0;
    this.targetSidePos = 0;
    this.tapAnimTimer = 0;
    this.isCharging = false;
    this.chargeHoldSec = 0;
    this.chargeProgress = 0;
  }

  /** Begin holding Space / LMB / Cane Button to prepare & charge a tap */
  public beginCharge(): void {
    if (!this.equipped || this.isCharging) return;
    this.isCharging = true;
    this.chargeHoldSec = 0;
    this.chargeProgress = 0;
    const isContinuous = this.elapsed - this.lastTapTimeSec <= this.comboTimeoutSec;
    this.targetSidePos = isContinuous ? this.nextComboSide * 0.34 : 0;
  }

  /** Release Space / LMB / Cane Button -> fires aimed center tap (after timeout) or subtle alternating Left/Right tap (continuous)! */
  public releaseCharge(): void {
    if (!this.equipped || !this.isCharging) return;
    const heavy = this.chargeHoldSec >= this.heavyThresholdSec;
    this.isCharging = false;
    this.chargeHoldSec = 0;
    this.chargeProgress = 0;
    this.triggerTap(heavy);
  }

  /**
   * Manual-only tap:
   * - If timed out (> 0.85s since last tap): taps cleanly at aimed center position (0), just like original precision.
   * - If tapping continuously (<= 0.85s): subtly alternates Left (-0.34) -> Right (+0.34) -> Left (-0.34) without wide swing.
   */
  public triggerTap(isHeavyEcho = false): void {
    if (!this.equipped) return;

    const isContinuous = this.elapsed - this.lastTapTimeSec <= this.comboTimeoutSec;
    this.lastTapTimeSec = this.elapsed;

    let strikeNorm = 0;
    let side: -1 | 1 = 1;
    if (isContinuous) {
      side = this.nextComboSide;
      this.nextComboSide = side === -1 ? 1 : -1;
      strikeNorm = side * 0.34; // Subtle shoulder-width alternating offset!
    } else {
      // Timed out -> tap directly at aimed center, prime next rapid tap for Left
      strikeNorm = 0;
      this.nextComboSide = -1;
    }

    this.targetSidePos = strikeNorm;
    this.currentSidePos = strikeNorm;
    this.tapAnimTimer = this.tapAnimDuration;
    this.totalTaps += 1;

    this.canePivot.rotation.y = this.computePivotYaw(this.currentSidePos);
    this.canePivot.rotation.x = -0.18;
    this.canePivot.rotation.z = -strikeNorm * 0.08;
    this.camera.updateMatrixWorld(true);

    const hit = this.performRaycast();
    this.onHit({
      point: hit.point,
      tag: hit.tag,
      pan: strikeNorm * 0.75, // Center (0) on single tap, subtle Left/Right stereo (-0.25/+0.25) on continuous taps
      isManualTap: true,
      isHeavyEcho,
      side,
    });
  }

  /** Maps normalized side (0 = aimed center, subtle ±0.34 during continuous taps) to wrist yaw */
  private computePivotYaw(sideNorm: number): number {
    return 0.13 - sideNorm * 0.36;
  }

  private resolveTag(obj: THREE.Object3D | null): SurfaceTag {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur.userData && cur.userData.surfaceTag) {
        return cur.userData.surfaceTag as SurfaceTag;
      }
      cur = cur.parent;
    }
    return 'normal';
  }

  private performRaycast(): { point: THREE.Vector3; tag: SurfaceTag } {
    this.camera.updateMatrixWorld(true);
    this.canePivot.getWorldPosition(this.handWorldPos);
    this.tipMarker.getWorldPosition(this.tipWorldPos);

    this.rayDir.subVectors(this.tipWorldPos, this.handWorldPos).normalize();
    this.raycaster.set(this.handWorldPos, this.rayDir);
    this.raycaster.near = 0.1;
    this.raycaster.far = 3.1;

    const hits = this.raycaster.intersectObjects(this.raycastTargets, true);
    if (hits.length > 0) {
      return {
        point: hits[0].point.clone(),
        tag: this.resolveTag(hits[0].object),
      };
    }

    const probeOrigin = new THREE.Vector3(this.tipWorldPos.x, 1.4, this.tipWorldPos.z);
    this.raycaster.set(probeOrigin, new THREE.Vector3(0, -1, 0));
    this.raycaster.far = 2.2;
    const floorHits = this.raycaster.intersectObjects(this.raycastTargets, true);
    if (floorHits.length > 0) {
      return {
        point: floorHits[0].point.clone(),
        tag: this.resolveTag(floorHits[0].object),
      };
    }

    return {
      point: new THREE.Vector3(this.tipWorldPos.x, 0.08, this.tipWorldPos.z),
      tag: 'normal',
    };
  }

  public update(
    dt: number,
    targetSweepInput: number,
    isWalking: boolean,
    walkCycle: number,
    isOutdoorsInRain: boolean
  ): { tipPos: THREE.Vector3; hoveredTag: SurfaceTag } {
    this.elapsed += dt;

    const targetRough = isOutdoorsInRain ? 0.11 : 0.24;
    this.whiteShaftMat.roughness +=
      (targetRough - this.whiteShaftMat.roughness) * Math.min(1, dt * 2.0);
    this.redReflectiveMat.roughness +=
      (targetRough - this.redReflectiveMat.roughness) * Math.min(1, dt * 2.0);

    if (this.isCharging) {
      this.chargeHoldSec += dt;
      this.chargeProgress = Math.min(1.0, this.chargeHoldSec / this.heavyThresholdSec);
    }

    // Automatically relax target back to aimed center (0) once continuous tap rhythm times out
    if (!this.isCharging && this.elapsed - this.lastTapTimeSec > this.comboTimeoutSec) {
      this.targetSidePos = 0;
    }

    // Smoothly glide cane toward target side + subtle manual look sway
    const idleSway = isWalking
      ? Math.sin(walkCycle * 1.1) * 0.05
      : Math.sin(this.elapsed * 1.3) * 0.018;
    const desiredSide = Math.max(
      -0.8,
      Math.min(0.8, this.targetSidePos + targetSweepInput * 0.16 + idleSway)
    );
    this.currentSidePos += (desiredSide - this.currentSidePos) * Math.min(1, dt * 11.0);

    // Strike downward arc & smooth lift rebound (two-point touch bounce!)
    let pitchOffset = this.chargeProgress * 0.18;
    let rollOffset = -this.currentSidePos * 0.06;
    if (this.tapAnimTimer > 0) {
      this.tapAnimTimer = Math.max(0, this.tapAnimTimer - dt);
      const p = 1.0 - this.tapAnimTimer / this.tapAnimDuration;
      // Sharp tap down in first 35%, then crisp lift into ready hover
      if (p < 0.35) {
        pitchOffset = -Math.sin((p / 0.35) * Math.PI * 0.5) * 0.22;
      } else {
        const rebound = (p - 0.35) / 0.65;
        pitchOffset = -0.22 * Math.cos(rebound * Math.PI * 0.5) + Math.sin(rebound * Math.PI) * 0.06;
      }
    }

    this.canePivot.rotation.y = this.computePivotYaw(this.currentSidePos);
    this.canePivot.rotation.x = pitchOffset;
    this.canePivot.rotation.z = rollOffset;

    if (!this.equipped) {
      return { tipPos: this.tipWorldPos.set(0, -50, 0), hoveredTag: 'normal' };
    }

    // Update cane tip world position for real-time intimate tip micro-glow ONLY (no auto-tap!)
    const hit = this.performRaycast();
    return {
      tipPos: hit.point,
      hoveredTag: hit.tag,
    };
  }
}
