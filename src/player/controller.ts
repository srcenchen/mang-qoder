import * as THREE from 'three';
import { ColliderBox, PLAYER_EYE_HEIGHT, PLAYER_RADIUS, WAYPOINTS } from '../level/levelData';

export interface ControllerCallbacks {
  onFootstep: (pos: THREE.Vector3) => void;
  onObstacleBump: (collider: ColliderBox) => void;
  onAirwallBlocked: () => void;
  onPrimaryHoldStart: () => void;
  onPrimaryHoldEnd: () => void;
  onPointerLockChange: (locked: boolean) => void;
}

const OBSTACLE_BUMP_COOLDOWN_MS = 1200;

export class FirstPersonController {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly position = new THREE.Vector3(
    WAYPOINTS.playerStart.x,
    PLAYER_EYE_HEIGHT,
    WAYPOINTS.playerStart.z
  );
  public yaw = 0;
  public pitch = -0.09;
  public enabled = false;
  public attractMode = true;
  public mouseSensitivity = 1.0;

  /** True when Web Pointer Lock API has captured the desktop cursor */
  public isPointerLocked = false;
  /** True when CSS 90deg clockwise auto-landscape is active on a portrait mobile screen */
  public cssRotatedLandscape = false;
  /** Set true while settings drawer or ending modal is open so canvas doesn't recapture cursor */
  public modalOpen = false;

  /** Focus Listen Mode (Shift / Right Click / Mobile Listen button) */
  public isListening = false;
  public listenBlend = 0;
  /** True while the kind stranger is gently holding your hand and leading you across the crosswalk */
  public escortAssistActive = false;

  public sweepInput = 0;
  public isMoving = false;
  public walkCycle = 0;

  private keys = new Set<string>();
  private colliders: ColliderBox[];
  private callbacks: ControllerCallbacks;

  private lookPointerId: number | null = null;
  private lookStartX = 0;
  private lookStartY = 0;
  private lastLookX = 0;
  private lastLookY = 0;
  private lookMovedDist = 0;
  private rmbListening = false;
  private lmbCharging = false;
  private touchListening = false;

  private joyPointerId: number | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;
  private joyVec = new THREE.Vector2(0, 0);

  private velocity = new THREE.Vector2(0, 0);
  private stepDistAccum = 0;
  private shakeTimer = 0;
  private shakeDuration = 0.22;
  private lastObstacleBumpTimes = new Map<string, number>();
  private obstacleContacts = new Set<string>();
  private frameObstacleContacts = new Set<string>();
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

  public setTouchListening(active: boolean): void {
    this.touchListening = active;
  }

  public setCssRotatedLandscape(rotated: boolean): void {
    this.cssRotatedLandscape = rotated;
  }

  public requestPointerLock(): void {
    if (this.modalOpen || !this.enabled || this.isPointerLocked) return;
    const isCoarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (isCoarse) return;
    try {
      const p = this.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Ignore in sandboxed iframes; drag-to-look fallback remains active
    }
  }

  public exitPointerLock(): void {
    try {
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
    } catch {
      // Ignore
    }
  }

  public reset(): void {
    this.position.set(WAYPOINTS.playerStart.x, PLAYER_EYE_HEIGHT, WAYPOINTS.playerStart.z);
    this.yaw = 0;
    this.pitch = -0.09;
    this.sweepInput = 0;
    this.lookPointerId = null;
    this.joyPointerId = null;
    this.joyVec.set(0, 0);
    this.joystickKnob.style.transform = 'translate(0px, 0px)';
    this.velocity.set(0, 0);
    this.keys.clear();
    this.rmbListening = false;
    this.lmbCharging = false;
    this.touchListening = false;
    this.isListening = false;
    this.listenBlend = 0;
    this.stepDistAccum = 0;
    this.shakeTimer = 0;
    this.lastObstacleBumpTimes.clear();
    this.obstacleContacts.clear();
    this.frameObstacleContacts.clear();
    this.lastAirwallNoticeTime = -10;
    this.syncCamera(0);
  }

  public triggerCameraShake(duration = 0.22): void {
    this.shakeDuration = duration;
    this.shakeTimer = duration;
  }

  /** Maps physical viewport deltas into rotated stage space when CSS 90deg auto-landscape is active */
  private mapScreenDelta(dx: number, dy: number): { x: number; y: number } {
    if (this.cssRotatedLandscape) {
      return { x: dy, y: -dx };
    }
    return { x: dx, y: dy };
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.rmbListening = false;
      if (this.lmbCharging) {
        this.lmbCharging = false;
        this.callbacks.onPrimaryHoldEnd();
      }
    });

    // Pointer Lock state listener
    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === this.domElement;
      if (!this.isPointerLocked) {
        this.rmbListening = false;
        if (this.lmbCharging) {
          this.lmbCharging = false;
          this.callbacks.onPrimaryHoldEnd();
        }
      }
      this.callbacks.onPointerLockChange(this.isPointerLocked);
    });

    // Raw Mouse Look while Pointer Locked!
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.enabled || !this.isPointerLocked) return;
      // Guard against browser single-frame pointer-lock spikes
      const mx = Math.max(-160, Math.min(160, e.movementX));
      const my = Math.max(-160, Math.min(160, e.movementY));

      const sens = 0.0022 * this.mouseSensitivity;
      this.yaw -= mx * sens;
      this.pitch = Math.max(-0.68, Math.min(0.55, this.pitch - my * sens * 0.85));

      // Moving mouse left/right sweeps the guide cane naturally in front of the player!
      this.sweepInput = Math.max(-1, Math.min(1, this.sweepInput + mx * 0.0055));
    });

    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    // Bottom-Left Virtual Joystick (Isolated pointerId + auto-landscape coordinate transform!)
    const maxJoyRadius = 36;
    this.joystickZone.addEventListener('pointerdown', (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!this.enabled || this.joyPointerId !== null || e.pointerId === this.lookPointerId) return;
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
    this.joystickZone.addEventListener('lostpointercapture', releaseJoy);

    // Canvas Pointer / Mouse Handling:
    // - Desktop click captures mouse (Pointer Lock) AND once locked, LMB charges/taps cane & RMB listens!
    // - Touch / Unlocked Mouse smoothly drags camera look!
    this.domElement.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!this.enabled || e.pointerId === this.joyPointerId) return;

      if (e.pointerType === 'mouse') {
        if (e.button === 2) {
          this.rmbListening = true;
          return;
        }
        if (e.button === 0) {
          if (this.isPointerLocked) {
            this.lmbCharging = true;
            this.callbacks.onPrimaryHoldStart();
            return;
          }
          // Not yet locked: request Pointer Lock immediately on canvas click!
          this.requestPointerLock();
        }
      }

      if (this.lookPointerId !== null) return;
      this.lookPointerId = e.pointerId;
      this.lookStartX = e.clientX;
      this.lookStartY = e.clientY;
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
      this.lookMovedDist = 0;
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.enabled || e.pointerId === this.joyPointerId || this.isPointerLocked) return;

      // Unlocked desktop mouse hover gently sweeps cane
      if (e.pointerType === 'mouse' && this.lookPointerId === null) {
        const normX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
        this.sweepInput = Math.max(-1, Math.min(1, normX));
      }

      // Touch drag OR unlocked mouse drag turns camera
      if (e.pointerId === this.lookPointerId) {
        const rawDx = e.clientX - this.lastLookX;
        const rawDy = e.clientY - this.lastLookY;
        this.lastLookX = e.clientX;
        this.lastLookY = e.clientY;
        this.lookMovedDist += Math.hypot(rawDx, rawDy);

        const mapped = this.mapScreenDelta(rawDx, rawDy);
        const sensitivity = (e.pointerType === 'touch' ? 0.0048 : 0.0034) * this.mouseSensitivity;
        this.yaw -= mapped.x * sensitivity;
        this.pitch = Math.max(-0.65, Math.min(0.52, this.pitch - mapped.y * sensitivity * 0.78));
        this.sweepInput = Math.max(-1, Math.min(1, this.sweepInput + mapped.x * 0.012));
      }
    });

    const releaseLook = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 2) this.rmbListening = false;
        if (e.button === 0 && this.lmbCharging) {
          this.lmbCharging = false;
          this.callbacks.onPrimaryHoldEnd();
          return;
        }
      }
      if (e.pointerId !== this.lookPointerId) return;
      const dist = Math.hypot(e.clientX - this.lookStartX, e.clientY - this.lookStartY);
      this.lookPointerId = null;
      if (e.type === 'pointerup' && dist < 10 && this.lookMovedDist < 14 && this.enabled) {
        this.callbacks.onPrimaryHoldStart();
        this.callbacks.onPrimaryHoldEnd();
      }
    };
    window.addEventListener('pointerup', releaseLook);
    window.addEventListener('pointercancel', releaseLook);
  }

  private updateJoystickFromPointer(clientX: number, clientY: number, maxR: number): void {
    const rawDx = clientX - this.joyOriginX;
    const rawDy = clientY - this.joyOriginY;
    const mapped = this.mapScreenDelta(rawDx, rawDy);
    const dist = Math.hypot(mapped.x, mapped.y);
    const clamped = Math.min(dist, maxR);
    const angle = Math.atan2(mapped.y, mapped.x);
    const kx = Math.cos(angle) * clamped;
    const ky = Math.sin(angle) * clamped;
    this.joystickKnob.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
    this.joyVec.set(kx / maxR, ky / maxR);
  }

  public update(dt: number): void {
    this.clockSec += dt;

    if (this.attractMode) {
      const swayX = Math.sin(this.clockSec * 0.24) * 0.42;
      const swayY = Math.cos(this.clockSec * 0.35) * 0.08;
      this.camera.position.set(
        WAYPOINTS.crosswalkCenterX + 0.65 + swayX,
        1.48 + swayY,
        -18.0 + Math.sin(this.clockSec * 0.16) * 0.75
      );
      this.camera.lookAt(WAYPOINTS.crosswalkCenterX - 0.5, 0.92, -31.5);
      this.camera.fov = 56;
      this.camera.updateProjectionMatrix();
      return;
    }

    if (!this.enabled) {
      this.isMoving = false;
      this.syncCamera(dt);
      return;
    }

    // Gently return cane sweep toward center when mouse is locked & stationary
    if (this.isPointerLocked) {
      this.sweepInput *= Math.pow(0.18, dt);
    }

    this.isListening =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.rmbListening ||
      this.touchListening;
    const listenTarget = this.isListening ? 1.0 : 0.0;
    this.listenBlend += (listenTarget - this.listenBlend) * Math.min(1, dt * 7.5);

    const targetFov = THREE.MathUtils.lerp(62, 56.5, this.listenBlend);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8.0);
      this.camera.updateProjectionMatrix();
    }

    const turnSpeed = 1.65 * this.mouseSensitivity;
    if (this.keys.has('KeyQ') || this.keys.has('ArrowLeft')) {
      this.yaw += turnSpeed * dt;
      this.sweepInput = Math.max(-1, this.sweepInput - dt * 1.8);
    }
    if (this.keys.has('ArrowRight')) {
      this.yaw -= turnSpeed * dt;
      this.sweepInput = Math.min(1, this.sweepInput + dt * 1.8);
    }

    let moveForward = 0;
    let moveRight = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveForward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveForward -= 1;
    if (this.keys.has('KeyD')) moveRight += 1;
    if (this.keys.has('KeyA')) moveRight -= 1;

    moveForward += -this.joyVec.y;
    moveRight += this.joyVec.x;

    const inputLen = Math.hypot(moveForward, moveRight);
    if (inputLen > 1) {
      moveForward /= inputLen;
      moveRight /= inputLen;
    }

    const walkSpeed = this.isListening ? 0.58 : 0.92;
    const prevX = this.position.x;
    const prevZ = this.position.z;

    let desiredVx = 0;
    let desiredVz = 0;
    if (inputLen > 0.04) {
      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);
      desiredVx = (fwdX * moveForward + rightX * moveRight) * walkSpeed;
      desiredVz = (fwdZ * moveForward + rightZ * moveRight) * walkSpeed;
    }

    // Gentle, reassuring forward-crossing pull while the kind stranger leads you across the zebra crossing!
    if (this.escortAssistActive) {
      const guidePullX = (WAYPOINTS.crosswalkCenterX - 0.12 - this.position.x) * 0.55;
      const guidePullZ = -0.82;
      desiredVx = desiredVx * 0.4 + guidePullX;
      desiredVz = Math.min(desiredVz, guidePullZ);
    }

    const accel = inputLen > 0.04 ? 11.5 : 14.0;
    this.velocity.x += (desiredVx - this.velocity.x) * Math.min(1, dt * accel);
    this.velocity.y += (desiredVz - this.velocity.y) * Math.min(1, dt * accel);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.y * dt;

    const contacts = this.frameObstacleContacts;
    contacts.clear();
    const radiusSq = PLAYER_RADIUS * PLAYER_RADIUS;
    for (let pass = 0; pass < 2; pass++) {
      for (const col of this.colliders) {
        if (!col.enabled) continue;
        const closestX = Math.max(col.minX, Math.min(this.position.x, col.maxX));
        const closestZ = Math.max(col.minZ, Math.min(this.position.z, col.maxZ));

        const dx = this.position.x - closestX;
        const dz = this.position.z - closestZ;
        const distSq = dx * dx + dz * dz;
        const overlaps = distSq < radiusSq;
        const wasTouching = this.obstacleContacts.has(col.id);
        const newObstacleContact = col.isObstacle && overlaps && !wasTouching && !contacts.has(col.id);
        // Keep resting contacts stable when collision resolution lands on the exact radius.
        if (col.isObstacle && (overlaps || (wasTouching && distSq <= radiusSq + 1e-6))) {
          contacts.add(col.id);
        }

        if (overlaps) {
          const dist = Math.sqrt(distSq);
          if (dist > 0.0001) {
            const overlap = PLAYER_RADIUS - dist;
            this.position.x += (dx / dist) * overlap;
            this.position.z += (dz / dist) * overlap;
          } else {
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

          if (newObstacleContact) {
            const now = performance.now();
            const lastBump = this.lastObstacleBumpTimes.get(col.id) ?? -Infinity;
            if (now - lastBump >= OBSTACLE_BUMP_COOLDOWN_MS) {
              this.lastObstacleBumpTimes.set(col.id, now);
              this.triggerCameraShake(0.22);
              this.callbacks.onObstacleBump(col);
            }
          } else if (
            pass === 0 &&
            col.id === 'crosswalk_airwall' &&
            this.clockSec - this.lastAirwallNoticeTime > 2.2
          ) {
            this.lastAirwallNoticeTime = this.clockSec;
            this.callbacks.onAirwallBlocked();
          }
        }
      }
    }
    this.frameObstacleContacts = this.obstacleContacts;
    this.obstacleContacts = contacts;

    const movedDist = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.isMoving = movedDist > 0.0015;
    if (this.isMoving) {
      this.stepDistAccum += movedDist;
      this.walkCycle += movedDist * 4.8;
      if (this.stepDistAccum >= 0.42) {
        this.stepDistAccum = 0;
        this.callbacks.onFootstep(this.position);
      }
    }

    this.syncCamera(dt);
  }

  private syncCamera(dt: number): void {
    const idleBreathY = Math.sin(this.clockSec * 1.45) * 0.008;
    const headBobY = this.isMoving ? Math.sin(this.walkCycle * 2.0) * 0.026 : idleBreathY;

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const t = this.shakeTimer / this.shakeDuration;
      const amp = 0.048 * t;
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
    this.camera.rotation.z = shakeX * 0.42;
  }
}
