import * as THREE from 'three';
import {
  AcousticBeacon,
  ColliderBox,
  createInitialBeacons,
  createInitialMicroInteractions,
  MicroInteraction,
  STREET, groundFeature, isNearPuddle, isOnTactilePath, streetX, streetZ, SurfaceTag,
  WAYPOINTS,
} from '../level/levelData';
import { BuiltSceneResult } from '../level/buildScene';
import { EchoShaderManager } from '../shaders/echoMaterial';
import { SpatialSoundEngine } from '../audio/soundEngine';
import { AccessibilityUI } from '../ui/accessibilityUI';

export interface StoryCallbacks {
  getPlayerPosition: () => THREE.Vector3;
  isTouchMode: () => boolean;
  onEquipCane: () => void;
  onCollidersUpdated: () => void;
  onImpactPulse: () => void;
  onEscortAssistChange: (active: boolean) => void;
  onChapter: (chapter: number) => void;
  onReachEnding: (seconds: number, bumps: number) => void;
}

type ContextAction = 'help' | 'board' | 'pickup' | 'door' | MicroInteraction | null;
const TOUCH_VERBS: Record<MicroInteraction['id'], string> = {
  bike_report: '标记',
  pet_cat: '抚摸',
  signal_pole: '触摸',
};

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
  private lastEscortZ = streetZ(-43.8);

  private steppedOnTactile = false;
  private turn1HintShown = false;
  private bikeHintShown = false;
  private barrierHintShown = false;
  private stallVisited = false;
  private catGreeted = false;
  private crosswalkEntered = false;
  private endingModalShown = false;
  private foyerReminderTimer = 0;
  private listenPulseTimer = 0;

  private trafficTimer = 0.8;
  private nextTrafficDir: 1 | -1 = 1;
  private helpReadyAt = 0;
  private puddleNearby = false;
  private puddleProbeUntil = 0;
  private escortRippleTimer = 0;

  private playElapsed = 0;
  private running = false;
  private tmpVec = new THREE.Vector3();
  private targetCatLightIntensity = 0;
  private targetPedHaloIntensity = 0;
  private targetDoorCrackIntensity = 1.4;
  private targetSunsetLightIntensity = 0.0;

  public chapterOpen = false;
  private chapter = 0;
  private bus: 'away' | 'passing' | 'waiting' | 'boarding' | 'ridden' = 'away';
  private busDeadline = 0;
  private finishDeadline = 0;
  private manholeFound = false;
  private bikesPassed = false;
  private gapPassed = false;
  private railFound = false;
  private ground: ReturnType<typeof groundFeature> = null;
  private hint = document.getElementById('scene-hint')!;
  private hintText = document.getElementById('scene-hint-text')!;

  private setHint(text: string): void {
    if (text && this.hintText.textContent !== text) this.hintText.textContent = text;
    const visible = Boolean(text);
    if (visible !== this.hint.classList.contains('on')) {
      this.hint.classList.toggle('on', visible);
      this.hint.setAttribute('aria-hidden', String(!visible));
    }
  }

  private startChapter(number: number): void {
    this.chapter = number;
    this.chapterOpen = true;
    this.setHint('');
    this.showContextPrompt(null);
    this.callbacks.onChapter(number);
  }

  public get hasRiddenBus(): boolean { return this.bus === 'ridden'; }

  public finishChapter(): void {
    if (!this.chapterOpen) return;
    this.chapterOpen = false;
    this.a11yUI.setActHeader(this.chapter + 1);
    if (this.chapter === 3) {
      this.bus = 'ridden';
      this.builtScene.busVehicle.visible = false;
      this.colliders.find(c => c.id === 'boarding_boundary')!.enabled = false;
      this.callbacks.getPlayerPosition().set(WAYPOINTS.crosswalkCenterX, 1.6, STREET.stop.minZ - 0.9);
      this.callbacks.onCollidersUpdated();
    }
  }

  public showSunsetBus(): void {
    this.builtScene.setBusRoute(7);
    this.builtScene.busVehicle.position.set(STREET.busLane.x, 0, STREET.busLane.stopZ);
    this.builtScene.busVehicle.visible = true;
  }

  private inStop(x: number, z: number): boolean {
    const stop = STREET.stop;
    return x >= stop.minX && x <= stop.maxX && z >= stop.minZ && z <= stop.maxZ;
  }

  private updateBus(x: number, z: number): void {
    if (this.chapter !== 2 || this.bus === 'ridden') return;
    const vehicle = this.builtScene.busVehicle;
    if (!this.inStop(x, z)) {
      this.bus = 'away';
      vehicle.visible = false;
      return;
    }
    const now = performance.now();
    const stopZ = STREET.busLane.stopZ;
    if (this.bus === 'away') {
      this.bus = 'passing';
      this.busDeadline = now + 2700;
      this.announceBus(12);
    }
    if (this.bus === 'passing') {
      vehicle.visible = true;
      vehicle.position.z = stopZ + 14 - (this.busDeadline - now) / 2700 * 23;
      if (now < this.busDeadline) return;
      vehicle.visible = false;
      this.bus = 'waiting';
      this.busDeadline = now + 2600;
      this.a11yUI.showSubtitle('不是这班车……再仔细听下一辆', 2100);
    } else if (this.bus === 'boarding') {
      if (now < this.busDeadline) return;
      this.bus = 'waiting';
      this.busDeadline = now + 6000;
      this.a11yUI.showSubtitle('这班车已驶离，下一班 7 路即将到站。', 3400);
    }
    if (this.bus === 'waiting') {
      const remaining = this.busDeadline - now;
      // Depart the kerb, then bring the same pooled vehicle back for the next service.
      if (remaining > 4400) {
        vehicle.visible = true;
        vehicle.position.z = stopZ + 14 * (6000 - remaining) / 1600;
      } else if (remaining > 1450) {
        vehicle.visible = false;
      } else {
        if (!vehicle.visible) {
          this.builtScene.setBusRoute(7);
          this.soundEngine.playBusArrival(7);
        }
        vehicle.visible = true;
        vehicle.position.z = stopZ - 9 * Math.max(0, remaining / 1450) ** 2;
        if (remaining <= 0) {
          this.bus = 'boarding';
          this.busDeadline = now + 6000;
          this.announceBus(7);
        }
      }
    }
  }

  private announceBus(route: 7 | 12): void {
    this.builtScene.setBusRoute(route);
    const text = route === 12 ? '12路开往火车站' : '7路开往老街路口';
    if (route === 12) this.soundEngine.playBusArrival(route);
    this.a11yUI.showSubtitle(text, route === 7 ? 5500 : 2600, '公交报站', this.soundEngine.getMuted() ? 'silent' : 'always');
  }

  public onGroundStep(feature: 'manhole' | 'puddle', point: THREE.Vector3): void {
    this.ground = feature;
    if (feature === 'manhole') {
      this.soundEngine.playCaneTap('manhole', 0, false);
      this.discoverManhole();
    } else {
      this.soundEngine.playSplashStep();
      this.echoManager.emitPuddleRipple(point.x, point.z);
    }
  }

  private updateStreet(player: THREE.Vector3): void {
    const { x, z } = player;
    const ground = groundFeature(x, z);
    if (ground !== this.ground) {
      if (ground) this.onGroundStep(ground, player);
      else this.ground = null;
    }
    const nearPuddle = isNearPuddle(x, z, 0.85);
    if (nearPuddle && !this.puddleNearby && ground !== 'puddle') this.soundEngine.playCaneTap('puddle', 0, false);
    this.puddleNearby = nearPuddle;
    if (z < STREET.puddle.z - STREET.puddle.rz) this.puddleProbeUntil = 0;
    if (x > 5.8 && Math.abs(z + 15.6) < 0.52) this.bikesPassed = true;
    const reconnect = x > streetX(12) && z <= STREET.gapEndZ && z >= STREET.puddle.z + STREET.puddle.rz + 0.85;
    if (!this.gapPassed && reconnect && isOnTactilePath(x, z)) {
      this.gapPassed = true;
      this.a11yUI.showSubtitle('脚下重新出现了条状盲道砖。沿着它往前，留意脚下的积水。', 4200, '触觉反馈');
    }
    this.updateBus(x, z);
    let hint = '';
    if (!this.hasCane && Math.abs(x) <= 2 && z > -5.5) hint = '向右侧墙边摸索导盲杖。';
    else if (this.canRequestHelp(player)) hint = this.callbacks.isTouchMode() ?
      '点按「求助」，等待路人引导过街。' : '按 E 呼喊求助，等待路人引导过街。';
    else if (this.chapter === 2 && this.inStop(x, z)) hint = this.callbacks.isTouchMode() ?
      '听清 7 路车报站声，点按「上车」。' : '听清 7 路车报站声，按 E 招手上车。';
    else if (nearPuddle || performance.now() < this.puddleProbeUntil)
      hint = '前方盲道有积水，试探边缘绕行。';
    else if (!this.gapPassed && this.chapter === 1 && x > streetX(12) && z <= STREET.gapEndZ)
      hint = '请沿护栏末端重新踩回黄色盲道。';
    else if (!this.manholeFound && Math.hypot(x - STREET.manhole.x, z - STREET.manhole.z) < 1.65)
      hint = '脚下是嵌入盲道的金属井盖，小心试探边缘。';
    else if (!this.bikesPassed && Math.abs(x - 4.8) < 2.8 && Math.abs(z + 15.6) < 2.5)
      hint = '避开盲道上的单车，绕行后找回盲道。';
    else if (!this.gapPassed && x > streetX(7.65) && x < streetX(15.8) && z < -13.3 && z > -19.35)
      hint = '沿着左侧栏杆绕过施工区。';
    this.setHint(hint);
  }

  private discoverManhole(): void {
    if (this.manholeFound || this.endingTriggered) return;
    this.manholeFound = true;
    this.setHint('');
    this.a11yUI.showSubtitle('盲道被一块冰凉的铁井盖切开了一半', 4800, '触觉反馈',
      this.soundEngine.getMuted() ? 'silent' : 'always');
  }

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
  private touchContext = document.getElementById('btn-touch-context') as HTMLButtonElement;

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

    this.ctxBtn.addEventListener('click', () => this.handleContextAction());
    this.touchContext.addEventListener('click', () => this.handleContextAction());
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
    this.chapter = 0;
    this.chapterOpen = false;
    this.bus = 'away';
    this.busDeadline = this.finishDeadline = 0;
    this.builtScene.busVehicle.visible = false;
    this.builtScene.resetCat();
    this.catGreeted = false;
    this.manholeFound = this.gapPassed = this.bikesPassed = this.railFound = false;
    this.ground = null;
    this.setHint('');
    this.colliders.find(c => c.id === 'boarding_boundary')!.enabled = true;
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
    this.turn1HintShown = false;
    this.bikeHintShown = false;
    this.barrierHintShown = false;
    this.stallVisited = false;
    this.crosswalkEntered = false;
    this.foyerReminderTimer = 0;
    this.playElapsed = 0;
    this.helpReadyAt = this.puddleProbeUntil = 0;
    this.puddleNearby = false;

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
    this.builtScene.sunsetDirLight.intensity = 0.0;
    this.targetCatLightIntensity = 0;
    this.targetPedHaloIntensity = 0;
    this.targetDoorCrackIntensity = 1.4;
    this.targetSunsetLightIntensity = 0.0;
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
    if (this.chapterOpen || this.endingTriggered) return;
    if (tag === 'manhole') this.discoverManhole();
    if (tag === 'puddle') {
      this.echoManager.emitPuddleRipple(point.x, point.z);
      this.puddleProbeUntil = performance.now() + 2800;
      this.setHint('前方盲道有积水，试探边缘绕行。');
    }
    if (tag === 'guardrail' && !this.railFound && !this.gapPassed) {
      this.railFound = true;
      this.a11yUI.showSubtitle('左手边是连续的金属栏杆。随它向左转，在尽头向右探两步，就能找回盲道。', 6300, '触觉反馈');
    }
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
    } else if ((tag === 'cat' || tag === 'stall') && !this.stallVisited && point.x > streetX(9.5) && point.z < streetZ(-20.5)) {
      this.triggerStallWarmth();
    } else if (tag === 'signal_pole' && this.hasRiddenBus) {
      this.completeMicroInteraction('signal_pole');
    }
  }

  public onAirwallBlocked(): void {
    if (!this.strangerArrived && performance.now() >= this.helpReadyAt) {
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
    if (action === 'pickup') {
      this.pickUpCane();
      this.showContextPrompt(null);
    } else if (action === 'door') {
      this.openFoyerDoor();
      this.showContextPrompt(null);
    } else if (action === 'board') {
      this.startChapter(3);
    } else if (action === 'help') {
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
      this.builtScene.petCat();
      this.targetCatLightIntensity = 2.4;
      this.echoManager.setCatGlow(1.45);
      this.soundEngine.playCatGreeting(-0.35);
      this.tmpVec.set(WAYPOINTS.catPos.x, 0.25, WAYPOINTS.catPos.z);
      this.echoManager.emitWave(this.tmpVec, 'amber', 4.8, 1.25, 1.15);
      this.tmpVec.set(WAYPOINTS.catPos.x, 0.3, WAYPOINTS.catPos.z);
      this.builtScene.spawnSparkles(this.tmpVec, true);
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
    if (performance.now() < this.helpReadyAt) return;

    this.helpPressCount += 1;
    this.helpReadyAt = performance.now() + 2400;
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
      this.setHint('');
      this.escortPhase = 'approaching';
      this.escortHoldingBlend = 0;
      this.escortStridePhase = 0;
      this.soundEngine.playWarmStrangerChime();

      // Switch 3D pedestrian signal lamp from RED to EMERALD GREEN!
      this.builtScene.setPedestrianSignalGreen(true);

      // Spawn warm backlit silhouette escort ahead-right (~1.8m away so never blocking camera!)
      this.builtScene.pedestrianGroup.visible = true;
      this.builtScene.pedestrianGroup.position.set(WAYPOINTS.crosswalkCenterX + 0.72, 0.08, streetZ(-43.1));
      this.builtScene.pedestrianGroup.rotation.y = -0.22;
      this.targetPedHaloIntensity = 2.8;
      this.builtScene.pedestrianHaloLight.position.set(
        WAYPOINTS.crosswalkCenterX + 0.72,
        1.85,
        streetZ(-43.1)
      );

      // Update beacons
      const trafficB = this.beacons.find((b) => b.id === 'crosswalk_traffic');
      if (trafficB) trafficB.active = false;
      const strangerB = this.beacons.find((b) => b.id === 'stranger_voice');
      if (strangerB) strangerB.active = true;

      this.tmpVec.set(WAYPOINTS.crosswalkCenterX + 0.5, 0.15, streetZ(-42.8));
      this.echoManager.emitWave(this.tmpVec, 'amber', 4.6, 1.25, 1.0);
      this.tmpVec.set(WAYPOINTS.crosswalkCenterX + 0.5, 0.2, streetZ(-42.6));
      this.builtScene.spawnSparkles(this.tmpVec, true);

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
    this.targetCatLightIntensity = Math.max(this.targetCatLightIntensity, 1.75);
    this.echoManager.setCatGlow(1.0);

    this.tmpVec.set(WAYPOINTS.catPos.x, 0.12, WAYPOINTS.catPos.z);
    this.echoManager.emitWave(this.tmpVec, 'amber', 4.6, 1.2);
    this.tmpVec.set(WAYPOINTS.catPos.x, 0.15, WAYPOINTS.catPos.z);
    this.builtScene.spawnSparkles(this.tmpVec, true);
    this.a11yUI.showSubtitle(
      '“小心脚下，刚下过雨路有点滑。” —— 街角早点摊飘来竹笼热气，脚边的小猫轻声回应。',
      6800,
      '早点摊老板'
    );
  }

  public spawnTrafficBurst(dir: 1 | -1, audioBoost = 1.0): void {
    const slot = this.builtScene.trafficStreaks.find((t) => t.direction === dir);
    if (slot && !slot.active) {
      slot.active = true;
      slot.group.visible = true;
      slot.group.position.set(slot.spawnX, 0, slot.laneZ);
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
        this.tmpVec.set(item.b.x, Math.min(0.65, item.b.y), item.b.z);
        this.echoManager.emitWave(this.tmpVec, item.b.color, 4.2, 0.95, 1.0);
      }
    }
  }

  private canRequestHelp(playerPos: THREE.Vector3): boolean {
    return this.bus === 'ridden' && this.running && this.hasCane && !this.endingTriggered && !this.strangerArrived &&
      this.helpPressCount < HELP_PROMPTS.length &&
      Math.abs(playerPos.x - WAYPOINTS.crosswalkCenterX) <= WAYPOINTS.crosswalkHalfWidth &&
      playerPos.z >= WAYPOINTS.crosswalkCurbZ && playerPos.z <= WAYPOINTS.crosswalkPromptZ;
  }

  private getContextAction(playerPos: THREE.Vector3): ContextAction {
    if (this.chapterOpen || !this.running || this.endingTriggered) return null;
    if (this.callbacks.isTouchMode()) {
      if (!this.hasCane) return this.canPickUpCane(playerPos) ? 'pickup' : null;
      if (!this.doorOpened && playerPos.z <= -3.75 && Math.abs(playerPos.x) < 1.65) return 'door';
    }
    if (this.chapter === 2 && this.inStop(playerPos.x, playerPos.z)) {
      return this.bus === 'boarding' && performance.now() < this.busDeadline ? 'board' : null;
    }
    if (this.canRequestHelp(playerPos)) return 'help';
    if (!this.running || !this.hasCane || this.endingTriggered || this.escortPhase !== 'none') {
      return null;
    }

    let nearest: MicroInteraction | null = null;
    let bestDist = Infinity;
    for (const item of this.microInteractions) {
      if (item.completed || !item.unlocked || (item.id === 'signal_pole' && !this.hasRiddenBus)) continue;
      const distance = Math.hypot(playerPos.x - item.x, playerPos.z - item.z);
      if (distance < item.radius && distance < bestDist) {
        bestDist = distance;
        nearest = item;
      }
    }
    return nearest;
  }

  private showContextPrompt(action: ContextAction): void {
    const hidden = action === null;
    const waiting = action === 'help' && performance.now() < this.helpReadyAt;
    const rawLabel = waiting ? '请稍候，听听车声…' : action === 'help' ? HELP_PROMPTS[this.helpPressCount] : action === 'board' ? '招手上车' : action === 'pickup' ? '拾取导盲杖' : action === 'door' ? '推开门' : action?.promptText ?? '';
    // Strip inline "[E]" since the frameless prompt renders a crisp left [E] micro-keycap
    const label = rawLabel.replace(/\s*\[E\]/g, '').trim();
    const braille = action === 'help' ? '⠠⠓⠑⠇⠏ · ⠟⠊⠥ 助' : action === 'board' ? '7 路' : typeof action === 'object' ? action?.brailleHint ?? '' : '';
    const touchVerb = action === 'help' ? (waiting ? '稍候' : '求助') :
      action === 'board' ? '上车' : action === 'pickup' ? '拾取' : action === 'door' ? '推门' :
        action ? TOUCH_VERBS[action.id] : '';
    const touchVisible = !hidden && this.callbacks.isTouchMode();
    if (this.touchContext.classList.contains('on') !== touchVisible) {
      this.touchContext.classList.toggle('on', touchVisible);
      this.touchContext.setAttribute('aria-hidden', String(!touchVisible));
    }
    if (this.touchContext.disabled !== (!touchVisible || waiting)) this.touchContext.disabled = !touchVisible || waiting;
    if (this.touchContext.textContent !== touchVerb) this.touchContext.textContent = touchVerb;
    if (this.ctxWrap.hidden !== hidden) {
      this.ctxWrap.hidden = hidden;
    }
    if (this.ctxBtn.disabled !== (hidden || waiting)) this.ctxBtn.disabled = hidden || waiting;
    if (this.ctxLabel.textContent !== label) this.ctxLabel.textContent = label;
    if (this.ctxBraille.textContent !== braille) this.ctxBraille.textContent = braille;
  }

  private canPickUpCane(player: THREE.Vector3): boolean {
    return Math.hypot(player.x - WAYPOINTS.canePickupPos.x, player.z - WAYPOINTS.canePickupPos.z) < 1.55;
  }

  private pickUpCane(): void {
    this.hasCane = true;
    this.setHint('');
    this.builtScene.canePickupGroup.visible = false;
    this.echoManager.setCanePickupVisible(false, 0);
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
      this.callbacks.isTouchMode() ? '摸到了导盲杖！点按右下角敲杖探路，长按再松开可远探。' :
        '摸到了导盲杖！点击左键或按空格手动「左敲一下、右敲一下」探路，长按可蓄力远距声波。',
      7400,
      '盲杖已拾取'
    );
  }

  private openFoyerDoor(): void {
    this.doorOpened = true;
    const doorCol = this.colliders.find((c) => c.id === 'foyer_security_door');
    if (doorCol) doorCol.enabled = false;
    const doorB = this.beacons.find((b) => b.id === 'door_breeze');
    if (doorB) doorB.active = false;

    this.builtScene.doorSliverMesh.visible = false;
    this.builtScene.doorShaftMesh.visible = false;
    this.targetDoorCrackIntensity = 0.35;
    this.soundEngine.playDoorOpen();
    this.callbacks.onCollidersUpdated();
    this.a11yUI.showSubtitle(
      '推开门步入漆黑细雨夜，手动左右敲击导盲杖，寻找脚下的黄色盲道砖吧。',
      5800,
      '街头雨夜'
    );
  }

  public update(
    dt: number,
    totalElapsed: number,
    playerPos: THREE.Vector3,
    isListening: boolean,
    camera: THREE.PerspectiveCamera
  ): void {
    if (!this.running || this.chapterOpen) return;

    if (!this.endingTriggered) {
      this.playElapsed += dt;
    }

    // Smoothly interpolate permanent scene lights (zero runtime light add/remove!)
    const lightLerp = Math.min(1, dt * 4.5);
    this.builtScene.catPointLight.intensity +=
      (this.targetCatLightIntensity - this.builtScene.catPointLight.intensity) * lightLerp;
    this.builtScene.pedestrianHaloLight.intensity +=
      (this.targetPedHaloIntensity - this.builtScene.pedestrianHaloLight.intensity) * lightLerp;
    this.builtScene.doorCrackLight.intensity +=
      (this.targetDoorCrackIntensity - this.builtScene.doorCrackLight.intensity) * lightLerp;
    this.builtScene.sunsetDirLight.intensity +=
      (this.targetSunsetLightIntensity - this.builtScene.sunsetDirLight.intensity) * lightLerp;

    if (!this.endingTriggered && !this.strangerArrived) this.updateStreet(playerPos);
    else this.setHint('');
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

      if (!this.callbacks.isTouchMode() && this.canPickUpCane(playerPos)) {
        this.pickUpCane();
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
    if (!this.callbacks.isTouchMode() && !this.doorOpened && playerPos.z <= -3.75) this.openFoyerDoor();

    if (!this.steppedOnTactile && playerPos.z <= -6.2) {
      this.steppedOnTactile = true;
      this.startChapter(1);
      return;
    }

    // Z-Turn Corner #1 tactile dot cue (Turn 90° Right -> +X)
    if (!this.turn1HintShown) {
      const distT1 = Math.hypot(
        playerPos.x - WAYPOINTS.turn1Pos.x,
        playerPos.z - WAYPOINTS.turn1Pos.z
      );
      if (distT1 < 1.35) {
        this.turn1HintShown = true;
        const turnB = this.beacons.find((b) => b.id === 'turn1_corner');
        if (turnB) turnB.active = false;
        this.tmpVec.set(WAYPOINTS.turn1Pos.x, 0.12, WAYPOINTS.turn1Pos.z);
        this.echoManager.emitWave(this.tmpVec, 'amber', 4.4, 1.15, 0.95);
        this.a11yUI.showSubtitle(
          '脚下变成了凸起的圆点转向砖——盲道在这里向右转弯，顺着新方向敲杖探路吧。',
          6200,
          '触觉转向'
        );
      }
    }

    // --- NODE 04: Street-Corner Warm Breakfast Stall & Cat ---
    if (!this.catGreeted && Math.hypot(playerPos.x - WAYPOINTS.catPos.x, playerPos.z - WAYPOINTS.catPos.z) <= 3.5) {
      this.catGreeted = true;
      this.soundEngine.playCatGreeting(-0.5);
      this.triggerStallWarmth();
    }

    if (this.chapter === 1 && this.gapPassed) {
      this.startChapter(2);
      return;
    }

    // --- Periodic Binaural Crosswalk Traffic ---
    if (this.bus === 'ridden' && playerPos.x > streetX(10) && playerPos.z <= WAYPOINTS.crosswalkPromptZ + 5 && !this.strangerArrived) {
      this.trafficTimer -= dt;
      if (this.trafficTimer <= 0) {
        const proximityBoost = playerPos.z <= WAYPOINTS.crosswalkPromptZ + 0.85 ? 1.15 : 0.65;
        this.spawnTrafficBurst(this.nextTrafficDir, proximityBoost);
        this.nextTrafficDir = this.nextTrafficDir === 1 ? -1 : 1;
        this.trafficTimer = playerPos.z <= WAYPOINTS.crosswalkPromptZ + 0.85 ? 2.15 : 3.1;
      }
    }

    // --- NODE 05: Silent Crosswalk Warning Bricks ---
    if (!this.crosswalkEntered && this.canRequestHelp(playerPos)) {
      this.crosswalkEntered = true;
      this.a11yUI.setActHeader(4);
      this.a11yUI.showLocationCard('中山路口 · 无声斑马线 · 19:45', '第四幕 · 听声辨位与善意微光');
      this.spawnTrafficBurst(1, 1.2);

      this.a11yUI.showSubtitle(
        this.callbacks.isTouchMode() ?
          '脚下变成密集的圆点提示砖！前方是没有过街提示音的斑马线，请点按右下方「求助」。' :
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
        // Position warm backlit silhouette 1.5m ahead-right of player (clear, respectful sightline!)
        const meetX = playerPos.x + 0.65;
        const meetZ = playerPos.z - 1.35;
        const dx = meetX - ped.position.x;
        const dz = meetZ - ped.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.16) {
          const stepSpeed = Math.min(dist, 1.85 * dt);
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
          // Escort is in position 1.5m ahead-right -> lift crosswalk airwall & lead across!
          this.escortPhase = 'holding_hands';
          this.lastEscortZ = playerPos.z;
          const airwall = this.colliders.find((c) => c.id === 'crosswalk_airwall');
          if (airwall) airwall.enabled = false;
          this.callbacks.onCollidersUpdated();
          this.callbacks.onEscortAssistChange(true);

          this.a11yUI.showSubtitle(
            '温暖的身影在右前方一步半处稳稳引路——跟着身旁人的脚步，一起穿过斑马线吧。',
            7200,
            '并肩同行'
          );
        }
      } else if (this.escortPhase === 'holding_hands') {
        this.escortHoldingBlend = Math.min(1.0, this.escortHoldingBlend + dt * 2.2);

        // Escort leads smoothly 1.5m ahead-right (0.65m right, 1.35m ahead -> hypot = 1.50m, never blocking view!)
        const targetX = Math.min(WAYPOINTS.crosswalkCenterX + 1.45, playerPos.x + 0.65);
        const targetZ = playerPos.z - 1.35;
        const targetY = targetZ < streetZ(-41.9) && targetZ > streetZ(-51.7) ? 0.02 : 0.08;
        ped.position.x += (targetX - ped.position.x) * Math.min(1, dt * 6.5);
        ped.position.z += (targetZ - ped.position.z) * Math.min(1, dt * 6.5);
        ped.position.y += (targetY - ped.position.y) * Math.min(1, dt * 6.0);

        const targetYaw = Math.PI + 0.14;
        ped.rotation.y += (targetYaw - ped.rotation.y) * Math.min(1, dt * 4.5);

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
        const crossT = THREE.MathUtils.clamp((-41.5 - playerPos.z) / 11.0, 0, 1);
        const preludeSunset = crossT * 0.38;
        if (preludeSunset > this.sunsetProgress) {
          this.sunsetProgress = preludeSunset;
          this.echoManager.setSunsetFactor(preludeSunset * 0.85);
          this.targetSunsetLightIntensity = preludeSunset * 2.4;
        }

        this.escortRippleTimer -= dt;
        if (this.escortRippleTimer <= 0) {
          this.escortRippleTimer = 2.1;
          this.tmpVec.set(ped.position.x, 0.08, ped.position.z);
          this.echoManager.emitWave(this.tmpVec, 'amber', 4.0, 1.05, 0.85);
          this.tmpVec.set(ped.position.x, 0.15, ped.position.z);
          this.builtScene.spawnSparkles(this.tmpVec, true);
        }
      } else if (this.escortPhase === 'arrived') {
        // Safely across! Step onto opposite curb framed in golden sunset backlight (Ref Image 4!)
        this.escortHoldingBlend = Math.max(0.0, this.escortHoldingBlend - dt * 1.8);
        const restX = WAYPOINTS.crosswalkCenterX;
        const restZ = streetZ(-53.9);
        ped.position.x += (restX - ped.position.x) * Math.min(1, dt * 2.2);
        ped.position.z += (restZ - ped.position.z) * Math.min(1, dt * 2.2);
        ped.position.y += (0.08 - ped.position.y) * Math.min(1, dt * 4.0);
        ped.rotation.y += (0.0 - ped.rotation.y) * Math.min(1, dt * 2.8);
        const rem = Math.hypot(restX - ped.position.x, restZ - ped.position.z);
        strideAmp = Math.min(1, rem * 1.5);
        this.escortStridePhase += dt * 4.0 * strideAmp;
      }

      halo.position.set(ped.position.x, 1.8, ped.position.z - 0.15);
      rig.updateEscortMotion(dt, this.escortHoldingBlend, this.escortStridePhase, strideAmp, totalElapsed);
      void camera;
    }

    // --- NODE 06: Golden After-Rain Sunset Finale (Z <= -55.0, 2.5s Transition) ---
    if (!this.endingTriggered && this.escortPhase === 'holding_hands' && playerPos.z <= WAYPOINTS.sunsetFinishZ) {
      this.endingTriggered = true;
      this.finishDeadline = performance.now() + 3500;
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
      this.targetSunsetLightIntensity = ease * 3.65;
      this.builtScene.ambientHemiLight.intensity = 0.85 + ease * 0.65;

    }
    if (this.endingTriggered && !this.endingModalShown && performance.now() >= this.finishDeadline) {
      this.endingModalShown = true;
      this.callbacks.onReachEnding(Math.max(1, Math.round(this.playElapsed)), this.obstacleBumps);
    }
  }
}
