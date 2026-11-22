export interface AccessibilityCallbacks {
  onHighContrastChange: (enabled: boolean) => void;
  onEchoDurationChange: (seconds: number) => void;
}

export class AccessibilityUI {
  public highContrast = false;
  public ttsEnabled = false;
  public echoDuration = 2.5;

  private subtitleWrap: HTMLElement;
  private subtitleText: HTMLElement;
  private actBraille: HTMLElement;
  private actTitle: HTMLElement;
  private modal: HTMLElement;
  private toggleContrastBtn: HTMLElement;
  private toggleTtsBtn: HTMLElement;
  private echoDurLabel: HTMLElement;
  private echoDurBtns: NodeListOf<HTMLButtonElement>;

  private subtitleHideTimer: number | null = null;
  private callbacks: AccessibilityCallbacks;

  constructor(callbacks: AccessibilityCallbacks) {
    this.callbacks = callbacks;

    this.subtitleWrap = document.getElementById('subtitle-wrap')!;
    this.subtitleText = document.getElementById('subtitle-text')!;
    this.actBraille = document.getElementById('act-braille')!;
    this.actTitle = document.getElementById('act-title')!;
    this.modal = document.getElementById('a11y-modal')!;
    this.toggleContrastBtn = document.getElementById('toggle-contrast')!;
    this.toggleTtsBtn = document.getElementById('toggle-tts')!;
    this.echoDurLabel = document.getElementById('echo-duration-label')!;
    this.echoDurBtns = document.querySelectorAll<HTMLButtonElement>('.echo-dur-btn');

    this.bindEvents();
  }

  private bindEvents(): void {
    const openBtns = [
      document.getElementById('btn-a11y'),
      document.getElementById('btn-start-a11y'),
    ];
    openBtns.forEach((btn) => {
      btn?.addEventListener('click', () => {
        this.openModal();
        this.speak('已打开无障碍辅助设置');
      });
    });

    const closeBtns = [
      document.getElementById('btn-close-a11y'),
      document.getElementById('btn-done-a11y'),
    ];
    closeBtns.forEach((btn) => {
      btn?.addEventListener('click', () => {
        this.closeModal();
        this.speak('已保存无障碍设置');
      });
    });

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });

    // 1. High Contrast Toggle
    this.toggleContrastBtn.addEventListener('click', () => {
      this.highContrast = !this.highContrast;
      document.body.classList.toggle('high-contrast', this.highContrast);
      this.updateSwitchVisual(this.toggleContrastBtn, this.highContrast);
      this.callbacks.onHighContrastChange(this.highContrast);
      this.speak(this.highContrast ? '高对比度模式已开启' : '高对比度模式已关闭');
    });

    // 2. Echo Persistence Duration (1.5s / 2.5s / 4.0s)
    this.echoDurBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.dataset.echoDur || '2.5');
        this.echoDuration = val;
        this.callbacks.onEchoDurationChange(val);

        this.echoDurBtns.forEach((b) => {
          const active = parseFloat(b.dataset.echoDur || '0') === val;
          b.className = active
            ? 'echo-dur-btn rounded-xl border border-amber-400 bg-amber-500/20 py-2 text-xs font-medium text-amber-200 transition cursor-pointer'
            : 'echo-dur-btn rounded-xl border border-white/15 bg-white/[0.04] py-2 text-xs font-medium text-slate-300 hover:bg-white/10 transition cursor-pointer';
        });

        const tag = val <= 1.6 ? '挑战' : val >= 3.5 ? '从容' : '标准';
        this.echoDurLabel.textContent = `${val.toFixed(1)}s（${tag}）`;
        this.speak(`声波停留时长已设为 ${val} 秒`);
      });
    });

    // 3. Native SpeechSynthesis TTS Toggle
    this.toggleTtsBtn.addEventListener('click', () => {
      this.ttsEnabled = !this.ttsEnabled;
      this.updateSwitchVisual(this.toggleTtsBtn, this.ttsEnabled);
      if (this.ttsEnabled) {
        this.speak('菜单与字幕语音朗读已开启', true);
      } else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    });

    // Speak interactive buttons on focus/hover when TTS is enabled
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('focus', () => {
        if (!this.ttsEnabled) return;
        const label = button.getAttribute('title') || button.textContent?.trim() || '';
        if (label) this.speak(label);
      });
    });
  }

  private updateSwitchVisual(btn: HTMLElement, active: boolean): void {
    btn.setAttribute('aria-pressed', String(active));
    btn.classList.toggle('bg-amber-500', active);
    btn.classList.toggle('bg-slate-700', !active);
    const dot = btn.querySelector('.toggle-dot') as HTMLElement | null;
    if (dot) {
      dot.style.transform = active ? 'translateX(24px)' : 'translateX(0px)';
    }
  }

  public openModal(): void {
    this.modal.classList.remove('hidden');
    this.modal.classList.add('flex');
  }

  public closeModal(): void {
    this.modal.classList.add('hidden');
    this.modal.classList.remove('flex');
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

  public showSubtitle(text: string, durationMs = 6200): void {
    if (this.subtitleHideTimer !== null) {
      window.clearTimeout(this.subtitleHideTimer);
    }

    this.subtitleText.textContent = text;
    this.subtitleWrap.classList.remove('opacity-0', 'translate-y-2');
    this.subtitleWrap.classList.add('opacity-100', 'translate-y-0');

    this.speak(text);

    if (durationMs > 0) {
      this.subtitleHideTimer = window.setTimeout(() => {
        this.subtitleWrap.classList.remove('opacity-100', 'translate-y-0');
        this.subtitleWrap.classList.add('opacity-0', 'translate-y-2');
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
      utter.pitch = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech synthesis errors on restricted webviews
    }
  }
}
