import './style.css';
import * as THREE from 'three';
import { createInitialColliders, isOnTactilePath, WAYPOINTS } from './level/levelData';
import { buildGameScene } from './level/buildScene';
import { EchoShaderManager } from './shaders/echoMaterial';
import { FirstPersonController } from './player/controller';
import { GuideCaneSystem } from './player/cane';
import { SpatialSoundEngine } from './audio/soundEngine';
import { AccessibilityUI } from './ui/accessibilityUI';
import { StoryScriptManager } from './story/scriptManager';
import { generateEmpathySharePoster, PlaythroughStats } from './ui/shareCard';
import { detectDefaultQuality, QUALITY_PROFILES, QualityName } from './render/quality';
import { SkyEnvironmentSystem } from './render/skyEnvironment';
import { PlanarReflectionPass } from './render/planarReflection';
import { RainWeatherSystem } from './render/weather';
import { CinemaPostPipeline } from './render/postPipeline';

class BlindPathGameApp {
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

  private latestStats: PlaythroughStats | null = null;
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

  private autoLandscapeEnabled = true;
  private stageW = window.innerWidth;
  private stageH = window.innerHeight;

  // Ending & Share Card Elements
  private endingModal = document.getElementById('ending-modal')!;
  private endingSummaryView = document.getElementById('ending-summary-view')!;
  private statTime = document.getElementById('stat-time')!;
  private statTaps = document.getElementById('stat-taps')!;
  private statBumps = document.getElementById('stat-bumps')!;
  private statMemories = document.getElementById('stat-memories')!;
  private posterWrap = document.getElementById('poster-preview-wrap')!;
  private posterImg = document.getElementById('poster-img') as HTMLImageElement;
  private btnDownloadPoster = document.getElementById('btn-download-poster') as HTMLAnchorElement;
  private btnGeneratePoster = document.getElementById('btn-generate-poster')!;
  private btnBackSummary = document.getElementById('btn-back-summary')!;
  private btnPosterRoam = document.getElementById('btn-poster-roam')!;
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
      onAutoLandscapeChange: (enabled) => {
        this.autoLandscapeEnabled = enabled;
        this.syncStageLayout();
      },
      onDrawerToggle: (open) => {
        this.controller.modalOpen = open;
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
        onReachEnding: (elapsedSeconds, obstacleBumps, memoriesFound, memoriesTotal) => {
          this.showEndingModal({
            elapsedSeconds,
            caneTaps: this.caneSystem.totalTaps,
            obstacleBumps,
            memoriesFound,
            memoriesTotal,
          });
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
          this.soundEngine.playFootstep(onTactile, isIndoor);
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
    this.tmpWaveOrigin.set(WAYPOINTS.crosswalkCenterX, 0.12, -23.6);
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

    this.caneSystem.handRoot.visible = true;
    this.builtScene.pedestrianGroup.visible = true;
    this.builtScene.escortRig.playerLeftArmRoot.visible = true;
    this.builtScene.debugWireframeGroup.visible = true;
    for (const tr of this.builtScene.trafficStreaks) tr.group.visible = true;

    this.renderer.compile(this.scene, this.camera);

    this.caneSystem.handRoot.visible = prevHandVis;
    this.builtScene.pedestrianGroup.visible = prevPedVis;
    this.builtScene.escortRig.playerLeftArmRoot.visible = prevArmVis;
    this.builtScene.debugWireframeGroup.visible = prevDebugVis;
    for (let i = 0; i < this.builtScene.trafficStreaks.length; i++) {
      this.builtScene.trafficStreaks[i].group.visible = prevTrafficVis[i];
    }
  }

  private isMobileOrTouch(): boolean {
    const uaMobile = /Android|iPhone|iPad|iPod|MicroMessenger|Mobile/i.test(navigator.userAgent);
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const touchSmall = navigator.maxTouchPoints > 0 && Math.min(window.innerWidth, window.innerHeight) <= 900;
    return uaMobile || coarse || touchSmall;
  }

  /**
   * Mobile Auto-Landscape:
   * 1. On Android/PWA browsers, attempts hardware Fullscreen + screen.orientation.lock('landscape').
   * 2. On iOS Safari / WeChat WebView (where OS blocks lock API), seamlessly applies CSS 90deg
   *    cinema landscape rotation (.force-landscape) and remaps WebGL aspect + touch coordinates!
   */
  private tryNativeLandscapeLock(): void {
    if (!this.isMobileOrTouch() || !this.autoLandscapeEnabled) return;
    try {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      const fsPromise = el.requestFullscreen?.() || el.webkitRequestFullscreen?.();
      const lockOrientation = () => {
        const orient = screen.orientation as ScreenOrientation & {
          lock?: (mode: string) => Promise<void>;
        };
        orient?.lock?.('landscape')?.catch(() => {});
      };
      if (fsPromise && typeof fsPromise.then === 'function') {
        fsPromise.then(lockOrientation).catch(lockOrientation);
      } else {
        lockOrientation();
      }
    } catch {
      // Fallback CSS auto-landscape handles portrait seamlessly
    }
  }

  private syncStageLayout(): void {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const isPortrait = winH > winW;
    const shouldRotate = this.autoLandscapeEnabled && this.isMobileOrTouch() && isPortrait;

    this.stageRoot.classList.toggle('force-landscape', shouldRotate);
    this.controller?.setCssRotatedLandscape(shouldRotate);

    // Logical stage dimensions in landscape space
    this.stageW = shouldRotate ? winH : winW;
    this.stageH = shouldRotate ? winW : winH;

    const p = QUALITY_PROFILES[this.qualityName];
    this.camera.aspect = this.stageW / Math.max(1, this.stageH);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.stageW, this.stageH, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

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
        this.tryNativeLandscapeLock();
        this.syncStageLayout();
      } else {
        // Capture mouse pointer immediately inside user click gesture!
        this.controller.requestPointerLock();
        this.a11yUI.setPointerLockVisual(this.controller.isPointerLocked, false, true);
      }

      this.story.startJourney();
    });

    // Cane Tap Button (supports both Quick Tap AND Hold-to-Charge Heavy Echo!)
    this.btnCaneTap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.caneSystem.beginCharge();
    });
    const endCaneHold = (e: PointerEvent) => {
      e.stopPropagation();
      this.caneSystem.releaseCharge();
    };
    this.btnCaneTap.addEventListener('pointerup', endCaneHold);
    this.btnCaneTap.addEventListener('pointercancel', endCaneHold);
    this.btnCaneTap.addEventListener('pointerleave', () => {
      if (this.caneSystem.chargeProgress > 0) this.caneSystem.releaseCharge();
    });

    // Focus Listen Hold Button (Mobile & Desktop)
    this.btnListen.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.controller.setTouchListening(true);
      this.btnListen.classList.add('active');
    });
    const endListen = (e: PointerEvent) => {
      e.stopPropagation();
      this.controller.setTouchListening(false);
      this.btnListen.classList.remove('active');
    };
    this.btnListen.addEventListener('pointerup', endListen);
    this.btnListen.addEventListener('pointercancel', endListen);
    this.btnListen.addEventListener('pointerleave', endListen);

    this.btnPeek.addEventListener('click', () => this.togglePeekMode());
    this.btnMute.addEventListener('click', () => this.toggleMute());

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (!this.started) return;
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
      if (!this.started) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.caneSystem.releaseCharge();
      }
    });

    // Ending Overlay & Independent Centered 9:16 Poster Lightbox (Round 5)
    this.btnGeneratePoster.addEventListener('click', () => {
      if (!this.latestStats) return;
      const dataUrl = generateEmpathySharePoster(this.latestStats);
      this.posterImg.src = dataUrl;
      this.btnDownloadPoster.href = dataUrl;
      this.endingSummaryView.classList.add('hidden');
      this.posterWrap.classList.remove('hidden');
      this.a11yUI.speak('公益共情海报已生成，电脑端可点击下载高清海报，手机端可长按图片保存');
    });

    this.btnBackSummary.addEventListener('click', () => {
      this.posterWrap.classList.add('hidden');
      this.endingSummaryView.classList.remove('hidden');
    });

    const enterSunsetRoam = () => {
      this.endingModal.classList.add('hidden');
      this.btnReopenEnding.classList.remove('hidden');
      this.controller.modalOpen = false;
      this.controller.enabled = true;
      if (!this.isMobileOrTouch()) {
        this.controller.requestPointerLock();
      }
    };

    this.btnAdmireSunset.addEventListener('click', enterSunsetRoam);
    this.btnPosterRoam.addEventListener('click', enterSunsetRoam);

    this.btnReopenEnding.addEventListener('click', () => {
      this.btnReopenEnding.classList.add('hidden');
      this.posterWrap.classList.add('hidden');
      this.endingSummaryView.classList.remove('hidden');
      this.endingModal.classList.remove('hidden');
      this.controller.modalOpen = true;
      this.controller.exitPointerLock();
    });

    this.btnRestart.addEventListener('click', () => this.restartExperience());

    const handleResize = () => this.syncStageLayout();
    window.addEventListener('resize', handleResize);
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

  private showEndingModal(stats: PlaythroughStats): void {
    this.latestStats = stats;
    this.statTime.textContent = `${stats.elapsedSeconds}s`;
    this.statTaps.textContent = `${stats.caneTaps}`;
    this.statBumps.textContent = `${stats.obstacleBumps}`;
    this.statMemories.textContent = `${stats.memoriesFound}/${stats.memoriesTotal}`;

    this.posterWrap.classList.add('hidden');
    this.endingSummaryView.classList.remove('hidden');
    this.endingModal.classList.remove('hidden');
    this.controller.modalOpen = true;
    this.controller.exitPointerLock();

    this.a11yUI.speak(
      `体验完成。本次耗时 ${stats.elapsedSeconds} 秒，盲杖探路 ${stats.caneTaps} 次，遭遇碰壁 ${stats.obstacleBumps} 次，收集城市微光 ${stats.memoriesFound} 处。`
    );
  }

  private restartExperience(): void {
    this.endingModal.classList.add('hidden');
    this.btnReopenEnding.classList.add('hidden');
    this.latestStats = null;
    this.statBumps.textContent = '0';

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
        const z = -21.5 - Math.random() * 5.5;
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

    this.story.update(
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

new BlindPathGameApp();
