import * as THREE from 'three';

export interface PBRMapGroup {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
}

export interface ProceduralTextureSet {
  interiorTile: PBRMapGroup;
  plasterWall: PBRMapGroup;
  brickWall: PBRMapGroup;
  shutterMetal: PBRMapGroup;
  wetSidewalk: PBRMapGroup;
  wetAsphalt: PBRMapGroup;
  tactileLine: PBRMapGroup;
  tactileDot: PBRMapGroup;
  barrierStripe: PBRMapGroup;
  darkWood: PBRMapGroup;
  warmWood: PBRMapGroup;
  bamboo: PBRMapGroup;
  convenienceSign: THREE.CanvasTexture;
  stallBanner: THREE.CanvasTexture;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function toTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Converts a greyscale height canvas into a true tangent-space RGB NormalMap via Sobel operator.
 * Dramatic realism boost under PBR point/directional lights and PMREM IBL!
 */
function heightToNormalTexture(
  heightCanvas: HTMLCanvasElement,
  strength: number,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const srcCtx = heightCanvas.getContext('2d')!;
  const src = srcCtx.getImageData(0, 0, w, h).data;

  const [outCanvas, outCtx] = makeCanvas(w, h);
  const outImg = outCtx.createImageData(w, h);
  const dst = outImg.data;

  const sample = (x: number, y: number) => {
    const cx = ((x % w) + w) % w;
    const cy = ((y % h) + h) % h;
    return src[(cy * w + cx) * 4] / 255.0;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dz = 1.0;
      const invLen = 1.0 / Math.hypot(dx, dy, dz);

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }
  outCtx.putImageData(outImg, 0, 0);
  return toTexture(outCanvas, false, repeatX, repeatY);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createProceduralTextures(): ProceduralTextureSet {
  const rand = mulberry32(20261130);

  // 1. Matte Dark Grey Interior Foyer Tile (512px PBR)
  const createInteriorTile = (): PBRMapGroup => {
    const size = 512;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);
    const [cR, rCtx] = makeCanvas(size, size);

    col.fillStyle = '#2d3138';
    col.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#dcdcdc';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#a8a8a8';
    rCtx.fillRect(0, 0, size, size);

    for (let i = 0; i < 2400; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 2 + rand() * 18;
      const v = Math.floor(34 + rand() * 28);
      col.fillStyle = `rgba(${v},${v + 2},${v + 5},0.14)`;
      col.beginPath();
      col.arc(x, y, r, 0, Math.PI * 2);
      col.fill();

      const rv = Math.floor(130 + rand() * 85);
      rCtx.fillStyle = `rgba(${rv},${rv},${rv},0.20)`;
      rCtx.fillRect(x, y, r, r * 0.6);
    }

    const drawSeams = (ctx: CanvasRenderingContext2D, stroke: string, w: number) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = w;
      for (const pos of [0, size / 2]) {
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, size);
        ctx.moveTo(0, pos);
        ctx.lineTo(size, pos);
        ctx.stroke();
      }
    };
    drawSeams(col, '#14171c', 5);
    drawSeams(hCtx, '#1c1c1c', 6);
    drawSeams(rCtx, '#f2f2f2', 6);

    return {
      map: toTexture(cCol, true, 3, 6),
      normalMap: heightToNormalTexture(cH, 2.2, 3, 6),
      roughnessMap: toTexture(cR, false, 3, 6),
    };
  };

  // 2. Mottled Aged Plaster Wall (512px PBR)
  const createPlasterWall = (): PBRMapGroup => {
    const size = 512;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);
    const [cR, rCtx] = makeCanvas(size, size);

    col.fillStyle = '#555961';
    col.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#cfcfcf';
    rCtx.fillRect(0, 0, size, size);

    for (let i = 0; i < 3200; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 3 + rand() * 28;
      const shade = Math.floor(62 + rand() * 42);
      col.fillStyle = `rgba(${shade},${shade + 1},${shade + 3},0.10)`;
      col.beginPath();
      col.arc(x, y, r, 0, Math.PI * 2);
      col.fill();
      const b = Math.floor(96 + rand() * 64);
      hCtx.fillStyle = `rgba(${b},${b},${b},0.18)`;
      hCtx.fillRect(x, y, r * 0.4, r * 0.4);
      const rv = Math.floor(170 + rand() * 60);
      rCtx.fillStyle = `rgba(${rv},${rv},${rv},0.16)`;
      rCtx.fillRect(x, y, r * 0.5, r * 0.5);
    }

    const grad = col.createLinearGradient(0, size * 0.72, 0, size);
    grad.addColorStop(0, 'rgba(18,20,24,0)');
    grad.addColorStop(1, 'rgba(18,20,24,0.56)');
    col.fillStyle = grad;
    col.fillRect(0, size * 0.72, size, size * 0.28);

    return {
      map: toTexture(cCol, true, 2, 1),
      normalMap: heightToNormalTexture(cH, 1.8, 2, 1),
      roughnessMap: toTexture(cR, false, 2, 1),
    };
  };

  // 3. Weathered Urban Brick Wall (Fine 512px 16x8 scale — realistic dark-red/umber masonry + damp base stains!)
  const createBrickWall = (): PBRMapGroup => {
    const size = 512;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);
    const [cR, rCtx] = makeCanvas(size, size);

    col.fillStyle = '#201c1a';
    col.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#242424';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#dcdcdc';
    rCtx.fillRect(0, 0, size, size);

    const rows = 16;
    const cols = 8;
    const rowH = size / rows;
    const colW = size / cols;

    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (colW * 0.5);
      for (let c = -1; c <= cols; c++) {
        const bx = c * colW + offset + 2;
        const by = r * rowH + 2;
        const bw = colW - 4;
        const bh = rowH - 4;

        const tone = rand();
        const baseR = 68 + Math.floor(tone * 36 + rand() * 14);
        const baseG = 46 + Math.floor(tone * 24 + rand() * 10);
        const baseB = 38 + Math.floor(tone * 18 + rand() * 8);
        col.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
        col.fillRect(bx, by, bw, bh);

        // Micro brick surface grain
        col.fillStyle = `rgba(18,14,12,${0.08 + rand() * 0.16})`;
        col.fillRect(bx + 2, by + bh * 0.55, bw - 4, bh * 0.45);

        const hv = 175 + Math.floor(rand() * 55);
        hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
        hCtx.fillRect(bx, by, bw, bh);

        const rv = 155 + Math.floor(rand() * 65);
        rCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
        rCtx.fillRect(bx, by, bw, bh);
      }
    }

    // Damp rain streaks from top & mossy water-stain gradient along base
    for (let i = 0; i < 65; i++) {
      const sx = rand() * size;
      const sh = 60 + rand() * 220;
      const g = col.createLinearGradient(sx, 0, sx, sh);
      g.addColorStop(0, 'rgba(10,12,15,0.48)');
      g.addColorStop(1, 'rgba(10,12,15,0)');
      col.fillStyle = g;
      col.fillRect(sx, 0, 3 + rand() * 7, sh);
    }
    const baseStain = col.createLinearGradient(0, size * 0.68, 0, size);
    baseStain.addColorStop(0, 'rgba(14,16,14,0)');
    baseStain.addColorStop(1, 'rgba(12,15,13,0.62)');
    col.fillStyle = baseStain;
    col.fillRect(0, size * 0.68, size, size * 0.32);

    const baseWet = rCtx.createLinearGradient(0, size * 0.68, 0, size);
    baseWet.addColorStop(0, 'rgba(70,70,70,0)');
    baseWet.addColorStop(1, 'rgba(55,55,55,0.85)');
    rCtx.fillStyle = baseWet;
    rCtx.fillRect(0, size * 0.68, size, size * 0.32);

    return {
      map: toTexture(cCol, true, 4, 2),
      normalMap: heightToNormalTexture(cH, 2.6, 4, 2),
      roughnessMap: toTexture(cR, false, 4, 2),
    };
  };

  // 4. Corrugated Rolling Shop Shutter Metal
  const createShutterMetal = (): PBRMapGroup => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);
    const [cR, rCtx] = makeCanvas(size, size);

    for (let y = 0; y < size; y++) {
      const slat = Math.sin((y / size) * Math.PI * 2 * 16) * 0.5 + 0.5;
      const v = Math.floor(54 + slat * 34);
      col.fillStyle = `rgb(${v},${v + 4},${v + 9})`;
      col.fillRect(0, y, size, 1);

      const hv = Math.floor(60 + slat * 185);
      hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
      hCtx.fillRect(0, y, size, 1);

      const rv = Math.floor(95 + (1 - slat) * 70);
      rCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
      rCtx.fillRect(0, y, size, 1);
    }

    return {
      map: toTexture(cCol, true, 1, 1),
      normalMap: heightToNormalTexture(cH, 3.0, 1, 1),
      roughnessMap: toTexture(cR, false, 1, 1),
    };
  };

  // 5. Wet Sidewalk Stone Pavers (High Detail + True NormalMap!)
  const createWetSidewalk = (): PBRMapGroup => {
    const size = 512;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);
    const [cR, rCtx] = makeCanvas(size, size);

    col.fillStyle = '#252930';
    col.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#303030';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#6c6c6c';
    rCtx.fillRect(0, 0, size, size);

    const step = size / 4;
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const tone = 50 + Math.floor(rand() * 24);
        col.fillStyle = `rgb(${tone},${tone + 4},${tone + 9})`;
        col.fillRect(gx * step + 3, gy * step + 3, step - 6, step - 6);

        const hv = 185 + Math.floor(rand() * 35);
        hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
        hCtx.fillRect(gx * step + 4, gy * step + 4, step - 8, step - 8);
      }
    }

    // Mineral stone aggregate
    for (let i = 0; i < 5000; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const v = 30 + Math.floor(rand() * 52);
      col.fillStyle = `rgba(${v},${v + 3},${v + 7},0.22)`;
      col.fillRect(x, y, 2, 2);
      const hv = 130 + Math.floor(rand() * 100);
      hCtx.fillStyle = `rgba(${hv},${hv},${hv},0.22)`;
      hCtx.fillRect(x, y, 2, 2);
    }

    // Damp patches
    for (let p = 0; p < 14; p++) {
      const px = rand() * size;
      const py = rand() * size;
      const pr = 30 + rand() * 80;
      const g = rCtx.createRadialGradient(px, py, 4, px, py, pr);
      g.addColorStop(0, 'rgba(20,20,20,0.92)');
      g.addColorStop(1, 'rgba(108,108,108,0)');
      rCtx.fillStyle = g;
      rCtx.beginPath();
      rCtx.arc(px, py, pr, 0, Math.PI * 2);
      rCtx.fill();
    }

    return {
      map: toTexture(cCol, true, 3, 14),
      normalMap: heightToNormalTexture(cH, 2.4, 3, 14),
      roughnessMap: toTexture(cR, false, 3, 14),
    };
  };

  // 6. Wet Asphalt Roadway
  const createWetAsphalt = (): PBRMapGroup => {
    const size = 512;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);
    const [cR, rCtx] = makeCanvas(size, size);

    col.fillStyle = '#1b1f26';
    col.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#5e5e5e';
    rCtx.fillRect(0, 0, size, size);

    for (let i = 0; i < 8500; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const v = 16 + Math.floor(rand() * 44);
      col.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
      col.fillRect(x, y, 2, 2);
      const hv = 75 + Math.floor(rand() * 145);
      // Keep the fine color grain; only some grains disturb the wet surface normal.
      if (i % 4 !== 0) continue;
      hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
      hCtx.fillRect(x, y, 2, 2);
    }

    for (let p = 0; p < 16; p++) {
      const px = rand() * size;
      const py = rand() * size;
      const pr = 40 + rand() * 90;
      // Preserve the random stream shared by the textures generated after this one.
      if (p % 2 !== 0) continue;
      const g = rCtx.createRadialGradient(px, py, 6, px, py, pr);
      g.addColorStop(0, 'rgba(16,16,16,0.72)');
      g.addColorStop(1, 'rgba(94,94,94,0)');
      rCtx.fillStyle = g;
      rCtx.beginPath();
      rCtx.arc(px, py, pr, 0, Math.PI * 2);
      rCtx.fill();
    }

    return {
      map: toTexture(cCol, true, 6, 12),
      normalMap: heightToNormalTexture(cH, 1.9, 6, 12),
      roughnessMap: toTexture(cR, false, 6, 12),
    };
  };

  // 7. Yellow Raised Bar Tactile Brick (Crisp 512px NormalMap!)
  const createTactileLine = (): PBRMapGroup => {
    const size = 512;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);
    const [cR, rCtx] = makeCanvas(size, size);

    col.fillStyle = '#c48d1a';
    col.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#505050';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#686868';
    rCtx.fillRect(0, 0, size, size);

    col.strokeStyle = '#533c0f';
    col.lineWidth = 14;
    col.strokeRect(4, 4, size - 8, size - 8);
    hCtx.strokeStyle = '#121212';
    hCtx.lineWidth = 16;
    hCtx.strokeRect(4, 4, size - 8, size - 8);

    const barCount = 4;
    const marginX = 46;
    const slotW = (size - marginX * 2) / barCount;

    for (let i = 0; i < barCount; i++) {
      const bx = marginX + i * slotW + 14;
      const bw = slotW - 28;
      const by = 34;
      const bh = size - 68;

      col.fillStyle = '#92660f';
      col.fillRect(bx - 5, by - 4, bw + 10, bh + 8);

      const grad = col.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, '#ba8417');
      grad.addColorStop(0.35, '#f0ba32');
      grad.addColorStop(0.7, '#e2a623');
      grad.addColorStop(1, '#a17012');
      col.fillStyle = grad;
      col.beginPath();
      col.roundRect(bx, by, bw, bh, 14);
      col.fill();

      const bGrad = hCtx.createLinearGradient(bx, 0, bx + bw, 0);
      bGrad.addColorStop(0, '#787878');
      bGrad.addColorStop(0.22, '#f8f8f8');
      bGrad.addColorStop(0.78, '#f8f8f8');
      bGrad.addColorStop(1, '#787878');
      hCtx.fillStyle = bGrad;
      hCtx.beginPath();
      hCtx.roundRect(bx, by, bw, bh, 14);
      hCtx.fill();

      rCtx.fillStyle = '#383838'; // Wet glossy ridge tops catching reflections!
      rCtx.fillRect(bx, by, bw, bh);
    }

    for (let i = 0; i < 1400; i++) {
      col.fillStyle = `rgba(52,38,14,${rand() * 0.16})`;
      col.fillRect(rand() * size, rand() * size, 4, 4);
    }

    return {
      map: toTexture(cCol, true, 1, 20),
      normalMap: heightToNormalTexture(cH, 3.4, 1, 20),
      roughnessMap: toTexture(cR, false, 1, 20),
    };
  };

  // 8. Yellow Raised Blister Dot Warning Brick (Crisp 512px NormalMap!)
  const createTactileDot = (): PBRMapGroup => {
    const size = 512;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);
    const [cR, rCtx] = makeCanvas(size, size);

    col.fillStyle = '#c48d1a';
    col.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#505050';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#686868';
    rCtx.fillRect(0, 0, size, size);

    col.strokeStyle = '#533c0f';
    col.lineWidth = 14;
    col.strokeRect(4, 4, size - 8, size - 8);
    hCtx.strokeStyle = '#121212';
    hCtx.lineWidth = 16;
    hCtx.strokeRect(4, 4, size - 8, size - 8);

    const grid = 5;
    const pad = 54;
    const step = (size - pad * 2) / (grid - 1);
    const radius = 30;

    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const cx = pad + gx * step;
        const cy = pad + gy * step;

        col.fillStyle = '#8e620e';
        col.beginPath();
        col.arc(cx + 2, cy + 3, radius + 4, 0, Math.PI * 2);
        col.fill();

        const cg = col.createRadialGradient(cx - 6, cy - 6, 4, cx, cy, radius);
        cg.addColorStop(0, '#f5c43c');
        cg.addColorStop(0.7, '#dca221');
        cg.addColorStop(1, '#a06f12');
        col.fillStyle = cg;
        col.beginPath();
        col.arc(cx, cy, radius, 0, Math.PI * 2);
        col.fill();

        const bg = hCtx.createRadialGradient(cx, cy, 8, cx, cy, radius + 4);
        bg.addColorStop(0, '#ffffff');
        bg.addColorStop(0.72, '#e2e2e2');
        bg.addColorStop(1, '#505050');
        hCtx.fillStyle = bg;
        hCtx.beginPath();
        hCtx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
        hCtx.fill();

        rCtx.fillStyle = '#363636';
        rCtx.beginPath();
        rCtx.arc(cx, cy, radius, 0, Math.PI * 2);
        rCtx.fill();
      }
    }

    return {
      map: toTexture(cCol, true, 2, 2),
      normalMap: heightToNormalTexture(cH, 3.6, 2, 2),
      roughnessMap: toTexture(cR, false, 2, 2),
    };
  };

  // 9. Orange-White Construction Barrier Board
  const createBarrierStripe = (): PBRMapGroup => {
    const w = 512;
    const h = 160;
    const [cCol, col] = makeCanvas(w, h);
    const [cH, hCtx] = makeCanvas(w, h);

    col.fillStyle = '#e5e7eb';
    col.fillRect(0, 0, w, h);
    hCtx.fillStyle = '#909090';
    hCtx.fillRect(0, 0, w, h);

    col.fillStyle = '#e05814';
    const stripeW = 54;
    for (let x = -h; x < w + h; x += stripeW * 2) {
      col.beginPath();
      col.moveTo(x, h);
      col.lineTo(x + stripeW, h);
      col.lineTo(x + stripeW + h, 0);
      col.lineTo(x + h, 0);
      col.closePath();
      col.fill();
    }

    col.fillStyle = 'rgba(235,236,238,0.92)';
    col.beginPath();
    col.roundRect(w / 2 - 115, 18, 230, h - 36, 8);
    col.fill();

    col.fillStyle = '#1f2937';
    col.beginPath();
    col.moveTo(w / 2, 28);
    col.lineTo(w / 2 + 28, 82);
    col.lineTo(w / 2 - 28, 82);
    col.closePath();
    col.fill();
    col.fillStyle = '#f59e0b';
    col.font = 'bold 28px sans-serif';
    col.textAlign = 'center';
    col.fillText('!', w / 2, 75);

    col.fillStyle = '#1f2937';
    col.font = 'bold 17px sans-serif';
    col.fillText('前方施工 · UNDER CONSTRUCTION', w / 2, 114);

    for (let i = 0; i < 700; i++) {
      const gx = rand() * w;
      const gy = rand() * h;
      const gr = 1 + rand() * 5;
      col.fillStyle = `rgba(42,35,28,${rand() * 0.34})`;
      col.fillRect(gx, gy, gr * 1.6, gr);
      hCtx.fillStyle = `rgba(35,35,35,${rand() * 0.4})`;
      hCtx.fillRect(gx, gy, gr, gr);
    }

    return {
      map: toTexture(cCol, true, 1, 1),
      normalMap: heightToNormalTexture(cH, 2.0, 1, 1),
    };
  };

  // 10. Weathered White Zebra Crosswalk Paint
  const createWood = (baseHex: string, grainRgb: [number, number, number]): PBRMapGroup => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);

    col.fillStyle = baseHex;
    col.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#8c8c8c';
    hCtx.fillRect(0, 0, size, size);

    for (let y = 0; y < size; y += 2) {
      const wave = Math.sin(y * 0.08) * 8;
      const alpha = 0.08 + rand() * 0.16;
      col.strokeStyle = `rgba(${grainRgb[0]},${grainRgb[1]},${grainRgb[2]},${alpha})`;
      col.lineWidth = 1 + rand() * 2;
      col.beginPath();
      col.moveTo(0, y);
      col.bezierCurveTo(size * 0.33, y + wave, size * 0.66, y - wave, size, y);
      col.stroke();

      hCtx.strokeStyle = `rgba(38,38,38,${alpha})`;
      hCtx.beginPath();
      hCtx.moveTo(0, y);
      hCtx.lineTo(size, y);
      hCtx.stroke();
    }

    for (let x = 0; x < size; x += 64) {
      col.fillStyle = 'rgba(15,10,6,0.38)';
      col.fillRect(x, 0, 2, size);
      hCtx.fillStyle = '#202020';
      hCtx.fillRect(x, 0, 3, size);
    }

    return {
      map: toTexture(cCol, true, 2, 2),
      normalMap: heightToNormalTexture(cH, 2.0, 2, 2),
    };
  };

  // 13. Bamboo Steamer Weave
  const createBamboo = (): PBRMapGroup => {
    const size = 128;
    const [cCol, col] = makeCanvas(size, size);
    const [cH, hCtx] = makeCanvas(size, size);

    col.fillStyle = '#be9056';
    col.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#909090';
    hCtx.fillRect(0, 0, size, size);

    for (const bandY of [8, 56, 68, 116]) {
      col.fillStyle = '#8b612e';
      col.fillRect(0, bandY, size, 8);
      hCtx.fillStyle = '#e8e8e8';
      hCtx.fillRect(0, bandY, size, 8);
    }
    for (let x = 0; x < size; x += 6) {
      col.fillStyle = 'rgba(65,42,16,0.25)';
      col.fillRect(x, 0, 2, size);
    }

    return {
      map: toTexture(cCol, true, 2, 1),
      normalMap: heightToNormalTexture(cH, 2.4, 2, 1),
    };
  };

  // 14. Convenience Store Glowing Signboard ("24H 便利店", Ref Image 2!)
  const createConvenienceSign = (): THREE.CanvasTexture => {
    const [c, ctx] = makeCanvas(512, 128);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#ea580c';
    ctx.fillRect(0, 0, 512, 26);
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(0, 102, 512, 26);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(0, 86, 512, 14);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 46px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('24H 街角便利店', 256, 72);
    return toTexture(c, true, 1, 1);
  };

  // 15. Breakfast Stall Warm Cloth Sign ("现磨豆浆 · 热气蒸包")
  const createStallBanner = (): THREE.CanvasTexture => {
    const [c, ctx] = makeCanvas(256, 128);
    ctx.fillStyle = '#432e22';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = 'rgba(245, 190, 105, 0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 240, 112);

    ctx.fillStyle = '#fde68a';
    ctx.font = 'bold 42px "PingFang SC", serif';
    ctx.textAlign = 'center';
    ctx.fillText('早点 · 热包', 128, 80);
    return toTexture(c, true, 1, 1);
  };

  return {
    interiorTile: createInteriorTile(),
    plasterWall: createPlasterWall(),
    brickWall: createBrickWall(),
    shutterMetal: createShutterMetal(),
    wetSidewalk: createWetSidewalk(),
    wetAsphalt: createWetAsphalt(),
    tactileLine: createTactileLine(),
    tactileDot: createTactileDot(),
    barrierStripe: createBarrierStripe(),
    darkWood: createWood('#3a2519', [20, 12, 7]),
    warmWood: createWood('#6e482b', [38, 22, 10]),
    bamboo: createBamboo(),
    convenienceSign: createConvenienceSign(),
    stallBanner: createStallBanner(),
  };
}
