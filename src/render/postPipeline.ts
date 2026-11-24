import * as THREE from 'three';
import { QualityProfile } from './quality';

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMMON_GLSL = /* glsl */ `
precision highp float;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

// 1. Half-res linear depth + SSAO pass
const SSAO_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D tDepth;
uniform vec2 uTanHalf;
uniform vec2 uTexel;
uniform vec2 uDepthSize;
uniform vec2 uDepthTexel;
uniform float uNear;
uniform float uFar;
uniform float uRadius;
uniform float uIntensity;
uniform float uAspect;

vec2 snapDepthUv(vec2 uv) {
  vec2 c = clamp(uv, uDepthTexel * 0.5, vec2(1.0) - uDepthTexel * 0.5);
  return (floor(c * uDepthSize) + 0.5) * uDepthTexel;
}

float linZ(vec2 uv) {
  float d = texture2D(tDepth, clamp(uv, uDepthTexel * 0.5, vec2(1.0) - uDepthTexel * 0.5)).r;
  return (uNear * uFar) / max(uFar - d * (uFar - uNear), 1e-4);
}

vec3 vpos(vec2 uv, float z) {
  return vec3((uv * 2.0 - 1.0) * uTanHalf * z, -z);
}

void main() {
  // Snap to exact full-res depth texel centers so NearestFilter never straddles
  // texel boundaries and causes periodic normal-reconstruction stripes.
  vec2 uv0 = snapDepthUv(vUv);
  float z0 = linZ(uv0);
  if (z0 < 0.12 || z0 > 55.0) {
    gl_FragColor = vec4(1.0);
    return;
  }
  vec3 P = vpos(uv0, z0);
  vec2 ox = vec2(uDepthTexel.x, 0.0);
  vec2 oy = vec2(0.0, uDepthTexel.y);
  vec2 uvl = snapDepthUv(uv0 - ox), uvr = snapDepthUv(uv0 + ox);
  vec2 uvd = snapDepthUv(uv0 - oy), uvu = snapDepthUv(uv0 + oy);
  float zl = linZ(uvl), zr = linZ(uvr);
  float zd = linZ(uvd), zu = linZ(uvu);
  vec3 dx = abs(zl - z0) < abs(zr - z0) ? P - vpos(uvl, zl) : vpos(uvr, zr) - P;
  vec3 dy = abs(zd - z0) < abs(zu - z0) ? P - vpos(uvd, zd) : vpos(uvu, zu) - P;
  vec3 n = normalize(cross(dx, dy));

  float R = uRadius * (0.65 + 0.35 * clamp(z0 / 10.0, 0.0, 1.0));
  float rUv = clamp(R / (2.0 * z0 * uTanHalf.y), 2.5 * uTexel.y, 0.12);
  float R2 = R * R;
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;

  for (int i = 0; i < AO_TAPS; i++) {
    float a = (float(i) + 0.5) / float(AO_TAPS);
    float th = a * 6.2831853 * 3.0 + rot;
    vec2 o = vec2(cos(th) / uAspect, sin(th)) * a * rUv;
    vec2 uv2 = snapDepthUv(uv0 + o);
    float z2 = linZ(uv2);
    vec3 v = vpos(uv2, z2) - P;
    float vv = dot(v, v);
    float vn = dot(v, n);
    float f = max(R2 - vv, 0.0);
    sum += f * f * f * max((vn - (0.015 + 0.004 * z0)) / (vv + 0.004), 0.0);
  }
  float ao = max(0.0, 1.0 - uIntensity * sum * 5.0 / (R2 * R2 * R2 * float(AO_TAPS)));
  ao = mix(ao, 1.0, smoothstep(32.0, 55.0, z0));
  gl_FragColor = vec4(ao, z0 / uFar, 0.0, 1.0);
}
`;

// Edge-preserving bilateral blur for SSAO
const AO_BLUR_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D tSrc;
uniform vec2 uDir;
void main() {
  vec2 c0 = texture2D(tSrc, vUv).rg;
  float acc = 0.0;
  float ws = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 s = texture2D(tSrc, clamp(vUv + uDir * float(i), vec2(0.001), vec2(0.999))).rg;
    float w = (1.0 - abs(float(i)) * 0.22) * max(0.0, 1.0 - abs(s.y - c0.y) / (0.012 + c0.y * 0.15));
    acc += s.x * w;
    ws += w;
  }
  gl_FragColor = vec4(ws > 1e-4 ? acc / ws : c0.x, c0.y, 0.0, 1.0);
}
`;

// 2. Karis-Weighted HDR Bloom Downsample
const BLOOM_DOWN_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;

vec3 sampleClamped(vec2 o) {
  vec3 c = clamp(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(0.0), vec3(80.0));
  if (uFirst > 0.5) {
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold + 0.25, 0.0, 0.5);
    soft = soft * soft * 0.5;
    float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
    c *= contrib;
  }
  return c;
}

float kw(vec3 c) { return 1.0 / (1.0 + luma(c) * 0.12); }

void main() {
  vec3 a = sampleClamped(vec2(-2.0,  2.0)), b = sampleClamped(vec2(0.0,  2.0)), c = sampleClamped(vec2(2.0,  2.0));
  vec3 d = sampleClamped(vec2(-2.0,  0.0)), e = sampleClamped(vec2(0.0,  0.0)), f = sampleClamped(vec2(2.0,  0.0));
  vec3 g = sampleClamped(vec2(-2.0, -2.0)), h = sampleClamped(vec2(0.0, -2.0)), i = sampleClamped(vec2(2.0, -2.0));
  vec3 j = sampleClamped(vec2(-1.0,  1.0)), k = sampleClamped(vec2(1.0,  1.0)), l = sampleClamped(vec2(-1.0, -1.0)), m = sampleClamped(vec2(1.0, -1.0));
  vec3 col;
  if (uFirst > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = kw(g0) * 0.125, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.5;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / max(w0 + w1 + w2 + w3 + w4, 1e-5);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// 3. Bloom Tent Upsample
const BLOOM_UP_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;
uniform float uMix;
void main() {
  vec2 o = uTexel;
  vec3 t = texture2D(tLow, vUv).rgb * 4.0;
  t += (texture2D(tLow, vUv + vec2(o.x, 0.0)).rgb + texture2D(tLow, vUv - vec2(o.x, 0.0)).rgb
      + texture2D(tLow, vUv + vec2(0.0, o.y)).rgb + texture2D(tLow, vUv - vec2(0.0, o.y)).rgb) * 2.0;
  t += texture2D(tLow, vUv + o).rgb + texture2D(tLow, vUv - o).rgb
      + texture2D(tLow, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLow, vUv + vec2(-o.x, o.y)).rgb;
  t *= 0.0625;
  gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, t, uMix), 1.0);
}
`;

// 4. Anamorphic Horizontal Streak Blur
const STREAK_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D tSrc;
uniform vec2 uDir;
uniform float uThreshold;
void main() {
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = -6; i <= 6; i++) {
    float x = float(i);
    float w = exp(-x * x / 14.0);
    vec3 c = max(texture2D(tSrc, vUv + uDir * x).rgb - vec3(uThreshold), vec3(0.0));
    acc += c * w;
    ws += w;
  }
  gl_FragColor = vec4(acc / ws, 1.0);
}
`;

// 5. Procedural Lens Dirt Mask (baked once)
const DIRT_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform float uAspect;
void main() {
  vec2 p = vUv * vec2(uAspect, 1.0);
  float acc = 0.0;
  for (int i = 0; i < 48; i++) {
    float fi = float(i);
    vec2 c = vec2(hash12(vec2(fi, 1.7)), hash12(vec2(fi, 9.2))) * vec2(uAspect, 1.0);
    float sz = mix(0.015, 0.08, pow(hash12(vec2(fi, 4.4)), 3.0));
    float r = length(p - c) / sz;
    float disc = smoothstep(1.0, 0.85, r) * (0.35 + 0.65 * smoothstep(0.35, 0.96, r));
    acc += disc * mix(0.15, 0.65, hash12(vec2(fi, 6.1)));
  }
  float v = acc * 0.55 * (0.4 + 0.85 * smoothstep(0.18, 0.72, length(vUv - 0.5)));
  gl_FragColor = vec4(vec3(v) * vec3(1.0, 0.95, 0.88), 1.0);
}
`;

// 6. Cinema Composite + ACES/AgX Hybrid ToneMap + Split-Tone Grade + Vignette
const COMPOSITE_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tStreak;
uniform sampler2D tAO;
uniform sampler2D tDirt;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uStreak;
uniform float uDirt;
uniform float uAoOn;
uniform float uCA;
uniform float uVignette;
uniform float uImpact;
uniform float uListen;
uniform float uFade;
uniform float uSunset;
uniform vec2 uSunUv;
uniform float uSunVis;

// Hill ACES filmic fit
vec3 slAces(vec3 x) {
  const mat3 M1 = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 M2 = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602)
  );
  vec3 v = M1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(M2 * (a / b), 0.0, 1.0);
}

// Blender/Filament AgX punchy rolloff (smooth golden highlights!)
vec3 slAgxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 slAgx(vec3 color) {
  const mat3 srgbToRec2020 = mat3(
    vec3(0.6274, 0.0691, 0.0164),
    vec3(0.3293, 0.9195, 0.0880),
    vec3(0.0433, 0.0113, 0.8956)
  );
  const mat3 rec2020ToSrgb = mat3(
    vec3( 1.6605, -0.1246, -0.0182),
    vec3(-0.5876,  1.1329, -0.1006),
    vec3(-0.0728, -0.0083,  1.1187)
  );
  const mat3 inset = mat3(
    vec3(0.85662715, 0.13731897, 0.11189821),
    vec3(0.09512124, 0.76124199, 0.07679942),
    vec3(0.04825161, 0.10143904, 0.81130237)
  );
  const mat3 outset = mat3(
    vec3( 1.12710058, -0.14132976, -0.14132976),
    vec3(-0.11060664,  1.15782370, -0.11060664),
    vec3(-0.01649394, -0.01649394,  1.25193641)
  );
  color = inset * (srgbToRec2020 * color);
  color = clamp((log2(max(color, 1e-10)) + 12.47393) / 16.5, 0.0, 1.0);
  color = slAgxContrast(color);
  float l = luma(color);
  color = pow(max(color, vec3(0.0)), vec3(1.16));
  color = l + (color - l) * 1.18;
  color = outset * color;
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(rec2020ToSrgb * color, 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec2 cc = vUv - 0.5;
  float r2 = dot(cc, cc) * 2.0;

  // Subtle edge chromatic aberration (boosted slightly on obstacle impact!)
  float ca = (uCA + uImpact * 0.0055) * r2;
  vec3 col;
  col.r = texture2D(tScene, vUv + cc * ca).r;
  col.g = texture2D(tScene, vUv).g;
  col.b = texture2D(tScene, vUv - cc * ca).b;
  col = max(col, vec3(0.0));

  // Contact Ambient Occlusion (fades out on bright emissive / echo ring pixels!)
  if (uAoOn > 0.5) {
    float ao = texture2D(tAO, vUv).r;
    float lit = smoothstep(0.18, 0.9, luma(col) * uExposure);
    float a = mix(1.0, ao, 0.85 * (1.0 - 0.78 * lit));
    col *= mix(vec3(a), vec3(1.0), vec3(0.0, 0.02, 0.05));
  }

  // Multi-mip HDR Bloom + Anamorphic Streak + Subtle Lens Dirt
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  vec3 streak = texture2D(tStreak, vUv).rgb;
  vec3 dirt = texture2D(tDirt, vUv).rgb;
  col += bloom * (uBloom + dirt * uDirt * (0.4 + uSunset * 0.9));
  col += streak * uStreak;

  // Warm sunset anamorphic horizon flare when facing the setting sun
  if (uSunVis > 0.02) {
    vec2 sd = vUv - uSunUv;
    float d = length(vec2(sd.x * 0.55, sd.y));
    float flare = exp(-d * 4.5) * 0.28 + exp(-abs(sd.y) * 22.0 - abs(sd.x) * 2.2) * 0.22;
    col += vec3(1.35, 0.72, 0.30) * flare * uSunVis * (1.0 + dirt * 1.1);
  }

  // Exposure + Filmic ACES/AgX Hybrid ToneMap
  col *= uExposure;
  col = mix(slAces(col), slAgx(col), 0.32);

  // Split-tone Cinema Grade (cool teal shadows, warm amber highlights)
  float l = luma(col);
  vec3 sh = vec3(0.84, 1.00, 1.10);
  vec3 hi = vec3(1.06, 1.00, 0.91);
  col *= mix(sh, hi, smoothstep(0.04, 0.58, l));

  // Gentle S-curve & true near-pure obsidian blacks in blind mode (lifted slightly at golden sunset!)
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.16);
  col = col * 0.996 + vec3(0.0025, 0.0038, 0.0055) * uSunset;

  // Deep Cinema Vignette (tightens further during Focus Listen mode!)
  float vig = mix(0.48, uVignette, uSunset) + uListen * 0.30;
  float vr = smoothstep(0.14 - uListen * 0.08, 1.02, r2);
  col *= 1.0 - vig * vr * vr * (3.0 - 2.0 * vr);

  // Subtle Focus Listen acoustic rim aura
  float edge = smoothstep(0.24, 1.0, r2);
  col += vec3(0.08, 0.22, 0.32) * edge * uListen * (0.45 + 0.15 * sin(uTime * 4.2));

  // Collision impact warm amber-red peripheral throb
  col = mix(col, vec3(0.62, 0.14, 0.05) * (0.4 + l), clamp(uImpact * edge * 0.78, 0.0, 1.0));

  // Smooth fade-in
  col *= 1.0 - uFade;

  col = toSRGB(clamp(col, 0.0, 1.0));
  gl_FragColor = vec4(col, dot(col, vec3(0.299, 0.587, 0.114)));
}
`;

// 7. Final FXAA + Unsharp Clarity + Film Grain + Anti-Banding Dither
const FINAL_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uTime;
uniform float uGrain;
uniform float uSharpen;
uniform float uFxaa;

void main() {
  vec4 M = texture2D(tSrc, vUv);
  vec3 col = M.rgb;
  vec4 NW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel);
  vec4 NE = texture2D(tSrc, vUv + vec2( 1.0, -1.0) * uTexel);
  vec4 SW = texture2D(tSrc, vUv + vec2(-1.0,  1.0) * uTexel);
  vec4 SE = texture2D(tSrc, vUv + vec2( 1.0,  1.0) * uTexel);

  float lMin = min(M.a, min(min(NW.a, NE.a), min(SW.a, SE.a)));
  float lMax = max(M.a, max(max(NW.a, NE.a), max(SW.a, SE.a)));
  float contrast = lMax - lMin;

  if (uFxaa > 0.5 && contrast > max(0.0312, lMax * 0.10)) {
    vec2 dir = vec2(-((NW.a + NE.a) - (SW.a + SE.a)), (NW.a + SW.a) - (NE.a + SE.a));
    float dirReduce = max((NW.a + NE.a + SW.a + SE.a) * 0.03125, 0.0078125);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
    vec4 A = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)) + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)));
    vec4 B = A * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5) + texture2D(tSrc, vUv + dir * 0.5));
    col = (B.a < lMin || B.a > lMax) ? A.rgb : B.rgb;
  }

  // Light unsharp mask (backed off on strong edges so FXAA stays clean)
  vec3 blur = (NW.rgb + NE.rgb + SW.rgb + SE.rgb) * 0.25;
  col += (M.rgb - blur) * uSharpen * (1.0 - smoothstep(0.04, 0.22, contrast));

  // Animated, luminance-weighted cinema film grain
  vec2 seed = gl_FragCoord.xy + fract(uTime * vec2(7.31, 3.17)) * vec2(311.7, 173.3);
  float g = hash12(seed) + hash12(seed + 57.3) - 1.0;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col += g * uGrain * mix(1.0, 0.35, smoothstep(0.25, 0.9, l)) * (0.4 + 0.6 * smoothstep(0.0, 0.08, l));

  // Anti-banding dither for dark fog & sunset sky gradients
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 19.3) - 0.5) / 255.0;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export interface PostFrameParams {
  elapsed: number;
  sunsetFactor: number;
  peekMode: boolean;
  impactPulse: number;
  listenBlend: number;
  fadeAmount: number;
  sunDir: THREE.Vector3;
}

export class CinemaPostPipeline {
  private renderer: THREE.WebGLRenderer;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quadMesh: THREE.Mesh;

  private sceneRT: THREE.WebGLRenderTarget;
  private ldrRT: THREE.WebGLRenderTarget;
  private aoA: THREE.WebGLRenderTarget;
  private aoB: THREE.WebGLRenderTarget;
  private bloomDown: THREE.WebGLRenderTarget[] = [];
  private bloomUp: THREE.WebGLRenderTarget[] = [];
  private streakA: THREE.WebGLRenderTarget;
  private streakB: THREE.WebGLRenderTarget;
  private dirtRT: THREE.WebGLRenderTarget;

  private matSSAO: THREE.ShaderMaterial;
  private matAOBlur: THREE.ShaderMaterial;
  private matBloomDown: THREE.ShaderMaterial;
  private matBloomUp: THREE.ShaderMaterial;
  private matStreak: THREE.ShaderMaterial;
  private matDirt: THREE.ShaderMaterial;
  private matComposite: THREE.ShaderMaterial;
  private matFinal: THREE.ShaderMaterial;

  private width = 1;
  private height = 1;
  private quality: QualityProfile;
  private dirtBaked = false;
  private sunProj = new THREE.Vector3();
  private camDir = new THREE.Vector3();

  private readonly BLOOM_MIPS = 5;

  constructor(renderer: THREE.WebGLRenderer, quality: QualityProfile) {
    this.renderer = renderer;
    this.quality = quality;

    const makeRT = (
      type: THREE.TextureDataType = THREE.HalfFloatType,
      withDepth = false
    ): THREE.WebGLRenderTarget => {
      const rt = new THREE.WebGLRenderTarget(4, 4, {
        type,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: withDepth,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      if (withDepth) {
        rt.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
        rt.depthTexture.minFilter = THREE.NearestFilter;
        rt.depthTexture.magFilter = THREE.NearestFilter;
      }
      return rt;
    };

    this.sceneRT = makeRT(THREE.HalfFloatType, true);
    this.ldrRT = makeRT(THREE.UnsignedByteType, false);
    this.aoA = makeRT(THREE.UnsignedByteType, false);
    this.aoB = makeRT(THREE.UnsignedByteType, false);
    this.streakA = makeRT(THREE.HalfFloatType, false);
    this.streakB = makeRT(THREE.HalfFloatType, false);
    this.dirtRT = new THREE.WebGLRenderTarget(512, 288, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });

    for (let i = 0; i < this.BLOOM_MIPS; i++) {
      this.bloomDown.push(makeRT(THREE.HalfFloatType, false));
    }
    for (let i = 0; i < this.BLOOM_MIPS - 1; i++) {
      this.bloomUp.push(makeRT(THREE.HalfFloatType, false));
    }

    const makePass = (
      fragmentShader: string,
      uniforms: Record<string, THREE.IUniform>,
      defines?: Record<string, string | number>
    ) =>
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader,
        uniforms,
        defines,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });

    this.matSSAO = makePass(
      SSAO_FRAG,
      {
        tDepth: { value: this.sceneRT.depthTexture },
        uTanHalf: { value: new THREE.Vector2(1, 1) },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uDepthSize: { value: new THREE.Vector2(4, 4) },
        uDepthTexel: { value: new THREE.Vector2(0.25, 0.25) },
        uNear: { value: 0.08 },
        uFar: { value: 95 },
        uRadius: { value: 0.72 },
        uIntensity: { value: 1.45 },
        uAspect: { value: 1 },
      },
      { AO_TAPS: quality.aoTaps }
    );

    this.matAOBlur = makePass(AO_BLUR_FRAG, {
      tSrc: { value: null },
      uDir: { value: new THREE.Vector2() },
    });

    this.matBloomDown = makePass(BLOOM_DOWN_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uFirst: { value: 0 },
      uThreshold: { value: 0.55 },
    });

    this.matBloomUp = makePass(BLOOM_UP_FRAG, {
      tLow: { value: null },
      tHigh: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uMix: { value: 0.65 },
    });

    this.matStreak = makePass(STREAK_FRAG, {
      tSrc: { value: null },
      uDir: { value: new THREE.Vector2() },
      uThreshold: { value: 1.25 },
    });

    this.matDirt = makePass(DIRT_FRAG, {
      uAspect: { value: 16 / 9 },
    });

    this.matComposite = makePass(COMPOSITE_FRAG, {
      tScene: { value: this.sceneRT.texture },
      tBloom: { value: this.bloomUp[0].texture },
      tStreak: { value: this.streakB.texture },
      tAO: { value: this.aoA.texture },
      tDirt: { value: this.dirtRT.texture },
      uTime: { value: 0 },
      uExposure: { value: 1.05 },
      uBloom: { value: 0.42 },
      uStreak: { value: 0.14 },
      uDirt: { value: 0.18 },
      uAoOn: { value: quality.ssao ? 1 : 0 },
      uCA: { value: 0.0014 },
      uVignette: { value: 0.34 },
      uImpact: { value: 0 },
      uListen: { value: 0 },
      uFade: { value: 0 },
      uSunset: { value: 0 },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uSunVis: { value: 0 },
    });

    this.matFinal = makePass(FINAL_FRAG, {
      tSrc: { value: this.ldrRT.texture },
      uTexel: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uGrain: { value: 0.018 },
      uSharpen: { value: 0.24 },
      uFxaa: { value: quality.fxaa ? 1 : 0 },
    });

    this.quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.matFinal);
    this.quadScene.add(this.quadMesh);
  }

  public setQuality(q: QualityProfile): void {
    this.quality = q;
    if (this.matSSAO.defines.AO_TAPS !== q.aoTaps) {
      this.matSSAO.defines.AO_TAPS = q.aoTaps;
      this.matSSAO.needsUpdate = true;
    }
    this.matComposite.uniforms.uAoOn.value = q.ssao ? 1 : 0;
    this.matFinal.uniforms.uFxaa.value = q.fxaa ? 1 : 0;
  }

  public resize(pixelW: number, pixelH: number): void {
    const w = Math.max(4, Math.floor(pixelW));
    const h = Math.max(4, Math.floor(pixelH));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;

    this.sceneRT.setSize(w, h);
    this.ldrRT.setSize(w, h);

    const hw = Math.max(2, Math.floor(w / 2));
    const hh = Math.max(2, Math.floor(h / 2));
    this.aoA.setSize(hw, hh);
    this.aoB.setSize(hw, hh);
    this.streakA.setSize(Math.max(2, Math.floor(w / 4)), Math.max(2, Math.floor(h / 4)));
    this.streakB.setSize(Math.max(2, Math.floor(w / 4)), Math.max(2, Math.floor(h / 4)));

    let bw = hw;
    let bh = hh;
    for (let i = 0; i < this.BLOOM_MIPS; i++) {
      this.bloomDown[i].setSize(bw, bh);
      if (i < this.BLOOM_MIPS - 1) this.bloomUp[i].setSize(bw, bh);
      bw = Math.max(2, Math.floor(bw / 2));
      bh = Math.max(2, Math.floor(bh / 2));
    }
  }

  private runPass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quadMesh.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  public render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    params: PostFrameParams
  ): void {
    // Bake procedural lens dirt once
    if (!this.dirtBaked) {
      this.dirtBaked = true;
      this.runPass(this.matDirt, this.dirtRT);
    }

    // 1. Render 3D Scene into HDR Offscreen RenderTarget
    this.renderer.setRenderTarget(this.sceneRT);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    // 2. Half-Res SSAO + Bilateral Blur (when enabled in quality profile)
    if (this.quality.ssao) {
      const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      this.matSSAO.uniforms.uTanHalf.value.set(tanY * camera.aspect, tanY);
      this.matSSAO.uniforms.uTexel.value.set(1 / this.aoA.width, 1 / this.aoA.height);
      this.matSSAO.uniforms.uDepthSize.value.set(this.sceneRT.width, this.sceneRT.height);
      this.matSSAO.uniforms.uDepthTexel.value.set(1 / this.sceneRT.width, 1 / this.sceneRT.height);
      this.matSSAO.uniforms.uNear.value = camera.near;
      this.matSSAO.uniforms.uFar.value = camera.far;
      this.matSSAO.uniforms.uAspect.value = camera.aspect;
      this.runPass(this.matSSAO, this.aoA);

      this.matAOBlur.uniforms.tSrc.value = this.aoA.texture;
      this.matAOBlur.uniforms.uDir.value.set(1 / this.aoA.width, 0);
      this.runPass(this.matAOBlur, this.aoB);

      this.matAOBlur.uniforms.tSrc.value = this.aoB.texture;
      this.matAOBlur.uniforms.uDir.value.set(0, 1 / this.aoA.height);
      this.runPass(this.matAOBlur, this.aoA);
    }

    // 3. Multi-Mip HDR Bloom Pyramid + Anamorphic Horizontal Streak
    if (this.quality.bloom) {
      let srcTex = this.sceneRT.texture;
      let srcW = this.width;
      let srcH = this.height;
      for (let i = 0; i < this.BLOOM_MIPS; i++) {
        this.matBloomDown.uniforms.tSrc.value = srcTex;
        this.matBloomDown.uniforms.uTexel.value.set(1 / srcW, 1 / srcH);
        this.matBloomDown.uniforms.uFirst.value = i === 0 ? 1 : 0;
        this.matBloomDown.uniforms.uThreshold.value = params.peekMode ? 0.85 : 0.42;
        this.runPass(this.matBloomDown, this.bloomDown[i]);
        srcTex = this.bloomDown[i].texture;
        srcW = this.bloomDown[i].width;
        srcH = this.bloomDown[i].height;
      }

      let lowTex = this.bloomDown[this.BLOOM_MIPS - 1].texture;
      for (let i = this.BLOOM_MIPS - 2; i >= 0; i--) {
        const tgt = this.bloomUp[i];
        this.matBloomUp.uniforms.tLow.value = lowTex;
        this.matBloomUp.uniforms.tHigh.value = this.bloomDown[i].texture;
        this.matBloomUp.uniforms.uTexel.value.set(1 / tgt.width, 1 / tgt.height);
        this.runPass(this.matBloomUp, tgt);
        lowTex = tgt.texture;
      }

      // Subtle cinema anamorphic streak from mip 1
      this.matStreak.uniforms.tSrc.value = this.bloomDown[1].texture;
      this.matStreak.uniforms.uDir.value.set(2.4 / this.streakA.width, 0);
      this.matStreak.uniforms.uThreshold.value = 0.85;
      this.runPass(this.matStreak, this.streakA);

      this.matStreak.uniforms.tSrc.value = this.streakA.texture;
      this.matStreak.uniforms.uDir.value.set(5.2 / this.streakB.width, 0);
      this.matStreak.uniforms.uThreshold.value = 0.0;
      this.runPass(this.matStreak, this.streakB);
    }

    // Project Sun position for sunset anamorphic horizon lens flare
    this.sunProj.copy(params.sunDir).multiplyScalar(60).add(camera.position).project(camera);
    camera.getWorldDirection(this.camDir);
    const facingSun = Math.max(0, this.camDir.dot(params.sunDir));
    const sunVis = params.sunsetFactor * Math.pow(facingSun, 3.0);

    // 4. Composite + Filmic ACES/AgX ToneMap + Split-Tone Cinema Grade
    const cu = this.matComposite.uniforms;
    cu.uTime.value = params.elapsed;
    cu.uExposure.value = params.peekMode ? 1.15 : 1.08 + params.sunsetFactor * 0.14;
    cu.uBloom.value = this.quality.bloom ? (params.peekMode ? 0.28 : 0.56) : 0.0;
    cu.uStreak.value = this.quality.bloom ? 0.16 : 0.0;
    cu.uImpact.value = params.impactPulse;
    cu.uListen.value = params.listenBlend;
    cu.uFade.value = params.fadeAmount;
    cu.uSunset.value = params.sunsetFactor;
    cu.uSunUv.value.set(this.sunProj.x * 0.5 + 0.5, this.sunProj.y * 0.5 + 0.5);
    cu.uSunVis.value = sunVis;
    this.runPass(this.matComposite, this.ldrRT);

    // 5. Final FXAA + Unsharp Clarity + Animated Film Grain -> Screen!
    const fu = this.matFinal.uniforms;
    fu.uTexel.value.set(1 / this.width, 1 / this.height);
    fu.uTime.value = params.elapsed;
    this.runPass(this.matFinal, null);
  }

  public dispose(): void {
    this.sceneRT.dispose();
    this.ldrRT.dispose();
    this.aoA.dispose();
    this.aoB.dispose();
    this.streakA.dispose();
    this.streakB.dispose();
    this.dirtRT.dispose();
    this.bloomDown.forEach((rt) => rt.dispose());
    this.bloomUp.forEach((rt) => rt.dispose());
    this.matSSAO.dispose();
    this.matAOBlur.dispose();
    this.matBloomDown.dispose();
    this.matBloomUp.dispose();
    this.matStreak.dispose();
    this.matDirt.dispose();
    this.matComposite.dispose();
    this.matFinal.dispose();
    this.quadMesh.geometry.dispose();
  }
}
