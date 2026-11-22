import * as THREE from 'three';
import { ColliderBox, PLAYER_EYE_HEIGHT, PLAYER_RADIUS, WAYPOINTS } from '../level/levelData';

export interface ControllerCallbacks {
  onFootstep: (pos: THREE.Vector3) => void;
  onObstacleBump: (collider: ColliderBox) => void;
  onAirwallBlocked: () => void;
  onCanvasQuickTap: () => void;
}

export class FirstPersonController {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly position = new THREE.Vector3(
    WAYPOINTS.playerStart.x,
    PLAYER_EYE_HEIGHT,
    WAYPOINTS.playerStart.z
  );
  public yaw = 0; // 0 = facing -Z
  public pitch = -0.08; // Slightly looking toward ground/cane ahead
  public enabled = false;

  /** Normalized horizontal cursor/look offset (-1..+1) driving cane sweep */
  public sweepInput = 0;
  public isMoving = false;
  public walkCycle = 0;

  private keys = new Set<string>();
  private colliders: ColliderBox[];
  private callbacks: ControllerCallbacks;

  // Mouse / Touch Look state (isolated from virtual joystick pointerId)
  private lookPointerId: number | null = null;
  private lookStartX = 0;
  private lookStartY = 0;
  private lastLookX = 0;
  private lastLookY = 0;
  private lookMovedDist = 0;

  // Virtual Joystick state (strictly isolated pointerId)
  private joyPointerId: number | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;
  private joyVec = new THREE.Vector2(0, 0);

  // Step & Shake timers
  private stepDistAccum = 0;
  private shakeTimer = 0;
  private shakeDuration = 0.22;
  private lastObstacleBumpTime = -10;
  private lastAirwallNoticeTime = -10;
  private clockSec = 0;

  private joystickZone: HTMLElement;
  private joystickKnob: HTMLElement;
  private domElement: HTMLElement;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    joystickZone: HTMLElement,
    joystickKnob: HTMLElement,
    colliders: ColliderBox[],
    callbacks: ControllerCallbacks
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.joystickZone = joystickZone;
    this.joystickKnob = joystickKnob;
    this.colliders = colliders;
    this.callbacks = callbacks;

    this.syncCamera(0);
    this.bindEvents();
  }

  public reset(): void {
    this.position.set(
      WAYPOINTS.playerStart.x,
      PLAYER_EYE_HEIGHT,
      WAYPOINTS.playerStart.z
    );
    this.yaw = 0;
    this.pitch = -0.08;
    this.sweepInput = 0;
    this.joyVec.set(0, 0);
    this.keys.clear();
    this.stepDistAccum = 0;
    this.shakeTimer = 0;
    this.syncCamera(0);
  }

  public triggerCameraShake(duration = 0.22): void {
    this.shakeDuration = duration;
    this.shakeTimer = duration;
  }

  private bindEvents(): void {
    // Keyboard Controls
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
    });

    // Bottom-Left Virtual Joystick (Isolated pointerId + stopPropagation!)
    const maxJoyRadius = 38;
    this.joystickZone.addEventListener('pointerdown', (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.joyPointerId !== null) return;
      this.joyPointerId = e.pointerId;
      this.joystickZone.setPointerCapture(e.pointerId);
      const rect = this.joystickZone.getBoundingClientRect();
      this.joyOriginX = rect.left + rect.width / 2;
      this.joyOriginY = rect.top + rect.height / 2;
      this.updateJoystickFromPointer(e.clientX, e.clientY, maxJoyRadius);
    });

    this.joystickZone.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointerId) return;
      e.stopPropagation();
      e.preventDefault();
      this.updateJoystickFromPointer(e.clientX, e.clientY, maxJoyRadius);
    });

    const releaseJoy = (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointerId) return;
      e.stopPropagation();
      this.joyPointerId = null;
      this.joyVec.set(0, 0);
      this.joystickKnob.style.transform = 'translate(0px, 0px)';
    };
    this.joystickZone.addEventListener('pointerup', releaseJoy);
    this.joystickZone.addEventListener('pointercancel', releaseJoy);

    // Canvas Look & Cane Sweep (Ignores joystick pointerId!)
    this.domElement.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!this.enabled || e.pointerId === this.joyPointerId) return;
      if (this.lookPointerId !== null) return;
      this.lookPointerId = e.pointerId;
      this.lookStartX = e.clientX;
      this.lookStartY = e.clientY;
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
      this.lookMovedDist = 0;
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.enabled) return;
      if (e.pointerId === this.joyPointerId) return;

      // Desktop passive mouse hover drives natural horizontal cane sweep
      if (e.pointerType === 'mouse' && this.lookPointerId === null) {
        const normX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
        this.sweepInput = Math.max(-1, Math.min(1, normX));
      }

      if (e.pointerId === this.lookPointerId) {
        const dx = e.clientX - this.lastLookX;
        const dy = e.clientY - this.lastLookY;
        this.lastLookX = e.clientX;
        this.lastLookY = e.clientY;
        this.lookMovedDist += Math.hypot(dx, dy);

        const sensitivity = e.pointerType === 'touch' ? 0.0046 : 0.0034;
        this.yaw -= dx * sensitivity;
        this.pitch = Math.max(-0.58, Math.min(0.45, this.pitch - dy * sensitivity * 0.75));

        // Also sweep cane slightly in direction of look drag
        this.sweepInput = Math.max(-1, Math.min(1, this.sweepInput + dx * 0.012));
      }
    });

    const releaseLook = (e: PointerEvent) => {
      if (e.pointerId !== this.lookPointerId) return;
      const dist = Math.hypot(e.clientX - this.lookStartX, e.clientY - this.lookStartY);
      this.lookPointerId = null;
      // Quick tap/click on canvas (not a drag) triggers cane tap!
      if (dist < 10 && this.lookMovedDist < 14 && this.enabled) {
        this.callbacks.onCanvasQuickTap();
      }
    };
    window.addEventListener('pointerup', releaseLook);
    window.addEventListener('pointercancel', releaseLook);
  }

  private updateJoystickFromPointer(clientX: number, clientY: number, maxR: number): void {
    const dx = clientX - this.joyOriginX;
    const dy = clientY - this.joyOriginY;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, maxR);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * clamped;
    const ky = Math.sin(angle) * clamped;
    this.joystickKnob.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
    this.joyVec.set(kx / maxR, ky / maxR);
  }

  public update(dt: number): void {
    this.clockSec += dt;

    if (!this.enabled) {
      this.isMoving = false;
      this.syncCamera(dt);
      return;
    }

    // Keyboard Yaw Turn (Q / E or ArrowLeft / ArrowRight)
    const turnSpeed = 1.65;
    if (this.keys.has('KeyQ') || this.keys.has('ArrowLeft')) {
      this.yaw += turnSpeed * dt;
      this.sweepInput = Math.max(-1, this.sweepInput - dt * 1.8);
    }
    if (this.keys.has('KeyE') || this.keys.has('ArrowRight')) {
      // Note: KeyE also triggers Help when standing right at Crosswalk Node 05; harmless slight turn or guarded
      this.yaw -= turnSpeed * dt;
      this.sweepInput = Math.min(1, this.sweepInput + dt * 1.8);
    }

    // Forward / Strafe Input (WASD + Up/Down + Virtual Joystick)
    let moveForward = 0;
    let moveRight = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveForward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveForward -= 1;
    if (this.keys.has('KeyD')) moveRight += 1;
    if (this.keys.has('KeyA')) moveRight -= 1;

    // Combine Virtual Joystick
    moveForward += -this.joyVec.y;
    moveRight += this.joyVec.x;

    const inputLen = Math.hypot(moveForward, moveRight);
    if (inputLen > 1) {
      moveForward /= inputLen;
      moveRight /= inputLen;
    }

    const walkSpeed = 2.45; // Comfortable ~3 min pace across 45m with exploration
    const prevX = this.position.x;
    const prevZ = this.position.z;

    if (inputLen > 0.04) {
      // Forward vector in XZ for yaw (yaw=0 -> (0, 0, -1))
      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      const vx = (fwdX * moveForward + rightX * moveRight) * walkSpeed;
      const vz = (fwdZ * moveForward + rightZ * moveRight) * walkSpeed;

      this.position.x += vx * dt;
      this.position.z += vz * dt;
    }

    // Circle-vs-Rectangle Collision Push-out (2 passes for rock-solid corner sliding)
    for (let pass = 0; pass < 2; pass++) {
      for (const col of this.colliders) {
        if (!col.enabled) continue;
        const closestX = Math.max(col.minX, Math.min(this.position.x, col.maxX));
        const closestZ = Math.max(col.minZ, Math.min(this.position.z, col.maxZ));

        const dx = this.position.x - closestX;
        const dz = this.position.z - closestZ;
        const distSq = dx * dx + dz * dz;

        if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
          const dist = Math.sqrt(distSq);
          if (dist > 0.0001) {
            const overlap = PLAYER_RADIUS - dist;
            this.position.x += (dx / dist) * overlap;
            this.position.z += (dz / dist) * overlap;
          } else {
            // Deep inside fallback: push out along shallowest axis
            const penLeft = Math.abs(this.position.x - col.minX);
            const penRight = Math.abs(col.maxX - this.position.x);
            const penFront = Math.abs(this.position.z - col.minZ);
            const penBack = Math.abs(col.maxZ - this.position.z);
            const minPen = Math.min(penLeft, penRight, penFront, penBack);
            if (minPen === penLeft) this.position.x = col.minX - PLAYER_RADIUS;
            else if (minPen === penRight) this.position.x = col.maxX + PLAYER_RADIUS;
            else if (minPen === penFront) this.position.z = col.minZ - PLAYER_RADIUS;
            else this.position.z = col.maxZ + PLAYER_RADIUS;
          }

          if (pass === 0) {
            if (col.isObstacle && this.clockSec - this.lastObstacleBumpTime > 1.15) {
              this.lastObstacleBumpTime = this.clockSec;
              this.triggerCameraShake(0.22);
              this.callbacks.onObstacleBump(col);
            } else if (
              col.id === 'crosswalk_airwall' &&
              this.clockSec - this.lastAirwallNoticeTime > 2.2
            ) {
              this.lastAirwallNoticeTime = this.clockSec;
              this.callbacks.onAirwallBlocked();
            }
          }
        }
      }
    }

    // Footstep Distance Tracking
    const movedDist = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.isMoving = movedDist > 0.002;
    if (this.isMoving) {
      this.stepDistAccum += movedDist;
      this.walkCycle += movedDist * 3.8;
      if (this.stepDistAccum >= 0.58) {
        this.stepDistAccum = 0;
        this.callbacks.onFootstep(this.position);
      }
    }

    this.syncCamera(dt);
  }

  private syncCamera(dt: number): void {
    // Subtle natural head-bob while walking
    const headBobY = this.isMoving ? Math.sin(this.walkCycle * 2.0) * 0.024 : 0;

    // Obstacle collision micro-shake (0.22s)
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const t = this.shakeTimer / this.shakeDuration;
      const amp = 0.045 * t;
      shakeX = Math.sin(this.clockSec * 68) * amp;
      shakeY = Math.cos(this.clockSec * 54) * amp * 0.7;
    }

    this.camera.position.set(
      this.position.x + shakeX,
      this.position.y + headBobY + shakeY,
      this.position.z
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = shakeX * 0.4;
  }
}
