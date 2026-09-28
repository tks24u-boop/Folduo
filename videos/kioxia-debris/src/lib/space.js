// space.js — deep-space environment for s1 (orbit / sunrise), s4 (orbit decay / re-entry), s5 (rescue).
// Everything is procedural (no external textures) and deterministic: textures are baked on the CPU at
// create() time from rng-seeded noise (cached per seed, so s1/s4/s5 share one bake per page); every
// per-frame change is a pure function of the arguments you pass to update()/set*().
//
// Scale: Earth radius 20 world units (≈ 320 km per unit). Cameras ~22..80 units from the centre.
// Sky objects (stars, nebula, sun) are drawn "at infinity" (direction only, depth pinned to the far
// plane): they never clip against camera.far and show no parallax. Opaque objects occlude them.
//
// createStarfield({ count=7000, radius=600, seed=1, intensity=1, twinkle=0.12 })
//   -> { points, update(t), setIntensity(k) }
//   points: THREE.Points (add to scene). update(t) every frame (twinkle). setIntensity(0..1) for fades.
//   Stars concentrate along the same galactic band as the nebula's Milky Way.
//
// createNebula({ radius=800, seed=1, intensity=1, res=2048 })
//   -> { mesh, setMood(k), setIntensity(k), update(t) }
//   Sky sphere (additive over scene.background). mood 0 = cool blue/violet, 1 = red/magenta crisis.
//
// createEarth({ radius=20, seed=1, segments=256, res=2048 })
//   -> { group, surface, atmosphere, radius, uniforms, hotspots,
//        setSun(dirWorldVec3), setMood(k), update(t), setParams(obj), dirFromLatLon(lat, lon) }
//   group: add to scene; move/rotate/scale it freely (the shaders read its world transform).
//   setSun(dir): world-space unit vector FROM Earth TOWARDS the sun (same vector as sun.setDirection).
//   setMood(0..1): 1 = subtle ominous red cast (crisis). update(t): cloud drift (call every frame).
//   setParams({ sun, city, atmo, halo, night, clouds, bump, airglow, spin }) — optional look tweaks:
//     sun   : sun irradiance for surface + atmosphere (default 18)
//     city  : night-side city-light gain (default 1)      atmo : in-scattering gain (default 1)
//     halo  : outer glow-shell gain (default 1)            night: moon/airglow ambient on night side (1)
//     clouds: cloud coverage multiplier (1)               bump : relief shading strength (1)
//   hotspots: [{ lat, lon, pop }] densest city regions (degrees) — good nadir targets for night shots.
//   Look best with fx.bloomThreshold ≈ 0.9..1.2 (daylit clouds are ~1.5–3 linear; city cores ~2–4).
//
// createSun({ size=1, earth=null, intensity=1, light=false })
//   -> { group, light, update(t, camera?, renderer?), setDirection(dirWorld), setOccluder(earthOrNull),
//        setIntensity(k), params }
//   Core disk (depth-tested at infinity -> gets clipped by the Earth limb), corona glow, starburst,
//   horizontal anamorphic streak, halo ring and 6 lens-flare ghosts on the sun->screen-centre line.
//   All flare placement is computed in the vertex shader from the live camera (so it stays correct under
//   fx.shake) and is faded analytically when the sun is behind the Earth (+atmospheric reddening near
//   the limb). params: { core, glow, rays, streak, ghosts, ring } gains (mutate or pass via setIntensity).
//   light (optional DirectionalLight, add to scene yourself) follows setDirection() for lighting props.
//
// Helpers:
//   orbitCamera(camera, earth, { lat, lon, altitude, heading, pitch, roll }) — places camera above
//     (lat, lon) [deg] at `altitude` units, looking along `heading` [deg, 0 = north, 90 = east];
//     pitch [deg] is relative to the visible LIMB (0 = limb at screen centre, +5 = limb 5° lower on screen);
//     roll [deg]. Updates camera.matrixWorld.
//   sunDirAtLimb(camera, earth, { elevation=0, azimuth=0 }) -> THREE.Vector3 world sun direction such
//     that, from this camera, the sun sits `elevation` degrees above the Earth's limb (negative = still
//     hidden) at the limb point nearest the view direction, rotated `azimuth` degrees around the limb.
//     Use for the s1 sunrise: elevation(t) from ≈ -1.5 to +1 around t = 3.75. Call after positioning the
//     camera; feed the result to both earth.setSun() and sun.setDirection().
//   latLonToDir(lat, lon) -> THREE.Vector3 (Earth object space, unit).
import * as THREE from 'three';
import { rng } from './rand.js';

// ---------------------------------------------------------------------------------------------
// CPU noise used for build-time bakes
// ---------------------------------------------------------------------------------------------
function perlin3(seed) {
  const r = rng(seed);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const grad = (h, x, y, z) => {
    const hh = h & 15;
    const u = hh < 8 ? x : y;
    const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
    return ((hh & 1) === 0 ? u : -u) + ((hh & 2) === 0 ? v : -v);
  };
  return function noise(x, y, z) {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    x -= fx; y -= fy; z -= fz;
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const x1 = x - 1, y1 = y - 1, z1 = z - 1;
    const g000 = grad(p[AA], x, y, z), g100 = grad(p[BA], x1, y, z);
    const g010 = grad(p[AB], x, y1, z), g110 = grad(p[BB], x1, y1, z);
    const g001 = grad(p[AA + 1], x, y, z1), g101 = grad(p[BA + 1], x1, y, z1);
    const g011 = grad(p[AB + 1], x, y1, z1), g111 = grad(p[BB + 1], x1, y1, z1);
    const a0 = g000 + u * (g100 - g000), a1 = g010 + u * (g110 - g010);
    const b0 = g001 + u * (g101 - g001), b1 = g011 + u * (g111 - g011);
    const c0 = a0 + v * (a1 - a0), c1 = b0 + v * (b1 - b0);
    return c0 + w * (c1 - c0);
  };
}

// fBm with a rotation between octaves (kills grid alignment). Output roughly in [-0.7, 0.7].
function fbm(n, x, y, z, oct, lac = 2.03, gain = 0.5) {
  let s = 0, a = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(x, y, z);
    norm += a;
    a *= gain;
    const nx = 0.8 * y + 0.6 * z;
    const ny = -0.8 * x + 0.36 * y - 0.48 * z;
    const nz = -0.6 * x - 0.48 * y + 0.64 * z;
    x = nx * lac + 1.7; y = ny * lac + 9.2; z = nz * lac + 3.1;
  }
  return s / norm;
}

// Ridged multifractal in [0, 1] (sharp crests: mountain ranges / dust filaments).
function ridged(n, x, y, z, oct, lac = 2.1) {
  let s = 0, a = 0.5, wgt = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(n(x, y, z) * 1.4);
    v = v * v * wgt;
    wgt = Math.min(1, v * 2);
    s += v * a;
    norm += a;
    a *= 0.5;
    const nx = 0.8 * y + 0.6 * z;
    const ny = -0.8 * x + 0.36 * y - 0.48 * z;
    const nz = -0.6 * x - 0.48 * y + 0.64 * z;
    x = nx * lac + 5.3; y = ny * lac + 1.1; z = nz * lac + 7.7;
  }
  return s / norm;
}

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mixN = (a, b, t) => a + (b - a) * t;
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const SRGB_LUT = new Uint8Array(16385);
for (let i = 0; i <= 16384; i++) {
  const c = i / 16384;
  SRGB_LUT[i] = Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}
const linToSrgb8 = (c) => SRGB_LUT[(Math.min(1, Math.max(0, c)) * 16384 + 0.5) | 0];
const hexLin = (hex) => [srgbToLin(((hex >> 16) & 255) / 255), srgbToLin(((hex >> 8) & 255) / 255), srgbToLin((hex & 255) / 255)];

// Rodrigues rotation of (x,y,z) around unit axis k by angle a (used for cyclone swirls).
function rotAxis(x, y, z, kx, ky, kz, a, out) {
  const c = Math.cos(a), s = Math.sin(a), d = (kx * x + ky * y + kz * z) * (1 - c);
  out[0] = x * c + (ky * z - kz * y) * s + kx * d;
  out[1] = y * c + (kz * x - kx * z) * s + ky * d;
  out[2] = z * c + (kx * y - ky * x) * s + kz * d;
}

/** Earth object-space unit direction for (lat, lon) in degrees (matches the baked textures / SphereGeometry UVs). */
export function latLonToDir(lat, lon, out = new THREE.Vector3()) {
  const theta = (90 - lat) * (Math.PI / 180);
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  return out.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}
// Partial fBm over octaves [o0, o1) (unnormalised; same octave chain as fbm()). fbm = fbmPart(0, oct) / fbmNorm(oct).
function fbmPart(n, x, y, z, o0, o1, lac = 2.03) {
  let s = 0, a = 1;
  for (let i = 0; i < o1; i++) {
    if (i >= o0) s += a * n(x, y, z);
    a *= 0.5;
    const nx = 0.8 * y + 0.6 * z;
    const ny = -0.8 * x + 0.36 * y - 0.48 * z;
    const nz = -0.6 * x - 0.48 * y + 0.64 * z;
    x = nx * lac + 1.7; y = ny * lac + 9.2; z = nz * lac + 3.1;
  }
  return s;
}
const fbmNorm = (oct) => 2 * (1 - Math.pow(0.5, oct));

// Quarter-resolution equirect grid of F float fields (low-frequency noise), with a bilinear
// up-sampler for full-res texel (i, j). lat rows: j = 0 south .. north (SphereGeometry UV layout).
function lowGrid(W, H, F, fn) {
  const lw = W >> 2, lh = H >> 2;
  const arr = new Float32Array(lw * lh * F);
  for (let j = 0; j < lh; j++) {
    const th = (1 - (j + 0.5) / lh) * Math.PI;
    const st = Math.sin(th), ct = Math.cos(th);
    const lat = 90 - (th * 180) / Math.PI;
    for (let i = 0; i < lw; i++) {
      const ph = ((i + 0.5) / lw) * Math.PI * 2;
      fn(-Math.cos(ph) * st, ct, Math.sin(ph) * st, lat, arr, (j * lw + i) * F);
    }
  }
  const ci0 = new Int32Array(W), ci1 = new Int32Array(W), cfx = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    const x = ((i + 0.5) * lw) / W - 0.5;
    const x0 = Math.floor(x);
    cfx[i] = x - x0;
    ci0[i] = ((x0 % lw) + lw) % lw;
    ci1[i] = (ci0[i] + 1) % lw;
  }
  const rj0 = new Int32Array(H), rj1 = new Int32Array(H), rfy = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    const y = ((j + 0.5) * lh) / H - 0.5;
    const y0 = Math.floor(y);
    rfy[j] = Math.min(1, Math.max(0, y - y0));
    rj0[j] = Math.max(0, Math.min(lh - 1, y0));
    rj1[j] = Math.max(0, Math.min(lh - 1, y0 + 1));
    if (y0 < 0) rfy[j] = 0;
  }
  const out = new Float32Array(F);
  out.sample = (i, j) => {
    const fx = cfx[i], fy = rfy[j];
    const o00 = (rj0[j] * lw + ci0[i]) * F, o10 = (rj0[j] * lw + ci1[i]) * F;
    const o01 = (rj1[j] * lw + ci0[i]) * F, o11 = (rj1[j] * lw + ci1[i]) * F;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    for (let f = 0; f < F; f++) out[f] = arr[o00 + f] * w00 + arr[o10 + f] * w10 + arr[o01 + f] * w01 + arr[o11 + f] * w11;
    return out;
  };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Earth bake (equirect, SphereGeometry UV layout: u = lon, v = 0 south .. 1 north)
// ---------------------------------------------------------------------------------------------
const EARTH_CACHE = new Map();

function bakeEarth(seed, W, H) {
  const key = `${seed}|${W}`;
  if (EARTH_CACHE.has(key)) return EARTH_CACHE.get(key);
  const N = W * H;
  const nC = perlin3(seed * 131 + 1), nW1 = perlin3(seed * 131 + 2), nW2 = perlin3(seed * 131 + 3), nW3 = perlin3(seed * 131 + 4);
  const nBig = perlin3(seed * 131 + 5), nMt = perlin3(seed * 131 + 6), nMo = perlin3(seed * 131 + 7), nT = perlin3(seed * 131 + 8);
  const nPop = perlin3(seed * 131 + 9), nCl = perlin3(seed * 131 + 10), nCw = perlin3(seed * 131 + 11), nCi = perlin3(seed * 131 + 12);
  const nVar = perlin3(seed * 131 + 13);

  const sinT = new Float32Array(H), cosT = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    const th = (1 - (j + 0.5) / H) * Math.PI;
    sinT[j] = Math.sin(th); cosT[j] = Math.cos(th);
  }
  const sinP = new Float32Array(W), cosP = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    const ph = ((i + 0.5) / W) * Math.PI * 2;
    sinP[i] = Math.sin(ph); cosP[i] = Math.cos(ph);
  }

  // cyclone swirl centres for the cloud deck
  const cr = rng(seed * 977 + 5);
  const cyc = [];
  for (let q = 0; q < 9; q++) {
    const hemi = q % 2 ? 1 : -1;
    const tropical = q >= 7;
    const la = hemi * (tropical ? 12 + cr() * 8 : 38 + cr() * 22);
    const lo = cr() * 360 - 180;
    const d = latLonToDir(la, lo);
    cyc.push([d.x, d.y, d.z, (tropical ? 0.012 : 0.03) + cr() * 0.02, hemi * (tropical ? 2.6 : 1.4 + cr() * 1.0)]);
  }
  const pr = [0, 0, 0];
  const N7 = fbmNorm(7);

  // --- low-frequency fields at quarter resolution
  const low = lowGrid(W, H, 18, (x, y, z, lat, a, o) => {
    const wx = fbm(nW1, x * 1.1 + 3.1, y * 1.1, z * 1.1, 3);
    const wy = fbm(nW2, x * 1.1, y * 1.1 + 7.4, z * 1.1, 3);
    const wz = fbm(nW3, x * 1.1, y * 1.1, z * 1.1 - 2.2, 3);
    a[o] = wx; a[o + 1] = wy; a[o + 2] = wz;
    a[o + 3] = fbmPart(nC, x * 1.35 + wx * 1.1, y * 1.35 + wy * 1.1, z * 1.35 + wz * 1.1, 0, 4) + 0.3 * N7 * nBig(x * 0.75 + 11, y * 0.75, z * 0.75);
    a[o + 4] = fbm(nMo, x * 2.2 + wx * 0.5, y * 2.2 + wy * 0.5, z * 2.2 + wz * 0.5, 4);
    a[o + 5] = fbm(nT, x * 2.5, y * 2.5, z * 2.5, 3);
    a[o + 6] = fbm(nMt, x * 1.2 + 9, y * 1.2, z * 1.2, 2);
    a[o + 7] = fbm(nPop, x * 5.5, y * 5.5, z * 5.5, 3);
    a[o + 8] = fbm(nPop, x * 1.6 + 5, y * 1.6, z * 1.6, 2);
    a[o + 9] = fbm(nT, x * 3 + 4, y * 3, z * 3, 3);
    a[o + 10] = fbm(nVar, x * 4, y * 4, z * 4, 3);
    // clouds: cyclone swirls, warp, low octaves
    let px = x, py = y, pz = z;
    for (let q = 0; q < cyc.length; q++) {
      const cc = cyc[q];
      const dd = 1 - (px * cc[0] + py * cc[1] + pz * cc[2]);
      if (dd < cc[3] * 6) {
        const ang = cc[4] * Math.exp(-dd / cc[3]);
        rotAxis(px, py, pz, cc[0], cc[1], cc[2], ang, pr);
        px = pr[0]; py = pr[1]; pz = pr[2];
      }
    }
    const cwx = fbm(nCw, px * 2.0 + 1.3, py * 4.0, pz * 2.0, 3);
    const cwz = fbm(nCw, px * 2.0 - 4.1, py * 4.0 + 2, pz * 2.0, 3);
    a[o + 11] = px; a[o + 12] = py; a[o + 13] = pz; a[o + 14] = cwx; a[o + 15] = cwz;
    a[o + 16] = fbmPart(nCl, px * 3.2 + cwx * 1.4, py * 4.4 + cwx * 0.6, pz * 3.2 + cwz * 1.4, 0, 2);
    a[o + 17] = fbmPart(nCi, px * 2.5 + cwz, py * 9.0, pz * 2.5 + cwx, 0, 2);
  });

  // --- pass 1: continent field (high octaves at full res)
  const cont = new Float32Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = -cosP[i] * sinT[j], y = cosT[j], z = sinP[i] * sinT[j];
      const L = low.sample(i, j);
      cont[j * W + i] = (L[3] + fbmPart(nC, x * 1.35 + L[0] * 1.1, y * 1.35 + L[1] * 1.1, z * 1.35 + L[2] * 1.1, 4, 7)) / N7;
    }
  }
  // sea level: area-weighted percentile (≈ 31% land)
  const samp = [];
  for (let j = 0; j < H; j += 4) for (let i = 0; i < W; i += 4) samp.push([cont[j * W + i], sinT[j]]);
  samp.sort((a, b) => a[0] - b[0]);
  let tot = 0;
  for (const s of samp) tot += s[1];
  let acc = 0, sea = 0;
  for (const s of samp) { acc += s[1]; if (acc >= tot * 0.69) { sea = s[0]; break; } }
  let cmax = -1e9, cmin = 1e9;
  for (let k = 0; k < N; k++) { if (cont[k] > cmax) cmax = cont[k]; if (cont[k] < cmin) cmin = cont[k]; }

  // palette (linear)
  const P = {
    deep: hexLin(0x020c24), mid: hexLin(0x04173a), shallow: hexLin(0x0a3350), reef: hexLin(0x135f70),
    rain: hexLin(0x18361a), forest: hexLin(0x2a4424), boreal: hexLin(0x223328), grass: hexLin(0x56682f),
    savanna: hexLin(0x847c48), sand: hexLin(0xc9ae6c), redsand: hexLin(0xb3834a), tundra: hexLin(0x66665a),
    rock: hexLin(0x6f6254), snow: hexLin(0xe9eef4), seaice: hexLin(0xd5e0ea),
  };

  const col = new Uint8Array(N * 4);
  const dat = new Uint8Array(N * 4);
  const cld = new Uint8Array(N * 4);
  const hgt = new Float32Array(N);
  const popF = new Float32Array(N);
  const c3 = [0, 0, 0];
  const mix3 = (a, b, t) => { c3[0] = a[0] + (b[0] - a[0]) * t; c3[1] = a[1] + (b[1] - a[1]) * t; c3[2] = a[2] + (b[2] - a[2]) * t; };
  const lerpInto = (b, t) => { c3[0] += (b[0] - c3[0]) * t; c3[1] += (b[1] - c3[1]) * t; c3[2] += (b[2] - c3[2]) * t; };
  const N6 = fbmNorm(6), N4 = fbmNorm(4);

  for (let j = 0; j < H; j++) {
    const lat = 90 - ((1 - (j + 0.5) / H) * 180);
    const alat = Math.abs(lat);
    const cov = 0.52 + 0.1 * Math.exp(-((lat / 7) ** 2)) - 0.26 * Math.exp(-(((alat - 24) / 9) ** 2)) + 0.14 * Math.exp(-(((alat - 56) / 11) ** 2)) - 0.1 * sstep(72, 88, alat);
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const x = -cosP[i] * sinT[j], y = cosT[j], z = sinP[i] * sinT[j];
      const L = low.sample(i, j);
      const c = cont[k];
      const land = sstep(sea - 0.004, sea + 0.004, c);
      const e = Math.max(0, (c - sea) / (cmax - sea)); // 0 at coast .. 1 highest
      const depth = Math.max(0, (sea - c) / (sea - cmin));
      const iceN = L[9];
      let r = 0, g = 0, b = 0, water = 1 - land, pop = 0, h = 0;

      if (land > 0) {
        const wx = L[0], wy = L[1], wz = L[2];
        const mtMask = sstep(0.02, 0.3, e) * sstep(0.25, 0.55, L[6] * 0.5 + 0.5);
        const rid = mtMask > 0.003 ? ridged(nMt, x * 2.6 + wx * 0.6, y * 2.6 + wy * 0.6, z * 2.6 + wz * 0.6, 4) : 0;
        h = Math.min(1, e * 0.3 + rid * rid * mtMask * 0.85);
        const temp = 1 - Math.pow(alat / 90, 1.3) * 1.15 - h * 0.45 + 0.12 * L[5];
        let moist = 0.5 + 0.8 * L[4];
        moist -= 0.5 * Math.exp(-(((alat - 24) / 10) ** 2));
        moist += 0.35 * Math.exp(-((lat / 11) ** 2));
        moist += 0.22 * (1 - sstep(0.0, 0.1, e));
        moist -= 0.18 * sstep(0.15, 0.45, e);
        mix3(P.sand, P.redsand, 0.55 * sstep(0.35, 0.75, L[10] * 0.5 + 0.5));
        lerpInto(P.savanna, sstep(0.18, 0.34, moist));
        lerpInto(P.grass, sstep(0.32, 0.46, moist));
        const wetF = sstep(0.44, 0.62, moist);
        if (temp > 0.62) lerpInto(P.rain, wetF);
        else if (temp > 0.4) lerpInto(P.forest, wetF);
        else lerpInto(P.boreal, wetF);
        lerpInto(P.tundra, sstep(0.36, 0.22, temp));
        lerpInto(P.rock, sstep(0.35, 0.7, h) * 0.8);
        lerpInto(P.snow, Math.max(sstep(0.82, 0.98, h * 0.75 + (1 - temp) * 0.5), sstep(0.15, 0.04, temp + iceN * 0.08)));
        const vv = 1 + 0.2 * nVar(x * 11 + 2, y * 11, z * 11);
        r = c3[0] * vv; g = c3[1] * vv; b = c3[2] * vv;
        // population: temperate/tropical, not desert/ice/high, strongly coastal, clustered
        const hab = sstep(0.18, 0.4, temp) * sstep(0.12, 0.32, moist) * (1 - sstep(0.35, 0.6, h));
        const coast = Math.exp(-e / 0.05);
        const clus = sstep(-0.05, 0.4, L[7]);
        pop = hab * (0.4 + 0.6 * coast) * clus * (0.55 + 0.45 * sstep(0.15, 0.45, L[8] * 0.5 + 0.5));
        pop *= land;
      }
      if (water > 0) {
        mix3(P.deep, P.mid, sstep(0.55, 0.12, depth));
        lerpInto(P.shallow, sstep(0.03, 0.005, depth));
        lerpInto(P.reef, sstep(0.006, 0.0, depth) * 0.5 * sstep(35, 15, alat));
        if (land > 0) { r = mixN(r, c3[0], water); g = mixN(g, c3[1], water); b = mixN(b, c3[2], water); }
        else { r = c3[0]; g = c3[1]; b = c3[2]; }
      }
      // polar ice (sea ice + ice sheets)
      const ice = sstep(71, 78, alat + iceN * 9);
      if (ice > 0) {
        const I = water > 0.5 ? P.seaice : P.snow;
        r = mixN(r, I[0], ice); g = mixN(g, I[1], ice); b = mixN(b, I[2], ice);
        water *= 1 - ice;
        pop *= 1 - ice;
        h = Math.max(h, ice * 0.15 * (1 - water));
      }
      col[k * 4] = linToSrgb8(r); col[k * 4 + 1] = linToSrgb8(g); col[k * 4 + 2] = linToSrgb8(b);
      col[k * 4 + 3] = Math.round(water * 255);
      hgt[k] = h * (1 - water);
      popF[k] = pop;

      // clouds: R = main deck (fronts, cyclones, ITCZ), G = high cirrus wisps
      const px = L[11], py = L[12], pz = L[13], cwx = L[14], cwz = L[15];
      const f = ((L[16] + 1.7 * fbmPart(nCl, px * 3.2 + cwx * 1.4, py * 4.4 + cwx * 0.6, pz * 3.2 + cwz * 1.4, 2, 6)) / N6) * 0.5 + 0.5;
      const cMain = Math.pow(sstep(1 - cov - 0.02, 1 - cov + 0.24, f), 1.35);
      const ci = ((L[17] + fbmPart(nCi, px * 2.5 + cwz, py * 9.0, pz * 2.5 + cwx, 2, 4)) / N4) * 0.5 + 0.5;
      cld[k * 4] = Math.round(cMain * 255);
      cld[k * 4 + 1] = Math.round(sstep(0.55, 0.85, ci) * 0.6 * 255);
      cld[k * 4 + 3] = 255;
    }
  }

  // --- relief gradient (east, north) for bump shading, + population
  const dth = Math.PI / H, dph = (Math.PI * 2) / W;
  for (let j = 0; j < H; j++) {
    const jn = Math.min(H - 1, j + 1), js = Math.max(0, j - 1);
    const st = Math.max(0.05, sinT[j]);
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const ie = (i + 1) % W, iw = (i - 1 + W) % W;
      const gE = (hgt[j * W + ie] - hgt[j * W + iw]) / (2 * dph * st);
      const gN = (hgt[jn * W + i] - hgt[js * W + i]) / ((jn - js) * dth);
      dat[k * 4] = Math.round(Math.min(1, popF[k]) * 255);
      dat[k * 4 + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + gE / 80)) * 255);
      dat[k * 4 + 2] = Math.round(Math.min(1, Math.max(0, 0.5 + gN / 80)) * 255);
      dat[k * 4 + 3] = Math.round(hgt[k] * 255);
    }
  }

  // --- densest city regions (for camera targeting)
  const BW = 32, BH = 16, bw = W / BW, bh = H / BH;
  const blocks = [];
  for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
    let s = 0;
    for (let j = by * bh; j < (by + 1) * bh; j += 2) for (let i = bx * bw; i < (bx + 1) * bw; i += 2) s += popF[j * W + i];
    const lat = 90 - ((1 - ((by + 0.5) * bh) / H) * 180);
    blocks.push({ lat: +lat.toFixed(1), lon: +((((bx + 0.5) * bw) / W) * 360 - 180).toFixed(1), pop: s / ((bw * bh) / 4) });
  }
  blocks.sort((a, b) => b.pop - a.pop);
  const hotspots = blocks.slice(0, 8).map((b) => ({ ...b, pop: +b.pop.toFixed(3) }));

  const out = { col, dat, cld, W, H, hotspots };
  EARTH_CACHE.set(key, out);
  return out;
}

function dataTex(data, W, H, srgb, mips = true, aniso = 2) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  t.anisotropy = mips ? aniso : 1;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------
// GLSL chunks
// ---------------------------------------------------------------------------------------------
const GLSL_HASH = /* glsl */ `
  #define PI 3.14159265
  float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

// Single-scattering atmosphere (Rayleigh + Mie) with analytic Chapman optical depth towards the sun.
const GLSL_ATMO = /* glsl */ `
  uniform vec3 uEarthC;
  uniform float uR, uRa, uHr, uHm, uMieG, uBetaM, uAtmo;
  uniform vec3 uBetaR;   // Rayleigh scattering
  uniform vec3 uBetaE;   // Rayleigh + ozone-like absorption (extinction)
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uInsTint; // mood grade of in-scattered light

  vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c; float b = dot(oc, rd); float cc = dot(oc, oc) - r * r; float h = b * b - cc;
    if (h < 0.0) return vec2(1e9, -1e9);
    h = sqrt(h); return vec2(-b - h, -b + h);
  }
  // Relative column density (units of H, incl. density at the start height) along a ray from
  // radius X+h (in scale heights) with zenith cosine cz. Grazing / below-horizon handled.
  float chapman(float X, float h, float cz) {
    float c = sqrt(1.5707963 * (X + h));
    if (cz >= 0.0) return exp(-h) * c / (c * cz + 1.0);
    float sz = sqrt(max(0.0, 1.0 - cz * cz));
    float x0 = sz * (X + h);
    float c0 = sqrt(1.5707963 * x0);
    return 2.0 * c0 * exp(min(X - x0, 60.0)) - exp(-h) * c / (1.0 - c * cz);
  }
  vec3 sunTrans(float h, float cz) {
    float sR = uHr * chapman(uR / uHr, h / uHr, cz);
    float sM = sR * (uHm / uHr) * exp(-h / uHm + h / uHr);
    return exp(-(uBetaE * sR + uBetaM * 1.11 * sM));
  }
  float phaseR(float mu) { return 0.0596831 * (1.0 + mu * mu); }
  float phaseM(float mu) {
    float g = uMieG, g2 = g * g;
    return 0.1193662 * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
  }
  #define VIEW_EXT 0.5
  vec3 atmosphere(vec3 ro, vec3 rd, float tMax, const int NS, out vec3 Tview) {
    Tview = vec3(1.0);
    vec2 ta = raySphere(ro, rd, uEarthC, uRa);
    if (ta.x > ta.y || ta.y < 0.0) return vec3(0.0);
    vec2 tg = raySphere(ro, rd, uEarthC, uR);
    float t0 = max(ta.x, 0.0);
    float t1 = ta.y;
    if (tg.x < tg.y && tg.x > 0.0) t1 = min(t1, tg.x);
    t1 = min(t1, tMax);
    if (t1 <= t0) return vec3(0.0);
    float ds = (t1 - t0) / float(NS);
    float mu = dot(rd, uSunDir);
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    float odR = 0.0, odM = 0.0;
    for (int i = 0; i < 16; i++) {
      if (i >= NS) break;
      float t = t0 + ds * (float(i) + 0.5);
      vec3 dp = ro + rd * t - uEarthC;
      float r = length(dp);
      float h = max(r - uR, 0.0);
      float dR = exp(-h / uHr), dM = exp(-h / uHm);
      odR += dR * ds * 0.5 * VIEW_EXT; odM += dM * ds * 0.5 * VIEW_EXT;
      float cz = dot(dp, uSunDir) / r;
      float sR = uHr * chapman(uR / uHr, h / uHr, cz);
      float sM = sR * (uHm / uHr) * (dM / dR);
      vec3 T = exp(-(uBetaE * (odR + sR) + uBetaM * 1.11 * (odM + sM)));
      sumR += dR * T; sumM += dM * T;
      odR += dR * ds * 0.5 * VIEW_EXT; odM += dM * ds * 0.5 * VIEW_EXT;
    }
    Tview = exp(-(uBetaE * odR + uBetaM * 1.11 * odM));
    return uSunCol * uInsTint * (sumR * uBetaR * phaseR(mu) + sumM * uBetaM * phaseM(mu)) * ds;
  }
`;

// ---------------------------------------------------------------------------------------------
// Galactic frame shared by stars + nebula (so the star band matches the Milky Way glow)
// ---------------------------------------------------------------------------------------------
const GAL_N = new THREE.Vector3(0.32, 0.86, -0.4).normalize();
const GAL_C = new THREE.Vector3(1, 0, 0).cross(GAL_N).normalize(); // galactic centre direction (in plane)
const GAL_B = new THREE.Vector3().crossVectors(GAL_N, GAL_C).normalize();

// ---------------------------------------------------------------------------------------------
// Starfield
// ---------------------------------------------------------------------------------------------
export function createStarfield({ count = 7000, radius = 600, seed = 1, intensity = 1, twinkle = 0.12 } = {}) {
  const r = rng(seed * 7919 + 3);
  const pos = new Float32Array(count * 3);
  const colA = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const glint = new Float32Array(count);
  // stellar colour ramp (linear): M, K, G, F, A, B/O
  const ramp = [
    [1.0, 0.55, 0.32], [1.0, 0.72, 0.48], [1.0, 0.9, 0.76], [1.0, 0.97, 0.93], [0.86, 0.91, 1.0], [0.66, 0.77, 1.0],
  ];
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const u = r();
    if (u < 0.4) {
      // galactic band: gaussian latitude
      const lon = r() * Math.PI * 2;
      const g = (r() + r() + r() - 1.5) * 0.16 + (r() - 0.5) * 0.05;
      v.copy(GAL_C).multiplyScalar(Math.cos(lon) * Math.cos(g))
        .addScaledVector(GAL_B, Math.sin(lon) * Math.cos(g)).addScaledVector(GAL_N, Math.sin(g));
    } else {
      const z = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      v.set(s * Math.cos(th), z, s * Math.sin(th));
    }
    v.normalize().multiplyScalar(radius);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    // colour: mostly white-ish, some orange/red and blue
    const cu = r();
    const ci = cu < 0.12 ? 0 : cu < 0.3 ? 1 : cu < 0.55 ? 2 : cu < 0.75 ? 3 : cu < 0.92 ? 4 : 5;
    const c = ramp[ci];
    colA[i * 3] = c[0]; colA[i * 3 + 1] = c[1]; colA[i * 3 + 2] = c[2];
    // brightness: steep power law — a handful of bright stars, a sea of faint ones
    const b = r();
    let m = 0.035 + 0.22 * Math.pow(b, 7) + 0.05 * r();
    let gl = 0;
    if (b > 0.992) { m = 1.2 + r() * 2.2; gl = 0.6 + r() * 0.4; }
    else if (b > 0.97) { m = 0.45 + r() * 0.5; gl = r() < 0.4 ? 0.25 : 0; }
    mag[i] = m;
    glint[i] = gl;
    size[i] = gl > 0.5 ? 26 + r() * 14 : gl > 0 ? 13 : 3.2 + Math.min(1.8, m * 4);
    phase[i] = r();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colA, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aGlint', new THREE.BufferAttribute(glint, 1));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 1 }, uI: { value: intensity }, uTw: { value: twinkle } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aMag, aSize, aPhase, aGlint;
      uniform float uTime, uScale, uI, uTw;
      varying vec3 vCol; varying float vB, vGl, vPx;
      void main() {
        vec3 dir = normalize(mat3(modelMatrix) * position);
        vec4 c = projectionMatrix * vec4(mat3(viewMatrix) * dir, 1.0);
        c.z = c.w * 0.99999;
        gl_Position = c;
        float ph = aPhase * 6.2831853;
        float tw = 1.0 + uTw * (0.65 * sin(uTime * (1.3 + aPhase * 2.7) + ph) + 0.35 * sin(uTime * (3.1 + aPhase * 1.9) + ph * 3.0));
        tw = mix(tw, 1.0 + (tw - 1.0) * 0.35, step(0.01, aGlint));
        vB = aMag * tw * uI;
        vCol = aColor;
        vGl = aGlint;
        float px = aSize * uScale;
        vPx = px;
        gl_PointSize = px;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vB, vGl, vPx;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float rr = dot(q, q);
        if (rr > 1.0) discard;
        vec2 p = q * vPx * 0.5;             // pixels from centre
        float sig = 0.62 * max(vPx / 3.6, 0.5) * mix(1.0, 0.28, step(0.01, vGl)) ;
        sig = max(sig, 0.55);
        float core = exp(-dot(p, p) / (2.0 * sig * sig));
        float edge = 1.0 - smoothstep(0.55, 1.0, sqrt(rr));
        float spk = 0.0;
        if (vGl > 0.0) {
          vec2 a = abs(p);
          float len = vPx * 0.16;
          spk = exp(-a.y * 1.7) * exp(-a.x / len) + exp(-a.x * 1.7) * exp(-a.y / len);
          vec2 d = abs(vec2(p.x + p.y, p.x - p.y)) * 0.7071;
          spk += 0.3 * (exp(-d.y * 2.2) * exp(-d.x / (len * 0.45)) + exp(-d.x * 2.2) * exp(-d.y / (len * 0.45)));
          spk += 0.12 * exp(-length(p) / (len * 0.35));
          spk *= vGl * 0.55;
        }
        vec3 col = vCol * vB * (core + spk) * edge;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -20;
  const tmp = new THREE.Vector2();
  points.onBeforeRender = (renderer) => {
    const rt = renderer.getRenderTarget();
    const h = rt ? rt.height : renderer.getDrawingBufferSize(tmp).y;
    uniforms.uScale.value = h / 1080;
  };
  return {
    points,
    uniforms,
    update(t) { uniforms.uTime.value = t; },
    setIntensity(k) { uniforms.uI.value = intensity * k; },
  };
}

// ---------------------------------------------------------------------------------------------
// Nebula / Milky Way sky
// ---------------------------------------------------------------------------------------------
const NEB_CACHE = new Map();
function bakeNebula(seed, W, H) {
  const key = `${seed}|${W}`;
  if (NEB_CACHE.has(key)) return NEB_CACHE.get(key);
  const n1 = perlin3(seed * 313 + 1), n2 = perlin3(seed * 313 + 2), n3 = perlin3(seed * 313 + 3);
  const n4 = perlin3(seed * 313 + 4), n5 = perlin3(seed * 313 + 5), n6 = perlin3(seed * 313 + 6);
  const data = new Uint8Array(W * H * 4);
  const gn = GAL_N, gc = GAL_C;
  // nebula uses its own lat/lon layout (v = asin(y)); low grid is only used for smooth fields, so
  // build it with the same parameterisation via a direction remap.
  const dirOf = (i, j, w, h, o) => {
    const lat = ((j + 0.5) / h - 0.5) * Math.PI, ph = ((i + 0.5) / w - 0.5) * Math.PI * 2;
    o[0] = Math.cos(ph) * Math.cos(lat); o[1] = Math.sin(lat); o[2] = Math.sin(ph) * Math.cos(lat);
  };
  const lw = W >> 2, lh = H >> 2, F = 6;
  const la = new Float32Array(lw * lh * F);
  const d = [0, 0, 0];
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    dirOf(i, j, lw, lh, d);
    const x = d[0], y = d[1], z = d[2], o = (j * lw + i) * F;
    const wx = fbm(n1, x * 1.6, y * 1.6, z * 1.6, 3);
    const wy = fbm(n1, x * 1.6 + 5.2, y * 1.6, z * 1.6, 3);
    la[o] = wx; la[o + 1] = wy;
    la[o + 2] = fbm(n2, x * 1.4, y * 1.4, z * 1.4, 2);
    la[o + 3] = fbmPart(n3, x * 4.5 + wx, y * 4.5 + wy, z * 4.5, 0, 2);
    la[o + 4] = fbmPart(n5, x * 2.1 + wx * 0.8, y * 2.1 + wy * 0.8, z * 2.1, 0, 2);
    la[o + 5] = fbmPart(n6, x * 2.8 - wy, y * 2.8 + wx, z * 2.8 + 3, 0, 2);
  }
  const L = new Float32Array(F);
  const N5 = fbmNorm(5);
  for (let j = 0; j < H; j++) {
    const yy = ((j + 0.5) * lh) / H - 0.5;
    const y0 = Math.floor(yy), fy = y0 < 0 ? 0 : Math.min(1, yy - y0);
    const j0 = Math.max(0, Math.min(lh - 1, y0)), j1 = Math.max(0, Math.min(lh - 1, y0 + 1));
    for (let i = 0; i < W; i++) {
      const xx = ((i + 0.5) * lw) / W - 0.5;
      const x0 = Math.floor(xx), fx = xx - x0;
      const i0 = ((x0 % lw) + lw) % lw, i1 = (i0 + 1) % lw;
      const o00 = (j0 * lw + i0) * F, o10 = (j0 * lw + i1) * F, o01 = (j1 * lw + i0) * F, o11 = (j1 * lw + i1) * F;
      for (let f = 0; f < F; f++) L[f] = (la[o00 + f] * (1 - fx) + la[o10 + f] * fx) * (1 - fy) + (la[o01 + f] * (1 - fx) + la[o11 + f] * fx) * fy;
      dirOf(i, j, W, H, d);
      const x = d[0], y = d[1], z = d[2];
      const wx = L[0], wy = L[1];
      const gl = Math.asin(Math.max(-1, Math.min(1, x * gn.x + y * gn.y + z * gn.z))) + wx * 0.07;
      const bw = 0.13 + 0.05 * L[2];
      const cc = x * gc.x + y * gc.y + z * gc.z;
      const bulge = Math.exp(-((1 - cc) / 0.09)) * Math.exp(-((gl / 0.3) ** 2));
      const mottle = 0.5 + 0.9 * ((L[3] + fbmPart(n3, x * 4.5 + wx, y * 4.5 + wy, z * 4.5, 2, 5)) / N5);
      const band = Math.exp(-((gl / bw) ** 2)) * Math.max(0, mottle) * 0.75 + bulge * 0.9;
      const inBand = Math.exp(-((gl / (bw * 0.75)) ** 2));
      const dust = inBand > 0.02 ? sstep(0.35, 0.8, ridged(n4, x * 3.2 + wx * 1.2, y * 3.2 + wy * 1.2, z * 3.2, 4)) * inBand : 0;
      const gA = ((L[4] + fbmPart(n5, x * 2.1 + wx * 0.8, y * 2.1 + wy * 0.8, z * 2.1, 2, 5)) / N5) * 0.5 + 0.5;
      const gasA = Math.pow(sstep(0.5, 0.82, gA), 1.6) * (0.35 + 0.65 * Math.exp(-((gl / 0.5) ** 2)));
      const gB = ((L[5] + fbmPart(n6, x * 2.8 - wy, y * 2.8 + wx, z * 2.8 + 3, 2, 5)) / N5) * 0.5 + 0.5;
      const gasB = Math.pow(sstep(0.52, 0.85, gB), 1.8) * (0.4 + 0.6 * sstep(0.1, 0.6, gA));
      const k = (j * W + i) * 4;
      data[k] = Math.round(Math.min(1, band) * 255);
      data[k + 1] = Math.round(Math.min(1, dust) * 255);
      data[k + 2] = Math.round(Math.min(1, gasA) * 255);
      data[k + 3] = Math.round(Math.min(1, gasB) * 255);
    }
  }
  NEB_CACHE.set(key, data);
  return data;
}

export function createNebula({ radius = 800, seed = 1, intensity = 1, res = 1536 } = {}) {
  const W = res, H = res / 2;
  const tex = dataTex(bakeNebula(seed, W, H), W, H, false, false);
  const uniforms = { tNeb: { value: tex }, uMood: { value: 0 }, uI: { value: intensity }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = mat3(modelMatrix) * position;
        vec4 c = projectionMatrix * vec4(mat3(viewMatrix) * normalize(vDir), 1.0);
        c.z = c.w * 0.99999;
        gl_Position = c;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_HASH}
      uniform sampler2D tNeb; uniform float uMood, uI, uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        vec4 n = texture2D(tNeb, uv);
        float det = vnoise3(d * 90.0) * 0.6 + vnoise3(d * 230.0) * 0.4;
        float band = n.r * (0.8 + 0.4 * det);
        float dust = clamp(n.g * (0.8 + 0.5 * det), 0.0, 1.0);
        vec3 bandCol = mix(vec3(0.62, 0.66, 0.85), vec3(0.85, 0.52, 0.6), uMood);
        vec3 cA = mix(vec3(0.16, 0.3, 1.0), vec3(1.0, 0.1, 0.22), uMood);
        vec3 cB = mix(vec3(0.55, 0.22, 1.0), vec3(0.95, 0.08, 0.55), uMood);
        vec3 col = band * bandCol * 0.055 * (1.0 - dust * 0.9);
        col += (n.b * cA * 0.05 + n.a * cB * 0.04) * (1.0 - dust * 0.6) * (0.85 + 0.3 * det) * (1.0 + uMood * 0.5);
        col *= uI;
        col += (hash12(gl_FragCoord.xy) - 0.5) * 0.0015;
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 50; // opaque pass, after solid geometry -> occluded pixels are skipped
  mesh.userData.radius = radius;
  return {
    mesh,
    uniforms,
    setMood(k) { uniforms.uMood.value = k; },
    setIntensity(k) { uniforms.uI.value = intensity * k; },
    update(t) { uniforms.uTime.value = t; },
  };
}

// ---------------------------------------------------------------------------------------------
// Earth
// ---------------------------------------------------------------------------------------------
const HR = 0.006; // Rayleigh scale height / R (≈5x real, so the limb reads at video resolution)
const HM = 0.0018; // Mie scale height / R
const BETA_R_BLUE = new THREE.Vector3(0.058, 0.135, 0.331); // vertical optical depths (680/550/440 nm)
const OZONE = new THREE.Vector3(1.1, 1.16, 1.0); // extinction/scattering: adds ozone-like red/green absorption
const MOOD_INS = new THREE.Vector3(1.9, 0.3, 0.55); // crisis grade for in-scattered light (limb turns red/magenta)

export function createEarth({ radius = 20, seed = 1, segments = 256, res = 2048 } = {}) {
  const bake = bakeEarth(seed, res, res / 2);
  const tColor = dataTex(bake.col, bake.W, bake.H, true, true, 4);
  const tData = dataTex(bake.dat, bake.W, bake.H, false);
  const tCloud = dataTex(bake.cld, bake.W, bake.H, false);

  const P = { sun: 4.5, city: 1, atmo: 1, halo: 1, night: 1, clouds: 1, bump: 1, airglow: 1, spin: 0, rayleigh: 1.25, mie: 1 };
  const atmoU = {
    uEarthC: { value: new THREE.Vector3() },
    uR: { value: radius }, uRa: { value: radius * (1 + HR * 8) }, uHr: { value: radius * HR }, uHm: { value: radius * HM },
    uMieG: { value: 0.78 }, uBetaM: { value: 0 }, uAtmo: { value: 1 },
    uBetaR: { value: new THREE.Vector3() }, uBetaE: { value: new THREE.Vector3() },
    uInsTint: { value: new THREE.Vector3(1, 1, 1) },
    uSunDir: { value: new THREE.Vector3(1, 0.2, 0.3).normalize() },
    uSunCol: { value: new THREE.Vector3(1, 1, 1) },
  };
  let mood = 0;
  const applyAtmo = (R) => {
    atmoU.uR.value = R;
    atmoU.uRa.value = R * (1 + HR * 8);
    atmoU.uHr.value = R * HR;
    atmoU.uHm.value = R * HM;
    const hr = atmoU.uHr.value, hm = atmoU.uHm.value;
    atmoU.uBetaR.value.copy(BETA_R_BLUE).multiplyScalar(P.rayleigh / hr);
    atmoU.uBetaE.value.copy(atmoU.uBetaR.value).multiply(OZONE);
    atmoU.uInsTint.value.set(1, 1, 1).lerp(MOOD_INS, mood);
    atmoU.uBetaM.value = (0.012 * P.mie) / hm;
    const sc = atmoU.uSunCol.value;
    sc.set(1.0, 0.97, 0.93).multiplyScalar(P.sun);
    atmoU.uAtmo.value = P.atmo;
  };

  const surfU = {
    ...atmoU,
    tColor: { value: tColor }, tData: { value: tData }, tCloud: { value: tCloud },
    uTime: { value: 0 }, uMood: { value: 0 }, uCity: { value: 1 }, uNight: { value: 1 }, uCloudAmt: { value: 1 },
    uBump: { value: 1 }, uCloudDrift: { value: 0.0009 },
  };
  const surfMat = new THREE.ShaderMaterial({
    uniforms: surfU,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWP; varying vec3 vOP; varying vec3 vEw; varying vec3 vNw;
      void main() {
        vUv = uv; vOP = position;
        vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz;
        vec3 n = normalize(position);
        float s = length(n.xz);
        vec3 east = s > 1e-4 ? vec3(n.z, 0.0, -n.x) / s : vec3(1.0, 0.0, 0.0);
        vec3 north = cross(n, east);
        vEw = mat3(modelMatrix) * east; vNw = mat3(modelMatrix) * north;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_HASH}
      ${GLSL_ATMO}
      uniform sampler2D tColor, tData, tCloud;
      uniform float uTime, uMood, uCity, uNight, uCloudAmt, uBump, uCloudDrift;
      varying vec2 vUv; varying vec3 vWP; varying vec3 vOP; varying vec3 vEw; varying vec3 vNw;

      vec3 cubeUV(vec3 n) {
        vec3 a = abs(n); vec2 uv; float f;
        if (a.x >= a.y && a.x >= a.z) { f = n.x > 0.0 ? 0.0 : 1.0; uv = n.zy / a.x; }
        else if (a.y >= a.z) { f = n.y > 0.0 ? 2.0 : 3.0; uv = n.xz / a.y; }
        else { f = n.z > 0.0 ? 4.0 : 5.0; uv = n.xy / a.z; }
        return vec3(atan(uv) * 1.2732395, f);
      }
      // Point lights on a jittered grid. When a point shrinks below ~1px its radius is clamped to a pixel
      // (energy preserving); when whole cells go sub-pixel the layer fades to its expectation (no blocks).
      float spotLOD(float d2, float rad, float fc) {
        float r = max(rad, 0.6 * fc);
        return exp(-d2 / (r * r)) * (rad * rad) / (r * r);
      }
      float cityLayer1(vec2 uv, float face, float N, float rad, float dens, float seed, float fwUV) {
        vec2 q = uv * N; vec2 id = floor(q); vec2 f = q - id;
        vec3 h = hash32(id + face * vec2(173.1, 91.7) + seed);
        vec2 dv = f - (0.25 + 0.5 * h.xy);
        float fc = fwUV * N;
        float on = smoothstep(h.z - 0.03, h.z + 0.03, dens);
        float b = 0.3 + 0.7 * fract(h.x * 17.13 + h.y * 3.71);
        float spot = on * b * spotLOD(dot(dv, dv), rad, fc);
        float expect = clamp(dens, 0.0, 1.0) * 0.65 * 3.14159 * rad * rad;
        return mix(spot, expect, smoothstep(0.3, 0.7, fc));
      }
      float cityLayer4(vec2 uv, float face, float N, float rad, float dens, float seed, float fwUV) {
        vec2 q = uv * N;
        vec2 id0 = floor(q - 0.5);
        float fc = fwUV * N;
        float acc = 0.0;
        for (int k = 0; k < 4; k++) {
          vec2 id = id0 + vec2(mod(float(k), 2.0), floor(float(k) * 0.5));
          vec3 h = hash32(id + face * vec2(173.1, 91.7) + seed);
          vec2 dv = q - (id + 0.06 + 0.88 * h.xy);
          float on = smoothstep(h.z - 0.03, h.z + 0.03, dens);
          float b = 0.25 + 0.75 * fract(h.x * 17.13 + h.y * 3.71);
          b *= b;
          acc += on * b * spotLOD(dot(dv, dv), rad, fc);
        }
        float expect = clamp(dens, 0.0, 1.0) * 0.45 * 3.14159 * rad * rad;
        return mix(acc, expect, smoothstep(0.3, 0.7, fc));
      }

      void main() {
        vec3 ro = cameraPosition;
        vec3 toP = vWP - ro; float tS = length(toP); vec3 rd = toP / tS;
        vec3 N = normalize(vWP - uEarthC);
        vec3 E = normalize(vEw), No = normalize(vNw);
        vec3 L = uSunDir;
        float mu = dot(N, L);
        vec3 on = normalize(vOP);

        vec4 C = texture2D(tColor, vUv);
        vec4 D = texture2D(tData, vUv);
        vec3 alb = C.rgb; float water = C.a; float pop = D.r;
        vec2 g = (D.gb - 0.5) * 80.0;

        float fwP = length(fwidth(vWP)) / uR;          // radians per pixel
        // close-up detail: two value-noise octaves, each faded out before it can alias
        float dA1 = 1.0 - smoothstep(0.12, 0.35, fwP * 180.0);
        float dA2 = 1.0 - smoothstep(0.12, 0.35, fwP * 520.0);
        float det = 0.0;
        if (dA1 > 0.001) det = (vnoise3(on * 180.0) - 0.5) * 0.65 * dA1 + (dA2 > 0.001 ? (vnoise3(on * 520.0) - 0.5) * 0.35 * dA2 : 0.0);
        alb *= 1.0 + det * 0.7 * (1.0 - water);

        float drift = uTime * uCloudDrift;
        vec2 cuv = vUv + vec2(drift, 0.0);
        vec4 CL = texture2D(tCloud, cuv);
        float cir = texture2D(tCloud, vUv + vec2(drift * 1.7 + 0.31, 0.0)).g;
        float cloud = clamp((CL.r + cir * 0.6) * uCloudAmt, 0.0, 1.0);
        cloud = clamp(cloud + det * 0.55 * cloud * (1.0 - cloud) * 2.5, 0.0, 1.0);

        // cloud shadow: sample the deck displaced towards the sun
        vec3 Lt = L - N * mu;
        vec3 off = Lt / max(mu, 0.12) * uR * 0.0035;
        float cosLat = max(length(on.xz), 0.05);
        vec2 suv = cuv + vec2(dot(off, E) / (6.2831853 * uR * cosLat), dot(off, No) / (3.14159265 * uR));
        float cs = clamp(texture2D(tCloud, suv).r * uCloudAmt, 0.0, 1.0);

        vec3 Tsun = sunTrans(0.0, mu);
        vec3 Tcl = sunTrans(uHr * 0.8, mu + 0.02);
        vec3 sunC = uSunCol * Tsun;
        vec3 Nb = normalize(N - uBump * 0.012 * (g.x * E + g.y * No) * (1.0 - water));
        float nl = dot(Nb, L);
        float diff = clamp((nl + 0.03) / 1.03, 0.0, 1.0);
        vec3 skyAmb = uSunCol * vec3(0.35, 0.55, 1.0) * 0.006 * smoothstep(-0.18, 0.35, mu);
        vec3 ground = alb * (sunC * diff / PI + skyAmb);
        ground *= 1.0 - 0.6 * cs * smoothstep(-0.05, 0.2, mu);

        // ocean: GGX sun glint + fresnel sky reflection
        vec3 V = -rd;
        float nv = max(dot(N, V), 1e-3);
        float nlg = max(mu, 0.0);
        vec3 Hh = normalize(L + V);
        float nh = max(dot(N, Hh), 0.0);
        float rough = 0.13 + 0.09 * vnoise3(on * 24.0);
        float a2 = rough * rough * rough * rough;
        float dd = nh * nh * (a2 - 1.0) + 1.0;
        float Dg = a2 / (PI * dd * dd);
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
        float k = rough * rough * 0.5;
        float Vis = 0.25 / ((nlg * (1.0 - k) + k) * (nv * (1.0 - k) + k));
        vec3 spec = sunC * min(Dg * F * Vis, 6.0) * nlg * smoothstep(0.0, 0.25, nv);
        float Fv = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
        vec3 skyRef = uSunCol * vec3(0.25, 0.45, 1.0) * 0.012 * Fv * smoothstep(-0.1, 0.3, mu);
        ground += (spec + skyRef) * water * (1.0 - cloud);

        // clouds
        float cwrap = clamp((mu + 0.12) / 1.12, 0.0, 1.0);
        vec3 cloudC = vec3(0.95) * (uSunCol * Tcl * cwrap / PI + skyAmb * 1.5);
        vec3 col = mix(ground, cloudC, cloud);

        // night side: city lights (sodium orange, whiter cores), moonlit ambient
        float night = smoothstep(0.06, -0.1, mu);
        vec3 lights = vec3(0.0);
        if (night > 0.001 && pop > 0.004) {
          vec3 cf = cubeUV(on);
          float fwUV = max(fwidth(cf.x), fwidth(cf.y));
          fwUV = fwUV > 0.2 ? 0.0 : fwUV; // face seams
          float mRaw = vnoise3(on * 95.0) * 0.62 + vnoise3(on * 240.0) * 0.38;
          float metro = smoothstep(0.45, 0.92, mRaw) * smoothstep(0.08, 0.45, pop);
          metro *= metro;
          float core = smoothstep(0.74, 0.95, mRaw) * smoothstep(0.2, 0.6, pop);
          float towns = cityLayer4(cf.xy, cf.z, 300.0, 0.085, pop * pop * 1.6 + metro * 0.6, 7.0, fwUV);
          float fine = cityLayer1(cf.xy, cf.z, 760.0, 0.16, pop * 0.25 + metro * 1.3, 13.0, fwUV);
          float dust = cityLayer1(cf.xy, cf.z, 1900.0, 0.2, pop * 0.3 + metro * 1.5, 29.0, fwUV);
          float glow = metro * pop * 0.1 + pop * pop * 0.025 + core * 0.3;
          vec3 sodium = vec3(1.0, 0.45, 0.12);
          vec3 white = vec3(1.0, 0.8, 0.55);
          lights = sodium * (towns * 2.6 + fine * 2.2 + dust * 1.2 + glow) + white * (core * 0.7 + fine * metro * 1.1);
          lights *= mix(vec3(1.0), vec3(1.3, 0.35, 0.3), uMood * 0.6);
        }
        col += lights * uCity * night * (1.0 - 0.8 * cloud);
        col += cloud * pop * night * vec3(1.0, 0.45, 0.15) * 0.05 * uCity;
        col += (alb * (1.0 - cloud) * 0.5 + cloud * 0.6 + water * 0.004) * vec3(0.35, 0.45, 0.75) * 0.03 * uNight * night;

        col *= mix(vec3(1.0), vec3(1.25, 0.62, 0.66), uMood * 0.6);

        vec3 Tv;
        vec3 ins = atmosphere(ro, rd, tS, 5, Tv);
        col = col * Tv + ins * uAtmo * 0.72;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2), surfMat);

  // Atmosphere shell (sky around the limb) + artistic outer halo + night airglow.
  const shellU = { ...atmoU, uHalo: { value: 1 }, uAirglow: { value: 1 }, uMood: surfU.uMood };
  const shellMat = new THREE.ShaderMaterial({
    uniforms: shellU,
    vertexShader: /* glsl */ `
      varying vec3 vWP;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_HASH}
      ${GLSL_ATMO}
      uniform float uHalo, uAirglow, uMood;
      varying vec3 vWP;
      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWP - ro);
        vec3 Tv;
        vec3 ins = atmosphere(ro, rd, 1e9, 10, Tv) * uAtmo;
        // closest approach of the view ray to the Earth centre
        vec3 oc = uEarthC - ro;
        float tc = max(dot(oc, rd), 0.0);
        vec3 pc = ro + rd * tc - uEarthC;
        float dc = length(pc);
        float hT = max(dc - uR, 0.0);
        vec3 up = pc / max(dc, 1e-4);
        float lit = dot(up, uSunDir);
        float fwd = pow(max(dot(rd, uSunDir), 0.0), 6.0);
        float dayF = smoothstep(-0.3, 0.45, lit);
        vec3 haloDay = mix(vec3(0.18, 0.42, 1.0), vec3(1.0, 0.45, 0.2), smoothstep(0.35, -0.2, lit) * 0.7);
        haloDay = mix(haloDay, vec3(1.0, 0.18, 0.3), uMood * 0.7);
        float fall = exp(-hT / (uR * 0.014)) * 0.6 + exp(-hT / (uR * 0.045)) * 0.4;
        vec3 halo = haloDay * fall * (dayF * 0.8 + fwd * 1.2) * uHalo * 0.05 * length(uSunCol) / 1.7;
        // night airglow: thin green/teal line ~100 km up
        float ag = exp(-pow((hT - uHr * 2.6) / (uHr * 0.35), 2.0));
        vec3 air = mix(vec3(0.3, 1.0, 0.6), vec3(1.0, 0.25, 0.35), uMood) * ag * 0.012 * smoothstep(0.05, -0.25, lit) * uAirglow;
        float edge = 1.0 - smoothstep(uR * 1.12, uR * 1.19, dc);
        vec3 col = (ins + halo + air) * edge;
        float a = (1.0 - dot(Tv, vec3(0.3333))) * edge * 0.6;
        gl_FragColor = vec4(col, a);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.2, 128, 64), shellMat);
  atmosphere.renderOrder = 5;

  const group = new THREE.Group();
  group.add(surface, atmosphere);
  const tmpV = new THREE.Vector3();
  const sync = () => {
    surface.getWorldPosition(atmoU.uEarthC.value);
    surface.getWorldScale(tmpV);
    applyAtmo(radius * tmpV.x);
  };
  surface.onBeforeRender = sync;
  atmosphere.onBeforeRender = sync;
  applyAtmo(radius);

  const api = {
    group, surface, atmosphere, radius, uniforms: surfU, shellUniforms: shellU, hotspots: bake.hotspots, params: P,
    setSun(dir) { atmoU.uSunDir.value.copy(dir).normalize(); },
    setMood(k) { mood = k; surfU.uMood.value = k; applyAtmo(atmoU.uR.value); },
    setParams(o = {}) {
      Object.assign(P, o);
      surfU.uCity.value = P.city; surfU.uNight.value = P.night; surfU.uCloudAmt.value = P.clouds; surfU.uBump.value = P.bump;
      shellU.uHalo.value = P.halo; shellU.uAirglow.value = P.airglow;
      applyAtmo(atmoU.uR.value);
    },
    update(t) {
      surfU.uTime.value = t;
      if (P.spin) surface.rotation.y = t * P.spin;
    },
    /** World-space unit direction from the Earth centre to (lat, lon) given the group's current transform. */
    dirFromLatLon(lat, lon, out = new THREE.Vector3()) {
      latLonToDir(lat, lon, out);
      group.updateMatrixWorld(true);
      return out.transformDirection(surface.matrixWorld);
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------
// Sun + lens flare
// ---------------------------------------------------------------------------------------------
const SUN_VERT = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uAlong, uAng, uRot, uDepth, uStretch;
  uniform vec2 uSize;
  uniform vec3 uOccC; uniform float uOccR, uSunAng, uPre, uHr;
  uniform vec3 uBetaR;
  varying vec2 vQ; varying float vVis, vPre, vOn; varying vec3 vTint; varying vec2 vSun;
  void main() {
    vec3 vd = mat3(viewMatrix) * uSunDir;
    vec4 sc = projectionMatrix * vec4(vd, 0.0);
    float w = sc.w;
    vec2 sn = sc.xy / max(w, 1e-4);
    float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    // analytic occlusion by the Earth sphere
    vec3 toC = uOccC - cameraPosition; float dC = max(length(toC), 1e-3);
    float angE = uOccR > 0.0 ? asin(clamp(uOccR / dC, 0.0, 1.0)) : -1.0;
    float th = acos(clamp(dot(toC / dC, uSunDir), -1.0, 1.0));
    vVis = uOccR > 0.0 ? smoothstep(angE - uSunAng, angE + uSunAng, th) : 1.0;
    vPre = uOccR > 0.0 ? smoothstep(angE - uSunAng * uPre, angE + uSunAng * 1.5, th) : 1.0;
    // reddening of the line of sight grazing the atmosphere
    float hmin = th < 1.5707963 ? dC * sin(th) - uOccR : 1e3;
    float col = uOccR > 0.0 ? 2.0 * uHr * sqrt(1.5707963 * uOccR / uHr) * exp(-max(hmin, 0.0) / uHr) : 0.0;
    vTint = exp(-uBetaR * col);
    float ext = max(abs(sn.x), abs(sn.y));
    vOn = step(0.0, w) * (1.0 - smoothstep(1.05, 1.7, ext));
    vec2 center = sn * uAlong;
    float s = tan(uAng) * projectionMatrix[1][1];
    vec2 off = position.xy * (uSize + vec2(s));
    float cr = cos(uRot), sr = sin(uRot);
    off = vec2(cr * off.x - sr * off.y, sr * off.x + cr * off.y);
    off.x /= aspect;
    gl_Position = vec4(center + off, uDepth, 1.0);
    if (w <= 1e-4) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    vQ = position.xy;
    vSun = sn;
  }
`;

function sunMat(frag, extraU, { depthTest = false, order = 100 } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: extraU,
    vertexShader: SUN_VERT,
    fragmentShader: `${GLSL_HASH}\nvarying vec2 vQ; varying float vVis, vPre, vOn; varying vec3 vTint; varying vec2 vSun;\n${frag}`,
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}

export function createSun({ size = 1, earth = null, intensity = 1, light = false } = {}) {
  const shared = {
    uSunDir: { value: new THREE.Vector3(1, 0.2, 0.3).normalize() },
    uOccC: { value: new THREE.Vector3() }, uOccR: { value: 0 },
    uSunAng: { value: 0.012 * size }, uHr: { value: 0.12 },
    uBetaR: { value: new THREE.Vector3(0.058, 0.135, 0.331).multiplyScalar(1.45 / 0.12) },
    uTime: { value: 0 },
  };
  const params = { core: 1, glow: 1, rays: 1, streak: 1, ghosts: 1, ring: 1 };
  const mk = (frag, own, opt) => {
    const u = {
      ...shared,
      uAlong: { value: 1 }, uAng: { value: 0 }, uRot: { value: 0 }, uDepth: { value: 0 }, uStretch: { value: 1 },
      uSize: { value: new THREE.Vector2(0, 0) }, uPre: { value: 1 }, uI: { value: 1 }, uColor: { value: new THREE.Vector3(1, 1, 1) },
      ...own,
    };
    return sunMat(frag, u, opt);
  };
  const group = new THREE.Group();

  // 1) core disk: depth-tested at infinity -> the Earth limb clips it naturally
  const core = mk(/* glsl */ `
    uniform float uI; uniform vec3 uColor;
    void main() {
      float r = length(vQ) * 4.0;               // disk radius = 1/4 of quad
      float mu = sqrt(max(0.0, 1.0 - min(r * r, 1.0)));
      float disk = (1.0 - smoothstep(0.93, 1.03, r)) * (0.72 + 0.28 * mu);
      float glow = exp(-max(r - 1.0, 0.0) * 2.2) * 0.12 + exp(-max(r - 1.0, 0.0) * 0.7) * 0.02;
      glow *= 1.0 - smoothstep(2.6, 4.0, r);
      vec3 c = uColor * vTint * (disk * 1.0 + glow) * uI * vOn;
      gl_FragColor = vec4(c, 1.0);
    }
  `, { uAng: { value: 0.0105 * size * 4 }, uDepth: { value: 0.99999 }, uColor: { value: new THREE.Vector3(1.0, 0.93, 0.82) }, uI: { value: 60 } },
  { depthTest: true, order: 10 });

  // 2) corona / bloom glow (not occluded, fades in slightly before the core appears)
  const glow = mk(/* glsl */ `
    uniform float uI; uniform vec3 uColor;
    void main() {
      float r = length(vQ);
      float g = exp(-r * 9.0) * 0.8 + exp(-r * 3.2) * 0.22 + exp(-r * 1.2) * 0.04;
      g *= 1.0 - smoothstep(0.75, 1.0, r);
      vec3 tt = mix(vTint, vec3(sqrt(dot(vTint, vec3(0.45, 0.4, 0.15)))), 0.45);
      gl_FragColor = vec4(uColor * tt * g * uI * vPre * vPre * vOn, 1.0);
    }
  `, { uAng: { value: 0.2 * size }, uPre: { value: 2.2 }, uColor: { value: new THREE.Vector3(1.0, 0.8, 0.55) }, uI: { value: 3.0 } });

  // 3) starburst rays (irregular diffraction spikes + 6-point aperture spikes)
  const rays = mk(/* glsl */ `
    uniform float uI; uniform vec3 uColor; uniform float uTime;
    float an(float a, float n, float s) { float x = a / 6.2831853 * n; float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(hash12(vec2(mod(i, n), s)), hash12(vec2(mod(i + 1.0, n), s)), f); }
    void main() {
      float r = length(vQ);
      float a = atan(vQ.y, vQ.x) + 3.14159265;
      float n1 = an(a, 90.0, 3.0), n2 = an(a + 0.7, 47.0, 9.0);
      float streaks = pow(n1, 7.0) * 1.2 + pow(n2, 9.0) * 0.8;
      float spikes = 0.0;
      for (int k = 0; k < 3; k++) { float aa = a + float(k) * 1.0471976; spikes += pow(abs(cos(aa)), 900.0); }
      float fall = exp(-r * (5.5 - 2.5 * n2));
      float I = (streaks * 0.5 + spikes * 1.3) * fall * (1.0 - smoothstep(0.7, 1.0, r)) * smoothstep(0.0, 0.03, r);
      vec3 tt = mix(vTint, vec3(sqrt(dot(vTint, vec3(0.45, 0.4, 0.15)))), 0.55);
      gl_FragColor = vec4(uColor * tt * I * uI * vVis * vOn, 1.0);
    }
  `, { uAng: { value: 0.3 * size }, uColor: { value: new THREE.Vector3(1.0, 0.86, 0.66) }, uI: { value: 1.6 } });

  // 4) anamorphic horizontal streak
  const streak = mk(/* glsl */ `
    uniform float uI; uniform vec3 uColor;
    void main() {
      float x = abs(vQ.x), y = abs(vQ.y);
      float core = exp(-y * 26.0) * pow(1.0 - x, 3.0);
      float wide = exp(-y * 7.0) * pow(1.0 - x, 5.0) * 0.25;
      float hot = exp(-y * 40.0) * exp(-x * 14.0) * 1.5;
      vec3 c = uColor * (core + wide) + vec3(1.0, 0.95, 0.9) * hot * vTint;
      float tl = sqrt(dot(vTint, vec3(0.45, 0.4, 0.15)));
      gl_FragColor = vec4(c * tl * uI * vVis * vOn, 1.0);
    }
  `, { uSize: { value: new THREE.Vector2(2.6, 0.05) }, uColor: { value: new THREE.Vector3(0.38, 0.6, 1.0) }, uI: { value: 2.6 } });

  // 5) faint rainbow halo ring around the sun
  const ring = mk(/* glsl */ `
    uniform float uI;
    void main() {
      float r = length(vQ);
      float d = (r - 0.82) / 0.09;
      vec3 rb = vec3(exp(-pow(d - 0.8, 2.0)), exp(-pow(d, 2.0)), exp(-pow(d + 0.8, 2.0)));
      gl_FragColor = vec4(rb * 0.012 * uI * vVis * vOn, 1.0);
    }
  `, { uSize: { value: new THREE.Vector2(0.62, 0.62) }, uI: { value: 1 } });

  // 6) ghosts along sun -> centre -> mirror line
  const GHOSTS = [
    // along, size (ndc-y), colour, kind (0 soft disk, 1 ring, 2 hexagon), gain
    [0.62, 0.035, [1.0, 0.75, 0.35], 0, 0.22],
    [0.34, 0.075, [0.4, 1.0, 0.6], 2, 0.07],
    [-0.18, 0.05, [0.5, 0.65, 1.0], 0, 0.1],
    [-0.42, 0.15, [0.85, 0.45, 1.0], 1, 0.06],
    [-0.7, 0.028, [1.0, 0.55, 0.3], 2, 0.16],
    [-1.05, 0.22, [0.35, 0.7, 1.0], 1, 0.045],
  ];
  const ghosts = GHOSTS.map(([along, sz, c, kind, gain]) =>
    mk(/* glsl */ `
      uniform float uI; uniform vec3 uColor; uniform float uKind;
      void main() {
        vec2 q = vQ; float r = length(q);
        float hx = max(abs(q.x) * 0.8660254 + abs(q.y) * 0.5, abs(q.y));
        float d = uKind > 1.5 ? hx : r;
        float body = uKind > 0.5 && uKind < 1.5
          ? 0.6 * exp(-pow((r - 0.78) / 0.16, 2.0)) + 0.2 * smoothstep(1.0, 0.0, r)
          : (1.0 - smoothstep(0.78, 1.0, d)) * (0.55 + 0.45 * smoothstep(0.2, 0.95, d));
        vec3 fr = vec3(smoothstep(0.7, 1.0, d), 1.0, smoothstep(1.0, 0.7, d));
        float tl = sqrt(dot(vTint, vec3(0.45, 0.4, 0.15)));
        gl_FragColor = vec4(uColor * fr * body * tl * uI * vVis * vOn, 1.0);
      }
    `, {
      uAlong: { value: along }, uSize: { value: new THREE.Vector2(sz, sz) }, uColor: { value: new THREE.Vector3(...c) },
      uKind: { value: kind }, uI: { value: gain },
    }));

  const parts = { core, glow, rays, streak, ring, ghosts };
  group.add(core, glow, rays, streak, ring, ...ghosts);
  const baseI = new Map([core, glow, rays, streak, ring, ...ghosts].map((m) => [m, m.material.uniforms.uI.value]));

  let dirLight = null;
  if (light) {
    dirLight = new THREE.DirectionalLight(0xfff1dd, 3);
    dirLight.position.copy(shared.uSunDir.value).multiplyScalar(100);
  }

  let occ = earth;
  const tmp = new THREE.Vector3();
  const syncOcc = () => {
    if (occ && occ.surface) {
      occ.surface.getWorldPosition(shared.uOccC.value);
      occ.surface.getWorldScale(tmp);
      const R = occ.radius * tmp.x;
      shared.uOccR.value = R * 1.0015;
      shared.uHr.value = occ.shellUniforms.uHr.value;
      shared.uBetaR.value.copy(occ.shellUniforms.uBetaE.value);
    } else {
      shared.uOccR.value = 0;
    }
  };
  core.onBeforeRender = syncOcc;

  const api = {
    group,
    light: dirLight,
    parts,
    params,
    setDirection(dir) {
      shared.uSunDir.value.copy(dir).normalize();
      if (dirLight) dirLight.position.copy(shared.uSunDir.value).multiplyScalar(100);
    },
    setOccluder(e) { occ = e; },
    setIntensity(k) { intensity = k; },
    update(t /* , camera, renderer */) {
      shared.uTime.value = t;
      const k = intensity;
      core.material.uniforms.uI.value = baseI.get(core) * k * params.core;
      glow.material.uniforms.uI.value = baseI.get(glow) * k * params.glow;
      rays.material.uniforms.uI.value = baseI.get(rays) * k * params.rays;
      rays.material.uniforms.uRot.value = t * 0.035;
      streak.material.uniforms.uI.value = baseI.get(streak) * k * params.streak;
      ring.material.uniforms.uI.value = baseI.get(ring) * k * params.ring;
      for (const gh of ghosts) gh.material.uniforms.uI.value = baseI.get(gh) * k * params.ghosts;
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------------------------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Place `camera` above (lat, lon) on `earth`. See header for parameter meanings. */
export function orbitCamera(camera, earth, { lat = 0, lon = 0, altitude = 2.5, heading = 0, pitch = 0, roll = 0 } = {}) {
  earth.group.updateMatrixWorld(true);
  const C = earth.surface.getWorldPosition(_v4);
  const s = earth.surface.getWorldScale(_v3).x;
  const R = earth.radius * s;
  const up = earth.dirFromLatLon(lat, lon, _v1.clone());
  const axis = _v2.set(0, 1, 0).transformDirection(earth.surface.matrixWorld);
  const east = new THREE.Vector3().crossVectors(axis, up);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const hd = (heading * Math.PI) / 180;
  const fwdH = north.clone().multiplyScalar(Math.cos(hd)).addScaledVector(east, Math.sin(hd));
  const dip = Math.acos(R / (R + altitude));
  const el = -dip - (pitch * Math.PI) / 180;
  const fwd = fwdH.clone().multiplyScalar(Math.cos(el)).addScaledVector(up, Math.sin(el)).normalize();
  const pos = C.clone().addScaledVector(up, R + altitude);
  camera.position.copy(pos);
  const camUp = up.clone().applyQuaternion(_q.setFromAxisAngle(fwd, (roll * Math.PI) / 180));
  camera.up.copy(camUp);
  camera.lookAt(pos.clone().add(fwd));
  camera.updateMatrixWorld(true);
  return camera;
}

/** World sun direction that puts the sun `elevation` degrees above the Earth limb as seen from `camera`. */
export function sunDirAtLimb(camera, earth, { elevation = 0, azimuth = 0 } = {}) {
  camera.updateMatrixWorld(true);
  earth.group.updateMatrixWorld(true);
  const C = earth.surface.getWorldPosition(new THREE.Vector3());
  const R = earth.radius * earth.surface.getWorldScale(new THREE.Vector3()).x;
  const cp = camera.getWorldPosition(new THREE.Vector3());
  const c = C.sub(cp);
  const d = c.length();
  c.divideScalar(d);
  const angE = Math.asin(Math.min(1, R / d));
  const f = camera.getWorldDirection(new THREE.Vector3());
  let u = f.clone().addScaledVector(c, -f.dot(c));
  if (u.lengthSq() < 1e-6) u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).addScaledVector(c, -c.dot(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)));
  u.normalize();
  if (azimuth) u.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(c, (azimuth * Math.PI) / 180));
  const a = angE + (elevation * Math.PI) / 180;
  return c.multiplyScalar(Math.cos(a)).addScaledVector(u, Math.sin(a)).normalize();
}

/** Internal: build-time bakers (exposed for offline texture inspection tools only). */
export const __bake = { bakeEarth, bakeNebula };
