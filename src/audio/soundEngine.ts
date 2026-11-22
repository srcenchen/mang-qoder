import * as THREE from 'three';
import { SurfaceTag, WAYPOINTS } from '../level/levelData';

export class SpatialSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private isMuted = false;
  private unlocked = false;

  // Continuous Scene 3 Breakfast Stall Spatial Nodes
  private stallGain: GainNode | null = null;
  private stallPanner: StereoPannerNode | null = null;

  // Outdoor Night Wind / Distant Street Bed
  private outdoorBedGain: GainNode | null = null;

  // Minimalist Ambient Piano Scheduler
  private pianoTimer = 1.8;
  private pianoStep = 0;
  private stepSide = 1;

  /**
   * Must be called synchronously inside user click ("开始体验") for iOS Safari & WeChat compatibility!
   */
  public unlockAndInit(): void {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : 0.88;
      this.masterGain.connect(this.ctx.destination);

      this.noiseBuffer = this.createNoiseBuffer(this.ctx, 2.0);
      this.setupContinuousLoops();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.unlocked = true;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.isMuted ? 0.0 : 0.88,
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
      // Warm pink-filtered noise
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.18) * 0.55;
    }
    return buffer;
  }

  private setupContinuousLoops(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;

    // 1. Breakfast Stall Warm Steamer / Sizzle Micro-Ambience (Scene 3, Z = -24.6, Left X = -3.0)
    const stallSrc = this.ctx.createBufferSource();
    stallSrc.buffer = this.noiseBuffer;
    stallSrc.loop = true;

    const stallFilter = this.ctx.createBiquadFilter();
    stallFilter.type = 'bandpass';
    stallFilter.frequency.value = 1450;
    stallFilter.Q.value = 0.85;

    this.stallPanner = this.ctx.createStereoPanner();
    this.stallPanner.pan.value = -0.75;

    this.stallGain = this.ctx.createGain();
    this.stallGain.gain.value = 0.0;

    stallSrc.connect(stallFilter);
    stallFilter.connect(this.stallPanner);
    this.stallPanner.connect(this.stallGain);
    this.stallGain.connect(this.masterGain);
    stallSrc.start();

    // 2. Subtle Outdoor Damp Night Air Bed
    const nightSrc = this.ctx.createBufferSource();
    nightSrc.buffer = this.noiseBuffer;
    nightSrc.loop = true;

    const nightFilter = this.ctx.createBiquadFilter();
    nightFilter.type = 'lowpass';
    nightFilter.frequency.value = 340;

    this.outdoorBedGain = this.ctx.createGain();
    this.outdoorBedGain.gain.value = 0.0;

    nightSrc.connect(nightFilter);
    nightFilter.connect(this.outdoorBedGain);
    this.outdoorBedGain.connect(this.masterGain);
    nightSrc.start();
  }

  /**
   * 1. Differentiated Cane Tap Sounds by SurfaceTag + Stereo Pan
   */
  public playCaneTap(tag: SurfaceTag, pan = 0, isManualTap = true): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const vol = isManualTap ? 1.0 : 0.48;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.95, Math.min(0.95, pan));
    panner.connect(this.masterGain);

    if (tag === 'tactile_line') {
      // Crisp resonant ceramic/hardwood bar click
      this.synthStrike(panner, now, 980, 1420, 0.095, 0.34 * vol, 'triangle');
      this.synthNoiseClick(panner, now, 1850, 2.2, 0.045, 0.22 * vol);
    } else if (tag === 'tactile_dot') {
      // Distinct twin high ceramic warning chime!
      this.synthStrike(panner, now, 1180, 1520, 0.075, 0.32 * vol, 'sine');
      this.synthStrike(panner, now + 0.058, 1460, 1760, 0.085, 0.34 * vol, 'sine');
    } else if (tag === 'bike' || tag === 'door') {
      // Sharp metallic clank & frame ring
      this.synthStrike(panner, now, 1740, 1690, 0.22, 0.28 * vol, 'sawtooth');
      this.synthStrike(panner, now, 2630, 2580, 0.28, 0.22 * vol, 'sine');
      this.synthNoiseClick(panner, now, 3400, 4.0, 0.04, 0.25 * vol);
    } else if (tag === 'barrier' || tag === 'stall') {
      // Hollow wooden board knock
      this.synthStrike(panner, now, 310, 220, 0.11, 0.34 * vol, 'triangle');
      this.synthNoiseClick(panner, now, 780, 1.8, 0.055, 0.24 * vol);
    } else if (tag === 'cat') {
      // Gentle warm cat meow/trill
      this.playCatGreeting(pan);
    } else if (tag === 'cane_pickup') {
      this.synthStrike(panner, now, 660, 990, 0.16, 0.32, 'sine');
    } else {
      // Muted damp concrete / asphalt tap
      this.synthStrike(panner, now, 185, 115, 0.085, 0.28 * vol, 'sine');
      this.synthNoiseClick(panner, now, 620, 1.1, 0.045, 0.18 * vol);
    }
  }

  /**
   * 2. Footstep Synthesis (Differentiates Yellow Tactile Bricks vs Wet Pavement vs Indoor Tile)
   */
  public playFootstep(onTactile: boolean, isIndoor: boolean): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    this.stepSide = -this.stepSide;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = this.stepSide * 0.14;
    panner.connect(this.masterGain);

    if (onTactile) {
      this.synthStrike(panner, now, 240, 150, 0.065, 0.14, 'triangle');
      this.synthNoiseClick(panner, now, 1350, 1.8, 0.05, 0.13);
    } else if (isIndoor) {
      this.synthStrike(panner, now, 155, 95, 0.06, 0.13, 'sine');
      this.synthNoiseClick(panner, now, 520, 1.2, 0.04, 0.08);
    } else {
      // Damp outdoor stone pavement step
      this.synthStrike(panner, now, 145, 88, 0.065, 0.12, 'sine');
      this.synthNoiseClick(panner, now, 920, 0.9, 0.06, 0.1);
    }
  }

  /**
   * 3. Obstacle Collision Setback Impact + Haptic Vibration (70ms)
   */
  public playCollisionBump(tag: SurfaceTag): void {
    try {
      navigator.vibrate?.(70);
    } catch {
      // Ignore on unsupported browsers
    }

    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;

    // Low body thud
    this.synthStrike(this.masterGain, now, 135, 52, 0.24, 0.48, 'triangle');

    if (tag === 'bike') {
      // Metallic bike frame rattle + faint handlebar bell ping
      this.synthStrike(this.masterGain, now + 0.02, 1580, 1490, 0.26, 0.26, 'sawtooth');
      this.synthStrike(this.masterGain, now + 0.05, 2920, 2890, 0.35, 0.18, 'sine');
    } else {
      // Construction wooden sawhorse clatter
      this.synthStrike(this.masterGain, now + 0.03, 340, 210, 0.18, 0.32, 'square');
      this.synthNoiseClick(this.masterGain, now + 0.02, 850, 1.4, 0.12, 0.28);
    }
  }

  public playDoorOpen(): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    // Metallic latch click + gentle hinge sweep
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
    osc.frequency.exponentialRampToValueAtTime(740, now + 0.14);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.42);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gain);
    gain.connect(panner);
    osc.start(now);
    osc.stop(now + 0.46);
  }

  public playWarmStrangerChime(): void {
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    // Uplifting warm golden triad arpeggio (F4 -> A4 -> C5 -> G5)
    const freqs = [349.23, 440.0, 523.25, 783.99];
    freqs.forEach((f, idx) => {
      this.playPianoTone(f, now + idx * 0.14, 2.4, 0.16);
    });
  }

  /**
   * 5. Binaural Crosswalk Traffic Whoosh (-0.95 -> +0.95 or +0.95 -> -0.95) with Doppler Shift!
   */
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

    // Wet tire spray whoosh
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.15;
    filter.frequency.setValueAtTime(360, now);
    filter.frequency.exponentialRampToValueAtTime(1250, now + dur * 0.48);
    filter.frequency.exponentialRampToValueAtTime(280, now + dur);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.001, now);
    nGain.gain.exponentialRampToValueAtTime(0.36 * volumeBoost, now + dur * 0.48);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(panner);
    noise.start(now);
    noise.stop(now + dur + 0.05);

    // Doppler engine hum
    const eng = this.ctx.createOscillator();
    eng.type = 'sawtooth';
    eng.frequency.setValueAtTime(165, now);
    eng.frequency.linearRampToValueAtTime(182, now + dur * 0.45);
    eng.frequency.exponentialRampToValueAtTime(108, now + dur);

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

  /**
   * 4 & 6. Updates spatial breakfast stall left-channel ambience & minimalist ambient piano
   */
  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    doorOpened: boolean,
    warmMajorFinale: boolean
  ): void {
    if (!this.ctx || !this.unlocked) return;
    const now = this.ctx.currentTime;

    // Outdoor ambient bed level
    if (this.outdoorBedGain) {
      const targetBed = doorOpened ? (warmMajorFinale ? 0.06 : 0.14) : 0.02;
      this.outdoorBedGain.gain.setTargetAtTime(targetBed, now, 0.25);
    }

    // Scene 3 Breakfast Stall Spatial Panning (Left Sidewalk X = -3.0, Z = -24.6)
    if (this.stallGain && this.stallPanner) {
      const dx = WAYPOINTS.stallLightPos.x - playerPos.x;
      const dz = WAYPOINTS.stallLightPos.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      const maxRange = 9.5;

      if (dist < maxRange) {
        // Project onto player's right-hand vector (cos(yaw), -sin(yaw))
        const rightX = Math.cos(playerYaw);
        const rightZ = -Math.sin(playerYaw);
        const pan = Math.max(-0.92, Math.min(0.92, (dx * rightX + dz * rightZ) / Math.max(1, dist)));
        const proximity = Math.pow(1 - dist / maxRange, 1.7);
        this.stallPanner.pan.setTargetAtTime(pan, now, 0.08);
        this.stallGain.gain.setTargetAtTime(proximity * 0.28, now, 0.12);
      } else {
        this.stallGain.gain.setTargetAtTime(0.0, now, 0.2);
      }
    }

    // 6. Minimalist Ambient Piano (Contemplative sparse notes -> Warm Major Chords at Finale!)
    this.pianoTimer -= dt;
    if (this.pianoTimer <= 0) {
      if (warmMajorFinale) {
        const majorChords = [
          [261.63, 329.63, 392.0, 493.88], // Cmaj7
          [349.23, 440.0, 523.25, 659.25], // Fmaj7
          [293.66, 392.0, 493.88, 587.33], // G6
        ];
        const chord = majorChords[this.pianoStep % majorChords.length];
        chord.forEach((freq, i) => {
          this.playPianoTone(freq, now + i * 0.08, 3.6, 0.075);
        });
        this.pianoStep += 1;
        this.pianoTimer = 3.8;
      } else {
        // Gentle, lonely felt-piano single notes
        const pensiveNotes = [220.0, 261.63, 329.63, 293.66, 246.94, 392.0];
        const note = pensiveNotes[this.pianoStep % pensiveNotes.length];
        this.playPianoTone(note, now, 2.9, 0.065);
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
