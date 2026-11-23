import * as THREE from 'three';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform float uSunset;
uniform float uPeek;
uniform vec3 uSunDir;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * n2(p);
    p = rot * p * 2.03 + vec2(13.1, 7.7);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 sunDir = normalize(uSunDir);
  float mu = dot(d, sunDir);
  float s = max(mu, 0.0);

  // Near-pure pitch-black sky in blind immersive mode (blooms into golden sunset on uSunset!)
  vec3 nightZenith = vec3(0.0003, 0.0005, 0.0009);
  vec3 nightHorizon = vec3(0.0012, 0.0018, 0.0028);
  vec3 nightSunGlow = vec3(0.004, 0.006, 0.009);

  // Peek-mode overcast evening blue-slate sky
  vec3 peekZenith = vec3(0.06, 0.095, 0.145);
  vec3 peekHorizon = vec3(0.18, 0.22, 0.27);

  // Golden after-rain sunset palette (inspired by baks/index.html & Ref Image 4!)
  vec3 sunZenith = vec3(0.09, 0.15, 0.26);
  vec3 sunMid = vec3(0.76, 0.44, 0.24);
  vec3 sunHorizon = vec3(1.18, 0.62, 0.25);

  vec3 baseZenith = mix(nightZenith, peekZenith, uPeek);
  vec3 baseHorizon = mix(nightHorizon, peekHorizon, uPeek);

  vec3 zen = mix(baseZenith, sunZenith, uSunset);
  vec3 hor = mix(baseHorizon, sunHorizon, uSunset);
  vec3 mid = mix(mix(nightHorizon, peekHorizon, uPeek) * 0.7, sunMid, uSunset);

  // Clear atmospheric gradient
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.16, h));
  col = mix(col, zen, smoothstep(0.12, 0.62, h));

  // Mie scattering sun aureole & blazing low sun disc along -Z street canyon
  float sunVis = max(uSunset, uPeek * 0.38);
  vec3 sunColor = mix(nightSunGlow, vec3(1.6, 0.92, 0.45), uSunset);
  float mie = pow(s, 6.0) * 0.24 + pow(s, 42.0) * 0.72 + pow(s, 360.0) * 2.8 + pow(s, 3800.0) * 18.0;
  col += sunColor * mie * (0.02 + sunVis * 1.18);

  // Rolling after-rain cloud deck with backlit golden silver-lining
  vec2 cuv = d.xz / (h + 0.12) * vec2(0.55, 0.88);
  vec2 wind = vec2(-0.015, 0.008) * uTime;
  float warp = fbm(cuv * 0.55 + wind);
  float dens = fbm(cuv * 1.15 + wind + (warp - 0.5) * 1.1);
  float cov = smoothstep(0.36, 0.68, dens) * smoothstep(0.02, 0.22, h);

  // Leave a ragged golden gap around the setting sun
  float sunGap = smoothstep(0.78, 0.985, s) * uSunset;
  cov *= (1.0 - sunGap * 0.65);

  vec3 cloudDark = mix(vec3(0.0005, 0.0008, 0.0012), vec3(0.18, 0.16, 0.21), max(uSunset * 0.9, uPeek * 0.55));
  vec3 cloudLit = mix(vec3(0.002, 0.003, 0.005), vec3(1.35, 0.72, 0.34), uSunset);
  float rim = pow(s, 4.0) * (1.0 - dens * 0.65) + pow(1.0 - cov, 2.0) * pow(s, 10.0);
  vec3 cloudCol = mix(cloudDark, cloudLit, clamp(rim * 1.35 + (1.0 - dens) * 0.35 * sunVis, 0.0, 1.0));

  col = mix(col, cloudCol, cov * 0.88);

  // Below-horizon wet-night dark floor bounce
  if (d.y < 0.0) {
    vec3 groundBounce = mix(vec3(0.0002, 0.0004, 0.0006), vec3(0.24, 0.13, 0.06), uSunset);
    col = mix(hor * 0.4, groundBounce, smoothstep(0.0, -0.18, d.y));
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export class SkyEnvironmentSystem {
  public readonly skyMesh: THREE.Mesh;
  public readonly material: THREE.ShaderMaterial;
  public readonly sunDirection = new THREE.Vector3(0.02, 0.115, -0.993).normalize();

  private pmrem: THREE.PMREMGenerator;
  private nightEnvRT: THREE.WebGLRenderTarget | null = null;
  private sunsetEnvRT: THREE.WebGLRenderTarget | null = null;
  private lastAppliedMode: 'night' | 'sunset' | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSunset: { value: 0 },
        uPeek: { value: 0 },
        uSunDir: { value: this.sunDirection.clone() },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });

    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(76, 32, 20), this.material);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -100;
    scene.add(this.skyMesh);

    this.bakeEnvironments(scene);
  }

  private bakeEnvironments(mainScene: THREE.Scene): void {
    // Build a lightweight sky-only scene for fast PMREM IBL baking (rainy dusk & golden sunset)
    const bakeScene = new THREE.Scene();
    const bakeMat = this.material.clone();
    const bakeDome = new THREE.Mesh(new THREE.SphereGeometry(20, 24, 16), bakeMat);
    bakeScene.add(bakeDome);

    // Subtle urban warm/cool light cards in the IBL scene so wet puddles & bikes get lush specular catchlights
    const warmCard = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.25, 0.45), side: THREE.DoubleSide })
    );
    warmCard.position.set(-8, 3.5, -2);
    warmCard.lookAt(0, 0, 0);
    bakeScene.add(warmCard);

    const coolCard = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.85, 1.45), side: THREE.DoubleSide })
    );
    coolCard.position.set(8, 5.5, 4);
    coolCard.lookAt(0, 0, 0);
    bakeScene.add(coolCard);

    // 1. Rainy Urban Night IBL
    bakeMat.uniforms.uSunset.value = 0.12;
    bakeMat.uniforms.uPeek.value = 0.65;
    this.nightEnvRT = this.pmrem.fromScene(bakeScene, 0.035);

    // 2. Golden After-Rain Sunset IBL
    bakeMat.uniforms.uSunset.value = 1.0;
    bakeMat.uniforms.uPeek.value = 0.0;
    this.sunsetEnvRT = this.pmrem.fromScene(bakeScene, 0.025);

    bakeDome.geometry.dispose();
    bakeMat.dispose();
    warmCard.geometry.dispose();
    warmCard.material.dispose();
    coolCard.geometry.dispose();
    coolCard.material.dispose();

    mainScene.environment = this.nightEnvRT.texture;
    mainScene.environmentIntensity = 0.92;
    this.lastAppliedMode = 'night';
  }

  public update(
    elapsed: number,
    sunsetFactor: number,
    peekMode: boolean,
    cameraPos: THREE.Vector3,
    scene: THREE.Scene
  ): void {
    this.material.uniforms.uTime.value = elapsed;
    this.material.uniforms.uSunset.value = sunsetFactor;
    this.material.uniforms.uPeek.value = peekMode ? 1.0 : 0.0;
    this.skyMesh.position.copy(cameraPos);

    const desiredMode = sunsetFactor > 0.35 ? 'sunset' : 'night';
    if (desiredMode !== this.lastAppliedMode) {
      this.lastAppliedMode = desiredMode;
      if (desiredMode === 'sunset' && this.sunsetEnvRT) {
        scene.environment = this.sunsetEnvRT.texture;
        scene.environmentIntensity = 1.18;
      } else if (this.nightEnvRT) {
        scene.environment = this.nightEnvRT.texture;
        scene.environmentIntensity = 0.92;
      }
    }
  }

  public dispose(): void {
    this.nightEnvRT?.dispose();
    this.sunsetEnvRT?.dispose();
    this.pmrem.dispose();
    this.skyMesh.geometry.dispose();
    this.material.dispose();
  }
}
