// Persistent broadcast-style HUD drawn on top of every scene (unless fx.globalHud == 0).
import { glowText, FONTS, COLORS, blink } from './lib/hudkit.js';
import { clamp01 } from './lib/ease.js';

export function drawGlobalHud(g, t, fx) {
  const a = clamp01(fx.globalHud) * clamp01((t - 0.25) / 0.6);
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;

  // Frame corners
  g.strokeStyle = 'rgba(210,235,255,0.55)';
  g.lineWidth = 2;
  const m = 44, L = 46;
  g.beginPath();
  g.moveTo(m, m + L); g.lineTo(m, m); g.lineTo(m + L, m);
  g.moveTo(1920 - m - L, m); g.lineTo(1920 - m, m); g.lineTo(1920 - m, m + L);
  g.moveTo(1920 - m, 1080 - m - L); g.lineTo(1920 - m, 1080 - m); g.lineTo(1920 - m - L, 1080 - m);
  g.moveTo(m + L, 1080 - m); g.lineTo(m, 1080 - m); g.lineTo(m, 1080 - m - L);
  g.stroke();

  // LIVE badge
  const live = blink(t, 1.0667, 0.6); // on the half-bar
  g.fillStyle = `rgba(255,42,68,${0.35 + 0.65 * live})`;
  g.shadowColor = COLORS.red;
  g.shadowBlur = 14 * live;
  g.beginPath(); g.arc(m + 34, m + 38, 9, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  glowText(g, 'LIVE', m + 54, m + 39, { font: FONTS.orb(22), color: COLORS.white, blur: 8 });
  glowText(g, 'TSE // 285A', m + 128, m + 39, { font: FONTS.mono(22), color: 'rgba(210,235,255,0.8)', glow: false });

  // Handle
  glowText(g, '@tack_trade', 1920 - m - 22, 1080 - m - 26, {
    font: FONTS.mono(24), color: 'rgba(230,240,255,0.75)', align: 'right', glow: false,
  });
  g.restore();
}
