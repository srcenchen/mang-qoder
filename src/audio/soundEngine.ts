import * as THREE from 'three';
import { SurfaceTag, WAYPOINTS } from '../level/levelData';

export class SpatialSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private isMuted = false;
  private volume = 0.88;
  private unlocked = false;

  // Continuous Spatial Layers
  private stallGain: GainNode | null = null;
  private stallPanner: StereoPannerNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;

  // Ambient Piano Scheduler
  private pianoTimer = 1.8;
  private pianoStep = 0;
  private stepSide = 1;

  public unlockAndInit(): void {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);

      this.noiseBuffer = this.createNoiseBuffer(this.ctx, 2.5);
      this.setupContinuousLoops();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.unlocked = true;
  }

  public setMasterVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.masterGain && !this.isMuted) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.04);
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.isMuted ? 0.0 : this.volume,
        this.ctx.currentTime,
        0.04
      );
    }
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.18) * 0.55;
    }
    return buffer;
  }

  private setupContinuousLoops(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;

    // 1. Breakfast Stall Warm Steamer / Sizzle Micro-Ambience (Left Channel)
    const stallSrc = this.ctx.createBufferSource();
    stallSrc.buffer = this.noiseBuffer;
    stallSrc.loop = true;

    const stallFilter = this.ctx.createBiquadFilter();
    stallFilter.type = 'bandpass';
    stallFilter.frequency.value = 1520;
    stallFilter.Q.value = 0.82;

    this.stallPanner = this.ctx.createStereoPanner();
    this.stallPanner.pan.value = -0.75;

    this.stallGain = this.ctx.createGain();
    this.stallGain.gain.value = 0.0;

    stallSrc.connect(stallFilter);
    stallFilter.connect(this.stallPanner);
    this.stallPanner.connect(this.stallGain);
    this.stallGain.connect(this.masterGain);
    stallSrc.start();

    // 2. Continuous Rain & Wet Night Air Bed (muffled indoors, crisp outdoors!)
    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = this.noiseBuffer;
    rainSrc.loop = true;

    this.rainFilter = this.ctx.createBiquadFilter();
    this.rainFilter.type = 'lowpass';
    this.rainFilter.frequency.value = 280;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0.035;

    rainSrc.connect(this.rainFilter);
    this.rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    rainSrc.start();
  }

  /**
   * 1. Differentiated Cane Tap Sounds (Normal Tap + Charged Heavy Wide-Range Resonance!)
   */
  public playCaneTap(tag: SurfaceTag, pan = 0, isManualTap = true, isHeavyEcho = false): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const vol = (isManualTap ? 1.0 : 0.45) * (isHeavyEcho ? 1.35 : 1.0);

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.95, Math.min(0.95, pan));
    panner.connect(this.masterGain);

    if (isHeavyEcho) {
      // Deep resonant echolocation harmonic bloom for charged heavy tap!
      this.synthStrike(panner, now, 220, 92, 0.42, 0.34, 'sine');
      this.synthStrike(panner, now + 0.03, 523.25, 520, 0.55, 0.14, 'triangle');
    }

    if (tag === 'tactile_line') {
      this.synthStrike(panner, now, 980, 1420, 0.1, 0.34 * vol, 'triangle');
      this.synthNoiseClick(panner, now, 1850, 2.2, 0.048, 0.22 * vol);
    } else if (tag === 'tactile_dot') {
      this.synthStrike(panner, now, 1180, 1520, 0.08, 0.32 * vol, 'sine');
      this.synthStrike(panner, now + 0.058, 1460, 1760, 0.09, 0.34 * vol, 'sine');
    } else if (tag === 'bike' || tag === 'door' || tag === 'signal_pole') {
      this.synthStrike(panner, now, 1740, 1690, 0.22, 0.28 * vol, 'sawtooth');
      this.synthStrike(panner, now, 2630, 2580, 0.28, 0.22 * vol, 'sine');
      this.synthNoiseClick(panner, now, 3400, 4.0, 0.04, 0.24 * vol);
    } else if (tag === 'barrier' || tag === 'stall') {
      this.synthStrike(panner, now, 310, 220, 0.11, 0.34 * vol, 'triangle');
      this.synthNoiseClick(panner, now, 780, 1.8, 0.055, 0.24 * vol);
    } else if (tag === 'cat') {
      this.playCatGreeting(pan);
    } else if (tag === 'cane_pickup') {
      this.synthStrike(panner, now, 660, 990, 0.16, 0.32, 'sine');
    } else {
      this.synthStrike(panner, now, 185, 115, 0.085, 0.28 * vol, 'sine');
      this.synthNoiseClick(panner, now, 640, 1.1, 0.045, 0.18 * vol);
    }
  }

  public playListenSonarPing(): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    this.playPianoTone(587.33, now, 1.35, 0.09);
    this.playPianoTone(880.0, now + 0.08, 1.5, 0.07);
  }

  public playDiscoveryChime(): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    this.playPianoTone(523.25, now, 1.2, 0.12);
    this.playPianoTone(659.25, now + 0.09, 1.4, 0.12);
    this.playPianoTone(1046.5, now + 0.18, 1.8, 0.11);
  }

  public playFootstep(onTactile: boolean, isIndoor: boolean): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    this.stepSide = -this.stepSide;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = this.stepSide * 0.14;
    panner.connect(this.masterGain);

    if (onTactile) {
      this.synthStrike(panner, now, 245, 152, 0.065, 0.14, 'triangle');
      this.synthNoiseClick(panner, now, 1380, 1.8, 0.05, 0.13);
    } else if (isIndoor) {
      this.synthStrike(panner, now, 155, 95, 0.06, 0.13, 'sine');
      this.synthNoiseClick(panner, now, 520, 1.2, 0.04, 0.08);
    } else {
      // Wet rain puddle footstep splash!
      this.synthStrike(panner, now, 145, 88, 0.065, 0.12, 'sine');
      this.synthNoiseClick(panner, now, 1180, 0.85, 0.075, 0.12);
    }
  }

  /** Soft companion footsteps in the left ear while the kind stranger walks beside you holding your hand! */
  public playCompanionFootstep(): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = -0.56;
    panner.connect(this.masterGain);
    this.synthStrike(panner, now, 175, 102, 0.06, 0.11, 'sine');
    this.synthNoiseClick(panner, now, 1020, 1.1, 0.065, 0.09);
  }

  public playCollisionBump(tag: SurfaceTag): void {
    try {
      navigator.vibrate?.(70);
    } catch {
      // Ignore on unsupported platforms
    }
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;

    this.synthStrike(this.masterGain, now, 135, 52, 0.24, 0.48, 'triangle');
    if (tag === 'bike') {
      this.synthStrike(this.masterGain, now + 0.02, 1580, 1490, 0.26, 0.26, 'sawtooth');
      this.synthStrike(this.masterGain, now + 0.05, 2920, 2890, 0.35, 0.18, 'sine');
    } else {
      this.synthStrike(this.masterGain, now + 0.03, 340, 210, 0.18, 0.32, 'square');
      this.synthNoiseClick(this.masterGain, now + 0.02, 850, 1.4, 0.12, 0.28);
    }
  }

  public playDoorOpen(): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    this.synthStrike(this.masterGain, now, 880, 620, 0.08, 0.24, 'triangle');
    this.synthStrike(this.masterGain, now + 0.09, 260, 195, 0.45, 0.18, 'sine');
  }

  public playCatGreeting(pan = -0.55): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.masterGain);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(510, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.15);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.44);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);

    osc.connect(gain);
    gain.connect(panner);
    osc.start(now);
    osc.stop(now + 0.48);
  }

  public playWarmStrangerChime(): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const freqs = [349.23, 440.0, 523.25, 783.99];
    freqs.forEach((f, idx) => {
      this.playPianoTone(f, now + idx * 0.14, 2.6, 0.17);
    });
  }

  public playTrafficWhoosh(direction: 1 | -1, volumeBoost = 1.0): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const dur = 1.45;

    const panner = this.ctx.createStereoPanner();
    const startPan = direction === 1 ? -0.95 : 0.95;
    const endPan = direction === 1 ? 0.95 : -0.95;
    panner.pan.setValueAtTime(startPan, now);
    panner.pan.linearRampToValueAtTime(endPan, now + dur);
    panner.connect(this.masterGain);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.15;
    filter.frequency.setValueAtTime(360, now);
    filter.frequency.exponentialRampToValueAtTime(1320, now + dur * 0.48);
    filter.frequency.exponentialRampToValueAtTime(280, now + dur);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.001, now);
    nGain.gain.exponentialRampToValueAtTime(0.38 * volumeBoost, now + dur * 0.48);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(panner);
    noise.start(now);
    noise.stop(now + dur + 0.05);

    const eng = this.ctx.createOscillator();
    eng.type = 'sawtooth';
    eng.frequency.setValueAtTime(165, now);
    eng.frequency.linearRampToValueAtTime(185, now + dur * 0.45);
    eng.frequency.exponentialRampToValueAtTime(106, now + dur);

    const engFilter = this.ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 320;

    const eGain = this.ctx.createGain();
    eGain.gain.setValueAtTime(0.001, now);
    eGain.gain.linearRampToValueAtTime(0.11 * volumeBoost, now + dur * 0.48);
    eGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    eng.connect(engFilter);
    engFilter.connect(eGain);
    eGain.connect(panner);
    eng.start(now);
    eng.stop(now + dur + 0.05);
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    doorOpened: boolean,
    warmMajorFinale: boolean,
    listenBlend: number
  ): void {
    if (!this.ctx || !this.unlocked) return;
    const now = this.ctx.currentTime;

    // Rain ambience smoothly brightens when stepping outdoors or holding Focus Listen!
    if (this.rainGain && this.rainFilter) {
      const targetGain = doorOpened
        ? (warmMajorFinale ? 0.05 : 0.14) * (1.0 + listenBlend * 0.35)
        : 0.035;
      const targetFreq = doorOpened ? (warmMajorFinale ? 950 : 1850) : 290;
      this.rainGain.gain.setTargetAtTime(targetGain, now, 0.25);
      this.rainFilter.frequency.setTargetAtTime(targetFreq, now, 0.35);
    }

    // Scene 3 Breakfast Stall Spatial Panning
    if (this.stallGain && this.stallPanner) {
      const dx = WAYPOINTS.stallLightPos.x - playerPos.x;
      const dz = WAYPOINTS.stallLightPos.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      const maxRange = 11.0;

      if (dist < maxRange) {
        const rightX = Math.cos(playerYaw);
        const rightZ = -Math.sin(playerYaw);
        const pan = Math.max(-0.92, Math.min(0.92, (dx * rightX + dz * rightZ) / Math.max(1, dist)));
        const proximity = Math.pow(1 - dist / maxRange, 1.6);
        this.stallPanner.pan.setTargetAtTime(pan, now, 0.08);
        this.stallGain.gain.setTargetAtTime(
          proximity * (0.28 + listenBlend * 0.18),
          now,
          0.12
        );
      } else {
        this.stallGain.gain.setTargetAtTime(0.0, now, 0.2);
      }
    }

    // Minimalist Ambient Piano
    this.pianoTimer -= dt;
    if (this.pianoTimer <= 0) {
      if (warmMajorFinale) {
        const majorChords = [
          [261.63, 329.63, 392.0, 493.88],
          [349.23, 440.0, 523.25, 659.25],
          [293.66, 392.0, 493.88, 587.33],
        ];
        const chord = majorChords[this.pianoStep % majorChords.length];
        chord.forEach((freq, i) => {
          this.playPianoTone(freq, now + i * 0.08, 3.6, 0.075);
        });
        this.pianoStep += 1;
        this.pianoTimer = 3.8;
      } else {
        const pensiveNotes = [220.0, 261.63, 329.63, 293.66, 246.94, 392.0];
        const note = pensiveNotes[this.pianoStep % pensiveNotes.length];
        this.playPianoTone(note, now, 2.9, 0.062);
        this.pianoStep += 1;
        this.pianoTimer = 3.4 + (this.pianoStep % 3) * 0.8;
      }
    }
  }

  private playPianoTone(freq: number, startTime: number, duration: number, peakGain: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.value = freq;
    osc2.frequency.value = freq * 2.0;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3.2, startTime);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.1, startTime + duration);

    const g1 = this.ctx.createGain();
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.15;

    g1.gain.setValueAtTime(0.0001, startTime);
    g1.gain.linearRampToValueAtTime(peakGain, startTime + 0.035);
    g1.gain.exponentialRampToValueAtTime(0.0005, startTime + duration);

    osc1.connect(filter);
    osc2.connect(g2);
    g2.connect(filter);
    filter.connect(g1);
    g1.connect(this.masterGain);

    osc1.start(startTime);
    osc2.start(startTime);
    osc1.stop(startTime + duration + 0.05);
    osc2.stop(startTime + duration + 0.05);
  }

  private synthStrike(
    dest: AudioNode,
    time: number,
    startFreq: number,
    endFreq: number,
    dur: number,
    gainVal: number,
    type: OscillatorType
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), time + dur);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(gainVal, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + dur);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private synthNoiseClick(
    dest: AudioNode,
    time: number,
    centerFreq: number,
    q: number,
    dur: number,
    gainVal: number
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centerFreq;
    filter.Q.value = q;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainVal, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(time);
    src.stop(time + dur + 0.02);
  }
}
