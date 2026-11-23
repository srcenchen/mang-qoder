import * as THREE from 'three';

/**
 * Real-time planar wet-ground reflection pass (inspired by baks/index.html).
 * Mirrors the camera across Y = planeY and renders into a mipmapped HalfFloat RenderTarget
 * so rain puddles & wet zebra stripes reflect lights, stall lanterns, car streaks, and sunset sky!
 */
export class PlanarReflectionPass {
  public readonly renderTarget: THREE.WebGLRenderTarget;
  public readonly textureMatrix = new THREE.Matrix4();
  public enabled = true;

  private virtualCamera = new THREE.PerspectiveCamera();
  private planeY = 0.08;
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08);
  private clipPlanesArr: THREE.Plane[] = [this.clipPlane];
  private prevVisCache: boolean[] = [];
  private lookTarget = new THREE.Vector3();
  private upVec = new THREE.Vector3();
  private biasMatrix = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1
  );

  constructor(width = 512, height = 288) {
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: true,
      stencilBuffer: false,
    });
  }

  public resize(viewportW: number, viewportH: number, scale: number): void {
    const w = Math.max(128, Math.floor(viewportW * scale));
    const h = Math.max(72, Math.floor(viewportH * scale));
    if (this.renderTarget.width !== w || this.renderTarget.height !== h) {
      this.renderTarget.setSize(w, h);
    }
  }

  public render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    mainCamera: THREE.PerspectiveCamera,
    hiddenObjects: THREE.Object3D[]
  ): void {
    if (!this.enabled) return;

    // Position mirrored camera across Y = planeY
    this.virtualCamera.fov = mainCamera.fov;
    this.virtualCamera.aspect = mainCamera.aspect;
    this.virtualCamera.near = mainCamera.near;
    this.virtualCamera.far = mainCamera.far;
    this.virtualCamera.updateProjectionMatrix();

    mainCamera.getWorldDirection(this.lookTarget);
    const camPos = mainCamera.position;
    const mirrorY = 2 * this.planeY - camPos.y;
    this.virtualCamera.position.set(camPos.x, mirrorY, camPos.z);

    // Mirror look direction & up vector across Y plane
    this.lookTarget.y = -this.lookTarget.y;
    this.lookTarget.add(this.virtualCamera.position);
    this.upVec.set(0, 1, 0).applyQuaternion(mainCamera.quaternion);
    this.upVec.y = -this.upVec.y;
    this.virtualCamera.up.copy(this.upVec);
    this.virtualCamera.lookAt(this.lookTarget);
    this.virtualCamera.updateMatrixWorld(true);

    // Compute world -> reflection UV projection matrix
    this.textureMatrix.copy(this.biasMatrix);
    this.textureMatrix.multiply(this.virtualCamera.projectionMatrix);
    this.textureMatrix.multiply(this.virtualCamera.matrixWorldInverse);

    // Hide reflective ground & first-person cane during reflection capture (reuse cache array to avoid GC)
    const count = hiddenObjects.length;
    if (this.prevVisCache.length < count) {
      this.prevVisCache.length = count;
    }
    for (let i = 0; i < count; i++) {
      this.prevVisCache[i] = hiddenObjects[i].visible;
      hiddenObjects[i].visible = false;
    }

    const prevTarget = renderer.getRenderTarget();
    const prevClipping = renderer.localClippingEnabled;
    const prevPlanes = renderer.clippingPlanes;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;

    // Clip geometry below ground plane so mirrored camera only captures above-ground scene
    renderer.localClippingEnabled = true;
    renderer.clippingPlanes = this.clipPlanesArr;
    renderer.shadowMap.autoUpdate = false;

    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(scene, this.virtualCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.localClippingEnabled = prevClipping;
    renderer.clippingPlanes = prevPlanes;
    renderer.shadowMap.autoUpdate = prevShadowAuto;

    for (let i = 0; i < count; i++) {
      hiddenObjects[i].visible = this.prevVisCache[i];
    }
  }

  public dispose(): void {
    this.renderTarget.dispose();
  }
}
