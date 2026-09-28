// Deterministic randomness + noise. NEVER use Math.random() in this project:
// frames are rendered out of order by parallel workers, so everything must be
// reproducible from (seed, time).

/** mulberry32 PRNG: returns a function producing floats in [0, 1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash of a number (or two) to [0, 1). */
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i + seed * 17.13) * 2 - 1;
  const b = hash1(i + 1 + seed * 17.13) * 2 - 1;
  return a + (b - a) * u;
}

/** Fractal 1D noise in roughly [-1, 1]. */
export function fbm1(x, seed = 0, oct = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += noise1(x * f, seed + i * 7) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

/** Random point on a unit sphere from a PRNG. */
export function onSphere(r) {
  const u = r() * 2 - 1;
  const th = r() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(th), u, s * Math.sin(th)];
}

/** Gaussian-ish sample (sum of uniforms). */
export function gauss(r) {
  return (r() + r() + r() + r() - 2) / 2;
}
