import * as THREE from 'three';
import { ColliderBox, SurfaceTag, WAYPOINTS } from '../level/levelData';
import { BuiltSceneResult } from '../level/buildScene';
import { EchoShaderManager } from '../shaders/echoMaterial';
import { SpatialSoundEngine } from '../audio/soundEngine';
import { AccessibilityUI } from '../ui/accessibilityUI';

export interface StoryCallbacks {
  onEquipCane: () => void;
  onCollidersUpdated: () => void;
  onReachEnding: (elapsedSeconds: number, obstacleBumps: number) => void;
}

export class StoryScriptManager {
  public hasCane = false;
  public doorOpened = false;
  public obstacleBumps = 0;
  public helpPressCount = 0;
  public strangerArrived = false;
  public endingTriggered = false;
  public sunsetProgress = 0;

  private steppedOnTactile = false;
  private bikeHintShown = false;
  private barrierHintShown = false;
  private stallVisited = false;
  private crosswalkEntered = false;
  private endingModalShown = false;
  private foyerReminderTimer = 0;

  // Crosswalk traffic scheduler
  private trafficTimer = 0.8;
  private nextTrafficDir: 1 | -1 = 1;
  private helpCooldown = 0;
  private escortRippleTimer = 0;

  private playElapsed = 0;
  private running = false;

  private colliders: ColliderBox[];
  private builtScene: BuiltSceneResult;
  private echoManager: EchoShaderManager;
  private soundEngine: SpatialSoundEngine;
  private a11yUI: AccessibilityUI;
  private callbacks: StoryCallbacks;

  private helpWrap: HTMLElement;
  private helpBtn: HTMLButtonElement;
  private helpBtnLabel: HTMLElement;

  constructor(
    colliders: ColliderBox[],
    builtScene: BuiltSceneResult,
    echoManager: EchoShaderManager,
    soundEngine: SpatialSoundEngine,
    a11yUI: AccessibilityUI,
    callbacks: StoryCallbacks
  ) {
    this.colliders = colliders;
    this.builtScene = builtScene;
    this.echoManager = echoManager;
    this.soundEngine = soundEngine;
    this.a11yUI = a11yUI;
    this.callbacks = callbacks;

    this.helpWrap = document.getElementById('help-action-wrap')!;
    this.helpBtn = document.getElementById('btn-help') as HTMLButtonElement;
    this.helpBtnLabel = document.getElementById('btn-help-label')!;

    this.helpBtn.addEventListener('click', () => {
      this.handleHelpPress();
    });
  }

  public startJourney(): void {
    this.running = true;
    this.playElapsed = 0;
    this.a11yUI.setActHeader(1);

    // Subtle opening pulse at foyer cane to orient player
    this.echoManager.emitWave(
      new THREE.Vector3(WAYPOINTS.canePickupPos.x, 0.2, WAYPOINTS.canePickupPos.z),
      false,
      2.6,
      1.15
    );

    this.a11yUI.showSubtitle(
      '四周一片漆黑……先向右侧墙边摸索你的导盲杖。',
      7500
    );
  }

  public reset(): void {
    this.hasCane = false;
    this.doorOpened = false;
    this.obstacleBumps = 0;
    this.helpPressCount = 0;
    this.strangerArrived = false;
    this.endingTriggered = false;
    this.endingModalShown = false;
    this.sunsetProgress = 0;
    this.steppedOnTactile = false;
    this.bikeHintShown = false;
    this.barrierHintShown = false;
    this.stallVisited = false;
    this.crosswalkEntered = false;
    this.foyerReminderTimer = 0;
    this.playElapsed = 0;
    this.helpCooldown = 0;

    // Restore colliders
    const doorCol = this.colliders.find((c) => c.id === 'foyer_security_door');
    if (doorCol) doorCol.enabled = true;
    const airwallCol = this.colliders.find((c) => c.id === 'crosswalk_airwall');
    if (airwallCol) airwallCol.enabled = true;

    // Restore visuals
    this.builtScene.canePickupGroup.visible = true;
    this.builtScene.doorSliverMesh.visible = true;
    this.builtScene.doorCrackLight.intensity = 1.15;
    this.builtScene.catPointLight.intensity = 0;
    this.builtScene.pedestrianGroup.visible = false;
    this.builtScene.pedestrianHaloLight.intensity = 0;
    this.builtScene.sunsetDirLight.intensity = 0.15;
    (this.builtScene.sunsetBackdrop.material as THREE.MeshBasicMaterial).opacity = 0;

    this.helpWrap.classList.add('hidden');
    this.helpBtnLabel.textContent = '呼喊求助 [E]';
    this.callbacks.onCollidersUpdated();
  }

  public onObstacleCollision(col: ColliderBox): void {
    this.obstacleBumps += 1;
    this.soundEngine.playCollisionBump(col.tag);

    // Emit localized cyan collision ripple at obstacle
    const cx = (col.minX + col.maxX) * 0.5;
    const cz = (col.minZ + col.maxZ) * 0.5;
    this.echoManager.emitWave(new THREE.Vector3(cx, 0.35, cz), false, 3.8, 1.0);

    if (col.id === 'shared_bikes') {
      this.bikeHintShown = true;
      this.a11yUI.showSubtitle(
        '冰冷的车把挡住了盲道，只能先离开盲道向两侧摸索绕行。',
        6000
      );
    } else if (col.id === 'construction_barrier') {
      this.barrierHintShown = true;
      this.a11yUI.showSubtitle(
        '施工围挡截断了整条盲道，小心向一侧人行道绕过去吧。',
        6000
      );
    }
  }

  public onCaneSurfaceHit(tag: SurfaceTag, point: THREE.Vector3): void {
    if (tag === 'bike' && !this.bikeHintShown) {
      this.bikeHintShown = true;
      this.a11yUI.showSubtitle(
        '盲杖敲到了金属车轮——违停共享单车占用了盲道，请小心绕行。',
        5500
      );
    } else if (tag === 'barrier' && !this.barrierHintShown) {
      this.barrierHintShown = true;
      this.a11yUI.showSubtitle(
        '前方是横在盲道上的施工围挡，先向旁边探路绕开它。',
        5500
      );
    } else if ((tag === 'cat' || tag === 'stall') && !this.stallVisited && point.z < -21.5) {
      this.triggerStallWarmth();
    }
  }

  public onAirwallBlocked(): void {
    if (!this.strangerArrived) {
      this.a11yUI.showSubtitle(
        '面前车流疾驰，没有过街提示音……请点击「呼喊求助」或按 E 键向路人求助。',
        5000
      );
    }
  }

  public handleHelpPress(): void {
    if (!this.crosswalkEntered || this.strangerArrived || this.helpCooldown > 0) return;

    this.helpPressCount += 1;
    this.helpCooldown = 1.35;

    if (this.helpPressCount === 1) {
      // 1st Press: Heavy rushing traffic drowns out call
      this.spawnTrafficBurst(1, 1.35);
      this.helpBtnLabel.textContent = '再次呼喊求助 [E] (1/3)';
      this.a11yUI.showSubtitle(
        '“请问有人在旁边吗——” 呼啸而过的车流淹没了声音，无人应答。',
        5200
      );
    } else if (this.helpPressCount === 2) {
      // 2nd Press: Opposite lane car streaks past, still unanswered
      this.spawnTrafficBurst(-1, 1.35);
      this.helpBtnLabel.textContent = '鼓起勇气再喊一次 [E] (2/3)';
      this.a11yUI.showSubtitle(
        '“能帮我看一下红绿灯吗？” 四周一片嘈杂，依然没有人停下……再试一次吧。',
        5200
      );
    } else {
      // 3rd Press: Kind stranger responds, warm golden halo blooms, airwall lifts!
      this.strangerArrived = true;
      this.helpWrap.classList.add('hidden');
      this.soundEngine.playWarmStrangerChime();

      // Reveal backlit pedestrian silhouette & warm golden halo
      this.builtScene.pedestrianGroup.visible = true;
      this.builtScene.pedestrianHaloLight.intensity = 3.8;

      // Release crosswalk safety air-wall
      const airwall = this.colliders.find((c) => c.id === 'crosswalk_airwall');
      if (airwall) airwall.enabled = false;
      this.callbacks.onCollidersUpdated();

      // Emit welcoming golden wave from across the crosswalk
      this.echoManager.emitWave(
        new THREE.Vector3(0, 0.15, -34.5),
        true,
        6.5,
        1.4
      );
      this.builtScene.spawnSparkles(new THREE.Vector3(0, 0.2, -34.0), true);

      this.a11yUI.showSubtitle(
        '“别急，变绿灯了，我扶你过去。” —— 前方亮起温暖的光晕，安心穿过斑马线吧。',
        8000
      );
    }
  }

  private triggerStallWarmth(): void {
    if (this.stallVisited) return;
    this.stallVisited = true;
    this.builtScene.catPointLight.intensity = 1.6;
    this.echoManager.setCatGlow(1.0);
    this.soundEngine.playCatGreeting(-0.5);
    this.echoManager.emitWave(
      new THREE.Vector3(WAYPOINTS.catPos.x, 0.12, WAYPOINTS.catPos.z),
      true,
      4.4,
      1.25
    );
    this.builtScene.spawnSparkles(
      new THREE.Vector3(WAYPOINTS.catPos.x, 0.15, WAYPOINTS.catPos.z),
      true
    );
    this.a11yUI.showSubtitle(
      '“小心脚下，刚下过雨路有点滑。” —— 街角早点摊飘来热气，脚边的小猫轻声回应。',
      6800
    );
  }

  private spawnTrafficBurst(dir: 1 | -1, audioBoost = 1.0): void {
    const slot = this.builtScene.trafficStreaks.find((t) => t.direction === dir);
    if (slot) {
      slot.active = true;
      slot.group.visible = true;
      slot.group.position.x = dir === 1 ? -24 : 24;
      slot.speed = 23 + Math.random() * 4;
    }
    this.soundEngine.playTrafficWhoosh(dir, audioBoost);
  }

  public update(dt: number, totalElapsed: number, playerPos: THREE.Vector3): void {
    if (!this.running) return;

    if (!this.endingTriggered) {
      this.playElapsed += dt;
    }

    if (this.helpCooldown > 0) {
      this.helpCooldown = Math.max(0, this.helpCooldown - dt);
    }

    // --- NODE 01: Foyer Cane Pickup ---
    if (!this.hasCane) {
      this.echoManager.setCanePickupVisible(true, totalElapsed);
      this.foyerReminderTimer += dt;

      // Gentle acoustic/echo beacon every 8s if player hasn't found the cane yet
      if (this.foyerReminderTimer > 8.0) {
        this.foyerReminderTimer = 0;
        const canePos = new THREE.Vector3(
          WAYPOINTS.canePickupPos.x,
          0.25,
          WAYPOINTS.canePickupPos.z
        );
        this.echoManager.emitWave(canePos, false, 2.8, 1.1);
        this.soundEngine.playCaneTap('cane_pickup', 0.65, true);
      }

      const distToCane = Math.hypot(
        playerPos.x - WAYPOINTS.canePickupPos.x,
        playerPos.z - WAYPOINTS.canePickupPos.z
      );
      if (distToCane < 1.55) {
        this.hasCane = true;
        this.builtScene.canePickupGroup.visible = false;
        this.echoManager.setCanePickupVisible(false, totalElapsed);
        this.soundEngine.playCaneTap('cane_pickup', 0.35, true);
        this.echoManager.emitWave(
          new THREE.Vector3(WAYPOINTS.canePickupPos.x, 0.1, WAYPOINTS.canePickupPos.z),
          true,
          4.8,
          1.2
        );
        this.callbacks.onEquipCane();
        this.a11yUI.showSubtitle(
          '摸到了导盲杖！按空格键或点右下角敲杖探路，朝着门缝微光走出去。',
          6800
        );
      } else if (playerPos.z < -4.25) {
        this.foyerReminderTimer = 7.5;
        this.a11yUI.showSubtitle(
          '还没拿到导盲杖，先退后半步在右侧墙边摸索一下吧。',
          4500
        );
      }
      return;
    }

    // --- NODE 02: Push Open Foyer Door & Step onto Tactile Guiding Bricks ---
    if (!this.doorOpened && playerPos.z <= -3.75) {
      this.doorOpened = true;
      const doorCol = this.colliders.find((c) => c.id === 'foyer_security_door');
      if (doorCol) doorCol.enabled = false;
      this.builtScene.doorSliverMesh.visible = false;
      this.builtScene.doorCrackLight.intensity = 0.35;
      this.soundEngine.playDoorOpen();
      this.echoManager.emitWave(new THREE.Vector3(0, 0.1, -6.2), true, 5.2, 1.25);
      this.callbacks.onCollidersUpdated();
      this.a11yUI.showSubtitle(
        '推开门走入夜色，沿着正前方凸起的黄色盲道前行吧。',
        5800
      );
    }

    if (!this.steppedOnTactile && playerPos.z <= -6.2 && Math.abs(playerPos.x) < 0.75) {
      this.steppedOnTactile = true;
      this.soundEngine.playCaneTap('tactile_line', 0, true);
      this.echoManager.emitWave(new THREE.Vector3(0, 0.1, -7.8), true, 5.4, 1.25);
      this.builtScene.spawnSparkles(new THREE.Vector3(0, 0.1, -7.2), true);
      this.a11yUI.showSubtitle(
        '脚下是条形引导砖，敲击它会发出清脆回响与琥珀色微光。',
        5800
      );
    }

    // --- NODE 04: Street-Corner Warm Breakfast Stall & Cat (Z ≈ -24.6) ---
    if (!this.stallVisited && playerPos.z <= -23.2 && playerPos.z >= -26.8) {
      const distToCat = Math.hypot(
        playerPos.x - WAYPOINTS.catPos.x,
        playerPos.z - WAYPOINTS.catPos.z
      );
      if (distToCat < 3.4) {
        this.triggerStallWarmth();
      }
    }

    // --- Periodic Binaural Crosswalk Traffic (audible from Z <= -26 until Stranger Stops Cars) ---
    if (playerPos.z <= -26.5 && !this.strangerArrived) {
      this.trafficTimer -= dt;
      if (this.trafficTimer <= 0) {
        const proximityBoost = playerPos.z <= -30.5 ? 1.15 : 0.65;
        this.spawnTrafficBurst(this.nextTrafficDir, proximityBoost);
        this.nextTrafficDir = this.nextTrafficDir === 1 ? -1 : 1;
        this.trafficTimer = playerPos.z <= -30.5 ? 2.15 : 3.1;
      }
    }

    // --- NODE 05: Silent Crosswalk Warning Bricks & 3-Step Call For Help ---
    if (!this.crosswalkEntered && playerPos.z <= WAYPOINTS.crosswalkPromptZ) {
      this.crosswalkEntered = true;
      this.a11yUI.setActHeader(2);
      this.soundEngine.playCaneTap('tactile_dot', 0, true);
      this.echoManager.emitWave(new THREE.Vector3(playerPos.x, 0.1, -31.9), true, 5.0, 1.2);
      this.spawnTrafficBurst(1, 1.2);

      this.helpWrap.classList.remove('hidden');
      this.a11yUI.showSubtitle(
        '踩到了密集的圆点提示砖！前方是无提示音的斑马线，车流湍急，请点击「呼喊求助」或按 E 键。',
        8500
      );
    }

    // Gentle golden escort ripples guiding player across crosswalk after 3rd help call
    if (this.strangerArrived && !this.endingTriggered) {
      this.escortRippleTimer -= dt;
      if (this.escortRippleTimer <= 0) {
        this.escortRippleTimer = 1.65;
        const aheadZ = Math.max(-43.0, playerPos.z - 3.2);
        this.echoManager.emitWave(new THREE.Vector3(0, 0.08, aheadZ), true, 4.8, 1.15);
        this.builtScene.spawnSparkles(new THREE.Vector3(0, 0.12, aheadZ), true);
      }
    }

    // --- NODE 06: Sunset Finale Reveal (Z <= -43.0, 2.5s Smooth Golden Transition) ---
    if (!this.endingTriggered && playerPos.z <= WAYPOINTS.sunsetFinishZ) {
      this.endingTriggered = true;
      this.soundEngine.playWarmStrangerChime();
      this.a11yUI.showSubtitle(
        '夕阳洒满十字路口——原来黑暗里的每一步安心，都源于不被占用的盲道与一句温柔回应。',
        9000
      );
    }

    if (this.endingTriggered && this.sunsetProgress < 1.0) {
      this.sunsetProgress = Math.min(1.0, this.sunsetProgress + dt / 2.5);
      // Smoothstep easing
      const ease = this.sunsetProgress * this.sunsetProgress * (3 - 2 * this.sunsetProgress);
      this.echoManager.setSunsetFactor(ease);
      this.builtScene.sunsetDirLight.intensity = 0.15 + ease * 2.85;
      this.builtScene.ambientHemiLight.intensity = 0.95 + ease * 0.75;
      (this.builtScene.sunsetBackdrop.material as THREE.MeshBasicMaterial).opacity = ease * 0.95;

      if (this.sunsetProgress >= 1.0 && !this.endingModalShown) {
        this.endingModalShown = true;
        window.setTimeout(() => {
          this.callbacks.onReachEnding(
            Math.max(1, Math.round(this.playElapsed)),
            this.obstacleBumps
          );
        }, 650);
      }
    }
  }
}
