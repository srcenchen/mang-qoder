export interface PlaythroughStats {
  elapsedSeconds: number;
  caneTaps: number;
  obstacleBumps: number;
}

/**
 * Generates a 9:16 vertical (1080x1920) dark-and-gold public-welfare empathy poster
 * entirely via local offscreen <canvas>, returning a PNG DataURL for download or WeChat long-press save.
 */
export function generateEmpathySharePoster(stats: PlaythroughStats): string {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // 1. Deep Obsidian & Warm Sunset Gold Radial Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#05080f');
  bgGrad.addColorStop(0.52, '#0a101d');
  bgGrad.addColorStop(0.88, '#1a1410');
  bgGrad.addColorStop(1, '#291a0d');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle Warm Sunset Horizon Halo at Bottom
  const glowGrad = ctx.createRadialGradient(W / 2, H * 0.78, 30, W / 2, H * 0.78, 620);
  glowGrad.addColorStop(0, 'rgba(245, 158, 11, 0.24)');
  glowGrad.addColorStop(0.45, 'rgba(56, 189, 248, 0.08)');
  glowGrad.addColorStop(1, 'rgba(5, 8, 15, 0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, W, H);

  // 2. Decorative Sonic Echo Concentric Ripples (Cyan & Gold)
  const ringCenterY = 620;
  const radii = [140, 235, 340, 455];
  radii.forEach((r, idx) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(W / 2, ringCenterY, r * 1.05, r * 0.42, 0, 0, Math.PI * 2);
    ctx.strokeStyle =
      idx % 2 === 0
        ? `rgba(245, 158, 11, ${0.42 - idx * 0.07})`
        : `rgba(56, 189, 248, ${0.38 - idx * 0.06})`;
    ctx.lineWidth = idx === 0 ? 4 : 2.5;
    ctx.stroke();
    ctx.restore();
  });

  // Floating Golden & Cyan Sparkle Motes
  for (let i = 0; i < 65; i++) {
    const sx = ((i * 173) % 960) + 60;
    const sy = ((i * 293) % 1680) + 120;
    const sr = 1.5 + (i % 3) * 1.2;
    ctx.fillStyle =
      i % 3 === 0 ? 'rgba(251, 191, 36, 0.55)' : 'rgba(56, 189, 248, 0.42)';
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Outer Editorial Gold Frame Border
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(52, 52, W - 104, H - 104);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(68, 68, W - 136, H - 136);

  // 4. Top Braille + Title Typography
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fbbf24';
  ctx.font = '30px monospace';
  ctx.fillText('⠞⠊⠝⠛  ⠚⠊⠁⠝  ·  ⠍⠁⠝⠛  ⠙⠁⠕  ⠭⠊⠝⠛', W / 2, 175);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 86px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('听见 · 盲道行', W / 2, 288);

  ctx.fillStyle = 'rgba(186, 230, 253, 0.85)';
  ctx.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('城市无障碍第一人称声波共情体验记录', W / 2, 352);

  // Stylized Minimalist Red-White Cane Illustration over Sonic Ripple Center
  ctx.save();
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(W / 2 + 210, ringCenterY - 125);
  ctx.lineTo(W / 2 + 52, ringCenterY - 32);
  ctx.stroke();

  ctx.strokeStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(W / 2 + 52, ringCenterY - 32);
  ctx.lineTo(W / 2, ringCenterY);
  ctx.stroke();

  ctx.fillStyle = '#fef3c7';
  ctx.beginPath();
  ctx.arc(W / 2, ringCenterY, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 5. Three Sculpted Data Cards
  const cardTop = 825;
  const cardW = 276;
  const cardH = 250;
  const gap = 30;
  const startX = (W - (cardW * 3 + gap * 2)) / 2;

  const metricItems = [
    {
      value: `${stats.elapsedSeconds}s`,
      label: '黑暗同行耗时',
      sub: '45 米城市街角',
      accent: '#fbbf24',
    },
    {
      value: `${stats.caneTaps}`,
      label: '盲杖探路敲击',
      sub: '以回响辨认前路',
      accent: '#38bdf8',
    },
    {
      value: `${stats.obstacleBumps}`,
      label: '遭遇占道受阻',
      sub: stats.obstacleBumps === 0 ? '谨慎避让全程' : '违停单车与围挡',
      accent: '#fda4af',
    },
  ];

  metricItems.forEach((item, i) => {
    const cx = startX + i * (cardW + gap);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx, cardTop, cardW, cardH, 28);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = item.accent;
    ctx.font = 'bold 72px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(item.value, cx + cardW / 2, cardTop + 108);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 30px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(item.label, cx + cardW / 2, cardTop + 168);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.font = '22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(item.sub, cx + cardW / 2, cardTop + 212);
  });

  // 6. Empathy Quote Block
  ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
  ctx.font = '46px serif';
  ctx.fillText('“', W / 2, 1195);

  const quoteLines = [
    '在全黑的三分钟里，每一次盲杖落地的脆响，',
    '都是中国 1731 万视障者走出家门的勇气。',
    '挪开一辆占道的单车，或是在路口轻声回应一句：',
    '“别急，变绿灯了”——你就是城市里的那束暖光。',
  ];
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '32px "PingFang SC", "Microsoft YaHei", sans-serif';
  quoteLines.forEach((line, idx) => {
    ctx.fillText(line, W / 2, 1265 + idx * 58);
  });

  // Divider line
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 220, 1560);
  ctx.lineTo(W / 2 + 220, 1560);
  ctx.stroke();

  // 7. Public Welfare Call-to-Action & Braille Footer
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 38px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('请把盲道还给盲杖 · 让善意被听见', W / 2, 1635);

  ctx.fillStyle = 'rgba(251, 191, 36, 0.65)';
  ctx.font = '26px monospace';
  ctx.fillText('⠇⠑⠞  ⠅⠊⠝⠙⠝⠑⠎⠎  ⠃⠑  ⠓⠑⠁⠗⠙', W / 2, 1695);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
  ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('2026 Qoder 高校创造力大赛 · 城市无障碍公益互动作品', W / 2, 1795);

  return canvas.toDataURL('image/png');
}
