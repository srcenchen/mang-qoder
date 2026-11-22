export interface PlaythroughStats {
  elapsedSeconds: number;
  caneTaps: number;
  obstacleBumps: number;
  memoriesFound: number;
  memoriesTotal: number;
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

  // 1. Deep Obsidian & After-Rain Sunset Gold Radial Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#07090e');
  bgGrad.addColorStop(0.5, '#0c121f');
  bgGrad.addColorStop(0.86, '#1f150e');
  bgGrad.addColorStop(1, '#301b0c');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const glowGrad = ctx.createRadialGradient(W / 2, H * 0.78, 30, W / 2, H * 0.78, 640);
  glowGrad.addColorStop(0, 'rgba(255, 179, 71, 0.28)');
  glowGrad.addColorStop(0.45, 'rgba(56, 189, 248, 0.09)');
  glowGrad.addColorStop(1, 'rgba(7, 9, 14, 0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, W, H);

  // 2. Decorative Sonic Echo Concentric Ripples
  const ringCenterY = 610;
  const radii = [140, 235, 340, 455];
  radii.forEach((r, idx) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(W / 2, ringCenterY, r * 1.05, r * 0.42, 0, 0, Math.PI * 2);
    ctx.strokeStyle =
      idx % 2 === 0
        ? `rgba(255, 179, 71, ${0.46 - idx * 0.07})`
        : `rgba(56, 189, 248, ${0.42 - idx * 0.06})`;
    ctx.lineWidth = idx === 0 ? 4.5 : 2.5;
    ctx.stroke();
    ctx.restore();
  });

  for (let i = 0; i < 75; i++) {
    const sx = ((i * 173) % 960) + 60;
    const sy = ((i * 293) % 1680) + 120;
    const sr = 1.6 + (i % 3) * 1.2;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 179, 71, 0.58)' : 'rgba(56, 189, 248, 0.45)';
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Outer Editorial Gold Frame Border
  ctx.strokeStyle = 'rgba(255, 179, 71, 0.42)';
  ctx.lineWidth = 2;
  ctx.strokeRect(52, 52, W - 104, H - 104);

  ctx.strokeStyle = 'rgba(232, 228, 218, 0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(68, 68, W - 136, H - 136);

  // 4. Braille + Title Typography
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb347';
  ctx.font = '30px monospace';
  ctx.fillText('⠞⠊⠝⠛  ⠚⠊⠁⠝  ·  ⠍⠁⠝⠛  ⠙⠁⠕  ⠭⠊⠝⠛', W / 2, 172);

  ctx.fillStyle = '#e8e4da';
  ctx.font = 'bold 88px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('听见 · 盲道行', W / 2, 286);

  ctx.fillStyle = 'rgba(186, 230, 253, 0.88)';
  ctx.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('城市无障碍第一人称声波共情体验记录', W / 2, 350);

  // Minimalist Red-White Guide Cane Illustration
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

  // 5. Four Sculpted Data Cards (2x2 Grid for crisp typography!)
  const gridTop = 790;
  const cardW = 432;
  const cardH = 165;
  const gapX = 32;
  const gapY = 26;
  const startX = (W - (cardW * 2 + gapX)) / 2;

  const metricItems = [
    {
      value: `${stats.elapsedSeconds}s`,
      label: '雨夜盲行总耗时',
      sub: '45 米真实城市街角',
      accent: '#ffb347',
    },
    {
      value: `${stats.caneTaps}`,
      label: '盲杖探路敲击',
      sub: '以回响丈量每一寸前路',
      accent: '#38bdf8',
    },
    {
      value: `${stats.obstacleBumps}`,
      label: '遭遇占道碰壁',
      sub: stats.obstacleBumps === 0 ? '谨慎探路零碰壁' : '违停单车与施工围挡',
      accent: '#fda4af',
    },
    {
      value: `${stats.memoriesFound}/${stats.memoriesTotal}`,
      label: '听见的城市微光',
      sub: '无障碍细节触感记录',
      accent: '#6ee7b7',
    },
  ];

  metricItems.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = startX + col * (cardW + gapX);
    const cy = gridTop + row * (cardH + gapY);

    ctx.fillStyle = 'rgba(15, 21, 32, 0.82)';
    ctx.strokeStyle = 'rgba(255, 179, 71, 0.34)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cardW, cardH, 20);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = item.accent;
    ctx.font = 'bold 62px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(item.value, cx + 30, cy + 78);

    ctx.fillStyle = '#e8e4da';
    ctx.font = 'bold 28px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(item.label, cx + 30, cy + 124);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(item.sub, cx + 30, cy + 152);
  });

  // 6. Empathy Quote Block
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 179, 71, 0.9)';
  ctx.font = '46px serif';
  ctx.fillText('“', W / 2, 1240);

  const quoteLines = [
    '在全黑的雨夜里，每一次盲杖落地的脆响，',
    '都是中国 1731 万视障者走出家门的勇气。',
    '挪开一辆占道的单车，或是在路口轻声回应一句：',
    '“别急，变绿灯了”——你就是城市里的那束暖光。',
  ];
  ctx.fillStyle = '#e8e4da';
  ctx.font = '32px "PingFang SC", "Microsoft YaHei", sans-serif';
  quoteLines.forEach((line, idx) => {
    ctx.fillText(line, W / 2, 1306 + idx * 56);
  });

  ctx.strokeStyle = 'rgba(255, 179, 71, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 220, 1575);
  ctx.lineTo(W / 2 + 220, 1575);
  ctx.stroke();

  // 7. Public Welfare Footer
  ctx.fillStyle = '#ffb347';
  ctx.font = 'bold 38px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('请把盲道还给盲杖 · 让善意被听见', W / 2, 1648);

  ctx.fillStyle = 'rgba(255, 179, 71, 0.68)';
  ctx.font = '26px monospace';
  ctx.fillText('⠇⠑⠞  ⠅⠊⠝⠙⠝⠑⠎⠎  ⠃⠑  ⠓⠑⠁⠗⠙', W / 2, 1705);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
  ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('2026 Qoder 高校创造力大赛 · 城市无障碍公益互动作品', W / 2, 1802);

  return canvas.toDataURL('image/png');
}
