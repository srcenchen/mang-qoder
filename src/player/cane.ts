import * as THREE from 'three';
import { SurfaceTag } from '../level/levelData';

export interface CaneHitEvent {
  point: THREE.Vector3;
  tag: SurfaceTag;
  pan: number;
  isManualTap: boolean;
}

export class GuideCaneSystem {
  public readonly handRoot = new THREE.Group();
  public equipped = false;
  public totalTaps = 0;

  private canePivot = new THREE.Group();
  private tipMarker = new THREE.Object3D();
  private camera: THREE.PerspectiveCamera;
  private raycastTargets: THREE.Object3D[];
  private onHit: (event: CaneHitEvent) => void;

  private raycaster = new THREE.Raycaster();
  private currentSweep = 0;
  private tapAnimTimer = 0;
  private readonly tapAnimDuration = 0.28;

  private tipWorldPos = new THREE.Vector3();
  private handWorldPos = new THREE.Vector3();
  private rayDir = new THREE.Vector3();

  private lastSweptTag: SurfaceTag | null = null;
  private lastAutoSweepTime = -10;
  private elapsed = 0;

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
    // Positioned in bottom-right of camera view (matching Reference Images 2, 3, 4!)
    this.handRoot.position.set(0.38, -0.32, -0.42);

    // Coat sleeve & right hand gripping handle
    const sleeveMat = new THREE.MeshStandardMaterial({
      color: '#1b2230',
      roughness: 0.85,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: '#c69474',
      roughness: 0.68,
    });
    const gripMat = new THREE.MeshStandardMaterial({
      color: '#11151c',
      roughness: 0.78,
    });
    const whiteShaftMat = new THREE.MeshStandardMaterial({
      color: '#f1f5f9',
      emissive: '#334155',
      emissiveIntensity: 0.25,
      roughness: 0.25,
      metalness: 0.15,
    });
    const redReflectiveMat = new THREE.MeshStandardMaterial({
      color: '#dc2626',
      emissive: '#7f1d1d',
      emissiveIntensity: 0.3,
      roughness: 0.28,
      metalness: 0.2,
    });

    // Subtle dedicated key light on camera for held hand/cane silhouette readability
    const handLight = new THREE.PointLight('#bae6fd', 0.35, 1.8);
    handLight.position.set(-0.1, 0.25, 0.2);
    this.handRoot.add(handLight);

    // Forearm sleeve
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.064, 0.32, 12), sleeveMat);
    sleeve.rotation.x = Math.PI / 2 - 0.18;
    sleeve.rotation.z = 0.34;
    sleeve.position.set(0.12, -0.04, 0.15);
    this.canePivot.add(sleeve);

    // Hand palm & fingers around grip
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.044, 12, 10), skinMat);
    hand.scale.set(0.95, 0.78, 1.25);
    hand.position.set(0.015, -0.008, 0.015);
    this.canePivot.add(hand);

    // Cane shaft: -Math.PI/2 points straight ahead (-Z), so -1.78 rad pitches ~12 deg DOWN toward floor!
    const shaftGroup = new THREE.Group();
    shaftGroup.rotation.x = -1.78;
    shaftGroup.rotation.z = 0.26;

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.015, 0.24, 12), gripMat);
    grip.position.y = 0.05;
    shaftGroup.add(grip);

    const upperWhite = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.011, 0.92, 12),
      whiteShaftMat
    );
    upperWhite.position.y = 0.63;
    shaftGroup.add(upperWhite);

    const lowerRed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.01, 0.42, 12),
      redReflectiveMat
    );
    lowerRed.position.y = 1.3;
    shaftGroup.add(lowerRed);

    const rollerTip = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 14), whiteShaftMat);
    rollerTip.position.y = 1.52;
    shaftGroup.add(rollerTip);

    // Exact tip world tracker
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
    this.currentSweep = 0;
    this.tapAnimTimer = 0;
    this.lastSweptTag = null;
  }

  /**
   * Actively taps the cane on the ground/obstacle ahead (Space / Cane Button / Quick Tap).
   */
  public triggerTap(): void {
    if (!this.equipped) return;
    this.tapAnimTimer = this.tapAnimDuration;
    this.totalTaps += 1;

    const hit = this.performRaycast();
    this.onHit({
      point: hit.point,
      tag: hit.tag,
      pan: Math.max(-0.85, Math.min(0.85, this.currentSweep * 0.9)),
      isManualTap: true,
    });
  }

  public getTipWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    this.tipMarker.getWorldPosition(out);
    return out;
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

    // Cast from hand along cane direction + slightly downward so ground/obstacles register reliably
    this.rayDir.subVectors(this.tipWorldPos, this.handWorldPos).normalize();
    this.raycaster.set(this.handWorldPos, this.rayDir);
    this.raycaster.near = 0.1;
    this.raycaster.far = 2.85;

    const hits = this.raycaster.intersectObjects(this.raycastTargets, true);
    if (hits.length > 0) {
      return {
        point: hits[0].point.clone(),
        tag: this.resolveTag(hits[0].object),
      };
    }

    // Fallback: downward probe directly below cane tip XZ
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
      point: new THREE.Vector3(this.tipWorldPos.x, 0.05, this.tipWorldPos.z),
      tag: 'normal',
    };
  }

  public update(
    dt: number,
    targetSweepInput: number,
    isWalking: boolean,
    walkCycle: number
  ): { tipPos: THREE.Vector3; hoveredTag: SurfaceTag } {
    this.elapsed += dt;

    // Smoothly interpolate horizontal cane sweep + gentle walking cadence swing
    const walkSwing = isWalking ? Math.sin(walkCycle * 1.35) * 0.22 : Math.sin(this.elapsed * 1.4) * 0.03;
    const desiredSweep = Math.max(-1, Math.min(1, targetSweepInput * 0.85 + walkSwing));
    const prevSweep = this.currentSweep;
    this.currentSweep += (desiredSweep - this.currentSweep) * Math.min(1, dt * 10.0);

    // Tap strike arc animation
    let tapPitchOffset = 0;
    if (this.tapAnimTimer > 0) {
      this.tapAnimTimer = Math.max(0, this.tapAnimTimer - dt);
      const p = 1.0 - this.tapAnimTimer / this.tapAnimDuration;
      // Fast downward tap and rebound
      tapPitchOffset = -Math.sin(p * Math.PI) * 0.22;
    }

    this.canePivot.rotation.y = -this.currentSweep * 0.52;
    this.canePivot.rotation.x = tapPitchOffset;

    if (!this.equipped) {
      return { tipPos: this.tipWorldPos.set(0, -50, 0), hoveredTag: 'normal' };
    }

    const hit = this.performRaycast();
    const sweepSpeed = Math.abs(this.currentSweep - prevSweep) / Math.max(0.001, dt);

    // Tactile sweep feedback: when sweeping across tactile bricks or striking bikes/barriers/cat
    const tagChanged = hit.tag !== this.lastSweptTag;
    const isNotableSurface =
      hit.tag === 'tactile_line' ||
      hit.tag === 'tactile_dot' ||
      hit.tag === 'bike' ||
      hit.tag === 'barrier' ||
      hit.tag === 'cat';

    if (
      (tagChanged && isNotableSurface && this.elapsed - this.lastAutoSweepTime > 0.36) ||
      (sweepSpeed > 1.25 && isNotableSurface && this.elapsed - this.lastAutoSweepTime > 0.52)
    ) {
      this.lastAutoSweepTime = this.elapsed;
      this.onHit({
        point: hit.point,
        tag: hit.tag,
        pan: Math.max(-0.85, Math.min(0.85, this.currentSweep * 0.9)),
        isManualTap: false,
      });
    }
    this.lastSweptTag = hit.tag;

    return {
      tipPos: hit.point,
      hoveredTag: hit.tag,
    };
  }
}
