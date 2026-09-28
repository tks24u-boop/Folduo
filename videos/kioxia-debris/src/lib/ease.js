// Easing + timing helpers. Every animation in this project is a pure function of time.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const clamp01 = (x) => clamp(x, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (x - a) / (b - a);
export const remap = (x, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, x)));
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Normalised progress of t inside [a, b], clamped to 0..1. */
export const seg = (t, a, b) => clamp01((t - a) / (b - a));

export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInQuart = (t) => t * t * t * t;
export const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
export const easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
export const easeInExpo = (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10));
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutExpo = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
export const easeOutBack = (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const easeInBack = (t, s = 1.70158) => (s + 1) * t * t * t - s * t * t;
export const easeOutElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
export const easeOutBounce = (t) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

/** Exponential decay envelope that starts at 1 when t == t0 and is 0 before t0. */
export const hit = (t, t0, decay = 8) => (t < t0 ? 0 : Math.exp(-(t - t0) * decay));

/** Slam: value goes from `from` to 1 quickly after t0 with overshoot (for scale slams). */
export const slam = (t, t0, dur = 0.18, from = 3.0) => {
  if (t < t0) return 0;
  const p = clamp01((t - t0) / dur);
  return lerp(from, 1, easeOutBack(p, 2.2));
};

/** 0 -> 1 -> 0 window with soft edges: fades in over `fin`, out over `fout`. */
export const window01 = (t, a, b, fin = 0.1, fout = 0.1) =>
  Math.min(smoothstep(a, a + fin, t), 1 - smoothstep(b - fout, b, t));
