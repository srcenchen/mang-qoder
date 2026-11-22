import * as THREE from 'three';
import { WAYPOINTS } from '../level/levelData';

export const ECHO_WAVE_COUNT = 6;

export const COLOR_ECHO_CYAN = new THREE.Color('#38BDF8');
export const COLOR_ECHO_AMBER = new THREE.Color('#F59E0B');
export const COLOR_ECHO_ALARM = new THREE.Color('#FB7185');

interface ActiveEchoWave {
  origin: THREE.Vector3;
  color: THREE.Color;
  age: number;
  duration: number;
  maxRadius: number;
  intensity: number;
  active: boolean;
}

export interface EchoUniformState {
  uTime: { value: number };
  uWaves: { value: THREE.Vector4[] };
  uWaveColors: { value: THREE.Vector3[] };
  uWaveAlpha: { value: number[] };
  uCaneTip: { value: THREE.Vector3 };
  uCaneActive: { value: number };
  uDebugPeek: { value: number };
  uAttractReveal: { value: number };
  uHighContrast: { value: number };
  uSunsetFactor: { value: number };
  uStallLightPos: { value: THREE.Vector3 };
  uCatGlowPos: { value: THREE.Vector3 };
  uCatGlowStrength: { value: number };
  uCanePickupPos: { value: THREE.Vector3 };
  uCanePickupGlow: { value: number };
  uBarrierBeaconPos: { value: THREE.Vector3 };
  uBarrierBeaconPulse: { value: number };
  uRefl: { value: THREE.Texture | null };
  uReflMatrix: { value: THREE.Matrix4 };
  uReflOn: { value: number };
}

export interface EnhanceMaterialOptions {
  selfGlowBoost?: number;
  isWetGround?: boolean;
}

export class EchoShaderManager {
  public readonly uniforms: EchoUniformState;
  private waves: ActiveEchoWave[] = [];
  private nextWaveSlot = 0;
  private echoDuration = 2.5;

  constructor() {
    const waveVecs: THREE.Vector4[] = [];
    const waveCols: THREE.Vector3[] = [];
    const waveAlphas: number[] = [];

    for (let i = 0; i < ECHO_WAVE_COUNT; i++) {
      waveVecs.push(new THREE.Vector4(0, -100, 0, 0));
      waveCols.push(new THREE.Vector3(0.22, 0.74, 0.97));
      waveAlphas.push(0);
      this.waves.push({
        origin: new THREE.Vector3(0, -100, 0),
        color: COLOR_ECHO_CYAN.clone(),
        age: 0,
        duration: 2.5,
        maxRadius: 5.5,
        intensity: 1.0,
        active: false,
      });
    }

    this.uniforms = {
      uTime: { value: 0 },
      uWaves: { value: waveVecs },
      uWaveColors: { value: waveCols },
      uWaveAlpha: { value: waveAlphas },
      uCaneTip: { value: new THREE.Vector3(0, -50, 0) },
      uCaneActive: { value: 0 },
      uDebugPeek: { value: 0 },
      uAttractReveal: { value: 0.65 },
      uHighContrast: { value: 0 },
      uSunsetFactor: { value: 0 },
      uStallLightPos: {
        value: new THREE.Vector3(WAYPOINTS.stallLightPos.x, 1.25, WAYPOINTS.stallLightPos.z),
      },
      uCatGlowPos: {
        value: new THREE.Vector3(WAYPOINTS.catPos.x, WAYPOINTS.catPos.y + 0.2, WAYPOINTS.catPos.z),
      },
      uCatGlowStrength: { value: 0 },
      uCanePickupPos: {
        value: new THREE.Vector3(WAYPOINTS.canePickupPos.x, 0.65, WAYPOINTS.canePickupPos.z),
      },
      uCanePickupGlow: { value: 1.0 },
      uBarrierBeaconPos: {
        value: new THREE.Vector3(0, 1.15, WAYPOINTS.barrierCenter.z),
      },
      uBarrierBeaconPulse: { value: 0.5 },
      uRefl: { value: null },
      uReflMatrix: { value: new THREE.Matrix4() },
      uReflOn: { value: 0 },
    };
  }

  public setPlanarReflection(tex: THREE.Texture | null, matrix: THREE.Matrix4, enabled: boolean): void {
    this.uniforms.uRefl.value = tex;
    this.uniforms.uReflMatrix.value.copy(matrix);
    this.uniforms.uReflOn.value = enabled && tex ? 1.0 : 0.0;
  }

  public setEchoDuration(seconds: number): void {
    this.echoDuration = Math.max(1.0, Math.min(6.0, seconds));
  }

  public getEchoDuration(): number {
    return this.echoDuration;
  }

  public setDebugPeek(enabled: boolean): void {
    this.uniforms.uDebugPeek.value = enabled ? 1.0 : 0.0;
  }

  public setAttractReveal(val: number): void {
    this.uniforms.uAttractReveal.value = Math.max(0, Math.min(1, val));
  }

  public setHighContrast(enabled: boolean): void {
    this.uniforms.uHighContrast.value = enabled ? 1.0 : 0.0;
  }

  public setSunsetFactor(factor: number): void {
    this.uniforms.uSunsetFactor.value = Math.max(0, Math.min(1, factor));
  }

  public setCaneTip(pos: THREE.Vector3, active: boolean): void {
    this.uniforms.uCaneTip.value.copy(pos);
    this.uniforms.uCaneActive.value = active ? 1.0 : 0.0;
  }

  public setCanePickupVisible(visible: boolean, timeSec: number): void {
    this.uniforms.uCanePickupGlow.value = visible
      ? 0.65 + 0.35 * Math.sin(timeSec * 3.2)
      : 0.0;
  }

  public setCatGlow(strength: number): void {
    this.uniforms.uCatGlowStrength.value = Math.max(0, Math.min(1.6, strength));
  }

  public emitWave(
    origin: THREE.Vector3,
    palette: 'amber' | 'cyan' | 'alarm' | boolean,
    maxRadius = 5.4,
    durationScale = 1.0,
    intensity = 1.0
  ): void {
    const slot = this.waves[this.nextWaveSlot];
    this.nextWaveSlot = (this.nextWaveSlot + 1) % ECHO_WAVE_COUNT;

    const color =
      palette === true || palette === 'amber'
        ? COLOR_ECHO_AMBER
        : palette === 'alarm'
          ? COLOR_ECHO_ALARM
          : COLOR_ECHO_CYAN;

    slot.origin.copy(origin);
    slot.color.copy(color);
    slot.age = 0;
    slot.duration = this.echoDuration * durationScale;
    slot.maxRadius = maxRadius;
    slot.intensity = intensity;
    slot.active = true;
  }

  public reset(): void {
    for (let i = 0; i < ECHO_WAVE_COUNT; i++) {
      this.waves[i].active = false;
      this.uniforms.uWaves.value[i].set(0, -100, 0, 0);
      this.uniforms.uWaveAlpha.value[i] = 0;
    }
    this.uniforms.uSunsetFactor.value = 0;
    this.uniforms.uCatGlowStrength.value = 0;
    this.uniforms.uCanePickupGlow.value = 1;
  }

  public update(dt: number, elapsed: number): void {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uBarrierBeaconPulse.value = 0.25 + 0.75 * Math.pow(Math.sin(elapsed * 3.8) * 0.5 + 0.5, 2.2);

    for (let i = 0; i < ECHO_WAVE_COUNT; i++) {
      const w = this.waves[i];
      if (!w.active) {
        this.uniforms.uWaveAlpha.value[i] = 0;
        continue;
      }

      w.age += dt;
      const progress = w.age / w.duration;
      if (progress >= 1.0) {
        w.active = false;
        this.uniforms.uWaveAlpha.value[i] = 0;
        this.uniforms.uWaves.value[i].w = 0;
        continue;
      }

      const expandT = 1.0 - Math.pow(1.0 - Math.min(1.0, progress * 1.42), 2.35);
      const radius = expandT * w.maxRadius;
      const alpha = Math.pow(1.0 - progress, 1.25) * w.intensity;

      this.uniforms.uWaves.value[i].set(w.origin.x, w.origin.y, w.origin.z, radius);
      this.uniforms.uWaveColors.value[i].set(w.color.r, w.color.g, w.color.b);
      this.uniforms.uWaveAlpha.value[i] = alpha;
    }
  }

  public enhanceMaterial(
    mat: THREE.MeshStandardMaterial,
    options?: EnhanceMaterialOptions
  ): THREE.MeshStandardMaterial {
    const shared = this.uniforms;
    const selfBoost = options?.selfGlowBoost ?? 0.0;
    const isWetGround = options?.isWetGround ?? false;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = shared.uTime;
      shader.uniforms.uWaves = shared.uWaves;
      shader.uniforms.uWaveColors = shared.uWaveColors;
      shader.uniforms.uWaveAlpha = shared.uWaveAlpha;
      shader.uniforms.uCaneTip = shared.uCaneTip;
      shader.uniforms.uCaneActive = shared.uCaneActive;
      shader.uniforms.uDebugPeek = shared.uDebugPeek;
      shader.uniforms.uAttractReveal = shared.uAttractReveal;
      shader.uniforms.uHighContrast = shared.uHighContrast;
      shader.uniforms.uSunsetFactor = shared.uSunsetFactor;
      shader.uniforms.uStallLightPos = shared.uStallLightPos;
      shader.uniforms.uCatGlowPos = shared.uCatGlowPos;
      shader.uniforms.uCatGlowStrength = shared.uCatGlowStrength;
      shader.uniforms.uCanePickupPos = shared.uCanePickupPos;
      shader.uniforms.uCanePickupGlow = shared.uCanePickupGlow;
      shader.uniforms.uBarrierBeaconPos = shared.uBarrierBeaconPos;
      shader.uniforms.uBarrierBeaconPulse = shared.uBarrierBeaconPulse;
      shader.uniforms.uRefl = shared.uRefl;
      shader.uniforms.uReflMatrix = shared.uReflMatrix;
      shader.uniforms.uReflOn = shared.uReflOn;
      shader.uniforms.uSelfGlowBoost = { value: selfBoost };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vEchoWorldPos;`
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          #ifdef USE_INSTANCING
            vec4 echoWorldTmp = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
          #else
            vec4 echoWorldTmp = modelMatrix * vec4( transformed, 1.0 );
          #endif
          vEchoWorldPos = echoWorldTmp.xyz;`
        );

      const wetHelpers = isWetGround
        ? `
          float wHash1(vec2 p) {
            vec3 q = fract(vec3(p.xyx) * 0.1031);
            q += dot(q, q.yzx + 33.33);
            return fract((q.x + q.y) * q.z);
          }
          vec3 wHash3(vec2 p) {
            vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
            q += dot(q, q.yzx + 33.33);
            return fract((q.xxy + q.yzz) * q.zyx);
          }
          float wNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(wHash1(i), wHash1(i + vec2(1.0, 0.0)), f.x),
              mix(wHash1(i + vec2(0.0, 1.0)), wHash1(i + vec2(1.0, 1.0)), f.x),
              f.y
            );
          }
          // Animated raindrop concentric puddle ripples (inspired by baks/index.html!)
          vec2 wRipple(vec2 p, float t, float cell, float seed) {
            vec2 q = p / cell;
            vec2 id = floor(q);
            vec2 f = fract(q);
            vec3 h = wHash3(id + seed);
            float period = 0.65 + 0.55 * h.x;
            float life = fract(t / period + h.z);
            float on = step(0.45, h.y);
            vec2 ctr = 0.22 + 0.56 * h.xy;
            vec2 dv = f - ctr;
            float d = length(dv);
            float r = life * 0.44;
            float w = 0.015 + 0.028 * life;
            float x = (d - r) / w;
            float ring = x * exp(-x * x) * 2.2;
            float amp = (1.0 - life);
            amp = amp * amp * on * smoothstep(0.0, 0.08, life);
            return (dv / max(d, 1e-4)) * ring * amp;
          }
        `
        : '';

      const wetRoughnessInject = isWetGround
        ? `
          float wetMaskPuddle = 0.0;
          vec2 wetRippleSlope = vec2(0.0);
          if (vEchoWorldPos.z < -5.6) {
            vec2 gp = vEchoWorldPos.xz;
            float p1 = wNoise(gp * 0.28 + vec2(1.7, 4.3));
            float p2 = wNoise(gp * 0.72 - vec2(3.1, 2.5));
            float puddleField = p1 * 0.65 + p2 * 0.35;
            // Extra rain puddle richness near curb & crosswalk!
            float roadBonus = smoothstep(-31.0, -34.0, vEchoWorldPos.z) * 0.14;
            wetMaskPuddle = smoothstep(0.50 - roadBonus, 0.66 - roadBonus, puddleField);
            // Smooth out shelter under breakfast stall awning
            float underAwning = step(-4.5, gp.x) * step(gp.x, -2.0) * step(-26.4, gp.y) * step(gp.y, -22.8);
            wetMaskPuddle *= (1.0 - underAwning * 0.85);
            roughnessFactor = mix(roughnessFactor * 0.76, 0.055, wetMaskPuddle);
            wetRippleSlope = (wRipple(gp, uTime, 0.85, 1.3) + wRipple(gp + 0.41, uTime * 1.13, 0.52, 7.9) * 0.65) * wetMaskPuddle;
          }
        `
        : '';

      const wetPlanarReflectInject = isWetGround
        ? `
          if (uReflOn > 0.5 && vEchoWorldPos.z < -5.6) {
            vec3 viewDirW = normalize(cameraPosition - vEchoWorldPos);
            float fresnel = 0.06 + 0.94 * pow(1.0 - clamp(viewDirW.y, 0.0, 1.0), 4.2);
            vec4 rc = uReflMatrix * vec4(vEchoWorldPos.x, 0.08, vEchoWorldPos.z, 1.0);
            vec2 ruv = rc.xy / max(rc.w, 1e-4);
            ruv += wetRippleSlope * 0.022;
            vec2 rClamped = clamp(ruv, vec2(0.004), vec2(0.996));
            // Multi-tap vertically blurred planar reflection (tight in puddles, glossy sheen on damp stone)
            vec2 blurOff = vec2(0.0, mix(0.018, 0.004, wetMaskPuddle));
            vec3 reflCol = texture2D(uRefl, rClamped).rgb * 0.5
                         + texture2D(uRefl, clamp(rClamped + blurOff, vec2(0.004), vec2(0.996))).rgb * 0.25
                         + texture2D(uRefl, clamp(rClamped - blurOff, vec2(0.004), vec2(0.996))).rgb * 0.25;
            reflCol = min(reflCol, vec3(12.0));
            float reflWeight = mix(0.16, 0.88, wetMaskPuddle) * fresnel;
            outgoingLight += reflCol * reflWeight * mix(0.75, 1.25, uSunsetFactor);
          }
        `
        : '';

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vEchoWorldPos;
          uniform float uTime;
          uniform vec4 uWaves[${ECHO_WAVE_COUNT}];
          uniform vec3 uWaveColors[${ECHO_WAVE_COUNT}];
          uniform float uWaveAlpha[${ECHO_WAVE_COUNT}];
          uniform vec3 uCaneTip;
          uniform float uCaneActive;
          uniform float uDebugPeek;
          uniform float uAttractReveal;
          uniform float uHighContrast;
          uniform float uSunsetFactor;
          uniform vec3 uStallLightPos;
          uniform vec3 uCatGlowPos;
          uniform float uCatGlowStrength;
          uniform vec3 uCanePickupPos;
          uniform float uCanePickupGlow;
          uniform vec3 uBarrierBeaconPos;
          uniform float uBarrierBeaconPulse;
          uniform sampler2D uRefl;
          uniform mat4 uReflMatrix;
          uniform float uReflOn;
          uniform float uSelfGlowBoost;
          ${wetHelpers}`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          ${wetRoughnessInject}`
        )
        .replace(
          '#include <opaque_fragment>',
          `
          ${wetPlanarReflectInject}

          if (uDebugPeek < 0.5) {
            // 1. Near-pure pitch-black obsidian darkness (~0.45% silhouette in immersive mode; rich noir in Title Attract!)
            vec3 darkBase = outgoingLight * (0.0045 + uAttractReveal * 0.44) + vec3(0.0002, 0.0003, 0.0005);

            float revealFactor = max(uSelfGlowBoost * (0.35 + uAttractReveal * 0.65), uAttractReveal * 0.62);
            vec3 ringEmission = vec3(0.0);

            // 2. Six-slot Sonic Echo Waves + Concentric Harmonic Ripples (HDR Bloom-ready!)
            for (int i = 0; i < ${ECHO_WAVE_COUNT}; i++) {
              float alpha = uWaveAlpha[i];
              float r = uWaves[i].w;
              if (alpha > 0.002 && r > 0.01) {
                vec3 delta = vEchoWorldPos - uWaves[i].xyz;
                delta.y *= 0.72;
                float dist = length(delta);

                float dOuter = abs(dist - r);
                float outerBand = exp(-dOuter * 19.0) * 2.15 + exp(-dOuter * 4.5) * 0.48;

                float rMid = r * 0.64;
                float dMid = abs(dist - rMid);
                float midBand = (r > 0.55 ? 1.0 : 0.0) * (exp(-dMid * 21.0) * 1.15 + exp(-dMid * 5.8) * 0.24);

                float rInner = r * 0.32;
                float dInner = abs(dist - rInner);
                float innerBand = (r > 0.9 ? 1.0 : 0.0) * exp(-dInner * 23.0) * 0.72;

                vec3 altCol = mix(uWaveColors[i], vec3(0.96, 0.62, 0.05), 0.55);
                ringEmission += uWaveColors[i] * outerBand * alpha;
                ringEmission += altCol * (midBand + innerBand * 0.85) * alpha;

                float insideMask = 1.0 - smoothstep(r - 0.42, r + 0.18, dist);
                float radialWeight = mix(0.55, 1.0, 1.0 - clamp(dist / max(r, 0.05), 0.0, 1.0));
                revealFactor = max(revealFactor, insideMask * radialWeight * min(1.0, alpha * 1.25));
              }
            }

            // 3. Real-time Cane Tip 0.72m Intimate Local Micro-Glow
            if (uCaneActive > 0.5) {
              float tipDist = distance(vEchoWorldPos, uCaneTip);
              float tipReveal = (1.0 - smoothstep(0.08, 0.72, tipDist)) * 0.72;
              revealFactor = max(revealFactor, tipReveal);

              float tipRing = exp(-abs(tipDist - 0.14) * 30.0) * 0.78 * (1.0 - smoothstep(0.0, 0.38, tipDist));
              ringEmission += vec3(1.15, 0.82, 0.28) * tipRing;
            }

            // 4. Foyer Cane Pickup Subtle Cyan Outline Guide
            if (uCanePickupGlow > 0.01) {
              float pDist = distance(vEchoWorldPos, uCanePickupPos);
              float pAura = (1.0 - smoothstep(0.12, 0.75, pDist)) * 0.42 * uCanePickupGlow;
              revealFactor = max(revealFactor, pAura);
              ringEmission += vec3(0.28, 0.82, 1.15) * exp(-pDist * 5.2) * 0.34 * uCanePickupGlow;
            }

            // 5. Construction Barrier Amber Hazard Beacon Pool (subtle pinprick in dark!)
            float bDist = distance(vEchoWorldPos, uBarrierBeaconPos);
            float bWarm = (1.0 - smoothstep(0.2, 1.6, bDist)) * (0.14 + uAttractReveal * 0.32) * uBarrierBeaconPulse;
            revealFactor = max(revealFactor, bWarm);

            // 6. Scene 3 Breakfast Stall Warm Lantern Oasis & Cat Glow (intimate warm pool only up close)
            float stallDist = distance(vEchoWorldPos, uStallLightPos);
            float stallWarmth = (1.0 - smoothstep(0.6, 3.4, stallDist)) * (0.28 + uAttractReveal * 0.35);
            revealFactor = max(revealFactor, stallWarmth);

            if (uCatGlowStrength > 0.01) {
              float catDist = distance(vEchoWorldPos, uCatGlowPos);
              float catAura = (1.0 - smoothstep(0.12, 1.25, catDist)) * 0.88 * uCatGlowStrength;
              revealFactor = max(revealFactor, catAura);
              ringEmission += vec3(1.15, 0.78, 0.26) * exp(-catDist * 3.8) * 0.38 * uCatGlowStrength;
            }

            // 7. 75% Saturation Real PBR Reveal (boosted in High Contrast Mode)
            float lumaVal = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
            float satAmount = mix(0.75, 0.96, uHighContrast);
            vec3 revealedColor = mix(vec3(lumaVal), outgoingLight, satAmount);

            vec3 immersiveLight = mix(darkBase, revealedColor, clamp(revealFactor, 0.0, 1.0));
            immersiveLight += ringEmission * (1.0 + uHighContrast * 0.65);

            // 8. Smooth Sunset Finale Reveal
            outgoingLight = mix(immersiveLight, outgoingLight * 1.16, uSunsetFactor);
          }
          #include <opaque_fragment>`
        );
    };

    mat.customProgramCacheKey = () =>
      `echo-aaa-v2-${selfBoost.toFixed(2)}-${isWetGround ? 'wet' : 'std'}`;
    return mat;
  }
}
