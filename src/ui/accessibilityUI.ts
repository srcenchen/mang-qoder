import { AcousticBeacon } from '../level/levelData';
import { QualityName } from '../render/quality';

export interface AccessibilityCallbacks {
  onHighContrastChange: (enabled: boolean) => void;
  onEchoDurationChange: (seconds: number) => void;
  onQualityChange: (quality: QualityName) => void;
  onVolumeChange: (volume: number) => void;
  onSensitivityChange: (sens: number) => void;
  onAutoLandscapeChange: (enabled: boolean) => void;
  onDrawerToggle: (open: boolean) => void;
}

export class AccessibilityUI {
  public highContrast = false;
  public ttsEnabled = false;
  public autoLandscape = true;
  public echoDuration = 2.5;

  private subtitleWrap: HTMLElement;
  private subtitleSpeaker: HTMLElement;
  private subtitleText: HTMLElement;
  private actBraille: HTMLElement;
  private actTitle: HTMLElement;
  private memoryBadge: HTMLElement;
  private locCard: HTMLElement;
  private locTitle: HTMLElement;
  private locSub: HTMLElement;
  private pointerHint: HTMLElement;
  private centerReticle: HTMLElement;

  private compassTape: HTMLElement;
  private compassBlips: HTMLElement;
  private compassModeTag: HTMLElement;
  private chargeArc: SVGCircleElement;

  private modal: HTMLElement;
  private toggleContrastBtn: HTMLElement;
  private toggleTtsBtn: HTMLElement;
  private toggleLandscapeBtn: HTMLElement;
  private echoDurLabel: HTMLElement;
  private echoDurBtns: NodeListOf<HTMLButtonElement>;
  private qualityBtns: NodeListOf<HTMLButtonElement>;
  private tabs: NodeListOf<HTMLButtonElement>;
  private panes: NodeListOf<HTMLElement>;

  private subtitleHideTimer: number | null = null;
  private locCardTimer: number | null = null;
  private callbacks: AccessibilityCallbacks;

  constructor(initialQuality: QualityName, callbacks: AccessibilityCallbacks) {
    this.callbacks = callbacks;

    this.subtitleWrap = document.getElementById('subtitle-wrap')!;
    this.subtitleSpeaker = document.getElementById('subtitle-speaker')!;
    this.subtitleText = document.getElementById('subtitle-text')!;
    this.actBraille = document.getElementById('act-braille')!;
    this.actTitle = document.getElementById('act-title')!;
    this.memoryBadge = document.getElementById('memory-badge')!;
    this.locCard = document.getElementById('loc-card')!;
    this.locTitle = document.getElementById('loc-card-title')!;
    this.locSub = document.getElementById('loc-card-sub')!;
    this.pointerHint = document.getElementById('pointer-hint')!;
    this.centerReticle = document.getElementById('center-reticle')!;

    this.compassTape = document.getElementById('compass-tape')!;
    this.compassBlips = document.getElementById('compass-blips')!;
    this.compassModeTag = document.getElementById('compass-mode-tag')!;
    this.chargeArc = document.getElementById('charge-arc') as unknown as SVGCircleElement;

    this.modal = document.getElementById('a11y-modal')!;
    this.toggleContrastBtn = document.getElementById('toggle-contrast')!;
    this.toggleTtsBtn = document.getElementById('toggle-tts')!;
    this.toggleLandscapeBtn = document.getElementById('toggle-landscape')!;
    this.echoDurLabel = document.getElementById('echo-duration-label')!;
    this.echoDurBtns = document.querySelectorAll<HTMLButtonElement>('.echo-dur-btn');
    this.qualityBtns = document.querySelectorAll<HTMLButtonElement>('.quality-btn');
    this.tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
    this.panes = document.querySelectorAll<HTMLElement>('[data-pane]');

    this.buildCompassTicks();
    this.syncQualityButtons(initialQuality);
    this.bindEvents();
  }

  private buildCompassTicks(): void {
    // 720-degree repeating graduation strip (4px per degree -> 2880px wide)
    const frag = document.createDocumentFragment();
    const cardinals: Record<number, string> = {
      0: '前',
      90: '右',
      180: '后',
      270: '左',
    };
    for (let deg = -360; deg <= 720; deg += 10) {
      const x = (deg + 360) * 3.0;
      const tick = document.createElement('i');
      tick.className = 'compass-tick';
      const norm = ((deg % 360) + 360) % 360;
      tick.style.left = `${x}px`;
      tick.style.height = norm % 90 === 0 ? '11px' : norm % 30 === 0 ? '7px' : '4px';
      tick.style.opacity = norm % 90 === 0 ? '0.9' : norm % 30 === 0 ? '0.6' : '0.32';
      frag.appendChild(tick);

      if (cardinals[norm]) {
        const lbl = document.createElement('span');
        lbl.className = 'compass-cardinal';
        lbl.style.left = `${x}px`;
        lbl.textContent = cardinals[norm];
        frag.appendChild(lbl);
      }
    }
    this.compassTape.appendChild(frag);
  }

  public updateCompass(
    playerPos: { x: number; z: number },
    playerYaw: number,
    beacons: AcousticBeacon[],
    isListening: boolean
  ): void {
    // yaw = 0 faces -Z (0 deg = 前), yaw > 0 turns left (CCW)
    const headingDeg = (((-playerYaw * 180) / Math.PI) % 360 + 360) % 360;
    const centerPx = (this.compassTape.parentElement?.clientWidth || 340) * 0.5;
    const offset = centerPx - (headingDeg + 360) * 3.0;
    this.compassTape.style.transform = `translateX(${offset.toFixed(1)}px)`;

    this.compassModeTag.textContent = isListening ? '凝神声源强化' : '常态感知';

    // Update acoustic bearing blips on compass
    let html = '';
    for (const b of beacons) {
      if (!b.active) continue;
      const dx = b.x - playerPos.x;
      const dz = b.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      const effectiveR = isListening ? b.radius * 1.85 : b.radius;
      if (dist > effectiveR || dist < 0.35) continue;

      // Relative angle: 0 = straight ahead (-Z), + = right (+X), - = left (-X)
      const worldAngle = Math.atan2(dx, -dz); // 0 along -Z, +PI/2 along +X
      const playerHeading = -playerYaw;
      let rel = worldAngle - playerHeading;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;

      const relDeg = (rel * 180) / Math.PI;
      if (Math.abs(relDeg) > 62) continue;

      const px = centerPx + relDeg * 3.0;
      const opacity = Math.min(1, (1 - dist / effectiveR) * (isListening ? 1.5 : 1.0) + 0.25);
      html += `<span class="compass-blip ${b.color}" style="left:${px.toFixed(1)}px;opacity:${opacity.toFixed(2)}" title="${b.label}"></span>`;
    }
    this.compassBlips.innerHTML = html;
  }

  public setChargeProgress(progress: number): void {
    const circumference = 289;
    this.chargeArc.style.strokeDashoffset = `${circumference * (1 - Math.max(0, Math.min(1, progress)))}`;
  }

  public setMemoryCount(found: number, total: number): void {
    this.memoryBadge.textContent = `✦ ${found}/${total}`;
  }

  public showLocationCard(title: string, subtitle: string): void {
    if (this.locCardTimer !== null) window.clearTimeout(this.locCardTimer);
    this.locTitle.textContent = title;
    this.locSub.textContent = subtitle;
    this.locCard.classList.remove('on');
    void this.locCard.offsetWidth;
    this.locCard.classList.add('on');
    this.locCardTimer = window.setTimeout(() => {
      this.locCard.classList.remove('on');
    }, 4600);
  }

  private syncQualityButtons(active: QualityName): void {
    this.qualityBtns.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.quality === active));
    });
  }

  private bindEvents(): void {
    const openDrawer = (tabName: string) => {
      this.selectTab(tabName);
      this.openModal();
      this.speak('已打开设置与无障碍面板');
    };

    document.getElementById('btn-a11y')?.addEventListener('click', () => openDrawer('a11y'));
    document.getElementById('btn-start-a11y')?.addEventListener('click', () => openDrawer('a11y'));
    document.getElementById('btn-start-controls')?.addEventListener('click', () => openDrawer('controls'));
    document.getElementById('btn-start-about')?.addEventListener('click', () => openDrawer('about'));

    [document.getElementById('btn-close-a11y'), document.getElementById('btn-done-a11y')].forEach(
      (btn) => {
        btn?.addEventListener('click', () => {
          this.closeModal();
          this.speak('已保存设置');
        });
      }
    );

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });

    // Tab switching
    this.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.selectTab(tab.dataset.tab || 'a11y');
      });
    });

    // 1. High Contrast Toggle
    this.toggleContrastBtn.addEventListener('click', () => {
      this.highContrast = !this.highContrast;
      document.body.classList.toggle('high-contrast', this.highContrast);
      this.updateToggleVisual(this.toggleContrastBtn, this.highContrast);
      this.callbacks.onHighContrastChange(this.highContrast);
      this.speak(this.highContrast ? '高对比度模式已开启' : '高对比度模式已关闭');
    });

    // 2. Echo Duration (1.5s / 2.5s / 4.0s)
    this.echoDurBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.dataset.echoDur || '2.5');
        this.echoDuration = val;
        this.callbacks.onEchoDurationChange(val);
        this.echoDurBtns.forEach((b) => {
          b.setAttribute('aria-pressed', String(parseFloat(b.dataset.echoDur || '0') === val));
        });
        const tag = val <= 1.6 ? '挑战' : val >= 3.5 ? '从容' : '标准';
        this.echoDurLabel.textContent = `${val.toFixed(1)}s（${tag}）`;
        this.speak(`声波停留时长已设为 ${val} 秒`);
      });
    });

    // 3. TTS Toggle
    this.toggleTtsBtn.addEventListener('click', () => {
      this.ttsEnabled = !this.ttsEnabled;
      this.updateToggleVisual(this.toggleTtsBtn, this.ttsEnabled);
      if (this.ttsEnabled) {
        this.speak('菜单与字幕语音朗读已开启', true);
      } else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    });

    // 4. Graphics Quality Selector
    this.qualityBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = (btn.dataset.quality || 'high') as QualityName;
        this.syncQualityButtons(q);
        this.callbacks.onQualityChange(q);
      });
    });

    // 5. Volume & Mouse Sensitivity Sliders
    const volInput = document.getElementById('s-vol') as HTMLInputElement | null;
    const volOut = document.getElementById('o-vol');
    volInput?.addEventListener('input', () => {
      const v = parseInt(volInput.value, 10);
      if (volOut) volOut.textContent = `${v}%`;
      this.callbacks.onVolumeChange(v / 100);
    });

    const sensInput = document.getElementById('s-sens') as HTMLInputElement | null;
    const sensOut = document.getElementById('o-sens');
    sensInput?.addEventListener('input', () => {
      const v = parseFloat(sensInput.value);
      if (sensOut) sensOut.textContent = `${v.toFixed(2)}×`;
      this.callbacks.onSensitivityChange(v);
    });

    // 6. Mobile Auto-Landscape Toggle
    this.toggleLandscapeBtn.addEventListener('click', () => {
      this.autoLandscape = !this.autoLandscape;
      this.updateToggleVisual(this.toggleLandscapeBtn, this.autoLandscape);
      this.callbacks.onAutoLandscapeChange(this.autoLandscape);
    });

    // Focus announcement for TTS users
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('focus', () => {
        if (!this.ttsEnabled) return;
        const label = button.getAttribute('title') || button.textContent?.trim() || '';
        if (label) this.speak(label);
      });
    });
  }

  private selectTab(tabName: string): void {
    this.tabs.forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.tab === tabName));
    });
    this.panes.forEach((p) => {
      p.classList.toggle('hidden', p.dataset.pane !== tabName);
    });
  }

  private updateToggleVisual(btn: HTMLElement, active: boolean): void {
    btn.setAttribute('aria-pressed', String(active));
    const span = btn.querySelector('span');
    if (span) span.textContent = active ? '开启' : '关闭';
  }

  public setPointerLockVisual(locked: boolean, isTouchDevice: boolean, gameStarted: boolean): void {
    this.centerReticle.classList.toggle('hidden', !locked || isTouchDevice);
    this.pointerHint.classList.toggle('hidden', locked || isTouchDevice || !gameStarted);
  }

  public openModal(): void {
    this.modal.classList.remove('hidden');
    this.callbacks.onDrawerToggle(true);
  }

  public closeModal(): void {
    this.modal.classList.add('hidden');
    this.callbacks.onDrawerToggle(false);
  }

  public setActHeader(actNum: 1 | 2): void {
    if (actNum === 1) {
      this.actBraille.textContent = '⠁⠉⠞ ⠼⠁ · ⠋⠕⠽⠑⠗ ⠯ ⠏⠁⠞⠓';
      this.actTitle.textContent = '第一幕 · 暗室与占道盲道';
    } else {
      this.actBraille.textContent = '⠁⠉⠞ ⠼⠃ · ⠉⠗⠕⠎⠎⠺⠁⠇⠅';
      this.actTitle.textContent = '第二幕 · 无提示音斑马线';
    }
  }

  public showSubtitle(text: string, durationMs = 6200, speaker = '内心感知'): void {
    if (this.subtitleHideTimer !== null) {
      window.clearTimeout(this.subtitleHideTimer);
    }

    this.subtitleSpeaker.textContent = speaker;
    this.subtitleText.textContent = text;
    this.subtitleWrap.classList.add('on');
    this.speak(text);

    if (durationMs > 0) {
      this.subtitleHideTimer = window.setTimeout(() => {
        this.subtitleWrap.classList.remove('on');
      }, durationMs);
    }
  }

  public speak(text: string, force = false): void {
    if ((!this.ttsEnabled && !force) || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text.replace(/[·—]/g, '，'));
      utter.lang = 'zh-CN';
      utter.rate = 1.02;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore on unsupported webviews
    }
  }
}
