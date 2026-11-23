import * as THREE from 'three';

const RAIN_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uIntensity;
uniform float uSunset;
uniform float uWorldVis;
uniform vec3 uCamPos;
uniform vec3 uBox;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;

bool isSheltered(vec3 p) {
  // Indoor foyer (Z > -5.55 && X in [-2.2, 2.2])
  if (p.z > -5.55 && abs(p.x) < 2.2) return true;
  // Breakfast stall awning overhang on Leg 3 (X in [9.6, 12.1], Z in [-25.5, -21.7], Y < 2.65)
  if (p.x > 9.6 && p.x < 12.1 && p.z < -21.7 && p.z > -25.5 && p.y < 2.65) return true;
  return false;
}

void main() {
  vUv = position.xy;
  float sp = 0.85 + 0.35 * aSeed.w;
  vec3 vel = vec3(-0.9, -11.5, 0.35) * sp;
  vec3 p;
  float len;
  float kill = 0.0;

  if (aSeed.w < 0.0) {
    // Eave drips falling off breakfast stall front canopy edge (Leg 3, X = 11.9, Z = -25.3 to -21.9)!
    float T = 0.78;
    float t = fract(uTime / T * (0.85 + 0.3 * aSeed.y) + aSeed.z) * T;
    p = vec3(11.9 + 0.06 * sin(aSeed.x * 41.0), 2.52 - 4.9 * t * t, mix(-25.3, -21.9, aSeed.x));
    vel = vec3(0.0, -9.81 * t - 0.35, 0.0);
    len = 0.032 * length(vel) + 0.035;
    if (p.y < 0.08) kill = 1.0;
  } else {
    p = aSeed.xyz * uBox + vel * uTime;
    p = mod(p - uCamPos + 0.5 * uBox, uBox) - 0.5 * uBox + uCamPos;
    len = 0.032 * length(vel);
    if (p.y < 0.05 || isSheltered(p)) kill = 1.0;
    if (fract(aSeed.w * 7.13 + aSeed.x) > uIntensity) kill = 1.0;
  }

  vec3 dir = normalize(vel);
  vec3 toP = p - uCamPos;
  float dist = length(toP);
  vec3 side = normalize(cross(dir, toP));
  float w = max(0.0055, dist * 0.0014);
  vec3 wp = p + dir * (len * (position.y - 0.5)) + side * (w * position.x);

  // Subtle illumination boost near stall warm lantern & golden sunset
  float stallDist = distance(p, vec3(11.55, 2.0, -23.6));
  float stallGlow = 1.0 - smoothstep(1.0, 5.2, stallDist);
  float distFade = smoothstep(0.6, 2.2, dist) * (1.0 - smoothstep(10.0, 18.0, dist));

  vec3 nightTint = vec3(0.32, 0.52, 0.72);
  vec3 warmTint = vec3(1.25, 0.78, 0.42);
  vColor = mix(nightTint, warmTint, clamp(stallGlow * 0.95 + uSunset * 0.85, 0.0, 1.0));
  float darkMask = 0.08 + 0.92 * max(uWorldVis, stallGlow * 0.85);
  vAlpha = (0.14 + stallGlow * 0.28 + uSunset * 0.24) * distFade * darkMask * (1.0 - kill);

  gl_Position = kill > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const RAIN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float x = 1.0 - abs(vUv.x) * 2.0;
  float e = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
  gl_FragColor = vec4(vColor, vAlpha * x * e);
}
`;

const SPLASH_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uIntensity;
uniform float uSunset;
uniform float uWorldVis;
uniform vec3 uCamPos;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;

vec2 sHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

void main() {
  vUv = position.xy;
  float period = 0.28 + 0.16 * aSeed.z;
  float tt = uTime / period + aSeed.w * 12.0;
  float cyc = floor(tt);
  float life = fract(tt);

  vec2 r = sHash(aSeed.xy * 87.3 + cyc * 0.371) - 0.5;
  vec2 snap = floor(uCamPos.xz / 2.5) * 2.5;
  vec3 p = vec3(snap.x + r.x * 18.0, 0.088, snap.y + r.y * 18.0);
  if (p.x > 16.85 || (p.z < -29.85 && p.z > -39.75)) p.y = 0.012;

  float kill = 0.0;
  if (p.z > -5.6 && abs(p.x) < 2.2) kill = 1.0;
  if (p.x > 9.6 && p.x < 12.1 && p.z < -21.7 && p.z > -25.5) kill = 1.0;
  if (fract(aSeed.w * 5.3 + cyc * 0.17) > uIntensity) kill = 1.0;

  float sz = mix(0.032, 0.065, aSeed.z);
  float wd = sz * (0.65 + 1.5 * life);
  float ht = sz * (0.35 + 1.25 * sin(life * 3.14159));

  vec3 toP = p - uCamPos;
  float dist = length(toP);
  vec3 side = normalize(vec3(toP.z, 0.0, -toP.x + 1e-4));
  vec3 wp = p + side * (wd * position.x * 2.0) + vec3(0.0, ht * position.y, 0.0);

  float stallGlow = 1.0 - smoothstep(1.0, 4.8, distance(p, vec3(11.55, 0.5, -23.6)));
  vColor = mix(vec3(0.34, 0.56, 0.78), vec3(1.25, 0.82, 0.42), clamp(stallGlow + uSunset * 0.85, 0.0, 1.0));
  float darkMask = 0.08 + 0.92 * max(uWorldVis, stallGlow * 0.85);
  vAlpha = (1.0 - life) * (1.0 - smoothstep(8.0, 14.0, dist)) * (0.18 + stallGlow * 0.35 + uSunset * 0.32) * darkMask * (1.0 - kill);

  gl_Position = kill > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SPLASH_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float x = vUv.x * 2.0;
  float y = vUv.y;
  float d = length(vec2(x * 1.15, y * 1.45));
  float crown = smoothstep(1.0, 0.25, d) * (0.35 + 0.65 * smoothstep(0.25, 0.72, d));
  gl_FragColor = vec4(vColor, vAlpha * crown);
}
`;

export class RainWeatherSystem {
  private scene: THREE.Scene;
  private rainMesh: THREE.Mesh | null = null;
  private splashMesh: THREE.Mesh | null = null;
  private rainMat: THREE.ShaderMaterial;
  private splashMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, rainCount: number, splashCount: number) {
    this.scene = scene;

    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.72 },
        uSunset: { value: 0 },
        uWorldVis: { value: 1.0 },
        uCamPos: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(24, 14, 24) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.splashMat = new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.72 },
        uSunset: { value: 0 },
        uWorldVis: { value: 1.0 },
        uCamPos: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.rebuild(rainCount, splashCount);
  }

  public rebuild(rainCount: number, splashCount: number): void {
    if (this.rainMesh) {
      this.scene.remove(this.rainMesh);
      this.rainMesh.geometry.dispose();
    }
    if (this.splashMesh) {
      this.scene.remove(this.splashMesh);
      this.splashMesh.geometry.dispose();
    }

    const baseQuad = new THREE.PlaneGeometry(1, 1);
    baseQuad.translate(0, 0.5, 0);

    // Rain streaks + 60 stall eave drips (indicated by negative aSeed.w)
    const eaveDrips = 60;
    const totalDrops = rainCount + eaveDrips;
    const rainGeo = new THREE.InstancedBufferGeometry();
    rainGeo.index = baseQuad.index;
    rainGeo.attributes.position = baseQuad.attributes.position;
    const rainSeeds = new Float32Array(totalDrops * 4);
    for (let i = 0; i < totalDrops; i++) {
      rainSeeds[i * 4] = Math.random();
      rainSeeds[i * 4 + 1] = Math.random();
      rainSeeds[i * 4 + 2] = Math.random();
      rainSeeds[i * 4 + 3] = i < eaveDrips ? -1.0 : Math.random();
    }
    rainGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(rainSeeds, 4));
    rainGeo.instanceCount = totalDrops;

    this.rainMesh = new THREE.Mesh(rainGeo, this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.scene.add(this.rainMesh);

    // Ground splash crowns
    const splashGeo = new THREE.InstancedBufferGeometry();
    splashGeo.index = baseQuad.index;
    splashGeo.attributes.position = baseQuad.attributes.position;
    const splashSeeds = new Float32Array(splashCount * 4);
    for (let i = 0; i < splashCount; i++) {
      splashSeeds[i * 4] = Math.random();
      splashSeeds[i * 4 + 1] = Math.random();
      splashSeeds[i * 4 + 2] = Math.random();
      splashSeeds[i * 4 + 3] = Math.random();
    }
    splashGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(splashSeeds, 4));
    splashGeo.instanceCount = splashCount;

    this.splashMesh = new THREE.Mesh(splashGeo, this.splashMat);
    this.splashMesh.frustumCulled = false;
    this.scene.add(this.splashMesh);
    baseQuad.dispose();
  }

  public update(
    elapsed: number,
    cameraPos: THREE.Vector3,
    sunsetFactor: number,
    worldVis = 1.0
  ): void {
    // Rain tapers into gentle golden after-rain mist at sunset finale
    const rainIntensity = THREE.MathUtils.lerp(0.75, 0.25, sunsetFactor);
    this.rainMat.uniforms.uTime.value = elapsed;
    this.rainMat.uniforms.uIntensity.value = rainIntensity;
    this.rainMat.uniforms.uSunset.value = sunsetFactor;
    this.rainMat.uniforms.uWorldVis.value = worldVis;
    this.rainMat.uniforms.uCamPos.value.copy(cameraPos);

    this.splashMat.uniforms.uTime.value = elapsed;
    this.splashMat.uniforms.uIntensity.value = rainIntensity;
    this.splashMat.uniforms.uSunset.value = sunsetFactor;
    this.splashMat.uniforms.uWorldVis.value = worldVis;
    this.splashMat.uniforms.uCamPos.value.copy(cameraPos);
  }

  public dispose(): void {
    if (this.rainMesh) {
      this.scene.remove(this.rainMesh);
      this.rainMesh.geometry.dispose();
    }
    if (this.splashMesh) {
      this.scene.remove(this.splashMesh);
      this.splashMesh.geometry.dispose();
    }
    this.rainMat.dispose();
    this.splashMat.dispose();
  }
}
