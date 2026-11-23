export interface PlaythroughStats {
  elapsedSeconds: number;
  caneTaps: number;
  obstacleBumps: number;
  memoriesFound: number;
  memoriesTotal: number;
}

/**
 * Generates a high-resolution 1080×1920 (9:16) editorial black-and-gold public-welfare empathy poster
 * entirely via offscreen <canvas>. Frameless gallery typography, central Z-turn blind path + sonic
 * ripple totem, oversized hairline-separated statistics, and crisp PNG download / mobile save.
 */
export function generateEmpathySharePoster(stats: PlaythroughStats): string {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // 1. Deep Obsidian & Subtle Warm After-Rain Horizon Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#05070a');
  bgGrad.addColorStop(0.45, '#090d14');
  bgGrad.addColorStop(0.84, '#140f0b');
  bgGrad.addColorStop(1, '#21150b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Restrained central warm golden atmospheric halo
  const centerGlow = ctx.createRadialGradient(W / 2, 860, 24, W / 2, 860, 520);
  centerGlow.addColorStop(0, 'rgba(232, 176, 88, 0.22)');
  centerGlow.addColorStop(0.48, 'rgba(132, 220, 232, 0.06)');
  centerGlow.addColorStop(1, 'rgba(5, 7, 10, 0)');
  ctx.fillStyle = centerGlow;
  ctx.fillRect(0, 0, W, H);

  // Ultra-fine subtle gallery outer margin hairline (1px)
  ctx.strokeStyle = 'rgba(232, 176, 88, 0.26)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(56, 56, W - 112, H - 112);

  // =========================================================================
  // TOP SECTION: Generous Whitespace + Braille + Editorial Serif Title
  // =========================================================================
  ctx.textAlign = 'center';

  ctx.fillStyle = 'rgba(232, 176, 88, 0.85)';
  ctx.font = '26px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('⠞⠊⠝⠛  ⠚⠊⠁⠝  ·  ⠍⠁⠝⠛  ⠙⠁⠕  ⠭⠊⠝⠛', W / 2, 195);

  ctx.fillStyle = '#eeeae1';
  ctx.font = '700 94px "Songti SC", "STSong", "Noto Serif CJK SC", "PingFang SC", serif';
  ctx.fillText('听见 · 盲道行', W / 2, 326);

  // Fine centered divider below title
  ctx.strokeStyle = 'rgba(238, 234, 225, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 120, 376);
  ctx.lineTo(W / 2 + 120, 376);
  ctx.stroke();

  ctx.fillStyle = 'rgba(238, 234, 225, 0.78)';
  ctx.font = '32px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('我用盲杖走过了一段 45 米的夜路', W / 2, 444);

  // =========================================================================
  // CENTERPIECE TOTEM: Minimalist Black-Gold Z-Turn Tactile Path + Sonic Ripples
  // =========================================================================
  const cx = W / 2;
  const cy = 835;

  // Delicate concentric elliptical sonic echo ripples (thin, feathered, dual-tone!)
  const ringSpecs = [
    { rx: 92, ry: 38, color: 'rgba(232, 176, 88, 0.78)', lw: 2.8 },
    { rx: 174, ry: 72, color: 'rgba(132, 220, 232, 0.56)', lw: 2.0 },
    { rx: 268, ry: 112, color: 'rgba(232, 176, 88, 0.34)', lw: 1.5 },
    { rx: 370, ry: 156, color: 'rgba(132, 220, 232, 0.2)', lw: 1.2 },
  ];
  for (const r of ringSpecs) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r.rx, r.ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.lw;
    ctx.stroke();
    ctx.restore();
  }

  // Stylized golden Z-turn tactile path line crossing cleanly through the totem
  ctx.save();
  const pathGrad = ctx.createLinearGradient(cx - 220, cy + 210, cx + 220, cy - 210);
  pathGrad.addColorStop(0, 'rgba(232, 176, 88, 0.08)');
  pathGrad.addColorStop(0.28, 'rgba(232, 176, 88, 0.85)');
  pathGrad.addColorStop(0.72, 'rgba(245, 198, 120, 0.92)');
  pathGrad.addColorStop(1, 'rgba(232, 176, 88, 0.12)');

  // Draw twin parallel tactile guiding rails with two crisp 90-degree-like urban turns
  for (const offset of [-10, 0, 10]) {
    ctx.strokeStyle = pathGrad;
    ctx.lineWidth = offset === 0 ? 3.2 : 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 195 + offset, cy + 215);
    ctx.lineTo(cx - 85 + offset, cy + 72);
    ctx.lineTo(cx + 85 + offset, cy - 42);
    ctx.lineTo(cx + 185 + offset, cy - 195);
    ctx.stroke();
  }

  // Turning blister-dot clusters at the two corner nodes
  for (const [tx, ty] of [
    [cx - 85, cy + 72],
    [cx + 85, cy - 42],
  ]) {
    ctx.fillStyle = '#f5c678';
    for (let dx = -12; dx <= 12; dx += 12) {
      for (let dy = -12; dy <= 12; dy += 12) {
        ctx.beginPath();
        ctx.arc(tx + dx, ty + dy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Minimalist red-white guide cane angled delicately to touch the center ripple
  ctx.strokeStyle = '#eeeae1';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + 230, cy - 135);
  ctx.lineTo(cx + 58, cy - 34);
  ctx.stroke();

  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(cx + 58, cy - 34);
  ctx.lineTo(cx, cy);
  ctx.stroke();

  // Soft golden contact point glow at cane tip
  const tipGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 32);
  tipGlow.addColorStop(0, 'rgba(255, 244, 214, 0.98)');
  tipGlow.addColorStop(0.45, 'rgba(232, 176, 88, 0.55)');
  tipGlow.addColorStop(1, 'rgba(232, 176, 88, 0)');
  ctx.fillStyle = tipGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, 32, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff9ec';
  ctx.beginPath();
  ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Sparse, delicate micro-dust glints around the totem (restrained, never noisy!)
  for (let i = 0; i < 24; i++) {
    const ang = i * 2.39996;
    const dist = 90 + (i % 7) * 46;
    const sx = cx + Math.cos(ang) * dist;
    const sy = cy + Math.sin(ang) * dist * 0.48;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(245, 198, 120, 0.52)' : 'rgba(132, 220, 232, 0.42)';
    ctx.beginPath();
    ctx.arc(sx, sy, 1.8 + (i % 2) * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // =========================================================================
  // DATA HIGHLIGHT STRIP: Oversized Open Monospace Numbers, 1px Vertical Hairlines, ZERO Boxes!
  // =========================================================================
  const metricsY = 1235;
  const colPositions = [230, 540, 850];
  const heroMetrics = [
    { value: `${stats.elapsedSeconds}s`, label: '总耗时', color: '#f5c678' },
    { value: `${stats.caneTaps}`, label: '盲杖探路', color: '#84dce8' },
    { value: `${stats.obstacleBumps}`, label: '障碍碰壁', color: '#eeeae1' },
  ];

  // Top & bottom ultra-thin hairline framing the open data strip
  ctx.strokeStyle = 'rgba(238, 234, 225, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(120, metricsY - 88);
  ctx.lineTo(W - 120, metricsY - 88);
  ctx.moveTo(120, metricsY + 114);
  ctx.lineTo(W - 120, metricsY + 114);
  ctx.stroke();

  // Two crisp vertical hairlines between the 3 columns
  for (const divX of [385, 695]) {
    ctx.strokeStyle = 'rgba(238, 234, 225, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(divX, metricsY - 46);
    ctx.lineTo(divX, metricsY + 58);
    ctx.stroke();
  }

  heroMetrics.forEach((m, idx) => {
    const mx = colPositions[idx];
    ctx.textAlign = 'center';
    ctx.fillStyle = m.color;
    ctx.font = '700 84px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(m.value, mx, metricsY + 14);

    ctx.fillStyle = 'rgba(182, 192, 200, 0.85)';
    ctx.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(m.label, mx, metricsY + 68);
  });

  // Subtle single-line memory glow tally beneath
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232, 176, 88, 0.8)';
  ctx.font = '25px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(
    `✦  听见的城市微光  ${stats.memoriesFound} / ${stats.memoriesTotal}`,
    W / 2,
    metricsY + 172
  );

  // =========================================================================
  // BOTTOM PUBLIC-WELFARE QUOTE & QUIET FOOTER
  // =========================================================================
  ctx.fillStyle = '#eeeae1';
  ctx.font = '34px "Songti SC", "STSong", "Noto Serif CJK SC", "PingFang SC", serif';
  ctx.fillText('“下次路过盲道时，顺手挪开挡路的单车，', W / 2, 1566);
  ctx.fillText('就是为另一个人点亮前方的路。”', W / 2, 1628);

  ctx.strokeStyle = 'rgba(232, 176, 88, 0.42)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 110, 1700);
  ctx.lineTo(W / 2 + 110, 1700);
  ctx.stroke();

  ctx.fillStyle = 'rgba(232, 176, 88, 0.72)';
  ctx.font = '22px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('⠇⠑⠞  ⠅⠊⠝⠙⠝⠑⠎⠎  ⠃⠑  ⠓⠑⠁⠗⠙', W / 2, 1756);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.82)';
  ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('2026 Qoder 高校创造力大赛 · 无障碍共情体验', W / 2, 1816);

  return canvas.toDataURL('image/png');
}
