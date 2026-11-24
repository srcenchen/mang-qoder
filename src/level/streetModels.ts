import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EchoShaderManager } from '../shaders/echoMaterial';

const PAINTS = ['#1e242d', '#1a2533', '#2b2422'];
type Route = 7 | 12;
type BusMesh = THREE.Group & { setRoute: (route: Route) => void };

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Combines fixed details by material at scene initialization, keeping the live draw count low. */
function batchParts(group: THREE.Group) {
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of group.children as THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]) {
    child.updateMatrix();
    const geometry = child.geometry.clone().applyMatrix4(child.matrix);
    const bucket = byMaterial.get(child.material);
    if (bucket) bucket.push(geometry);
    else byMaterial.set(child.material, [geometry]);
  }
  group.clear();
  for (const [material, parts] of byMaterial) {
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts)!;
    if (parts.length > 1) for (const part of parts) part.dispose();
    group.add(new THREE.Mesh(geometry, material));
  }
}

export function createStreetModelFactories(echo: EchoShaderManager) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const tireShape = new THREE.CylinderGeometry(1, 1, 1, 16);
  const hubShape = new THREE.CylinderGeometry(1, 1, 1, 12);
  const surface = (options: THREE.MeshStandardMaterialParameters) =>
    echo.enhanceMaterial(new THREE.MeshStandardMaterial(options));
  const paints = PAINTS.map(color => surface({ color, metalness: 0.65, roughness: 0.3 }));
  const glass = surface({ color: '#0c131c', metalness: 0.85, roughness: 0.12 });
  const trim = surface({ color: '#222731', metalness: 0.63, roughness: 0.38 });
  const rubber = surface({ color: '#151619', roughness: 0.92 });
  const alloy = surface({ color: '#8b95a3', metalness: 0.8, roughness: 0.3 });
  const headlight = new THREE.MeshStandardMaterial({
    color: '#fff2d6', emissive: '#fff2d6', emissiveIntensity: 0.52,
  });
  const taillight = new THREE.MeshStandardMaterial({
    color: '#ff1f1f', emissive: '#ff1f1f', emissiveIntensity: 3.2,
  });
  const busTaillight = new THREE.MeshStandardMaterial({
    color: '#ff2b2b', emissive: '#ff2b2b', emissiveIntensity: 0.45,
  });
  const beamMask = canvasTexture(128, 32, ctx => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 32);
    const lengthwise = ctx.createLinearGradient(0, 0, 128, 0);
    lengthwise.addColorStop(0, 'white');
    lengthwise.addColorStop(1, 'black');
    ctx.fillStyle = lengthwise;
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.lineTo(128, 0);
    ctx.lineTo(128, 32);
    ctx.lineTo(0, 21);
    ctx.closePath();
    ctx.fill();
  });
  const beam = (color: string, opacity: number) => new THREE.MeshBasicMaterial({
    color, opacity, alphaMap: beamMask, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lowBeam = beam('#fff2d6', 0.14);
  const trail = beam('#ff1f1f', 0.34);

  function part(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material,
    x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    group.add(mesh);
    return mesh;
  }

  function wheels(group: THREE.Group, axleX: number, width: number, radius: number, hub: number, depth: number) {
    for (const end of [-1, 1]) for (const side of [-1, 1]) {
      part(group, tireShape, rubber, end * axleX, radius, side * width, radius, depth, radius).rotation.x = Math.PI / 2;
      part(group, hubShape, alloy, end * axleX, radius, side * width, hub, depth + 0.01, hub).rotation.x = Math.PI / 2;
    }
  }

  function lamps(group: THREE.Group, end: number, offset: number, height: number, beams: boolean) {
    for (const side of [-1, 1]) {
      part(group, box, headlight, end, height, side * offset, 0.047, 0.11, 0.31);
      part(group, box, beams ? taillight : busTaillight, -end, height, side * offset, 0.043, 0.10, 0.27);
      if (beams) {
        part(group, plane, lowBeam, end + 1.66, 0.022, side * offset, 3.3, 1.05, 1).rotation.x = -Math.PI / 2;
        part(group, plane, trail, -end - 1.55, height, side * offset, 3.1, 0.057, 1)
          .rotation.set(0, 0, Math.PI);
        part(group, plane, trail, -end - 1.55, height, side * offset, 3.1, 0.057, 1)
          .rotation.set(0, Math.PI, 0);
      }
    }
  }

  // Both factories face +X. The bus is later rotated to +Z with its doors on the kerb side.
  function createSedanMesh(paintColorHex: string): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Crosswalk sedan';
    const paint = paints[Math.max(0, PAINTS.indexOf(paintColorHex))];
    part(group, box, paint, 0, 0.54, 0, 4.15, 0.54, 1.76);
    part(group, box, paint, -0.25, 1.02, 0, 2.05, 0.46, 1.54);
    part(group, box, paint, -0.28, 1.39, 0, 1.48, 0.09, 1.46);
    for (const end of [-1, 1]) {
      part(group, box, trim, end * 2.075, 0.4, 0, 0.09, 0.13, 1.59);
      part(group, box, glass, -0.25 + end * 0.98, 1.105, 0, 0.045, 0.56, 1.51).rotation.z = end * Math.PI * 32 / 180;
    }
    for (const side of [-1, 1]) {
      for (const x of [-0.69, 0.13]) {
        part(group, box, glass, x, 1.094, side * 0.777, 0.73, 0.3, 0.026);
      }
      part(group, box, paint, 0.70, 1.06, side * 0.872, 0.20, 0.105, 0.17);
      part(group, box, trim, -0.22, 0.60, side * 0.889, 1.75, 0.035, 0.032);
    }
    wheels(group, 1.27, 0.785, 0.32, 0.18, 0.24);
    lamps(group, 2.09, 0.64, 0.635, true);
    batchParts(group);
    return group;
  }

  function cycleSedanPaint(group: THREE.Group) {
    for (const mesh of group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]) {
      const index = paints.indexOf(mesh.material);
      if (index >= 0) mesh.material = paints[(index + 1) % paints.length];
    }
  }

  function createBusMesh(): BusMesh {
    const group = new THREE.Group();
    group.name = 'Kerbside city bus';
    const lower = surface({ color: '#1e3a46', roughness: 0.45, metalness: 0.25 });
    const upper = surface({ color: '#cbd5e1', roughness: 0.45, metalness: 0.25 });
    part(group, box, lower, 0, 0.84, 0, 8.72, 1.05, 2.35);
    part(group, box, upper, 0, 1.98, 0, 8.75, 1.24, 2.36);
    part(group, box, upper, -0.30, 2.73, 0, 2.60, 0.26, 1.35);
    part(group, box, glass, 4.383, 1.95, 0, 0.04, 0.69, 2.16).rotation.z = 0.07;
    part(group, box, glass, -4.384, 1.94, 0, 0.04, 0.63, 2.07);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        part(group, box, glass, -3.45 + i * 1.68, 1.95, side * 1.184, 1.49, 0.68, 0.026);
      }
      part(group, box, upper, 0, 1.27, side * 1.184, 8.53, 0.075, 0.018);
    }
    // Both doors land inside the existing platform opening when the bus is stopped.
    for (const doorX of [-1.01, 1.4]) {
      part(group, box, trim, doorX, 1.51, 1.188, 1.09, 1.66, 0.045);
      for (const dx of [-0.255, 0.255]) {
        part(group, box, glass, doorX + dx, 1.63, 1.213, 0.45, 1.22, 0.020);
      }
    }
    wheels(group, 2.65, 1.015, 0.46, 0.25, 0.29);
    lamps(group, 4.39, 0.83, 0.93, false);
    batchParts(group);
    return Object.assign(group, { setRoute: addBusRouteBoards(group) });
  }

  function addBusRouteBoards(bus: THREE.Group): (route: Route) => void {
    const boards: Record<Route, THREE.MeshStandardMaterial> = {
      12: routeMaterial('12路 火车站'),
      7: routeMaterial('7路 老街路口'),
    };
    const front = part(bus, plane, boards[12], 4.409, 2.39, 0, 1.83, 0.25, 1);
    front.name = 'Front route LED';
    front.rotation.y = Math.PI / 2;
    const side = part(bus, plane, boards[12], 2.12, 2.37, 1.204, 1.54, 0.23, 1);
    side.name = 'Platform route LED';
    let activeRoute: Route = 12;
    return route => {
      if (route === activeRoute) return;
      activeRoute = route;
      front.material = side.material = boards[route];
    };
  }

  function routeMaterial(label: string) {
    const map = canvasTexture(384, 72, ctx => {
      ctx.fillStyle = '#080a09';
      ctx.fillRect(0, 0, 384, 72);
      ctx.fillStyle = '#ffc16b';
      ctx.font = '600 42px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 192, 36);
      ctx.fillStyle = 'rgba(0,0,0,.24)';
      for (let y = 1; y < 72; y += 4) ctx.fillRect(0, y, 384, 1);
    });
    return new THREE.MeshStandardMaterial({
      map, emissive: '#ffab48', emissiveMap: map, emissiveIntensity: 0.6, roughness: 0.74,
    });
  }

  function createBusShelter(x: number, z: number, wood: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();
    group.name = '老街站';
    group.position.set(x, 0.08, z);
    const steel = surface({ color: '#2a2f38', metalness: 0.72, roughness: 0.38 });
    const screen = surface({
      color: '#384a52', transparent: true, opacity: 0.28, roughness: 0.15,
      metalness: 0.26, depthWrite: false, side: THREE.DoubleSide,
    });
    const strip = surface({ color: '#fef3c7', emissive: '#fef3c7', emissiveIntensity: 0.21 });
    for (const offset of [-0.95, 0, 0.95]) {
      part(group, box, steel, 0, 1.18, offset, 0.12, 2.36, 0.12);
    }
    for (const offset of [-0.475, 0.475]) {
      part(group, box, screen, 0, 1.13, offset, 0.02, 1.64, 0.83);
    }
    part(group, box, screen, 0.33, 1.13, 0.95, 0.58, 1.64, 0.023);
    for (const y of [0.28, 1.96]) part(group, box, steel, 0, y, 0, 0.08, 0.043, 1.92);
    part(group, box, steel, 0.59, 2.38, 0, 1.54, 0.075, 2.46).rotation.z = -0.062;
    part(group, box, steel, 1.34, 2.31, 0, 0.095, 0.13, 2.46);
    part(group, box, strip, 0.65, 2.30, 0, 0.052, 0.020, 1.79);
    for (const x of [0.15, 0.264, 0.378]) {
      part(group, box, wood, x, 0.435, -0.14, 0.106, 0.03, 1.29);
    }
    for (const offset of [-0.64, 0.36]) part(group, box, steel, 0.26, 0.21, offset, 0.27, 0.42, 0.052);
    part(group, box, steel, 0.07, 1.22, 0.72, 0.10, 1.13, 0.43);
    const schedule = canvasTexture(192, 448, ctx => {
      ctx.fillStyle = '#111c23'; ctx.fillRect(0, 0, 192, 448);
      ctx.fillStyle = '#eee1c7'; ctx.font = 'bold 39px "Microsoft YaHei", sans-serif';
      ctx.fillText('老街站', 23, 58);
      ctx.fillStyle = '#edb875'; ctx.font = 'bold 24px "Microsoft YaHei", sans-serif';
      ctx.fillText('7路 · 12路', 23, 112);
      ctx.fillRect(34, 157, 3, 220);
      const stops = ['本站', '老街路口', '火车站'];
      for (let i = 0; i < stops.length; i++) {
        const y = 176 + 86 * i;
        ctx.beginPath(); ctx.arc(35, y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillText(stops[i], 58, y + 7);
      }
    });
    const panel = surface({ map: schedule, emissive: '#e1c499', emissiveMap: schedule, emissiveIntensity: 0.24 });
    part(group, plane, panel, 0.123, 1.22, 0.72, 0.40, 1.09, 1).rotation.y = Math.PI / 2;
    part(group, box, steel, 1.48, 1.24, -1.48, 0.065, 2.48, 0.065);
    part(group, box, steel, 1.48, 2.30, -1.48, 0.06, 0.33, 0.76);
    const sign = canvasTexture(320, 128, ctx => {
      ctx.fillStyle = '#17313d'; ctx.fillRect(0, 0, 320, 128);
      ctx.strokeStyle = '#dfc49c'; ctx.lineWidth = 4; ctx.strokeRect(9, 9, 302, 110);
      ctx.textAlign = 'center'; ctx.fillStyle = '#f1e5cc'; ctx.font = '600 30px "Microsoft YaHei", sans-serif';
      ctx.fillText('公交车站 · 7 / 12', 160, 75);
    });
    const signFace = surface({ map: sign, metalness: 0.26, roughness: 0.48 });
    for (const side of [-1, 1]) {
      part(group, plane, signFace, 1.48 + side * 0.032, 2.30, -1.48, 0.72, 0.29, 1).rotation.y = side * Math.PI / 2;
    }
    batchParts(group);
    return group;
  }

  return { createSedanMesh, cycleSedanPaint, createBusMesh, createBusShelter };
}
