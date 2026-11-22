import './style.css';
import * as THREE from 'three';
import { createInitialColliders, WAYPOINTS } from './level/levelData';
import { buildGameScene } from './level/buildScene';
import { EchoShaderManager } from './shaders/echoMaterial';
import { FirstPersonController } from './player/controller';
import { GuideCaneSystem } from './player/cane';
import { SpatialSoundEngine } from './audio/soundEngine';
import { AccessibilityUI } from './ui/accessibilityUI';
import { StoryScriptManager } from './story/scriptManager';
import { generateEmpathySharePoster, PlaythroughStats } from './ui/shareCard';

class BlindPathGameApp {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private fog: THREE.FogExp2;

  private darkBgColor = new THREE.Color('#040507');
  private sunsetBgColor = new THREE.Color('#2b170e');
  private sunsetFogColor = new THREE.Color('#8a4b24');
  private peekBgColor = new THREE.Color('#131b29');

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
  private latestStats: PlaythroughStats = { elapsedSeconds: 0, caneTaps: 0, obstacleBumps: 0 };

  // UI Elements
  private hudHeader = document.getElementById('hud-header')!;
  private hudHint = document.getElementById('hud-controls-hint')!;
  private touchControls = document.getElementById('touch-controls')!;
  private startScreen = document.getElementById('start-screen')!;
  private btnStart = document.getElementById('btn-start')!;
  private btnPeek = document.getElementById('btn-peek')!;
  private peekDot = document.getElementById('peek-dot')!;
  private btnMute = document.getElementById('btn-mute')!;
  private iconSound = document.getElementById('icon-sound')!;
  private btnCaneTap = document.getElementById('btn-cane-tap') as HTMLButtonElement;

  // Ending & Share Card Elements
  private endingModal = document.getElementById('ending-modal')!;
  private statTime = document.getElementById('stat-time')!;
  private statTaps = document.getElementById('stat-taps')!;
  private statBumps = document.getElementById('stat-bumps')!;
  private posterWrap = document.getElementById('poster-preview-wrap')!;
  private posterImg = document.getElementById('poster-img') as HTMLImageElement;
  private btnDownloadPoster = document.getElementById('btn-download-poster') as HTMLAnchorElement;
  private btnGeneratePoster = document.getElementById('btn-generate-poster')!;
  private btnAdmireSunset = document.getElementById('btn-admire-sunset')!;
  private btnRestart = document.getElementById('btn-restart')!;
  private btnReopenEnding = document.getElementById('btn-reopen-ending')!;

  constructor() {
    const container = document.getElementById('canvas-container')!;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = this.darkBgColor.clone();
    this.fog = new THREE.FogExp2('#040507', 0.08);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.08,
      90
    );
    this.camera.position.set(
      WAYPOINTS.playerStart.x,
      WAYPOINTS.playerStart.y,
      WAYPOINTS.playerStart.z
    );
    this.scene.add(this.camera);

    this.echoManager = new EchoShaderManager();
    this.soundEngine = new SpatialSoundEngine();

    this.a11yUI = new AccessibilityUI({
      onHighContrastChange: (enabled) => {
        this.echoManager.setHighContrast(enabled);
      },
      onEchoDurationChange: (seconds) => {
        this.echoManager.setEchoDuration(seconds);
      },
    });

    this.builtScene = buildGameScene(this.scene, this.echoManager, this.colliders);

    this.caneSystem = new GuideCaneSystem(
      this.camera,
      this.builtScene.raycastTargets,
      (hit) => {
        const isWarm =
          hit.tag === 'tactile_line' ||
          hit.tag === 'tactile_dot' ||
          hit.tag === 'cat' ||
          hit.tag === 'stall';

        this.soundEngine.playCaneTap(hit.tag, hit.pan, hit.isManualTap);

        if (hit.isManualTap) {
          this.echoManager.emitWave(hit.point, isWarm, 5.2, 1.0);
          this.builtScene.spawnSparkles(hit.point, isWarm);
        } else {
          // Subtle sweep ripple when brushing onto tactile paving or obstacle
          this.echoManager.emitWave(hit.point, isWarm, 2.4, 0.7);
        }

        this.story.onCaneSurfaceHit(hit.tag, hit.point);
      }
    );

    this.story = new StoryScriptManager(
      this.colliders,
      this.builtScene,
      this.echoManager,
      this.soundEngine,
      this.a11yUI,
      {
        onEquipCane: () => {
          this.caneSystem.setEquipped(true);
          this.btnCaneTap.disabled = false;
        },
        onCollidersUpdated: () => {
          this.builtScene.rebuildDebugWireframes(this.colliders);
        },
        onReachEnding: (elapsedSeconds, obstacleBumps) => {
          this.showEndingModal({
            elapsedSeconds,
            caneTaps: this.caneSystem.totalTaps,
            obstacleBumps,
          });
        },
      }
    );

    this.controller = new FirstPersonController(
      this.camera,
      this.renderer.domElement,
      document.getElementById('joystick-zone')!,
      document.getElementById('joystick-knob')!,
      this.colliders,
      {
        onFootstep: (pos) => {
          const isIndoor = pos.z > -5.5;
          const onTactile =
            !isIndoor &&
            ((pos.z <= -6.0 && pos.z >= -32.2 && Math.abs(pos.x) < 0.36) ||
              (pos.z <= -31.3 && pos.z >= -32.35 && Math.abs(pos.x) < 1.8));
          this.soundEngine.playFootstep(onTactile, isIndoor);
        },
        onObstacleBump: (collider) => {
          this.story.onObstacleCollision(collider);
        },
        onAirwallBlocked: () => {
          this.story.onAirwallBlocked();
        },
        onCanvasQuickTap: () => {
          if (this.caneSystem.equipped) {
            this.caneSystem.triggerTap();
          }
        },
      }
    );

    this.bindUIEvents();
    this.animate();
  }

  private bindUIEvents(): void {
    // Synchronous Web Audio Unlock on Start Click (WeChat & iOS Safari compatible!)
    this.btnStart.addEventListener('click', () => {
      this.soundEngine.unlockAndInit();
      this.started = true;
      this.controller.enabled = true;

      this.startScreen.classList.add('opacity-0', 'pointer-events-none');
      window.setTimeout(() => {
        this.startScreen.classList.add('hidden');
      }, 680);

      this.hudHeader.classList.remove('opacity-0');
      this.hudHint.classList.remove('opacity-0');
      this.touchControls.classList.remove('opacity-0');

      this.story.startJourney();
    });

    // Cane Tap Button (Bottom-Right)
    this.btnCaneTap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.caneSystem.triggerTap();
    });

    // Peek Debug Mode Switch (Top-Right)
    this.btnPeek.addEventListener('click', () => {
      this.togglePeekMode();
    });

    // Mute Toggle (Top-Right)
    this.btnMute.addEventListener('click', () => {
      this.toggleMute();
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (!this.started) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.caneSystem.triggerTap();
      } else if (e.code === 'KeyP') {
        this.togglePeekMode();
      } else if (e.code === 'KeyM') {
        this.toggleMute();
      } else if (e.code === 'KeyE') {
        this.story.handleHelpPress();
      }
    });

    // Share Card Generation & Ending Modal Actions
    this.btnGeneratePoster.addEventListener('click', () => {
      const dataUrl = generateEmpathySharePoster(this.latestStats);
      this.posterImg.src = dataUrl;
      this.btnDownloadPoster.href = dataUrl;
      this.posterWrap.classList.remove('hidden');
      this.posterWrap.classList.add('flex');
      this.btnGeneratePoster.textContent = '↻ 重新生成海报';
      this.a11yUI.speak('公益共情海报已生成，电脑端可点击下载，手机端可长按图片保存');
    });

    this.btnAdmireSunset.addEventListener('click', () => {
      this.endingModal.classList.add('hidden');
      this.endingModal.classList.remove('flex');
      this.btnReopenEnding.classList.remove('hidden');
      this.controller.enabled = true;
    });

    this.btnReopenEnding.addEventListener('click', () => {
      this.btnReopenEnding.classList.add('hidden');
      this.endingModal.classList.remove('hidden');
      this.endingModal.classList.add('flex');
    });

    this.btnRestart.addEventListener('click', () => {
      this.restartExperience();
    });

    // Responsive Resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private togglePeekMode(): void {
    this.debugPeek = !this.debugPeek;
    this.echoManager.setDebugPeek(this.debugPeek);
    this.builtScene.debugWireframeGroup.visible = this.debugPeek;

    this.btnPeek.setAttribute('aria-pressed', String(this.debugPeek));
    this.peekDot.className = this.debugPeek
      ? 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] transition-colors'
      : 'w-2 h-2 rounded-full bg-slate-500 transition-colors';

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

    this.posterWrap.classList.add('hidden');
    this.posterWrap.classList.remove('flex');
    this.btnGeneratePoster.textContent = '✦ 生成公益共情海报';

    this.endingModal.classList.remove('hidden');
    this.endingModal.classList.add('flex');

    this.a11yUI.speak(
      `体验完成。本次耗时 ${stats.elapsedSeconds} 秒，盲杖探路 ${stats.caneTaps} 次，遭遇碰壁 ${stats.obstacleBumps} 次。`
    );
  }

  private restartExperience(): void {
    this.endingModal.classList.add('hidden');
    this.endingModal.classList.remove('flex');
    this.btnReopenEnding.classList.add('hidden');

    this.btnCaneTap.disabled = true;
    this.echoManager.reset();
    this.caneSystem.reset();
    this.controller.reset();
    this.story.reset();

    if (this.debugPeek) {
      this.togglePeekMode();
    }

    this.controller.enabled = true;
    this.story.startJourney();
  }

  private updateAtmosphere(): void {
    if (this.debugPeek) {
      (this.scene.background as THREE.Color).copy(this.peekBgColor);
      this.fog.color.copy(this.peekBgColor);
      this.fog.density = 0.012;
      return;
    }

    const s = this.story.sunsetProgress;
    const ease = s * s * (3 - 2 * s);
    (this.scene.background as THREE.Color).lerpColors(this.darkBgColor, this.sunsetBgColor, ease);
    this.fog.color.lerpColors(this.darkBgColor, this.sunsetFogColor, ease);
    this.fog.density = THREE.MathUtils.lerp(0.08, 0.016, ease);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const dt = Math.min(0.05, this.clock.getDelta());
    this.totalElapsed += dt;

    this.controller.update(dt);

    const caneState = this.caneSystem.update(
      dt,
      this.controller.sweepInput,
      this.controller.isMoving,
      this.controller.walkCycle
    );
    this.echoManager.setCaneTip(caneState.tipPos, this.caneSystem.equipped);
    this.echoManager.update(dt);

    this.story.update(dt, this.totalElapsed, this.controller.position);

    const doorTargetAngle = this.story.doorOpened ? 1.42 : 0.14;
    this.builtScene.updateParticlesAndProps(dt, this.totalElapsed, doorTargetAngle);

    this.soundEngine.update(
      dt,
      this.controller.position,
      this.controller.yaw,
      this.story.doorOpened,
      this.story.strangerArrived
    );

    this.updateAtmosphere();
    this.renderer.render(this.scene, this.camera);
  };
}

new BlindPathGameApp();
