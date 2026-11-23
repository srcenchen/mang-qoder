import * as THREE from 'three';
import { WAYPOINTS } from '../level/levelData';

/** Max 2 concurrent sonic echo waves on screen (reusing oldest slot -> clean, restrained visual!) */
export const ECHO_WAVE_COUNT = 2;
/** Fixed-capacity spatial memory trail so explored zigzag path retains ~22% low-sat ghost shadow */
const MEMORY_NODE_COUNT = 16;

// Strictly two restrained colors: cool pale moonlight-cyan & warm amber gold (no harsh pink/magenta!)
export const COLOR_ECHO_CYAN = new THREE.Color('#7ee2ee');
export const COLOR_ECHO_AMBER = new THREE.Color('#e8ae52');
export const COLOR_ECHO_ALARM = new THREE.Color('#e8ae52');

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
  uMemoryNodes: { value: THREE.Vector4[] };
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
  private nextMemorySlot = 0;
  private echoDuration = 2.4;

  constructor() {
    const waveVecs: THREE.Vector4[] = [];
    const waveCols: THREE.Vector3[] = [];
    const waveAlphas: number[] = [];

    for (let i = 0; i < ECHO_WAVE_COUNT; i++) {
      waveVecs.push(new THREE.Vector4(0, -100, 0, 0));
      waveCols.push(new THREE.Vector3(0.5, 0.89, 0.93));
      waveAlphas.push(0);
      this.waves.push({
        origin: new THREE.Vector3(0, -100, 0),
        color: COLOR_ECHO_CYAN.clone(),
        age: 0,
        duration: 2.4,
        maxRadius: 4.3,
        intensity: 0.95,
        active: false,
      });
    }

    const memoryNodes: THREE.Vector4[] = [];
    for (let i = 0; i < MEMORY_NODE_COUNT; i++) {
      memoryNodes.push(new THREE.Vector4(0, -100, 0, 0));
    }

    this.uniforms = {
      uTime: { value: 0 },
      uWaves: { value: waveVecs },
      uWaveColors: { value: waveCols },
      uWaveAlpha: { value: waveAlphas },
      uMemoryNodes: { value: memoryNodes },
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
        value: new THREE.Vector3(WAYPOINTS.barrierCenter.x, 1.15, WAYPOINTS.barrierCenter.z),
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
      ? 0.52 + 0.25 * Math.sin(timeSec * 2.8)
      : 0.0;
  }

  public setCatGlow(strength: number): void {
    this.uniforms.uCatGlowStrength.value = Math.max(0, Math.min(1.4, strength));
  }

  private recordMemoryAnchor(origin: THREE.Vector3, radius: number): void {
    const nodes = this.uniforms.uMemoryNodes.value;
    // Update existing nearby anchor instead of duplicating memory slots
    for (let i = 0; i < MEMORY_NODE_COUNT; i++) {
      const n = nodes[i];
      if (n.w > 0.1) {
        const dx = n.x - origin.x;
        const dz = n.z - origin.z;
        if (dx * dx + dz * dz < 2.56) {
          n.w = Math.max(n.w, Math.min(3.4, radius * 0.65));
          return;
        }
      }
    }
    const target = nodes[this.nextMemorySlot];
    this.nextMemorySlot = (this.nextMemorySlot + 1) % MEMORY_NODE_COUNT;
    target.set(origin.x, origin.y, origin.z, Math.min(3.4, radius * 0.65));
  }

  public emitWave(
    origin: THREE.Vector3,
    palette: 'amber' | 'cyan' | 'alarm' | boolean,
    maxRadius = 4.3,
    durationScale = 1.0,
    intensity = 0.95
  ): void {
    const slot = this.waves[this.nextWaveSlot];
    this.nextWaveSlot = (this.nextWaveSlot + 1) % ECHO_WAVE_COUNT;

    // Strictly dual-color restrained palette (amber for warm/tactile, moonlight-cyan for general)
    const color =
      palette === true || palette === 'amber' || palette === 'alarm'
        ? COLOR_ECHO_AMBER
        : COLOR_ECHO_CYAN;

    const clampedRadius = Math.max(2.2, Math.min(7.5, maxRadius));
    slot.origin.copy(origin);
    slot.color.copy(color);
    slot.age = 0;
    slot.duration = this.echoDuration * durationScale;
    slot.maxRadius = clampedRadius;
    slot.intensity = Math.min(1.18, intensity);
    slot.active = true;

    this.recordMemoryAnchor(origin, clampedRadius);
  }

  public reset(): void {
    for (let i = 0; i < ECHO_WAVE_COUNT; i++) {
      this.waves[i].active = false;
      this.uniforms.uWaves.value[i].set(0, -100, 0, 0);
      this.uniforms.uWaveAlpha.value[i] = 0;
    }
    for (let i = 0; i < MEMORY_NODE_COUNT; i++) {
      this.uniforms.uMemoryNodes.value[i].set(0, -100, 0, 0);
    }
    this.nextWaveSlot = 0;
    this.nextMemorySlot = 0;
    this.uniforms.uSunsetFactor.value = 0;
    this.uniforms.uCatGlowStrength.value = 0;
    this.uniforms.uCanePickupGlow.value = 1;
  }

  public update(dt: number, elapsed: number): void {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uBarrierBeaconPulse.value =
      0.25 + 0.75 * Math.pow(Math.sin(elapsed * 3.6) * 0.5 + 0.5, 2.2);

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

      const expandT = 1.0 - Math.pow(1.0 - Math.min(1.0, progress * 1.38), 2.3);
      const radius = expandT * w.maxRadius;
      const alpha = Math.pow(1.0 - progress, 1.32) * w.intensity;

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
      shader.uniforms.uMemoryNodes = shared.uMemoryNodes;
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
            float ring = x * exp(-x * x) * 2.0;
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
            // Extra rain puddle richness near crosswalk roadway (Z < -29.0)
            float roadBonus = smoothstep(-28.5, -31.5, vEchoWorldPos.z) * 0.14;
            wetMaskPuddle = smoothstep(0.50 - roadBonus, 0.66 - roadBonus, puddleField);
            // Shelter under breakfast stall awning on Leg 3 (X in [9.6, 12.1], Z in [-25.5, -21.7])
            float underAwning = step(9.6, gp.x) * step(gp.x, 12.1) * step(-25.5, gp.y) * step(gp.y, -21.7);
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
            vec2 blurOff = vec2(0.0, mix(0.018, 0.004, wetMaskPuddle));
            vec3 reflCol = texture2D(uRefl, rClamped).rgb * 0.5
                         + texture2D(uRefl, clamp(rClamped + blurOff, vec2(0.004), vec2(0.996))).rgb * 0.25
                         + texture2D(uRefl, clamp(rClamped - blurOff, vec2(0.004), vec2(0.996))).rgb * 0.25;
            reflCol = min(reflCol, vec3(12.0));
            float reflWeight = mix(0.16, 0.86, wetMaskPuddle) * fresnel;
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
          uniform vec4 uMemoryNodes[${MEMORY_NODE_COUNT}];
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
            // 1. Deep dark ambient base for unexplored areas
            vec3 darkBase = outgoingLight * (0.004 + uAttractReveal * 0.44) + vec3(0.0002, 0.0003, 0.0005);

            float revealFactor = max(uSelfGlowBoost * (0.32 + uAttractReveal * 0.68), uAttractReveal * 0.62);
            vec3 ringEmission = vec3(0.0);

            // 2. Restrained Dual-Slot Sonic Echo Waves (Slender ~60% thinner feathered rings, Ref Images 2 & 3!)
            for (int i = 0; i < ${ECHO_WAVE_COUNT}; i++) {
              float alpha = uWaveAlpha[i];
              float r = uWaves[i].w;
              if (alpha > 0.002 && r > 0.01) {
                vec3 delta = vEchoWorldPos - uWaves[i].xyz;
                delta.y *= 0.72;
                float dist = length(delta);

                // Crisp slender primary ring with soft outer feather
                float dOuter = abs(dist - r);
                float outerBand = exp(-dOuter * 44.0) * 1.42 + exp(-dOuter * 14.0) * 0.22;

                // Secondary delicate inner harmonic ring (amber/cyan subtle pairing)
                float rMid = r * 0.58;
                float dMid = abs(dist - rMid);
                float midBand = (r > 0.65 ? 1.0 : 0.0) * (exp(-dMid * 48.0) * 0.74 + exp(-dMid * 16.0) * 0.11);

                vec3 altCol = mix(uWaveColors[i], vec3(0.91, 0.68, 0.32), 0.52);
                ringEmission += uWaveColors[i] * outerBand * alpha;
                ringEmission += altCol * midBand * alpha;

                float insideMask = 1.0 - smoothstep(r - 0.35, r + 0.14, dist);
                float radialWeight = mix(0.45, 1.0, 1.0 - clamp(dist / max(r, 0.05), 0.0, 1.0));
                revealFactor = max(revealFactor, insideMask * radialWeight * min(1.0, alpha * 1.18));
              }
            }

            // 3. Real-time Cane Tip 1.15m Intimate Local PBR Color Reveal (Ref Images 2 & 3!)
            if (uCaneActive > 0.5) {
              float tipDist = distance(vEchoWorldPos, uCaneTip);
              float tipReveal = (1.0 - smoothstep(0.14, 1.15, tipDist)) * 0.88;
              revealFactor = max(revealFactor, tipReveal);

              float tipRing = exp(-abs(tipDist - 0.13) * 48.0) * 0.56 * (1.0 - smoothstep(0.0, 0.34, tipDist));
              ringEmission += vec3(0.94, 0.72, 0.34) * tipRing;
            }

            // 4. Visited Path Subtle Memory Ghost (~22% low-saturation shadow so Z-turn path stays legible!)
            float memoryMask = 0.0;
            for (int m = 0; m < ${MEMORY_NODE_COUNT}; m++) {
              float mr = uMemoryNodes[m].w;
              if (mr > 0.1) {
                float md = distance(vEchoWorldPos.xz, uMemoryNodes[m].xz);
                float mFalloff = 1.0 - smoothstep(mr * 0.35, mr, md);
                memoryMask = max(memoryMask, mFalloff);
              }
            }

            // 5. Foyer Cane Pickup Soft Subtle Guide (no harsh neon glow)
            if (uCanePickupGlow > 0.01) {
              float pDist = distance(vEchoWorldPos, uCanePickupPos);
              float pAura = (1.0 - smoothstep(0.12, 0.72, pDist)) * 0.38 * uCanePickupGlow;
              revealFactor = max(revealFactor, pAura);
              ringEmission += vec3(0.42, 0.82, 0.92) * exp(-pDist * 6.5) * 0.22 * uCanePickupGlow;
            }

            // 6. Construction Barrier Amber Hazard Beacon Pool
            float bDist = distance(vEchoWorldPos, uBarrierBeaconPos);
            float bWarm = (1.0 - smoothstep(0.2, 1.5, bDist)) * (0.14 + uAttractReveal * 0.32) * uBarrierBeaconPulse;
            revealFactor = max(revealFactor, bWarm);

            // 7. Breakfast Stall Warm Lantern Oasis & Cat Glow
            float stallDist = distance(vEchoWorldPos, uStallLightPos);
            float stallWarmth = (1.0 - smoothstep(0.6, 3.4, stallDist)) * (0.28 + uAttractReveal * 0.35);
            revealFactor = max(revealFactor, stallWarmth);

            if (uCatGlowStrength > 0.01) {
              float catDist = distance(vEchoWorldPos, uCatGlowPos);
              float catAura = (1.0 - smoothstep(0.12, 1.2, catDist)) * 0.82 * uCatGlowStrength;
              revealFactor = max(revealFactor, catAura);
              ringEmission += vec3(0.95, 0.7, 0.3) * exp(-catDist * 4.5) * 0.26 * uCatGlowStrength;
            }

            // 8. Real PBR Color Reveal + 22% Low-Saturation Explored Memory Ghost
            float lumaVal = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
            float satAmount = mix(0.78, 0.96, uHighContrast);
            vec3 revealedColor = mix(vec3(lumaVal), outgoingLight, satAmount);
            vec3 memoryGhost = mix(vec3(lumaVal), outgoingLight, 0.22) * 0.23;

            vec3 baseWithMemory = mix(darkBase, max(darkBase, memoryGhost), memoryMask);
            vec3 immersiveLight = mix(baseWithMemory, revealedColor, clamp(revealFactor, 0.0, 1.0));
            immersiveLight += ringEmission * (1.0 + uHighContrast * 0.55);

            // 9. Smooth Sunset Finale Reveal
            outgoingLight = mix(immersiveLight, outgoingLight * 1.15, uSunsetFactor);
          }
          #include <opaque_fragment>`
        );
    };

    mat.customProgramCacheKey = () =>
      `echo-aaa-v3-${selfBoost.toFixed(2)}-${isWetGround ? 'wet' : 'std'}`;
    return mat;
  }
}
