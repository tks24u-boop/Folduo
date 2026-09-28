// 2D canvas HUD helpers. The HUD canvas is always addressed in 1920x1080 logical pixels
// (main.js scales for preview sizes). Colours are display sRGB.
import { clamp01 } from './ease.js';

export const COLORS = {
  red: '#ff2a44',
  redHot: '#ff5a6e',
  green: '#1dff8f',
  gold: '#ffc85a',
  cyan: '#39e6ff',
  orange: '#ff8a2a',
  white: '#f4f7ff',
  dim: 'rgba(200,220,255,0.55)',
};

export const FONTS = {
  dela: (px) => `400 ${px}px 'Dela Gothic One'`,
  noto: (px) => `900 ${px}px 'Noto Sans JP'`,
  orb: (px) => `900 ${px}px 'Orbitron'`,
  mono: (px) => `400 ${px}px 'Share Tech Mono'`,
};

/** Text with neon glow. opts: font, color, glow, blur, align, baseline, alpha, stroke, strokeWidth, spacing(px) */
export function glowText(g, str, x, y, o = {}) {
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.font = o.font ?? FONTS.noto(48);
  g.textAlign = o.align ?? 'left';
  g.textBaseline = o.baseline ?? 'middle';
  if (o.spacing) g.letterSpacing = `${o.spacing}px`;
  const color = o.color ?? COLORS.white;
  if (o.stroke) {
    g.lineJoin = 'round';
    g.lineWidth = o.strokeWidth ?? 8;
    g.strokeStyle = o.stroke;
    g.strokeText(str, x, y);
  }
  if (o.glow !== false) {
    g.shadowColor = o.glow ?? color;
    g.shadowBlur = o.blur ?? 18;
    g.fillStyle = color;
    g.fillText(str, x, y);
    g.shadowBlur = (o.blur ?? 18) * 0.35;
  }
  g.fillStyle = color;
  g.fillText(str, x, y);
  g.restore();
}

/** Sci-fi panel with cut corners. */
export function panel(g, x, y, w, h, o = {}) {
  const c = o.cut ?? 14;
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.beginPath();
  g.moveTo(x + c, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h - c);
  g.lineTo(x + w - c, y + h);
  g.lineTo(x, y + h);
  g.lineTo(x, y + c);
  g.closePath();
  g.fillStyle = o.fill ?? 'rgba(6,10,22,0.55)';
  g.fill();
  if (o.stroke !== false) {
    g.strokeStyle = o.stroke ?? COLORS.cyan;
    g.lineWidth = o.lineWidth ?? 2;
    g.shadowColor = o.stroke ?? COLORS.cyan;
    g.shadowBlur = o.blur ?? 10;
    g.stroke();
  }
  g.restore();
}

/** Corner brackets around a rect. */
export function brackets(g, x, y, w, h, o = {}) {
  const L = o.len ?? 28;
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.strokeStyle = o.color ?? COLORS.cyan;
  g.lineWidth = o.lineWidth ?? 3;
  g.shadowColor = o.color ?? COLORS.cyan;
  g.shadowBlur = o.blur ?? 8;
  g.beginPath();
  g.moveTo(x, y + L); g.lineTo(x, y); g.lineTo(x + L, y);
  g.moveTo(x + w - L, y); g.lineTo(x + w, y); g.lineTo(x + w, y + L);
  g.moveTo(x + w, y + h - L); g.lineTo(x + w, y + h); g.lineTo(x + w - L, y + h);
  g.moveTo(x + L, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - L);
  g.stroke();
  g.restore();
}

/** Typewriter: substring of str revealed at `cps` chars/sec starting at t0. */
export function typed(str, t, t0, cps = 30) {
  const chars = Array.from(str);
  const n = Math.max(0, Math.min(chars.length, Math.floor((t - t0) * cps)));
  return chars.slice(0, n).join('');
}

/** Horizontal scrolling ticker. items: [{text, color}] */
export function ticker(g, items, y, t, o = {}) {
  const speed = o.speed ?? 240; // px/sec
  const gap = o.gap ?? 60;
  const font = o.font ?? FONTS.mono(30);
  g.save();
  g.font = font;
  g.textBaseline = 'middle';
  const widths = items.map((it) => g.measureText(it.text).width + gap);
  const total = widths.reduce((a, b) => a + b, 0);
  let off = -((t * speed) % total);
  if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, y - (o.h ?? 44) / 2, 1920, o.h ?? 44); }
  for (let rep = 0; off + rep * total < 1920; rep++) {
    let x = off + rep * total;
    items.forEach((it, i) => {
      if (x < 1920 && x + widths[i] > 0) {
        g.fillStyle = it.color ?? COLORS.white;
        g.shadowColor = it.color ?? COLORS.white;
        g.shadowBlur = 10;
        g.fillText(it.text, x, y);
      }
      x += widths[i];
    });
  }
  g.restore();
}

export function avatarCircle(g, img, cx, cy, r, o = {}) {
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  g.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  g.restore();
}

/** Diagonal warning stripes band. */
export function hazard(g, x, y, w, h, t, o = {}) {
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = o.bg ?? '#140304';
  g.fillRect(x, y, w, h);
  g.fillStyle = o.color ?? COLORS.red;
  const s = o.stripe ?? 40;
  const off = ((t * (o.speed ?? 80)) % (s * 2));
  for (let i = -4; i < w / s + 4; i += 2) {
    const sx = x + i * s + off;
    g.beginPath();
    g.moveTo(sx, y + h); g.lineTo(sx + s, y + h); g.lineTo(sx + s + h, y); g.lineTo(sx + h, y);
    g.closePath(); g.fill();
  }
  g.restore();
}

export const fmtInt = (n) => (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('en-US');

/** Blink helper: 1/0 square wave. */
export const blink = (t, hz = 2, duty = 0.5) => ((t * hz) % 1 < duty ? 1 : 0);

export const alphaIn = (t, a, b) => clamp01((t - a) / (b - a));
