import * as THREE from 'three';
import { WAYPOINTS } from '../level/levelData';

export const ECHO_WAVE_COUNT = 4;

export const COLOR_ECHO_CYAN = new THREE.Color('#38BDF8');
export const COLOR_ECHO_AMBER = new THREE.Color('#F59E0B');

interface ActiveEchoWave {
  origin: THREE.Vector3;
  color: THREE.Color;
  age: number;
  duration: number;
  maxRadius: number;
  active: boolean;
}

export interface EchoUniformState {
  uWaves: { value: THREE.Vector4[] };
  uWaveColors: { value: THREE.Vector3[] };
  uWaveAlpha: { value: number[] };
  uCaneTip: { value: THREE.Vector3 };
  uCaneActive: { value: number };
  uDebugPeek: { value: number };
  uHighContrast: { value: number };
  uSunsetFactor: { value: number };
  uStallLightPos: { value: THREE.Vector3 };
  uCatGlowPos: { value: THREE.Vector3 };
  uCatGlowStrength: { value: number };
  uCanePickupPos: { value: THREE.Vector3 };
  uCanePickupGlow: { value: number };
}

export class EchoShaderManager {
  public readonly uniforms: EchoUniformState;
  private waves: ActiveEchoWave[] = [];
  private nextWaveSlot = 0;
  private echoDuration = 2.5; // Configurable 1.5s / 2.5s / 4.0s (default ~2.2-2.5s)

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
        duration: 2.2,
        maxRadius: 5.0,
        active: false,
      });
    }

    this.uniforms = {
      uWaves: { value: waveVecs },
      uWaveColors: { value: waveCols },
      uWaveAlpha: { value: waveAlphas },
      uCaneTip: { value: new THREE.Vector3(0, -50, 0) },
      uCaneActive: { value: 0 },
      uDebugPeek: { value: 0 },
      uHighContrast: { value: 0 },
      uSunsetFactor: { value: 0 },
      uStallLightPos: {
        value: new THREE.Vector3(
          WAYPOINTS.stallLightPos.x,
          1.1,
          WAYPOINTS.stallLightPos.z
        ),
      },
      uCatGlowPos: {
        value: new THREE.Vector3(
          WAYPOINTS.catPos.x,
          WAYPOINTS.catPos.y + 0.2,
          WAYPOINTS.catPos.z
        ),
      },
      uCatGlowStrength: { value: 0 },
      uCanePickupPos: {
        value: new THREE.Vector3(
          WAYPOINTS.canePickupPos.x,
          0.65,
          WAYPOINTS.canePickupPos.z
        ),
      },
      uCanePickupGlow: { value: 1.0 },
    };
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
    this.uniforms.uCatGlowStrength.value = Math.max(0, Math.min(1.5, strength));
  }

  /**
   * Emits an expanding sonic echo wave at `origin`.
   */
  public emitWave(
    origin: THREE.Vector3,
    isWarmTactile: boolean,
    maxRadius = 5.2,
    durationScale = 1.0
  ): void {
    const slot = this.waves[this.nextWaveSlot];
    this.nextWaveSlot = (this.nextWaveSlot + 1) % ECHO_WAVE_COUNT;

    slot.origin.copy(origin);
    slot.color.copy(isWarmTactile ? COLOR_ECHO_AMBER : COLOR_ECHO_CYAN);
    slot.age = 0;
    slot.duration = this.echoDuration * durationScale;
    slot.maxRadius = maxRadius;
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

  public update(dt: number): void {
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

      // Fast ease-out expansion in first 45% of life, then lingers & fades out smoothly
      const expandT = 1.0 - Math.pow(1.0 - Math.min(1.0, progress * 1.45), 2.4);
      const radius = expandT * w.maxRadius;

      // Smooth fade-out curve over wave duration (~2.2s default)
      const alpha = Math.pow(1.0 - progress, 1.25);

      this.uniforms.uWaves.value[i].set(w.origin.x, w.origin.y, w.origin.z, radius);
      this.uniforms.uWaveColors.value[i].set(w.color.r, w.color.g, w.color.b);
      this.uniforms.uWaveAlpha.value[i] = alpha;
    }
  }

  /**
   * Enhances any MeshStandardMaterial with the blind-touch sonic echo & reveal shader.
   */
  public enhanceMaterial(
    mat: THREE.MeshStandardMaterial,
    options?: { selfGlowBoost?: number }
  ): THREE.MeshStandardMaterial {
    const shared = this.uniforms;
    const selfBoost = options?.selfGlowBoost ?? 0.0;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaves = shared.uWaves;
      shader.uniforms.uWaveColors = shared.uWaveColors;
      shader.uniforms.uWaveAlpha = shared.uWaveAlpha;
      shader.uniforms.uCaneTip = shared.uCaneTip;
      shader.uniforms.uCaneActive = shared.uCaneActive;
      shader.uniforms.uDebugPeek = shared.uDebugPeek;
      shader.uniforms.uHighContrast = shared.uHighContrast;
      shader.uniforms.uSunsetFactor = shared.uSunsetFactor;
      shader.uniforms.uStallLightPos = shared.uStallLightPos;
      shader.uniforms.uCatGlowPos = shared.uCatGlowPos;
      shader.uniforms.uCatGlowStrength = shared.uCatGlowStrength;
      shader.uniforms.uCanePickupPos = shared.uCanePickupPos;
      shader.uniforms.uCanePickupGlow = shared.uCanePickupGlow;
      shader.uniforms.uSelfGlowBoost = { value: selfBoost };

      // Vertex shader: pass reliable world-space coordinates
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

      // Fragment shader: inject sonic ring glow, 75% saturation reveal, cane tip aura, and peek/sunset modes
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vEchoWorldPos;
          uniform vec4 uWaves[${ECHO_WAVE_COUNT}];
          uniform vec3 uWaveColors[${ECHO_WAVE_COUNT}];
          uniform float uWaveAlpha[${ECHO_WAVE_COUNT}];
          uniform vec3 uCaneTip;
          uniform float uCaneActive;
          uniform float uDebugPeek;
          uniform float uHighContrast;
          uniform float uSunsetFactor;
          uniform vec3 uStallLightPos;
          uniform vec3 uCatGlowPos;
          uniform float uCatGlowStrength;
          uniform vec3 uCanePickupPos;
          uniform float uCanePickupGlow;
          uniform float uSelfGlowBoost;`
        )
        .replace(
          '#include <opaque_fragment>',
          `
          if (uDebugPeek < 0.5) {
            // 1. Ultra-dark 3.5%~5% ambient silhouette (never dead pitch-black)
            vec3 darkBase = outgoingLight * 0.042 + vec3(0.0028, 0.0038, 0.0058);

            float revealFactor = uSelfGlowBoost;
            vec3 ringEmission = vec3(0.0);

            // 2. Sonic Echo Waves (4 simultaneous slots + concentric harmonic ripples)
            for (int i = 0; i < ${ECHO_WAVE_COUNT}; i++) {
              float alpha = uWaveAlpha[i];
              float r = uWaves[i].w;
              if (alpha > 0.002 && r > 0.01) {
                vec3 delta = vEchoWorldPos - uWaves[i].xyz;
                delta.y *= 0.72; // Let ground waves climb smoothly onto bikes/walls/furniture
                float dist = length(delta);

                // Primary outer wavefront glow band
                float dOuter = abs(dist - r);
                float outerBand = exp(-dOuter * 18.0) * 1.35 + exp(-dOuter * 4.2) * 0.36;

                // Concentric inner harmonic ripples (matching reference art's multi-ring aura)
                float rMid = r * 0.64;
                float dMid = abs(dist - rMid);
                float midBand = (r > 0.55 ? 1.0 : 0.0) * (exp(-dMid * 20.0) * 0.78 + exp(-dMid * 5.5) * 0.2);

                float rInner = r * 0.32;
                float dInner = abs(dist - rInner);
                float innerBand = (r > 0.9 ? 1.0 : 0.0) * exp(-dInner * 22.0) * 0.55;

                vec3 altCol = mix(uWaveColors[i], vec3(0.96, 0.62, 0.05), 0.55);
                ringEmission += uWaveColors[i] * outerBand * alpha;
                ringEmission += altCol * (midBand + innerBand * 0.85) * alpha;

                // Swept interior color reveal (lingers and fades smoothly via alpha)
                float insideMask = 1.0 - smoothstep(r - 0.38, r + 0.16, dist);
                float radialWeight = mix(0.55, 1.0, 1.0 - clamp(dist / max(r, 0.05), 0.0, 1.0));
                revealFactor = max(revealFactor, insideMask * radialWeight * min(1.0, alpha * 1.25));
              }
            }

            // 3. Real-time Cane Tip 0.8m Local Micro-Glow
            if (uCaneActive > 0.5) {
              float tipDist = distance(vEchoWorldPos, uCaneTip);
              float tipReveal = (1.0 - smoothstep(0.12, 0.85, tipDist)) * 0.82;
              revealFactor = max(revealFactor, tipReveal);

              float tipRing = exp(-abs(tipDist - 0.16) * 28.0) * 0.55 * (1.0 - smoothstep(0.0, 0.45, tipDist));
              ringEmission += vec3(0.95, 0.72, 0.25) * tipRing;
            }

            // 4. Foyer Cane Pickup Subtle Cyan Outline Guide (Node 01 only)
            if (uCanePickupGlow > 0.01) {
              float pDist = distance(vEchoWorldPos, uCanePickupPos);
              float pAura = (1.0 - smoothstep(0.15, 0.95, pDist)) * 0.55 * uCanePickupGlow;
              revealFactor = max(revealFactor, pAura);
              ringEmission += vec3(0.22, 0.74, 0.97) * exp(-pDist * 4.5) * 0.32 * uCanePickupGlow;
            }

            // 5. Scene 3 Breakfast Stall Warm Lantern Oasis & Cat Glow
            float stallDist = distance(vEchoWorldPos, uStallLightPos);
            float stallWarmth = (1.0 - smoothstep(0.8, 4.4, stallDist)) * 0.42;
            revealFactor = max(revealFactor, stallWarmth);

            if (uCatGlowStrength > 0.01) {
              float catDist = distance(vEchoWorldPos, uCatGlowPos);
              float catAura = (1.0 - smoothstep(0.15, 1.35, catDist)) * 0.85 * uCatGlowStrength;
              revealFactor = max(revealFactor, catAura);
              ringEmission += vec3(0.98, 0.68, 0.22) * exp(-catDist * 3.8) * 0.35 * uCatGlowStrength;
            }

            // 6. 75% Saturation Real PBR Reveal (boosted in High Contrast Mode)
            float luma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
            float satAmount = mix(0.75, 0.95, uHighContrast);
            vec3 revealedColor = mix(vec3(luma), outgoingLight, satAmount);

            vec3 immersiveLight = mix(darkBase, revealedColor, clamp(revealFactor, 0.0, 1.0));
            immersiveLight += ringEmission * (1.0 + uHighContrast * 0.65);

            // 7. Smooth Sunset Finale Transition (0 -> 1 over 2.5s)
            outgoingLight = mix(immersiveLight, outgoingLight * 1.12, uSunsetFactor);
          }
          #include <opaque_fragment>`
        );
    };

    mat.customProgramCacheKey = () => `echo-standard-v1-${selfBoost.toFixed(2)}`;
    return mat;
  }
}
