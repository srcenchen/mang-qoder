import * as THREE from 'three';

export interface ProceduralTextureSet {
  interiorTile: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture };
  plasterWall: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture };
  brickWall: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture };
  wetSidewalk: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture };
  wetAsphalt: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture };
  tactileLine: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture };
  tactileDot: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture };
  barrierStripe: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture };
  crosswalk: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture };
  darkWood: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture };
  warmWood: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture };
  bamboo: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture };
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
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Deterministic fast pseudo-random for reproducible organic grain */
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

  // 1. Matte Dark Grey Interior Foyer Tile
  const createInteriorTile = () => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cBump, bump] = makeCanvas(size, size);
    const [cRough, rough] = makeCanvas(size, size);

    col.fillStyle = '#2d3138';
    col.fillRect(0, 0, size, size);
    bump.fillStyle = '#d8d8d8';
    bump.fillRect(0, 0, size, size);
    rough.fillStyle = '#b8b8b8'; // ~0.72 matte roughness
    rough.fillRect(0, 0, size, size);

    // Subtle stone mottling & scuffs
    for (let i = 0; i < 900; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 2 + rand() * 14;
      const v = Math.floor(38 + rand() * 24);
      col.fillStyle = `rgba(${v}, ${v + 2}, ${v + 5}, 0.16)`;
      col.beginPath();
      col.arc(x, y, r, 0, Math.PI * 2);
      col.fill();

      const rv = Math.floor(150 + rand() * 65);
      rough.fillStyle = `rgba(${rv},${rv},${rv},0.22)`;
      rough.fillRect(x, y, r, r * 0.6);
    }

    // 2x2 tile grid seams
    const drawSeams = (ctx: CanvasRenderingContext2D, stroke: string, lineW: number) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineW;
      for (const pos of [0, size / 2]) {
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, size);
        ctx.moveTo(0, pos);
        ctx.lineTo(size, pos);
        ctx.stroke();
      }
    };
    drawSeams(col, '#181b20', 4);
    drawSeams(bump, '#303030', 5);
    drawSeams(rough, '#f0f0f0', 5);

    return {
      map: toTexture(cCol, true, 3, 6),
      bumpMap: toTexture(cBump, false, 3, 6),
      roughnessMap: toTexture(cRough, false, 3, 6),
    };
  };

  // 2. Mottled Foyer Plaster Wall
  const createPlasterWall = () => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cBump, bump] = makeCanvas(size, size);

    col.fillStyle = '#55585e';
    col.fillRect(0, 0, size, size);
    bump.fillStyle = '#808080';
    bump.fillRect(0, 0, size, size);

    for (let i = 0; i < 1200; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 4 + rand() * 26;
      const shade = Math.floor(62 + rand() * 44);
      col.fillStyle = `rgba(${shade}, ${shade + 1}, ${shade + 3}, 0.12)`;
      col.beginPath();
      col.arc(x, y, r, 0, Math.PI * 2);
      col.fill();

      const b = Math.floor(105 + rand() * 50);
      bump.fillStyle = `rgba(${b},${b},${b},0.18)`;
      bump.fillRect(x, y, r * 0.5, r * 0.5);
    }

    // Subtle damp baseboard grime gradient at bottom
    const grad = col.createLinearGradient(0, size * 0.75, 0, size);
    grad.addColorStop(0, 'rgba(20,22,26,0)');
    grad.addColorStop(1, 'rgba(20,22,26,0.45)');
    col.fillStyle = grad;
    col.fillRect(0, size * 0.75, size, size * 0.25);

    return {
      map: toTexture(cCol, true, 2, 1),
      bumpMap: toTexture(cBump, false, 2, 1),
    };
  };

  // 3. Exterior Urban Brick Wall
  const createBrickWall = () => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cBump, bump] = makeCanvas(size, size);

    col.fillStyle = '#2a2625'; // Mortar dark grey-brown
    col.fillRect(0, 0, size, size);
    bump.fillStyle = '#353535';
    bump.fillRect(0, 0, size, size);

    const rows = 8;
    const cols = 4;
    const rowH = size / rows;
    const colW = size / cols;

    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (colW * 0.5);
      for (let c = -1; c <= cols; c++) {
        const bx = c * colW + offset + 2;
        const by = r * rowH + 2;
        const bw = colW - 4;
        const bh = rowH - 4;

        const baseR = 92 + Math.floor(rand() * 36);
        const baseG = 68 + Math.floor(rand() * 24);
        const baseB = 56 + Math.floor(rand() * 20);
        col.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
        col.fillRect(bx, by, bw, bh);

        bump.fillStyle = `rgb(${185 + Math.floor(rand() * 45)},${185},${185})`;
        bump.fillRect(bx, by, bw, bh);
      }
    }

    return {
      map: toTexture(cCol, true, 6, 2),
      bumpMap: toTexture(cBump, false, 6, 2),
    };
  };

  // 4. Wet Sidewalk Stone Pavers (Low Roughness Puddles!)
  const createWetSidewalk = () => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cBump, bump] = makeCanvas(size, size);
    const [cRough, rough] = makeCanvas(size, size);

    col.fillStyle = '#383d44';
    col.fillRect(0, 0, size, size);
    bump.fillStyle = '#b0b0b0';
    bump.fillRect(0, 0, size, size);
    rough.fillStyle = '#787878'; // ~0.47 damp base
    rough.fillRect(0, 0, size, size);

    // Paver grid 4x4
    const step = size / 4;
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const tone = 48 + Math.floor(rand() * 20);
        col.fillStyle = `rgb(${tone},${tone + 4},${tone + 9})`;
        col.fillRect(gx * step + 2, gy * step + 2, step - 4, step - 4);
        bump.fillStyle = `rgb(${175 + Math.floor(rand() * 35)},180,180)`;
        bump.fillRect(gx * step + 2, gy * step + 2, step - 4, step - 4);
      }
    }

    // Stone grain
    for (let i = 0; i < 1400; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const v = 30 + Math.floor(rand() * 45);
      col.fillStyle = `rgba(${v},${v + 3},${v + 6},0.22)`;
      col.fillRect(x, y, 2, 2);
      const b = 130 + Math.floor(rand() * 90);
      bump.fillStyle = `rgba(${b},${b},${b},0.25)`;
      bump.fillRect(x, y, 2, 2);
    }

    // Wet specular puddles (very low roughness = shiny reflections!)
    for (let p = 0; p < 10; p++) {
      const px = rand() * size;
      const py = rand() * size;
      const pr = 18 + rand() * 42;
      const g = rough.createRadialGradient(px, py, 2, px, py, pr);
      g.addColorStop(0, 'rgba(22,22,22,0.92)'); // roughness ~0.09 mirror-wet puddle
      g.addColorStop(1, 'rgba(110,110,110,0)');
      rough.fillStyle = g;
      rough.beginPath();
      rough.arc(px, py, pr, 0, Math.PI * 2);
      rough.fill();

      // Slightly darker wet stone under puddle
      const cg = col.createRadialGradient(px, py, 2, px, py, pr);
      cg.addColorStop(0, 'rgba(18,22,28,0.42)');
      cg.addColorStop(1, 'rgba(18,22,28,0)');
      col.fillStyle = cg;
      col.beginPath();
      col.arc(px, py, pr, 0, Math.PI * 2);
      col.fill();
    }

    return {
      map: toTexture(cCol, true, 3, 14),
      bumpMap: toTexture(cBump, false, 3, 14),
      roughnessMap: toTexture(cRough, false, 3, 14),
    };
  };

  // 5. Wet Asphalt Roadway
  const createWetAsphalt = () => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cBump, bump] = makeCanvas(size, size);
    const [cRough, rough] = makeCanvas(size, size);

    col.fillStyle = '#1d2128';
    col.fillRect(0, 0, size, size);
    bump.fillStyle = '#808080';
    bump.fillRect(0, 0, size, size);
    rough.fillStyle = '#686868';
    rough.fillRect(0, 0, size, size);

    // Asphalt mineral aggregate
    for (let i = 0; i < 2800; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const v = 18 + Math.floor(rand() * 42);
      col.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
      col.fillRect(x, y, 2, 2);

      const bv = 80 + Math.floor(rand() * 130);
      bump.fillStyle = `rgb(${bv},${bv},${bv})`;
      bump.fillRect(x, y, 2, 2);
    }

    // Wet rain slick patches
    for (let p = 0; p < 12; p++) {
      const px = rand() * size;
      const py = rand() * size;
      const pr = 24 + rand() * 52;
      const g = rough.createRadialGradient(px, py, 4, px, py, pr);
      g.addColorStop(0, 'rgba(18,18,18,0.95)');
      g.addColorStop(1, 'rgba(105,105,105,0)');
      rough.fillStyle = g;
      rough.beginPath();
      rough.arc(px, py, pr, 0, Math.PI * 2);
      rough.fill();
    }

    return {
      map: toTexture(cCol, true, 6, 12),
      bumpMap: toTexture(cBump, false, 6, 12),
      roughnessMap: toTexture(cRough, false, 6, 12),
    };
  };

  // 6. Yellow Raised Bar Tactile Brick (tactile_line)
  const createTactileLine = () => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cBump, bump] = makeCanvas(size, size);
    const [cRough, rough] = makeCanvas(size, size);

    // Rich warm urban yellow base
    col.fillStyle = '#c8921e';
    col.fillRect(0, 0, size, size);
    bump.fillStyle = '#555555';
    bump.fillRect(0, 0, size, size);
    rough.fillStyle = '#707070';
    rough.fillRect(0, 0, size, size);

    // Outer tile mortar border
    col.strokeStyle = '#5a4212';
    col.lineWidth = 8;
    col.strokeRect(2, 2, size - 4, size - 4);
    bump.strokeStyle = '#181818';
    bump.lineWidth = 10;
    bump.strokeRect(2, 2, size - 4, size - 4);

    // 4 raised longitudinal guiding bars
    const barCount = 4;
    const marginX = 24;
    const usableW = size - marginX * 2;
    const slotW = usableW / barCount;

    for (let i = 0; i < barCount; i++) {
      const bx = marginX + i * slotW + 7;
      const bw = slotW - 14;
      const by = 18;
      const bh = size - 36;

      // Subtle bevel shadow in groove
      col.fillStyle = '#9c6e12';
      col.fillRect(bx - 3, by - 2, bw + 6, bh + 4);

      // Raised bar top highlight
      const grad = col.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, '#be8819');
      grad.addColorStop(0.35, '#eab32e');
      grad.addColorStop(0.7, '#dfa423');
      grad.addColorStop(1, '#a97714');
      col.fillStyle = grad;
      col.beginPath();
      col.roundRect(bx, by, bw, bh, 8);
      col.fill();

      // Strong raised bump
      const bGrad = bump.createLinearGradient(bx, 0, bx + bw, 0);
      bGrad.addColorStop(0, '#909090');
      bGrad.addColorStop(0.25, '#f5f5f5');
      bGrad.addColorStop(0.75, '#f5f5f5');
      bGrad.addColorStop(1, '#909090');
      bump.fillStyle = bGrad;
      bump.beginPath();
      bump.roundRect(bx, by, bw, bh, 8);
      bump.fill();

      rough.fillStyle = '#505050';
      rough.fillRect(bx, by, bw, bh);
    }

    // Subtle urban street dust/scuffs
    for (let i = 0; i < 450; i++) {
      const x = rand() * size;
      const y = rand() * size;
      col.fillStyle = `rgba(55, 42, 18, ${rand() * 0.16})`;
      col.fillRect(x, y, 3, 3);
    }

    return {
      map: toTexture(cCol, true, 1, 56),
      bumpMap: toTexture(cBump, false, 1, 56),
      roughnessMap: toTexture(cRough, false, 1, 56),
    };
  };

  // 7. Yellow Raised Blister Dot Warning Brick (tactile_dot)
  const createTactileDot = () => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cBump, bump] = makeCanvas(size, size);
    const [cRough, rough] = makeCanvas(size, size);

    col.fillStyle = '#c6901c';
    col.fillRect(0, 0, size, size);
    bump.fillStyle = '#555555';
    bump.fillRect(0, 0, size, size);
    rough.fillStyle = '#6e6e6e';
    rough.fillRect(0, 0, size, size);

    col.strokeStyle = '#5a4212';
    col.lineWidth = 8;
    col.strokeRect(2, 2, size - 4, size - 4);
    bump.strokeStyle = '#181818';
    bump.lineWidth = 10;
    bump.strokeRect(2, 2, size - 4, size - 4);

    // 5x5 truncated domes
    const grid = 5;
    const pad = 26;
    const step = (size - pad * 2) / (grid - 1);
    const radius = 15;

    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const cx = pad + gx * step;
        const cy = pad + gy * step;

        // Groove shadow
        col.fillStyle = '#946710';
        col.beginPath();
        col.arc(cx + 1.5, cy + 2, radius + 2, 0, Math.PI * 2);
        col.fill();

        // Dome top
        const cg = col.createRadialGradient(cx - 3, cy - 3, 2, cx, cy, radius);
        cg.addColorStop(0, '#f3bf38');
        cg.addColorStop(0.7, '#dca221');
        cg.addColorStop(1, '#a57413');
        col.fillStyle = cg;
        col.beginPath();
        col.arc(cx, cy, radius, 0, Math.PI * 2);
        col.fill();

        // Bump dome
        const bg = bump.createRadialGradient(cx, cy, 4, cx, cy, radius + 2);
        bg.addColorStop(0, '#ffffff');
        bg.addColorStop(0.75, '#dcdcdc');
        bg.addColorStop(1, '#555555');
        bump.fillStyle = bg;
        bump.beginPath();
        bump.arc(cx, cy, radius + 2, 0, Math.PI * 2);
        bump.fill();
      }
    }

    for (let i = 0; i < 350; i++) {
      col.fillStyle = `rgba(50, 38, 15, ${rand() * 0.15})`;
      col.fillRect(rand() * size, rand() * size, 3, 3);
    }

    return {
      map: toTexture(cCol, true, 7, 2),
      bumpMap: toTexture(cBump, false, 7, 2),
      roughnessMap: toTexture(cRough, false, 7, 2),
    };
  };

  // 8. Orange-White Construction Barrier Board (Matching Ref Image 2!)
  const createBarrierStripe = () => {
    const w = 512;
    const h = 160;
    const [cCol, col] = makeCanvas(w, h);
    const [cBump, bump] = makeCanvas(w, h);

    col.fillStyle = '#e5e7eb';
    col.fillRect(0, 0, w, h);
    bump.fillStyle = '#909090';
    bump.fillRect(0, 0, w, h);

    // Diagonal orange hazard stripes
    col.fillStyle = '#dd5814';
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

    // Center caution stencil plate
    col.fillStyle = 'rgba(235, 236, 238, 0.92)';
    col.beginPath();
    col.roundRect(w / 2 - 105, 18, 210, h - 36, 8);
    col.fill();

    // Warning triangle icon
    col.fillStyle = '#1f2937';
    col.beginPath();
    col.moveTo(w / 2, 30);
    col.lineTo(w / 2 + 28, 82);
    col.lineTo(w / 2 - 28, 82);
    col.closePath();
    col.fill();
    col.fillStyle = '#f59e0b';
    col.font = 'bold 28px sans-serif';
    col.textAlign = 'center';
    col.fillText('!', w / 2, 76);

    col.fillStyle = '#1f2937';
    col.font = 'bold 18px sans-serif';
    col.fillText('前方施工 · UNDER CONSTRUCTION', w / 2, 115);

    // Grunge & weathered scratches
    for (let i = 0; i < 650; i++) {
      const gx = rand() * w;
      const gy = rand() * h;
      const gr = 1 + rand() * 5;
      col.fillStyle = `rgba(45, 38, 32, ${rand() * 0.32})`;
      col.fillRect(gx, gy, gr * 1.6, gr);
      bump.fillStyle = `rgba(40, 40, 40, ${rand() * 0.35})`;
      bump.fillRect(gx, gy, gr, gr);
    }

    const map = toTexture(cCol, true, 1, 1);
    const bumpMap = toTexture(cBump, false, 1, 1);
    return { map, bumpMap };
  };

  // 9. Weathered White Crosswalk Bar Texture (Matching Ref Image 4!)
  const createCrosswalk = () => {
    const w = 256;
    const h = 128;
    const [cCol, col] = makeCanvas(w, h);
    const [cBump, bump] = makeCanvas(w, h);
    const [cRough, rough] = makeCanvas(w, h);

    // Base paint white-grey
    col.fillStyle = '#dfe4ec';
    col.fillRect(0, 0, w, h);
    bump.fillStyle = '#c8c8c8';
    bump.fillRect(0, 0, w, h);
    rough.fillStyle = '#585858';
    rough.fillRect(0, 0, w, h);

    // Tire wear tracks & chipped asphalt patches showing through
    for (let i = 0; i < 360; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const onEdge = y < 18 || y > h - 18 || x < 16 || x > w - 16;
      const rx = (onEdge ? 8 : 4) + rand() * 18;
      const ry = 2 + rand() * 8;
      if (rand() < (onEdge ? 0.65 : 0.24)) {
        col.fillStyle = `rgba(28, 32, 40, ${0.45 + rand() * 0.5})`;
        col.fillRect(x, y, rx, ry);
        bump.fillStyle = '#404040';
        bump.fillRect(x, y, rx, ry);
        rough.fillStyle = '#202020'; // Wet asphalt showing through worn paint!
        rough.fillRect(x, y, rx, ry);
      }
    }

    return {
      map: toTexture(cCol, true, 1, 1),
      bumpMap: toTexture(cBump, false, 1, 1),
      roughnessMap: toTexture(cRough, false, 1, 1),
    };
  };

  // 10 & 11. Wood Grains (Dark Walnut for Shoe Cabinet & Warm Cedar for Breakfast Stall)
  const createWood = (baseHex: string, grainRgb: [number, number, number]) => {
    const size = 256;
    const [cCol, col] = makeCanvas(size, size);
    const [cBump, bump] = makeCanvas(size, size);

    col.fillStyle = baseHex;
    col.fillRect(0, 0, size, size);
    bump.fillStyle = '#888888';
    bump.fillRect(0, 0, size, size);

    for (let y = 0; y < size; y += 2) {
      const wave = Math.sin(y * 0.08) * 8;
      const alpha = 0.08 + rand() * 0.16;
      col.strokeStyle = `rgba(${grainRgb[0]},${grainRgb[1]},${grainRgb[2]},${alpha})`;
      col.lineWidth = 1 + rand() * 2;
      col.beginPath();
      col.moveTo(0, y);
      col.bezierCurveTo(size * 0.33, y + wave, size * 0.66, y - wave, size, y);
      col.stroke();

      bump.strokeStyle = `rgba(40,40,40,${alpha})`;
      bump.beginPath();
      bump.moveTo(0, y);
      bump.lineTo(size, y);
      bump.stroke();
    }

    // Subtle vertical plank lines
    for (let x = 0; x < size; x += 64) {
      col.fillStyle = 'rgba(15,10,6,0.35)';
      col.fillRect(x, 0, 2, size);
      bump.fillStyle = '#252525';
      bump.fillRect(x, 0, 3, size);
    }

    return {
      map: toTexture(cCol, true, 2, 2),
      bumpMap: toTexture(cBump, false, 2, 2),
    };
  };

  // 12. Bamboo Steamer Texture
  const createBamboo = () => {
    const size = 128;
    const [cCol, col] = makeCanvas(size, size);
    const [cBump, bump] = makeCanvas(size, size);

    col.fillStyle = '#b98b52';
    col.fillRect(0, 0, size, size);
    bump.fillStyle = '#909090';
    bump.fillRect(0, 0, size, size);

    // Horizontal bamboo rim bands
    for (const bandY of [8, 56, 68, 116]) {
      col.fillStyle = '#8c6230';
      col.fillRect(0, bandY, size, 8);
      bump.fillStyle = '#e0e0e0';
      bump.fillRect(0, bandY, size, 8);
    }

    // Fine weave lines
    for (let x = 0; x < size; x += 6) {
      col.fillStyle = 'rgba(70,45,18,0.22)';
      col.fillRect(x, 0, 2, size);
    }

    return {
      map: toTexture(cCol, true, 2, 1),
      bumpMap: toTexture(cBump, false, 2, 1),
    };
  };

  return {
    interiorTile: createInteriorTile(),
    plasterWall: createPlasterWall(),
    brickWall: createBrickWall(),
    wetSidewalk: createWetSidewalk(),
    wetAsphalt: createWetAsphalt(),
    tactileLine: createTactileLine(),
    tactileDot: createTactileDot(),
    barrierStripe: createBarrierStripe(),
    crosswalk: createCrosswalk(),
    darkWood: createWood('#3a261b', [22, 13, 8]),
    warmWood: createWood('#6e482b', [38, 22, 10]),
    bamboo: createBamboo(),
  };
}
