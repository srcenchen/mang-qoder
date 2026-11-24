import './style.css';
import * as THREE from 'three';
import { createInitialColliders, isOnTactilePath, groundFeature, streetZ, WAYPOINTS } from './level/levelData';
import { buildGameScene } from './level/buildScene';
import { EchoShaderManager } from './shaders/echoMaterial';
import { FirstPersonController } from './player/controller';
import { GuideCaneSystem } from './player/cane';
import { SpatialSoundEngine } from './audio/soundEngine';
import { AccessibilityUI } from './ui/accessibilityUI';
import { StoryScriptManager } from './story/scriptManager';
import { detectDefaultQuality, QUALITY_PROFILES, QualityName } from './render/quality';
import { SkyEnvironmentSystem } from './render/skyEnvironment';
import { PlanarReflectionPass } from './render/planarReflection';
import { RainWeatherSystem } from './render/weather';
import { CinemaPostPipeline } from './render/postPipeline';

class TactilePathGameApp {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private fog: THREE.FogExp2;

  private darkFogColor = new THREE.Color('#000000');
  private sunsetFogColor = new THREE.Color('#8c4c24');
  private peekFogColor = new THREE.Color('#1a2433');
  private attractFogColor = new THREE.Color('#0c121b');

  private qualityName: QualityName = detectDefaultQuality();
  private skyEnv: SkyEnvironmentSystem;
  private planarRefl: PlanarReflectionPass;
  private weather: RainWeatherSystem;
  private postPipeline: CinemaPostPipeline;

  private echoManager: EchoShaderManager;
  private soundEngine: SpatialSoundEngine;
  private a11yUI: AccessibilityUI;
  private colliders = createInitialColliders();
  private builtScene: ReturnType<typeof buildGameScene>;
  private controller: FirstPersonController;
  private caneSystem: GuideCaneSystem;
  private story: StoryScriptManager;

  private debugPeek = false;
  private started = false;
  private clock = new THREE.Clock();
  private totalElapsed = 0;

  // Attract Mode & Cinema Transition States
  private attractReveal = 0.72;
  private attractWaveTimer = 1.2;
  private attractCarTimer = 2.4;
  private impactPulse = 0;
  private screenFade = 1.0;

  private endingTimer = 0;
  private endingPhase: 'off' | 'question' | 'leaving-question' | 'thanks' | 'roaming' = 'off';
  private question = document.getElementById('ending-question')!;
  private thanks = document.getElementById('ending-content')!;
  private questionMotion?: Animation;
  private chapterTimer = 0;
  private chapterClosing = false;
  private chapterScreen = document.getElementById('chapter-screen')!;
  private record = document.getElementById('journey-record')!;
  private reflectionHideList: THREE.Object3D[] = [];
  private tmpWaveOrigin = new THREE.Vector3();

  // UI Elements
  private stageRoot = document.getElementById('stage-root')!;
  private bootScreen = document.getElementById('boot')!;
  private bootFill = document.getElementById('boot-fill')!;
  private cinemaBars = document.getElementById('cinema-bars')!;
  private titleScreen = document.getElementById('title-screen')!;
  private hudRoot = document.getElementById('hud-root')!;
  private btnStart = document.getElementById('btn-start')!;
  private btnPeek = document.getElementById('btn-peek')!;
  private peekDot = document.getElementById('peek-dot')!;
  private btnMute = document.getElementById('btn-mute')!;
  private iconSound = document.getElementById('icon-sound')!;
  private btnCaneTap = document.getElementById('btn-cane-tap') as HTMLButtonElement;
  private btnListen = document.getElementById('btn-listen') as HTMLButtonElement;

  private portraitBlocked = false;
  private pseudoLandscape = false;
  private rotationTimer = 0;
  private heldActions = new Map<HTMLElement, number>();
  private rotationGuide = document.getElementById('rotation-guide')!;
  private stageW = window.innerWidth;
  private stageH = window.innerHeight;

  // Journey ending
  private endingModal = document.getElementById('ending-modal')!;
  private btnAdmireSunset = document.getElementById('btn-admire-sunset')!;
  private btnRestart = document.getElementById('btn-restart')!;
  private btnReopenEnding = document.getElementById('btn-reopen-ending')!;

  constructor() {
    this.bootFill.style.width = '28%';
    const container = document.getElementById('canvas-container')!;
    const profile = QUALITY_PROFILES[this.qualityName];

    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // Handled cleanly by our FXAA post-pass!
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, Math.min(profile.maxDpr, 1.5)));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Tone mapping & sRGB encoding are handled inside our CinemaPostPipeline (ACES/AgX hybrid!)
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2('#0c121b', 0.042);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.08,
      95
    );
    this.camera.position.set(0.65, 1.48, -9.6);
    this.scene.add(this.camera);

    // 1. Procedural Sky Dome + PMREM IBL Baker
    this.bootFill.style.width = '52%';
    this.skyEnv = new SkyEnvironmentSystem(this.renderer, this.scene);

    // 2. Planar Wet-Ground Reflection Pass & Rain Weather
    this.planarRefl = new PlanarReflectionPass(512, 288);
    this.planarRefl.enabled = profile.reflections;
    this.planarRefl.resize(window.innerWidth, window.innerHeight, profile.reflScale);

    this.weather = new RainWeatherSystem(this.scene, profile.rainCount, profile.splashCount);

    // 3. Cinema Multi-Pass HDR Post-Processing Pipeline (SSAO + Bloom + Streak + ACES/AgX + FXAA + Grain)
    this.postPipeline = new CinemaPostPipeline(this.renderer, profile);
    const dpr = this.renderer.getPixelRatio();
    this.postPipeline.resize(window.innerWidth * dpr, window.innerHeight * dpr);

    this.bootFill.style.width = '78%';

    // 4. Sonic Echo PBR Material Manager & Audio Engine
    this.echoManager = new EchoShaderManager();
    this.echoManager.setAttractReveal(this.attractReveal);
    this.soundEngine = new SpatialSoundEngine();

    this.a11yUI = new AccessibilityUI(this.qualityName, {
      onHighContrastChange: (enabled) => {
        this.echoManager.setHighContrast(enabled);
      },
      onEchoDurationChange: (seconds) => {
        this.echoManager.setEchoDuration(seconds);
      },
      onQualityChange: (q) => {
        this.applyQuality(q);
      },
      onVolumeChange: (v) => {
        this.soundEngine.setMasterVolume(v);
      },
      onSensitivityChange: (s) => {
        this.controller.mouseSensitivity = s;
      },
      onDrawerToggle: (open) => {
        this.controller.modalOpen = open;
        if (this.started) this.controller.enabled = !open;
        if (open) {
          this.controller.exitPointerLock();
        }
      },
    });

    // 5. Build Dense 45m Urban Street Canyon Scene
    this.builtScene = buildGameScene(this.scene, this.camera, this.echoManager, this.colliders);
    this.builtScene.setShadowsEnabled(profile.shadows, profile.shadowMapSize);

    // 6. First-Person Guide Cane (Light Tap + Charged Heavy Wide-Range Echo)
    this.caneSystem = new GuideCaneSystem(
      this.camera,
      this.builtScene.raycastTargets,
      (hit) => {
        const palette =
          hit.tag === 'tactile_line' ||
          hit.tag === 'tactile_dot' ||
          hit.tag === 'cat' ||
          hit.tag === 'stall'
            ? 'amber'
            : hit.tag === 'bike' || hit.tag === 'barrier'
              ? 'cyan'
              : 'cyan';

        this.soundEngine.playCaneTap(hit.tag, hit.pan, hit.isManualTap, hit.isHeavyEcho);

        if (hit.isManualTap) {
          // Restrained sonic echo radii (Round 3): light tap 4.3m (within 3.8~5.2m), heavy tap 7.2m (<= 7.5m)
          const radius = hit.isHeavyEcho ? 7.2 : 4.3;
          const durScale = hit.isHeavyEcho ? 1.28 : 1.0;
          const intensity = hit.isHeavyEcho ? 1.15 : 0.95;
          this.echoManager.emitWave(hit.point, palette, radius, durScale, intensity);
          this.builtScene.spawnSparkles(hit.point, palette === 'amber');
        } else {
          this.echoManager.emitWave(hit.point, palette, 2.4, 0.72, 0.75);
        }

        this.story.onCaneSurfaceHit(hit.tag, hit.point);
      }
    );

    // 7. Narrative Script Manager (6 Main Nodes + 3 Optional Micro-Interactions)
    this.story = new StoryScriptManager(
      this.colliders,
      this.builtScene,
      this.echoManager,
      this.soundEngine,
      this.a11yUI,
      {
        getPlayerPosition: () => this.controller.position,
        isTouchMode: () => this.stageRoot.classList.contains('touch-layout'),
        onEquipCane: () => {
          this.caneSystem.setEquipped(true);
          this.btnCaneTap.disabled = false;
        },
        onCollidersUpdated: () => {
          this.builtScene.rebuildDebugWireframes(this.colliders);
        },
        onImpactPulse: () => {
          this.impactPulse = 1.0;
        },
        onEscortAssistChange: (active) => {
          this.controller.escortAssistActive = active;
        },
        onChapter: chapter => this.openChapter(chapter),
        onReachEnding: (elapsedSeconds, obstacleBumps) => {
          this.record.textContent = `耗时 ${elapsedSeconds} 秒　·　敲杖 ${this.caneSystem.totalTaps} 次　·　碰壁 ${obstacleBumps} 次`;
          this.showEndingModal();
        },
      }
    );

    // 8. First-Person Controller (Attract Mode -> In-Game Exploration)
    this.controller = new FirstPersonController(
      this.camera,
      this.renderer.domElement,
      document.getElementById('joystick-zone')!,
      document.getElementById('joystick-knob')!,
      this.colliders,
      {
        onFootstep: (pos) => {
          const isIndoor = pos.z > -5.5 && Math.abs(pos.x) < 2.2;
          const onTactile = !isIndoor && isOnTactilePath(pos.x, pos.z);
          const feature = groundFeature(pos.x, pos.z);
          if (feature) this.story.onGroundStep(feature, pos);
          else this.soundEngine.playFootstep(onTactile, isIndoor);
        },
        onObstacleBump: (collider) => {
          this.story.onObstacleCollision(collider);
        },
        onAirwallBlocked: () => {
          this.story.onAirwallBlocked();
        },
        onPrimaryHoldStart: () => {
          if (this.caneSystem.equipped) {
            this.caneSystem.beginCharge();
          }
        },
        onPrimaryHoldEnd: () => {
          if (this.caneSystem.equipped) {
            this.caneSystem.releaseCharge();
          }
        },
        onPointerLockChange: (locked) => {
          this.a11yUI.setPointerLockVisual(locked, this.isMobileOrTouch(), this.started);
        },
      }
    );

    this.reflectionHideList = [
      ...this.builtScene.reflectiveGroundMeshes,
      this.caneSystem.handRoot,
      this.builtScene.escortRig.playerLeftArmRoot,
    ];

    this.syncStageLayout();
    this.bindUIEvents();
    this.precompileDynamicAssets();

    // Seed an opening golden sonic ripple on the wet tactile street corner for the Live 3D Title Screen!
    this.tmpWaveOrigin.set(WAYPOINTS.crosswalkCenterX, 0.12, WAYPOINTS.stallLightPos.z);
    this.echoManager.emitWave(this.tmpWaveOrigin, 'amber', 4.6, 1.3, 1.0);

    this.bootFill.style.width = '100%';
    window.setTimeout(() => {
      this.bootScreen.classList.add('done');
    }, 320);

    this.animate();
  }

  /**
   * Pre-compiles every dynamic mesh, hidden rig, traffic streak, and post-processing pass during boot
   * while keeping all lights permanently active in the scene graph (intensity = 0 when idle),
   * completely eliminating mid-game shader compilation stutter on cane pickup or crosswalk escort!
   */
  private precompileDynamicAssets(): void {
    const prevHandVis = this.caneSystem.handRoot.visible;
    const prevPedVis = this.builtScene.pedestrianGroup.visible;
    const prevArmVis = this.builtScene.escortRig.playerLeftArmRoot.visible;
    const prevDebugVis = this.builtScene.debugWireframeGroup.visible;
    const prevTrafficVis = this.builtScene.trafficStreaks.map((t) => t.group.visible);

    this.builtScene.busVehicle.visible = true;
    this.caneSystem.handRoot.visible = true;
    this.builtScene.pedestrianGroup.visible = true;
    this.builtScene.escortRig.playerLeftArmRoot.visible = true;
    this.builtScene.debugWireframeGroup.visible = true;
    for (const tr of this.builtScene.trafficStreaks) tr.group.visible = true;

    // Gameplay draws to linear HDR targets. Compile and submit the first draw there
    // during boot, including props outside the title camera and the sunset environment.
    const previousTarget = this.renderer.getRenderTarget();
    const culled: THREE.Object3D[] = [];
    this.scene.traverseVisible(object => {
      if (object.frustumCulled) {
        culled.push(object);
        object.frustumCulled = false;
      }
    });
    try {
      this.renderer.setRenderTarget(this.planarRefl.renderTarget);
      this.renderer.compile(this.scene, this.camera);
      this.builtScene.setBusRoute(7);
      this.renderer.render(this.scene, this.camera);
      this.builtScene.setBusRoute(12);
      this.skyEnv.update(0, 1, false, this.camera.position, this.scene);
      this.renderer.render(this.scene, this.camera);
      // The mirrored pass uses a clipping plane and therefore a different GPU program.
      this.renderer.setRenderTarget(previousTarget);
      this.planarRefl.render(this.renderer, this.scene, this.camera, this.reflectionHideList);
    } finally {
      this.skyEnv.update(0, 0, false, this.camera.position, this.scene);
      this.renderer.setRenderTarget(previousTarget);
      for (const object of culled) object.frustumCulled = true;
    }

    this.builtScene.busVehicle.visible = false;
    this.caneSystem.handRoot.visible = prevHandVis;
    this.builtScene.pedestrianGroup.visible = prevPedVis;
    this.builtScene.escortRig.playerLeftArmRoot.visible = prevArmVis;
    this.builtScene.debugWireframeGroup.visible = prevDebugVis;
    for (let i = 0; i < this.builtScene.trafficStreaks.length; i++) {
      this.builtScene.trafficStreaks[i].group.visible = prevTrafficVis[i];
    }
  }

  private isMobileOrTouch(): boolean {
    if (window.matchMedia('(pointer: coarse)').matches) return true;
    if (navigator.maxTouchPoints === 0) return false;
    // iPad desktop-mode Safari can report a fine pointer with a connected trackpad.
    const mobilePlatform = /Android|iPad|iPhone|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return mobilePlatform || window.matchMedia('(hover: none)').matches;
  }

  private syncStageLayout(): void {
    const touch = this.isMobileOrTouch();
    const portrait = touch && window.innerWidth <= window.innerHeight;
    if (portrait) {
      if (!this.pseudoLandscape && !this.rotationTimer) {
        this.rotationTimer = window.setTimeout(() => {
          this.rotationTimer = 0;
          this.pseudoLandscape = this.isMobileOrTouch() && window.innerWidth <= window.innerHeight;
          this.syncStageLayout();
        }, 3000);
      }
    } else {
      window.clearTimeout(this.rotationTimer);
      this.rotationTimer = 0;
      this.pseudoLandscape = false;
    }

    const blocked = portrait && !this.pseudoLandscape;
    const modeChanged = this.stageRoot.classList.contains('touch-layout') !== touch ||
      this.stageRoot.classList.contains('pseudo-landscape') !== this.pseudoLandscape ||
      blocked !== this.portraitBlocked;
    this.stageRoot.classList.toggle('touch-layout', touch);
    this.stageRoot.classList.toggle('touch-landscape', touch && !blocked);
    this.stageRoot.classList.toggle('pseudo-landscape', this.pseudoLandscape);

    if (modeChanged) {
      if (blocked) {
        this.rotationGuide.classList.remove('leaving');
        this.rotationGuide.hidden = false;
      } else if (this.portraitBlocked && this.pseudoLandscape) {
        this.rotationGuide.classList.add('leaving');
      } else if (!this.pseudoLandscape) {
        this.rotationGuide.hidden = true;
        this.rotationGuide.classList.remove('leaving');
      }
      this.rotationGuide.setAttribute('aria-hidden', String(!blocked));
      this.portraitBlocked = blocked;
      this.stageRoot.inert = blocked;
      this.controller.setTouchLayout(touch, this.pseudoLandscape);
      this.clearTouchInput();
    }

    this.stageW = this.pseudoLandscape ? this.stageRoot.clientWidth : window.innerWidth;
    this.stageH = this.pseudoLandscape ? this.stageRoot.clientHeight : window.innerHeight;
    const p = QUALITY_PROFILES[this.qualityName];
    this.camera.aspect = this.stageW / Math.max(1, this.stageH);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.stageW, this.stageH, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    if (this.endingPhase === 'question') this.fitEndingQuestion();

    const dpr = this.renderer.getPixelRatio();
    this.postPipeline.resize(this.stageW * dpr, this.stageH * dpr);
    this.planarRefl.resize(this.stageW, this.stageH, p.reflScale);
  }

  private applyQuality(name: QualityName): void {
    this.qualityName = name;
    const p = QUALITY_PROFILES[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, Math.min(p.maxDpr, 1.5)));
    this.renderer.shadowMap.enabled = p.shadows;
    this.builtScene.setShadowsEnabled(p.shadows, p.shadowMapSize);
    this.planarRefl.enabled = p.reflections;
    this.weather.rebuild(p.rainCount, p.splashCount);
    this.postPipeline.setQuality(p);
    this.syncStageLayout();
  }

  private bindUIEvents(): void {
    // Synchronous Web Audio Unlock + Pointer Lock (Desktop) / Auto-Landscape (Mobile)!
    this.btnStart.addEventListener('click', () => {
      if (this.started) return;
      this.titleScreen.inert = true;
      this.soundEngine.unlockAndInit();
      this.started = true;

      this.titleScreen.classList.remove('open');
      this.cinemaBars.classList.remove('open');
      this.screenFade = 0.85;

      this.controller.attractMode = false;
      this.controller.reset();
      this.controller.enabled = true;
      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();

      this.echoManager.reset();
      this.attractReveal = 0.0;
      this.echoManager.setAttractReveal(0.0);

      this.hudRoot.classList.add('on');
      this.hudRoot.setAttribute('aria-hidden', 'false');

      if (this.isMobileOrTouch()) {
        this.syncStageLayout();
      } else {
        // Capture mouse pointer immediately inside user click gesture!
        this.controller.requestPointerLock();
        this.a11yUI.setPointerLockVisual(this.controller.isPointerLocked, false, true);
      }

      this.story.startJourney();
    });

    const bindHold = (button: HTMLButtonElement, start: () => void, finish: (cancelled: boolean) => void) => {
      button.addEventListener('pointerdown', e => {
        e.stopPropagation();
        e.preventDefault();
        if (!this.controller.enabled || this.controller.modalOpen || this.heldActions.has(button)) return;
        this.heldActions.set(button, e.pointerId);
        button.setPointerCapture(e.pointerId);
        start();
      });
      const end = (e: PointerEvent) => {
        e.stopPropagation();
        if (this.heldActions.get(button) !== e.pointerId) return;
        this.heldActions.delete(button);
        finish(e.type !== 'pointerup');
      };
      button.addEventListener('pointerup', end);
      button.addEventListener('pointercancel', end);
      button.addEventListener('lostpointercapture', end);
    };
    bindHold(this.btnCaneTap, () => this.caneSystem.beginCharge(), cancelled => {
      if (cancelled) this.caneSystem.cancelCharge();
      else this.caneSystem.releaseCharge();
    });
    bindHold(this.btnListen, () => this.controller.setTouchListening(true),
      () => this.controller.setTouchListening(false));
    window.addEventListener('blur', () => this.clearTouchInput());

    this.btnPeek.addEventListener('click', () => this.togglePeekMode());
    this.btnMute.addEventListener('click', () => this.toggleMute());

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (this.portraitBlocked) return;
      if (this.endingPhase === 'question' && e.code === 'Space') {
        e.preventDefault();
        this.fadeQuestion();
        return;
      }
      if (this.story.chapterOpen) {
        if (e.code === 'Space') {
          e.preventDefault();
          if (!e.repeat) this.closeChapter();
        }
        return;
      }
      if (!this.started || this.controller.modalOpen) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.caneSystem.beginCharge();
      } else if (e.code === 'KeyP' && !e.repeat) {
        this.togglePeekMode();
      } else if (e.code === 'KeyM' && !e.repeat) {
        this.toggleMute();
      } else if (e.code === 'KeyE' && !e.repeat) {
        this.story.handleContextAction();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (!this.started || this.controller.modalOpen) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.caneSystem.releaseCharge();
      }
    });

    this.chapterScreen.addEventListener('click', () => this.closeChapter());

    this.endingModal.addEventListener('click', () => this.fadeQuestion());
    this.btnAdmireSunset.addEventListener('click', () => {
      if (this.endingPhase !== 'thanks') return;
      this.endingPhase = 'roaming';
      this.story.showSunsetBus();
      this.endingModal.inert = true;
      this.endingModal.classList.add('roaming');
      this.endingTimer = window.setTimeout(() => {
        this.endingModal.classList.add('hidden');
        this.endingModal.classList.remove('roaming');
        this.endingModal.inert = false;
        this.endingPhase = 'off';
        this.hudRoot.inert = false;
        this.btnReopenEnding.classList.remove('hidden');
        this.controller.modalOpen = false;
        this.controller.enabled = true;
        if (!this.isMobileOrTouch()) this.controller.requestPointerLock();
      }, 650);
    });
    this.btnReopenEnding.addEventListener('click', () => this.showEndingModal(true));
    this.btnRestart.addEventListener('click', () => this.restartExperience());

    this.rotationGuide.addEventListener('transitionend', () => {
      if (this.rotationGuide.classList.contains('leaving') && !this.portraitBlocked) {
        this.rotationGuide.hidden = true;
      }
    });
    const handleResize = () => this.syncStageLayout();
    for (const type of ['contextmenu', 'selectstart']) {
      this.stageRoot.addEventListener(type, e => {
        if (this.stageRoot.classList.contains('touch-layout')) e.preventDefault();
      });
    }
    window.addEventListener('resize', handleResize);
    for (const query of ['(pointer: coarse)', '(hover: none)']) {
      window.matchMedia(query).addEventListener?.('change', handleResize);
    }
    window.addEventListener('orientationchange', () => {
      window.setTimeout(handleResize, 120);
    });
  }

  private togglePeekMode(): void {
    this.debugPeek = !this.debugPeek;
    this.echoManager.setDebugPeek(this.debugPeek);
    this.builtScene.debugWireframeGroup.visible = this.debugPeek;

    this.btnPeek.setAttribute('aria-pressed', String(this.debugPeek));
    this.peekDot.classList.toggle('active', this.debugPeek);
    this.a11yUI.speak(this.debugPeek ? '透视调试模式已开启' : '已切回沉浸盲行模式');
  }

  private toggleMute(): void {
    const muted = this.soundEngine.toggleMute();
    this.btnMute.setAttribute('aria-pressed', String(muted));
    this.iconSound.textContent = muted ? '🔇' : '🔊';
    this.a11yUI.speak(muted ? '已静音' : '声音已开启');
  }

  private clearTouchInput(): void {
    this.heldActions.clear();
    this.caneSystem.cancelCharge();
    this.controller.clearInput();
  }

  private pauseControls(): void {
    this.controller.modalOpen = true;
    this.controller.enabled = false;
    this.clearTouchInput();
    this.controller.exitPointerLock();
    this.hudRoot.inert = true;
  }

  private openChapter(chapter: number): void {
    const messages = [
      `眼睛关上之后，世界并没有消失。
它换了一种方式，落在杖尖的每一次回响里。`,
      `盲道突然断了，像一条被随意折断的线。
手里的盲杖左右试探，原来最难绕开的，从来不是路。`,
      `车声从四面涌来，绿灯却没有声音。
在无数次擦肩而过里，我们等的，只是一句“我带你过去”。`,
    ];
    this.pauseControls();
    document.getElementById('chapter-text')!.textContent = messages[chapter - 1];
    this.chapterScreen.hidden = false;
    this.chapterScreen.focus();
    this.a11yUI.speak(messages[chapter - 1]);
    this.chapterTimer = window.setTimeout(() => this.closeChapter(), 4500);
  }

  private closeChapter(): void {
    if (!this.story.chapterOpen || this.chapterClosing) return;
    this.chapterClosing = true;
    window.speechSynthesis?.cancel();
    window.clearTimeout(this.chapterTimer);
    this.story.finishChapter();
    if (this.story.hasRiddenBus) this.controller.yaw = 0;
    this.chapterScreen.classList.add('leaving');
    this.chapterTimer = window.setTimeout(() => {
      this.chapterScreen.hidden = true;
      this.chapterScreen.classList.remove('leaving');
      this.chapterClosing = false;
      this.hudRoot.inert = false;
      this.controller.clearInput();
      this.controller.modalOpen = false;
      this.controller.enabled = true;
    }, 350);
  }

  private fitEndingQuestion(): void {
    this.question.style.scale = String(Math.min(1, (this.stageW - 32) / Math.max(1, this.question.scrollWidth)));
  }

  private fadeQuestion(): void {
    if (this.endingPhase !== 'question') return;
    this.endingPhase = 'leaving-question';
    window.clearTimeout(this.endingTimer);
    const opacity = getComputedStyle(this.question).opacity;
    this.questionMotion?.cancel();
    this.questionMotion = this.question.animate([{ opacity }, { opacity: 0 }],
      { duration: 800, easing: 'ease-in-out', fill: 'both' });
    this.endingTimer = window.setTimeout(() => this.showThanks(), 1000);
  }

  private showThanks(): void {
    this.questionMotion?.cancel();
    this.question.hidden = true;
    this.thanks.hidden = false;
    this.endingPhase = 'thanks';
    this.endingModal.focus();
  }

  private showEndingModal(reopen = false): void {
    window.clearTimeout(this.endingTimer);
    this.pauseControls();
    this.btnReopenEnding.classList.add('hidden');
    this.endingModal.classList.remove('hidden');
    if (reopen) { this.showThanks(); return; }
    this.endingPhase = 'question';
    this.thanks.hidden = true;
    this.question.hidden = false;
    this.endingModal.focus();
    // Keep the full sentence on one line in a narrow, unrotated viewport.
    this.fitEndingQuestion();
    this.questionMotion = this.question.animate([{ opacity: 0 }, { opacity: 1 }],
      { delay: 900, duration: 1000, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    this.endingTimer = window.setTimeout(() => this.fadeQuestion(), 5800);
  }

  private restartExperience(): void {
    window.clearTimeout(this.endingTimer);
    this.questionMotion?.cancel();
    this.endingPhase = 'off';
    this.endingModal.classList.add('hidden');
    this.btnReopenEnding.classList.add('hidden');
    this.record.textContent = '';
    this.hudRoot.inert = false;
    window.speechSynthesis?.cancel();

    this.btnCaneTap.disabled = true;
    this.echoManager.reset();
    this.echoManager.setAttractReveal(0);
    this.caneSystem.reset();
    this.controller.reset();
    this.story.reset();

    if (this.debugPeek) this.togglePeekMode();
    this.controller.modalOpen = false;
    this.controller.enabled = true;
    this.screenFade = 0.7;
    if (!this.isMobileOrTouch()) {
      this.controller.requestPointerLock();
    }
    this.story.startJourney();
  }

  private updateAtmosphere(dt: number): void {
    // Smooth fade-in after boot or transition
    if (this.screenFade > 0) {
      this.screenFade = Math.max(0, this.screenFade - dt * 1.65);
    }
    if (this.impactPulse > 0) {
      this.impactPulse = Math.max(0, this.impactPulse - dt * 2.4);
    }

    // Live 3D Title Attract-Mode Showcase Waves & Background Traffic!
    if (!this.started) {
      this.attractWaveTimer -= dt;
      if (this.attractWaveTimer <= 0) {
        this.attractWaveTimer = 2.9;
        const z = streetZ(-21.5) - Math.random() * 5.5;
        const warm = Math.random() > 0.35;
        this.tmpWaveOrigin.set(WAYPOINTS.crosswalkCenterX, 0.12, z);
        this.echoManager.emitWave(this.tmpWaveOrigin, warm ? 'amber' : 'cyan', 4.5, 1.2, 0.95);
        this.tmpWaveOrigin.set(WAYPOINTS.crosswalkCenterX, 0.14, z);
        this.builtScene.spawnSparkles(this.tmpWaveOrigin, warm);
      }
      this.attractCarTimer -= dt;
      if (this.attractCarTimer <= 0) {
        this.attractCarTimer = 3.2;
        this.story.spawnTrafficBurst(Math.random() > 0.5 ? 1 : -1, 0);
      }
      this.fog.color.copy(this.attractFogColor);
      this.fog.density = 0.036;
      return;
    }

    if (this.debugPeek) {
      this.fog.color.copy(this.peekFogColor);
      this.fog.density = 0.011;
      return;
    }

    const s = this.story.sunsetProgress;
    const ease = s * s * (3 - 2 * s);
    this.fog.color.lerpColors(this.darkFogColor, this.sunsetFogColor, ease);
    this.fog.density = THREE.MathUtils.lerp(0.115, 0.014, ease);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.portraitBlocked) return;
    this.totalElapsed += dt;

    this.controller.update(dt);

    const isOutdoors = !this.started || this.controller.position.z < -5.5;
    const caneState = this.caneSystem.update(
      dt,
      this.controller.sweepInput,
      this.controller.isMoving,
      this.controller.walkCycle,
      isOutdoors
    );
    this.echoManager.setCaneTip(caneState.tipPos, this.caneSystem.equipped);
    this.echoManager.update(dt, this.totalElapsed);
    this.a11yUI.setChargeProgress(this.caneSystem.chargeProgress);

    if (!this.controller.modalOpen && !this.chapterClosing) this.story.update(
      dt,
      this.totalElapsed,
      this.controller.position,
      this.controller.isListening,
      this.camera
    );

    if (this.started) {
      this.a11yUI.updateCompass(
        this.controller.position,
        this.controller.yaw,
        this.story.beacons,
        this.controller.isListening
      );
      this.btnListen.classList.toggle('active', this.controller.isListening);
    }

    const sunsetVisual = !this.started ? 0.24 : this.story.sunsetProgress;
    const worldVis = !this.started ? 1.0 : this.debugPeek ? 1.0 : this.story.sunsetProgress;
    const doorTargetAngle = this.story.doorOpened ? 1.42 : 0.14;
    this.builtScene.updateParticlesAndProps(
      dt,
      this.totalElapsed,
      doorTargetAngle,
      sunsetVisual,
      worldVis
    );
    this.skyEnv.update(
      this.totalElapsed,
      sunsetVisual,
      this.debugPeek || !this.started,
      this.camera.position,
      this.scene
    );
    this.weather.update(this.totalElapsed, this.camera.position, sunsetVisual, worldVis);

    this.soundEngine.update(
      dt,
      this.controller.position,
      this.controller.yaw,
      this.story.doorOpened,
      this.story.strangerArrived,
      this.controller.listenBlend
    );

    this.updateAtmosphere(dt);

    // 1. Real-time Planar Wet-Ground Reflection Pass (when outdoors & enabled in Quality)
    const shouldReflect =
      this.planarRefl.enabled && (this.controller.attractMode || this.controller.position.z < -4.2);
    if (shouldReflect) {
      this.planarRefl.render(this.renderer, this.scene, this.camera, this.reflectionHideList);
      this.echoManager.setPlanarReflection(
        this.planarRefl.renderTarget.texture,
        this.planarRefl.textureMatrix,
        true
      );
    } else {
      this.echoManager.setPlanarReflection(null, this.planarRefl.textureMatrix, false);
    }

    // 2. Cinema Multi-Pass HDR Post-Processing Render -> Screen!
    this.postPipeline.render(this.scene, this.camera, {
      elapsed: this.totalElapsed,
      sunsetFactor: sunsetVisual,
      peekMode: this.debugPeek,
      impactPulse: this.impactPulse,
      listenBlend: this.controller.listenBlend,
      fadeAmount: this.screenFade,
      sunDir: this.skyEnv.sunDirection,
    });
  };
}

new TactilePathGameApp();
