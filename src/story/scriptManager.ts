import * as THREE from 'three';
import {
  AcousticBeacon,
  ColliderBox,
  createInitialBeacons,
  createInitialMicroInteractions,
  MicroInteraction,
  SurfaceTag,
  WAYPOINTS,
} from '../level/levelData';
import { BuiltSceneResult } from '../level/buildScene';
import { EchoShaderManager } from '../shaders/echoMaterial';
import { SpatialSoundEngine } from '../audio/soundEngine';
import { AccessibilityUI } from '../ui/accessibilityUI';

export interface StoryCallbacks {
  getPlayerPosition: () => THREE.Vector3;
  onEquipCane: () => void;
  onCollidersUpdated: () => void;
  onImpactPulse: () => void;
  onEscortAssistChange: (active: boolean) => void;
  onReachEnding: (
    elapsedSeconds: number,
    obstacleBumps: number,
    memoriesFound: number,
    memoriesTotal: number
  ) => void;
}

const HELP_PROMPTS = [
  '呼喊求助 [E]',
  '再次呼喊求助 [E] (1/3)',
  '鼓起勇气再喊一次 [E] (2/3)',
];

export class StoryScriptManager {
  public hasCane = false;
  public doorOpened = false;
  public obstacleBumps = 0;
  public helpPressCount = 0;
  public strangerArrived = false;
  public endingTriggered = false;
  public sunsetProgress = 0;
  public beacons: AcousticBeacon[] = createInitialBeacons();
  public microInteractions: MicroInteraction[] = createInitialMicroInteractions();

  // Hand-in-Hand Sighted Guide Escort State
  private escortPhase: 'none' | 'approaching' | 'holding_hands' | 'arrived' = 'none';
  private escortHoldingBlend = 0;
  private escortStridePhase = 0;
  private escortStepTimer = 0;
  private lastEscortZ = -31.8;

  private steppedOnTactile = false;
  private bikeHintShown = false;
  private barrierHintShown = false;
  private stallVisited = false;
  private crosswalkEntered = false;
  private endingModalShown = false;
  private foyerReminderTimer = 0;
  private listenPulseTimer = 0;

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

  private ctxWrap: HTMLElement;
  private ctxBtn: HTMLButtonElement;
  private ctxBraille: HTMLElement;
  private ctxLabel: HTMLElement;

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

    this.ctxWrap = document.getElementById('context-action-wrap')!;
    this.ctxBtn = document.getElementById('btn-context') as HTMLButtonElement;
    this.ctxBraille = document.getElementById('ctx-braille')!;
    this.ctxLabel = document.getElementById('ctx-label')!;

    this.ctxBtn.addEventListener('click', () => {
      this.handleContextAction();
    });
  }

  public getMemoriesFound(): number {
    return this.microInteractions.filter((m) => m.completed).length;
  }

  public startJourney(): void {
    this.running = true;
    this.playElapsed = 0;
    this.a11yUI.setActHeader(1);
    this.a11yUI.setMemoryCount(0, this.microInteractions.length);
    this.a11yUI.showLocationCard('旧城南街 · 玄关 · 19:42', '第一幕 · 摸黑寻杖与雨夜占道盲道');

    this.echoManager.emitWave(
      new THREE.Vector3(WAYPOINTS.canePickupPos.x, 0.2, WAYPOINTS.canePickupPos.z),
      'cyan',
      2.9,
      1.15
    );

    this.a11yUI.showSubtitle(
      '窗外正下着细雨，玄关一片漆黑……先向右侧墙边摸索你的导盲杖。',
      7500,
      '内心感知'
    );
  }

  public reset(): void {
    this.running = false;
    this.hasCane = false;
    this.doorOpened = false;
    this.obstacleBumps = 0;
    this.helpPressCount = 0;
    this.strangerArrived = false;
    this.endingTriggered = false;
    this.endingModalShown = false;
    this.sunsetProgress = 0;
    this.escortPhase = 'none';
    this.escortHoldingBlend = 0;
    this.escortStridePhase = 0;
    this.escortStepTimer = 0;
    this.callbacks.onEscortAssistChange(false);
    this.builtScene.escortRig.playerLeftArmRoot.visible = false;
    this.builtScene.escortRig.joinedHandsLight.intensity = 0;
    this.steppedOnTactile = false;
    this.bikeHintShown = false;
    this.barrierHintShown = false;
    this.stallVisited = false;
    this.crosswalkEntered = false;
    this.foyerReminderTimer = 0;
    this.playElapsed = 0;
    this.helpCooldown = 0;

    this.beacons = createInitialBeacons();
    this.microInteractions = createInitialMicroInteractions();
    this.a11yUI.setMemoryCount(0, this.microInteractions.length);

    const doorCol = this.colliders.find((c) => c.id === 'foyer_security_door');
    if (doorCol) doorCol.enabled = true;
    const airwallCol = this.colliders.find((c) => c.id === 'crosswalk_airwall');
    if (airwallCol) airwallCol.enabled = true;

    this.builtScene.canePickupGroup.visible = true;
    this.builtScene.doorSliverMesh.visible = true;
    this.builtScene.doorShaftMesh.visible = true;
    this.builtScene.doorCrackLight.intensity = 1.4;
    this.builtScene.catPointLight.intensity = 0;
    this.builtScene.pedestrianGroup.visible = false;
    this.builtScene.pedestrianHaloLight.intensity = 0;
    this.builtScene.sunsetDirLight.intensity = 0.25;
    this.builtScene.setPedestrianSignalGreen(false);

    this.showContextPrompt(null);
    this.callbacks.onCollidersUpdated();
  }

  public onObstacleCollision(col: ColliderBox): void {
    if (this.running && !this.endingTriggered) this.obstacleBumps += 1;
    this.soundEngine.playCollisionBump(col.tag);
    this.callbacks.onImpactPulse();

    const cx = (col.minX + col.maxX) * 0.5;
    const cz = (col.minZ + col.maxZ) * 0.5;
    this.echoManager.emitWave(new THREE.Vector3(cx, 0.35, cz), 'alarm', 4.2, 1.0, 1.25);

    if (col.id === 'shared_bikes') {
      this.bikeHintShown = true;
      this.a11yUI.showSubtitle(
        '冰冷的金属车把挡住了盲道！可以按 E 标记此占道点，再先离开盲道向两侧绕行。',
        6200,
        '触觉反馈'
      );
    } else if (col.id === 'construction_barrier') {
      this.barrierHintShown = true;
      this.a11yUI.showSubtitle(
        '施工围挡截断了整条盲道，小心向一侧人行道探路绕过去吧。',
        6000,
        '触觉反馈'
      );
    }
  }

  public onCaneSurfaceHit(tag: SurfaceTag, point: THREE.Vector3): void {
    if (tag === 'bike' && !this.bikeHintShown) {
      this.bikeHintShown = true;
      this.a11yUI.showSubtitle(
        '盲杖敲到了金属车轮——违停共享单车占用了盲道，按 E 可记下此处占道障碍，或小心绕行。',
        6200,
        '盲杖回响'
      );
    } else if (tag === 'barrier' && !this.barrierHintShown) {
      this.barrierHintShown = true;
      this.a11yUI.showSubtitle(
        '前方是闪着警示灯的施工围挡，先向旁边探路绕开它。',
        5500,
        '盲杖回响'
      );
    } else if ((tag === 'cat' || tag === 'stall') && !this.stallVisited && point.z < -21.5) {
      this.triggerStallWarmth();
    } else if (tag === 'signal_pole') {
      this.completeMicroInteraction('signal_pole');
    }
  }

  public onAirwallBlocked(): void {
    if (!this.strangerArrived) {
      this.a11yUI.showSubtitle(
        this.canRequestHelp(this.callbacks.getPlayerPosition())
          ? '面前车流疾驰，没有过街提示音……请点击「呼喊求助」或按 E 键向路人求助。'
          : '面前车流疾驰……请先沿路边找到斑马线前的圆点提示砖。',
        5200,
        '路口警示'
      );
    }
  }

  /**
   * Unified E-key / Contextual Button handler:
   * Handles Crosswalk Call For Help (Node 05) OR nearby optional urban micro-interaction!
   */
  public handleContextAction(): void {
    const action = this.getContextAction(this.callbacks.getPlayerPosition());
    if (action === 'help') {
      this.handleHelpPress();
    } else if (action) {
      this.completeMicroInteraction(action.id);
    }
  }

  private completeMicroInteraction(id: MicroInteraction['id']): void {
    if (!this.running || this.endingTriggered) return;
    const item = this.microInteractions.find((m) => m.id === id);
    if (!item || item.completed) return;

    item.completed = true;
    this.showContextPrompt(this.getContextAction(this.callbacks.getPlayerPosition()));
    const count = this.getMemoriesFound();
    this.a11yUI.setMemoryCount(count, this.microInteractions.length);
    this.soundEngine.playDiscoveryChime();

    if (id === 'bike_report') {
      this.echoManager.emitWave(
        new THREE.Vector3(WAYPOINTS.bikesCenter.x, 0.35, WAYPOINTS.bikesCenter.z),
        'amber',
        5.8,
        1.25,
        1.25
      );
      this.builtScene.spawnSparkles(
        new THREE.Vector3(WAYPOINTS.bikesCenter.x, 0.5, WAYPOINTS.bikesCenter.z),
        true
      );
      this.a11yUI.showSubtitle(
        `【听见的微光 ${count}/3】已记下违停占道点：“如果每个人停好车多看一眼脚下的黄砖，这一步就不用绕路了。”`,
        6800,
        '无障碍记录'
      );
    } else if (id === 'pet_cat') {
      this.builtScene.catPointLight.intensity = 2.4;
      this.echoManager.setCatGlow(1.45);
      this.soundEngine.playCatGreeting(-0.35);
      this.echoManager.emitWave(
        new THREE.Vector3(WAYPOINTS.catPos.x, 0.25, WAYPOINTS.catPos.z),
        'amber',
        6.2,
        1.35,
        1.3
      );
      this.builtScene.spawnSparkles(
        new THREE.Vector3(WAYPOINTS.catPos.x, 0.3, WAYPOINTS.catPos.z),
        true
      );
      this.a11yUI.showSubtitle(
        `【听见的微光 ${count}/3】温热的小猫蹭了蹭你的掌心——早点摊老板笑着说：“慢点走，前边路口快到了！”`,
        6800,
        '街角微光'
      );
    } else if (id === 'signal_pole') {
      this.echoManager.emitWave(
        new THREE.Vector3(WAYPOINTS.signalPolePos.x, 1.1, WAYPOINTS.signalPolePos.z),
        'cyan',
        5.5,
        1.2,
        1.2
      );
      this.a11yUI.showSubtitle(
        `【听见的微光 ${count}/3】摸遍了整根铁柱，却没找到盲人过街提示音装置——很多老旧路口依然需要靠呼喊求助。`,
        6800,
        '触觉记录'
      );
    }
  }

  private handleHelpPress(): void {
    if (this.helpCooldown > 0) return;

    this.helpPressCount += 1;
    this.helpCooldown = 1.35;
    this.showContextPrompt(this.helpPressCount < HELP_PROMPTS.length ? 'help' : null);

    if (this.helpPressCount === 1) {
      this.spawnTrafficBurst(1, 1.35);
      this.a11yUI.showSubtitle(
        '“请问有人在旁边吗——” 雨夜呼啸而过的车流淹没了声音，无人应答。',
        5200,
        '内心呼喊'
      );
    } else if (this.helpPressCount === 2) {
      this.spawnTrafficBurst(-1, 1.35);
      this.a11yUI.showSubtitle(
        '“能帮我看一下红绿灯吗？” 雨伞擦肩而过，四周依然一片喧嚣……再试一次吧。',
        5200,
        '内心呼喊'
      );
    } else {
      this.strangerArrived = true;
      this.escortPhase = 'approaching';
      this.escortHoldingBlend = 0;
      this.escortStridePhase = 0;
      this.soundEngine.playWarmStrangerChime();

      // Switch 3D pedestrian signal lamp from RED to EMERALD GREEN!
      this.builtScene.setPedestrianSignalGreen(true);

      // Spawn kind stranger nearby on your left-front so they walk right over to hold your hand!
      this.builtScene.pedestrianGroup.visible = true;
      this.builtScene.pedestrianGroup.position.set(-0.85, 0.08, -33.8);
      this.builtScene.pedestrianGroup.rotation.y = 0.25; // Facing back toward you as they walk up
      this.builtScene.pedestrianHaloLight.intensity = 3.8;
      this.builtScene.pedestrianHaloLight.position.set(-0.85, 1.85, -33.5);

      // Update beacons
      const trafficB = this.beacons.find((b) => b.id === 'crosswalk_traffic');
      if (trafficB) trafficB.active = false;
      const strangerB = this.beacons.find((b) => b.id === 'stranger_voice');
      if (strangerB) strangerB.active = true;

      this.echoManager.emitWave(new THREE.Vector3(-0.6, 0.15, -33.2), 'amber', 6.5, 1.4, 1.25);
      this.builtScene.spawnSparkles(new THREE.Vector3(-0.6, 0.2, -33.0), true);

      this.a11yUI.showSubtitle(
        '“别急，变绿灯了——来，拉着我的手，我扶你慢慢走过去！”',
        7800,
        '热心路人'
      );
    }
  }

  private triggerStallWarmth(): void {
    if (this.stallVisited) return;
    this.stallVisited = true;
    this.builtScene.catPointLight.intensity = 1.75;
    this.echoManager.setCatGlow(1.0);
    this.soundEngine.playCatGreeting(-0.5);
    this.echoManager.emitWave(
      new THREE.Vector3(WAYPOINTS.catPos.x, 0.12, WAYPOINTS.catPos.z),
      'amber',
      4.8,
      1.25
    );
    this.builtScene.spawnSparkles(
      new THREE.Vector3(WAYPOINTS.catPos.x, 0.15, WAYPOINTS.catPos.z),
      true
    );
    this.a11yUI.showSubtitle(
      '“小心脚下，刚下过雨路有点滑。” —— 街角早点摊飘来竹笼热气，脚边的小猫轻声回应。',
      6800,
      '早点摊老板'
    );
  }

  public spawnTrafficBurst(dir: 1 | -1, audioBoost = 1.0): void {
    const slot = this.builtScene.trafficStreaks.find((t) => t.direction === dir);
    if (slot) {
      slot.active = true;
      slot.group.visible = true;
      slot.group.position.x = dir === 1 ? -26 : 26;
      slot.speed = 23 + Math.random() * 4;
    }
    if (audioBoost > 0) {
      this.soundEngine.playTrafficWhoosh(dir, audioBoost);
    }
  }

  /**
   * Focus Listen (Shift / RMB): periodically emits subtle acoustic sonar rings from nearby active sound sources!
   */
  private updateFocusListenRadar(dt: number, playerPos: THREE.Vector3, isListening: boolean): void {
    if (!isListening) {
      this.listenPulseTimer = 0.25;
      return;
    }
    this.listenPulseTimer -= dt;
    if (this.listenPulseTimer <= 0) {
      this.listenPulseTimer = 1.15;
      this.soundEngine.playListenSonarPing();

      // Emit acoustic echoes from up to 2 nearest active sound beacons!
      const sorted = this.beacons
        .filter((b) => b.active)
        .map((b) => ({ b, dist: Math.hypot(b.x - playerPos.x, b.z - playerPos.z) }))
        .filter((x) => x.dist < x.b.radius * 1.65)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2);

      for (const item of sorted) {
        this.echoManager.emitWave(
          new THREE.Vector3(item.b.x, Math.min(0.65, item.b.y), item.b.z),
          item.b.color,
          4.2,
          0.95,
          1.15
        );
      }
    }
  }

  private canRequestHelp(playerPos: THREE.Vector3): boolean {
    return this.running && this.hasCane && !this.endingTriggered && !this.strangerArrived &&
      this.helpPressCount < HELP_PROMPTS.length &&
      Math.abs(playerPos.x) <= WAYPOINTS.crosswalkHalfWidth &&
      playerPos.z >= WAYPOINTS.crosswalkCurbZ && playerPos.z <= WAYPOINTS.crosswalkPromptZ;
  }

  private getContextAction(playerPos: THREE.Vector3): 'help' | MicroInteraction | null {
    if (this.canRequestHelp(playerPos)) return 'help';
    if (!this.running || !this.hasCane || this.endingTriggered || this.escortPhase !== 'none') {
      return null;
    }

    let nearest: MicroInteraction | null = null;
    let bestDist = Infinity;
    for (const item of this.microInteractions) {
      if (item.completed || !item.unlocked) continue;
      const distance = Math.hypot(playerPos.x - item.x, playerPos.z - item.z);
      if (distance < item.radius && distance < bestDist) {
        bestDist = distance;
        nearest = item;
      }
    }
    return nearest;
  }

  private showContextPrompt(action: 'help' | MicroInteraction | null): void {
    const hidden = action === null;
    const label = action === 'help' ? HELP_PROMPTS[this.helpPressCount] : action?.promptText ?? '';
    const braille = action === 'help' ? '⠠⠓⠑⠇⠏ · ⠟⠊⠥ 助' : action?.brailleHint ?? '';
    if (this.ctxWrap.hidden !== hidden) {
      this.ctxWrap.hidden = hidden;
      this.ctxBtn.disabled = hidden;
    }
    if (this.ctxLabel.textContent !== label) this.ctxLabel.textContent = label;
    if (this.ctxBraille.textContent !== braille) this.ctxBraille.textContent = braille;
  }

  public update(
    dt: number,
    totalElapsed: number,
    playerPos: THREE.Vector3,
    isListening: boolean,
    camera: THREE.PerspectiveCamera
  ): void {
    if (!this.running) return;

    if (!this.endingTriggered) {
      this.playElapsed += dt;
    }
    if (this.helpCooldown > 0) {
      this.helpCooldown = Math.max(0, this.helpCooldown - dt);
    }

    this.updateFocusListenRadar(dt, playerPos, isListening);
    this.showContextPrompt(this.getContextAction(playerPos));

    // --- NODE 01: Foyer Cane Pickup ---
    if (!this.hasCane) {
      this.echoManager.setCanePickupVisible(true, totalElapsed);
      this.foyerReminderTimer += dt;

      if (this.foyerReminderTimer > 8.0) {
        this.foyerReminderTimer = 0;
        const canePos = new THREE.Vector3(WAYPOINTS.canePickupPos.x, 0.25, WAYPOINTS.canePickupPos.z);
        this.echoManager.emitWave(canePos, 'cyan', 3.0, 1.1);
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
        const caneB = this.beacons.find((b) => b.id === 'cane_beacon');
        if (caneB) caneB.active = false;
        const doorB = this.beacons.find((b) => b.id === 'door_breeze');
        if (doorB) doorB.active = true;

        this.soundEngine.playCaneTap('cane_pickup', 0.35, true);
        this.echoManager.emitWave(
          new THREE.Vector3(WAYPOINTS.canePickupPos.x, 0.12, WAYPOINTS.canePickupPos.z),
          'amber',
          5.2,
          1.2
        );
        this.callbacks.onEquipCane();
        this.a11yUI.showSubtitle(
          '摸到了导盲杖！点击左键或按空格手动「左敲一下、右敲一下」探路，长按可蓄力远距声波。',
          7400,
          '盲杖已拾取'
        );
      } else if (playerPos.z < -4.25) {
        this.foyerReminderTimer = 7.5;
        this.a11yUI.showSubtitle(
          '还没拿到导盲杖，先退后半步在右侧墙边摸索一下吧。',
          4500,
          '内心感知'
        );
      }
      return;
    }

    // --- NODE 02: Push Open Foyer Door & Step onto Tactile Guiding Bricks ---
    if (!this.doorOpened && playerPos.z <= -3.75) {
      this.doorOpened = true;
      const doorCol = this.colliders.find((c) => c.id === 'foyer_security_door');
      if (doorCol) doorCol.enabled = false;
      const doorB = this.beacons.find((b) => b.id === 'door_breeze');
      if (doorB) doorB.active = false;

      this.builtScene.doorSliverMesh.visible = false;
      this.builtScene.doorShaftMesh.visible = false;
      this.builtScene.doorCrackLight.intensity = 0.35;
      this.soundEngine.playDoorOpen();
      this.callbacks.onCollidersUpdated();
      this.a11yUI.showSubtitle(
        '推开门步入漆黑细雨夜，手动左右敲击导盲杖，寻找脚下的黄色盲道砖吧。',
        5800,
        '街头雨夜'
      );
    }

    if (!this.steppedOnTactile && playerPos.z <= -6.2 && Math.abs(playerPos.x) < 0.78) {
      this.steppedOnTactile = true;
      this.a11yUI.showSubtitle(
        '鞋底感受到了凸起的条形引导砖！手动左右交替敲杖，循着清脆回响与琥珀微光前行。',
        5800,
        '触觉反馈'
      );
    }

    // --- NODE 04: Street-Corner Warm Breakfast Stall & Cat ---
    if (!this.stallVisited && playerPos.z <= -23.2 && playerPos.z >= -26.8) {
      const distToCat = Math.hypot(
        playerPos.x - WAYPOINTS.catPos.x,
        playerPos.z - WAYPOINTS.catPos.z
      );
      if (distToCat < 3.4) {
        this.triggerStallWarmth();
      }
    }

    // --- Periodic Binaural Crosswalk Traffic ---
    if (playerPos.z <= -26.5 && !this.strangerArrived) {
      this.trafficTimer -= dt;
      if (this.trafficTimer <= 0) {
        const proximityBoost = playerPos.z <= -30.5 ? 1.15 : 0.65;
        this.spawnTrafficBurst(this.nextTrafficDir, proximityBoost);
        this.nextTrafficDir = this.nextTrafficDir === 1 ? -1 : 1;
        this.trafficTimer = playerPos.z <= -30.5 ? 2.15 : 3.1;
      }
    }

    // --- NODE 05: Silent Crosswalk Warning Bricks ---
    if (!this.crosswalkEntered && this.canRequestHelp(playerPos)) {
      this.crosswalkEntered = true;
      this.a11yUI.setActHeader(2);
      this.a11yUI.showLocationCard('中山路口 · 无声斑马线 · 19:45', '第二幕 · 听声辨位与善意微光');
      this.spawnTrafficBurst(1, 1.2);

      this.a11yUI.showSubtitle(
        '脚下变成密集的圆点提示砖！前方是没有过街提示音的斑马线，车流湍急，请按 E 或点击「呼喊求助」。',
        8500,
        '路口警示'
      );
    }

    // --- HAND-IN-HAND SIGHTED GUIDE ESCORT ANIMATION (Approaching -> Holding Hands -> Safe Curb!) ---
    if (this.escortPhase !== 'none') {
      const ped = this.builtScene.pedestrianGroup;
      const halo = this.builtScene.pedestrianHaloLight;
      const rig = this.builtScene.escortRig;
      let strideAmp = 0;

      if (this.escortPhase === 'approaching') {
        const meetX = playerPos.x - 0.56;
        const meetZ = playerPos.z - 0.8;
        const dx = meetX - ped.position.x;
        const dz = meetZ - ped.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.14) {
          const stepSpeed = Math.min(dist, 1.65 * dt);
          ped.position.x += (dx / dist) * stepSpeed;
          ped.position.z += (dz / dist) * stepSpeed;
          this.escortStridePhase += dt * 7.2;
          strideAmp = 1.0;

          this.escortStepTimer += dt;
          if (this.escortStepTimer > 0.42) {
            this.escortStepTimer = 0;
            this.soundEngine.playCompanionFootstep();
          }
        } else {
          // Arrived right beside your left shoulder -> clasp hands & lift crosswalk airwall!
          this.escortPhase = 'holding_hands';
          this.lastEscortZ = playerPos.z;
          const airwall = this.colliders.find((c) => c.id === 'crosswalk_airwall');
          if (airwall) airwall.enabled = false;
          this.callbacks.onCollidersUpdated();
          this.callbacks.onEscortAssistChange(true);

          this.a11yUI.showSubtitle(
            '温暖的手稳稳握住了你的左手——跟着身旁人的脚步，一起穿过斑马线吧。',
            7200,
            '并肩同行'
          );
        }
      } else if (this.escortPhase === 'holding_hands') {
        // Smoothly reach out & clasp hands!
        this.escortHoldingBlend = Math.min(1.0, this.escortHoldingBlend + dt * 2.2);

        // Stranger walks half a step ahead on your left (authentic sighted-guide position!)
        const targetX = playerPos.x - 0.54;
        const targetZ = playerPos.z - 0.78;
        const targetY = playerPos.z < -32.4 && playerPos.z > -42.2 ? 0.02 : 0.08;
        ped.position.x += (targetX - ped.position.x) * Math.min(1, dt * 7.5);
        ped.position.z += (targetZ - ped.position.z) * Math.min(1, dt * 7.5);
        ped.position.y += (targetY - ped.position.y) * Math.min(1, dt * 6.0);

        // Smoothly turn to face forward (-Z, i.e., rotation.y = Math.PI) alongside you
        const targetYaw = Math.PI - 0.14;
        ped.rotation.y += (targetYaw - ped.rotation.y) * Math.min(1, dt * 4.5);

        // Synchronize walking stride & left-ear companion footsteps with actual forward progress
        const forwardDelta = Math.abs(playerPos.z - this.lastEscortZ);
        this.lastEscortZ = playerPos.z;
        const speedNorm = Math.min(1.2, forwardDelta / Math.max(0.001, dt));
        strideAmp = Math.min(1.0, speedNorm * 1.15);
        this.escortStridePhase += forwardDelta * 4.8;

        if (speedNorm > 0.2) {
          this.escortStepTimer += forwardDelta;
          if (this.escortStepTimer >= 0.44) {
            this.escortStepTimer = 0;
            this.soundEngine.playCompanionFootstep();
          }
        }

        // Gradual golden warmth begins illuminating the wet zebra stripes while crossing together!
        const crossT = THREE.MathUtils.clamp((-32.0 - playerPos.z) / 11.0, 0, 1);
        const preludeSunset = crossT * 0.38;
        if (preludeSunset > this.sunsetProgress) {
          this.sunsetProgress = preludeSunset;
          this.echoManager.setSunsetFactor(preludeSunset * 0.85);
          this.builtScene.sunsetDirLight.intensity = 0.25 + preludeSunset * 2.2;
        }

        // Soft golden ripple every ~2s at your joined feet
        this.escortRippleTimer -= dt;
        if (this.escortRippleTimer <= 0) {
          this.escortRippleTimer = 1.9;
          this.echoManager.emitWave(
            new THREE.Vector3(ped.position.x + 0.25, 0.08, ped.position.z),
            'amber',
            4.8,
            1.15,
            1.05
          );
          this.builtScene.spawnSparkles(
            new THREE.Vector3(ped.position.x + 0.25, 0.15, ped.position.z),
            true
          );
        }
      } else if (this.escortPhase === 'arrived') {
        // Safely across! Gently release hands, step onto opposite curb, turn around in golden sunset backlight!
        this.escortHoldingBlend = Math.max(0.0, this.escortHoldingBlend - dt * 1.8);
        const restX = -0.35;
        const restZ = -44.6;
        ped.position.x += (restX - ped.position.x) * Math.min(1, dt * 2.2);
        ped.position.z += (restZ - ped.position.z) * Math.min(1, dt * 2.2);
        ped.position.y += (0.08 - ped.position.y) * Math.min(1, dt * 4.0);
        // Turn back toward player (+Z, rotation.y = 0) to say goodbye in sunset silhouette
        ped.rotation.y += (0.0 - ped.rotation.y) * Math.min(1, dt * 2.8);
        const rem = Math.hypot(restX - ped.position.x, restZ - ped.position.z);
        strideAmp = Math.min(1, rem * 1.5);
        this.escortStridePhase += dt * 4.0 * strideAmp;
      }

      halo.position.set(ped.position.x, 1.8, ped.position.z - 0.15);
      rig.updateHandClasp(dt, this.escortHoldingBlend, this.escortStridePhase, strideAmp, camera);
    }

    // --- NODE 06: Golden After-Rain Sunset Finale (Z <= -43.0, 2.5s Transition) ---
    if (!this.endingTriggered && playerPos.z <= WAYPOINTS.sunsetFinishZ) {
      this.endingTriggered = true;
      this.showContextPrompt(null);
      this.escortPhase = 'arrived';
      this.callbacks.onEscortAssistChange(false);
      this.soundEngine.playWarmStrangerChime();
      this.a11yUI.showSubtitle(
        '“到对面安全区了，慢点走呀。” —— 雨霁初晴，夕阳洒满湿润的十字路口。',
        9500,
        '热心路人'
      );
    }

    if (this.endingTriggered && this.sunsetProgress < 1.0) {
      this.sunsetProgress = Math.min(1.0, this.sunsetProgress + dt / 2.5);
      const ease = this.sunsetProgress * this.sunsetProgress * (3 - 2 * this.sunsetProgress);
      this.echoManager.setSunsetFactor(ease);
      this.builtScene.sunsetDirLight.intensity = 0.25 + ease * 3.45;
      this.builtScene.ambientHemiLight.intensity = 0.85 + ease * 0.65;

      if (this.sunsetProgress >= 1.0 && !this.endingModalShown) {
        this.endingModalShown = true;
        window.setTimeout(() => {
          this.callbacks.onReachEnding(
            Math.max(1, Math.round(this.playElapsed)),
            this.obstacleBumps,
            this.getMemoriesFound(),
            this.microInteractions.length
          );
        }, 700);
      }
    }
  }
}
