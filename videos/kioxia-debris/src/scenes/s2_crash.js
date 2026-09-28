// s2_crash — THE DROP (global 9.375 – 16.875, bars 6-9).
// Self-contained (in-scene chip / shards / sparks / candle canyon) so it never depends on libs
// that may still be in flux. Everything is a pure function of t.
import * as THREE from 'three';
import { makeText3D } from '../lib/text3d.js';
import { seg, clamp01, lerp, easeOutCubic, easeOutExpo, easeInOutCubic, easeOutQuart, slam, hit, smoothstep } from '../lib/ease.js';
import { beatPulse } from '../lib/beats.js';
import { rng, fbm1 } from '../lib/rand.js';
import { glowText, panel, brackets, FONTS, COLORS } from '../lib/hudkit.js';

const T_DROP = 9.375, T_KYU = 10.3125, T_EXP = 11.25, T_CUT = 13.125, T_TAKA = 15.0, T_HALF = 15.9375, T_END = 16.875;
const TEXT_D = 10; // camera-space distance of the slam-text plane

// ---------------------------------------------------------------- helpers
function makeSparks(n, seed, o = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const col = new THREE.Color(o.color ?? 0xff5a3a).multiplyScalar(o.hdr ?? 5);
  const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  const r = rng(seed);
  const items = [];
  const bias = o.bias ? o.bias.clone() : null;
  const life = o.life ?? 0.9;
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const d = new THREE.Vector3(s * Math.cos(th), u, s * Math.sin(th));
    if (o.flat) d.z *= o.flat;
    if (bias) d.add(bias).normalize();
    const sp = (o.speed ?? 8) * (0.3 + r() * 0.95);
    items.push({ v: d.multiplyScalar(sp), life: life * (0.45 + r() * 0.75), w: (o.width ?? 0.03) * (0.6 + r() * 0.9),
      p0: new THREE.Vector3((r() - 0.5) * (o.spread ?? 0), (r() - 0.5) * (o.spread ?? 0) * 0.4, (r() - 0.5) * (o.spread ?? 0) * 0.3) });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1), dir = new THREE.Vector3();
  const g = o.gravity ?? -7, k = o.drag ?? 2.2;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function update(dt) {
    if (dt < 0 || dt > life * 1.25) { mesh.visible = false; return; }
    mesh.visible = true;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const a = dt / it.life;
      if (a >= 1) { mesh.setMatrixAt(i, zero); continue; }
      const f = (1 - Math.exp(-k * dt)) / k;
      p.copy(it.v).multiplyScalar(f).add(it.p0);
      p.y += 0.5 * g * dt * dt;
      dir.copy(it.v).multiplyScalar(Math.exp(-k * dt));
      dir.y += g * dt;
      const spd = dir.length() + 1e-4;
      dir.multiplyScalar(1 / spd);
      q.setFromUnitVectors(zAxis, dir);
      const fade = 1 - a;
      sc.set(it.w * fade, it.w * fade, Math.max(0.04, spd * 0.05) * fade);
      m4.compose(p, q, sc);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, update };
}

function makeShock(color, hdr = 4, thick = 0.08) {
  const grp = new THREE.Group();
  const c = new THREE.Color(color).multiplyScalar(hdr);
  const m1 = new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const m2 = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.08), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const r1 = new THREE.Mesh(new THREE.RingGeometry(1 - thick, 1, 96), m1);
  const r2 = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.0, 96), m2);
  r1.frustumCulled = false; r2.frustumCulled = false;
  grp.add(r1, r2);
  function update(dt, R = 8, dur = 0.7) {
    if (dt < 0 || dt > dur) { grp.visible = false; return; }
    grp.visible = true;
    const a = dt / dur;
    const s = lerp(0.2, R, easeOutExpo(a));
    r1.scale.setScalar(s);
    r2.scale.setScalar(s * 0.96);
    m1.opacity = Math.pow(1 - a, 1.6);
    m2.opacity = Math.pow(1 - a, 2.2);
  }
  return { group: grp, update };
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function nandTexture() {
  // emissive detail for the exposed NAND layers: cell grid + word lines
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 512);
  const r = rng(77);
  for (let i = 0; i < 512; i += 16) {
    g.fillStyle = `rgba(255,40,70,${0.18 + r() * 0.25})`;
    g.fillRect(0, i, 512, 2);
  }
  for (let bx = 0; bx < 4; bx++) for (let by = 0; by < 4; by++) {
    g.strokeStyle = 'rgba(255,90,110,0.9)';
    g.lineWidth = 3;
    g.strokeRect(bx * 128 + 10, by * 128 + 10, 108, 108);
    for (let k = 0; k < 10; k++) {
      g.fillStyle = `rgba(255,${60 + (r() * 80) | 0},90,${0.3 + r() * 0.5})`;
      g.fillRect(bx * 128 + 16 + r() * 90, by * 128 + 16 + r() * 90, 4 + r() * 20, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- scene
export default {
  async create(ctx) {
    const { assets, envMap, renderer } = ctx;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x12020a, 0.002);
    const camera = new THREE.PerspectiveCamera(40, ctx.aspect, 0.1, 900);
    scene.add(camera);

    // ---------- lights (constant set: never toggled -> no shader recompiles)
    const hemi = new THREE.HemisphereLight(0x6677aa, 0x220004, 0.5);
    scene.add(hemi);
    const keyW = new THREE.DirectionalLight(0xffe6e0, 2.2);
    keyW.position.set(-6, 10, 8);
    scene.add(keyW);
    const rimW = new THREE.DirectionalLight(0xff3050, 3.0);
    rimW.position.set(6, 4, -10);
    scene.add(rimW);
    const core = new THREE.PointLight(0xff2040, 0, 30, 2);
    core.position.set(0, 1.2, 0);
    scene.add(core);
    // camera-attached text lights
    const tKey = new THREE.DirectionalLight(0xffffff, 1.4);
    tKey.position.set(-5, 6, 4);
    const tKeyT = new THREE.Object3D(); tKeyT.position.set(0, 0, -TEXT_D);
    tKey.target = tKeyT;
    const tRim = new THREE.DirectionalLight(0xff4060, 4.0);
    tRim.position.set(6, 3, -22);
    const tRimT = new THREE.Object3D(); tRimT.position.set(0, 0, -TEXT_D);
    tRim.target = tRimT;
    camera.add(tKey, tKeyT, tRim, tRimT);

    // ---------- stars + backdrop glow
    const starGeo = new THREE.BufferGeometry();
    {
      const r = rng(5);
      const pos = [];
      for (let i = 0; i < 1600; i++) {
        const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), R = 300 + r() * 100;
        pos.push(s * Math.cos(th) * R, u * R, s * Math.sin(th) * R);
      }
      starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    }
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffd8dc, size: 1.6, sizeAttenuation: false, fog: false }));
    scene.add(stars);

    const glowTex = radialTexture([[0, 'rgba(120,8,22,1)'], [0.35, 'rgba(60,3,12,1)'], [0.7, 'rgba(14,1,4,1)'], [1, 'rgba(0,0,0,1)']]);
    const backGlow = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshBasicMaterial({ map: glowTex, fog: false, depthWrite: false }));
    backGlow.renderOrder = -5;
    scene.add(backGlow);

    // =============================================================== SHOT A: CHIP
    const chipShot = new THREE.Group();
    scene.add(chipShot);
    const chip = new THREE.Group();
    chipShot.add(chip);

    const substrate = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.16, 4.8),
      new THREE.MeshStandardMaterial({ color: 0x0b1410, metalness: 0.5, roughness: 0.45, envMap, envMapIntensity: 0.7 }));
    substrate.position.y = 0.08;
    chip.add(substrate);
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc85a, metalness: 1, roughness: 0.22, envMap, envMapIntensity: 1.6, emissive: 0x3a2000, emissiveIntensity: 0.4 });
    const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.06, 0.5), goldMat, 64);
    {
      const m = new THREE.Matrix4();
      let k = 0;
      for (let side = 0; side < 4; side++) for (let i = 0; i < 16; i++) {
        const a = -2.1 + i * 0.28;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side * Math.PI / 2);
        const p = new THREE.Vector3(a, 0.1, 2.55).applyQuaternion(q);
        m.compose(p, q, new THREE.Vector3(1, 1, 1));
        pins.setMatrixAt(k++, m);
      }
    }
    chip.add(pins);

    const nandTex = nandTexture();
    const layerSide = new THREE.MeshStandardMaterial({ color: 0x220005, emissive: 0xff2040, emissiveIntensity: 2.4, roughness: 0.5 });
    const layerTop = new THREE.MeshStandardMaterial({ color: 0x1a1c26, metalness: 0.9, roughness: 0.3, envMap, envMapIntensity: 1.3,
      emissive: 0xffffff, emissiveMap: nandTex, emissiveIntensity: 1.6 });
    const LAYERS = 8, LH = 0.1;
    const layers = [];
    const layerGeo = new THREE.BoxGeometry(3.7, LH, 3.7);
    for (let i = 0; i < LAYERS; i++) {
      const l = new THREE.Mesh(layerGeo, [layerSide, layerSide, layerTop, layerTop, layerSide, layerSide]);
      l.userData.y0 = 0.16 + LH / 2 + i * LH;
      l.position.y = l.userData.y0;
      chip.add(l);
      layers.push(l);
    }
    // lid: black glossy top, gold rim
    const lid = new THREE.Group();
    const lidTop = new THREE.MeshStandardMaterial({ color: 0x07070a, metalness: 0.7, roughness: 0.16, envMap, envMapIntensity: 1.3 });
    const lidBox = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.26, 4.2), [goldMat, goldMat, lidTop, lidTop, goldMat, goldMat]);
    lid.add(lidBox);
    const lidY0 = 0.16 + LAYERS * LH + 0.13;
    lid.position.y = lidY0;
    chip.add(lid);
    const label = makeText3D(assets.fonts.orbitron, '285A', { size: 0.62, depth: 0.05, bevel: 0.01, curveSegments: 4, material: goldMat });
    label.group.rotation.x = -Math.PI / 2;
    label.group.position.set(0.95, 0.15, 1.35);
    lid.add(label.group);
    // cracks on lid top (children of the lid so they fly with it)
    const crackMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.12, 0.2).multiplyScalar(7) });
    const crackGeo = new THREE.BoxGeometry(1, 0.03, 1);
    const cracks = [];
    {
      const r = rng(31);
      const branches = 7;
      for (let b = 0; b < branches; b++) {
        let x = (r() - 0.5) * 0.3, z = (r() - 0.5) * 0.3;
        let ang = (b / branches) * Math.PI * 2 + r() * 0.6;
        const nSeg = 5 + Math.floor(r() * 3);
        for (let j = 0; j < nSeg; j++) {
          ang += (r() - 0.5) * 1.1;
          const L = 0.22 + r() * 0.3;
          const dx = Math.cos(ang), dz = Math.sin(ang);
          const nx = x + dx * L, nz = z + dz * L;
          if (Math.abs(nx) > 2.0 || Math.abs(nz) > 2.0) break;
          const m = new THREE.Mesh(crackGeo, crackMat);
          m.userData = { x, z, dx, dz, L, w: 0.07 * (1 - j / (nSeg + 1)) + 0.02, order: j / nSeg };
          m.rotation.y = -ang;
          m.visible = false;
          lid.add(m);
          cracks.push(m);
          x = nx; z = nz;
        }
      }
    }

    // shards (dark silicon + hot glowing)
    const shardGeo = new THREE.TetrahedronGeometry(1, 0);
    const shardDark = new THREE.MeshStandardMaterial({ color: 0x15161c, metalness: 0.9, roughness: 0.25, envMap, envMapIntensity: 1.4, emissive: 0x400008, flatShading: true });
    const shardHot = new THREE.MeshStandardMaterial({ color: 0x220004, emissive: 0xff3050, emissiveIntensity: 4, flatShading: true });
    const NS_D = 150, NS_H = 70;
    const shardsD = new THREE.InstancedMesh(shardGeo, shardDark, NS_D);
    const shardsH = new THREE.InstancedMesh(shardGeo, shardHot, NS_H);
    shardsD.frustumCulled = false; shardsH.frustumCulled = false;
    chipShot.add(shardsD, shardsH);

    // chip-shot camera path (function so shard bias can use the camera at the blast)
    function chipCam(t, out, look) {
      const lt = t - T_DROP;
      const pre = clamp01(lt / (T_EXP - T_DROP));
      const pb = easeOutCubic(seg(t, T_EXP, T_CUT));
      const ang = lerp(0.18 + pre * 0.16, 1.05, pb) + (t - T_EXP > 0 ? (t - T_EXP) * 0.06 : 0);
      const rad = lerp(9.6 - pre * 1.4, 15.5, pb);
      const h = lerp(5.2 - pre * 0.6, 6.4, pb);
      out.set(Math.sin(ang) * rad, h, Math.cos(ang) * rad);
      look.set(0, lerp(2.4, 2.8, pb), 0);
    }
    const camA = new THREE.Vector3(), lookA = new THREE.Vector3();
    chipCam(T_EXP, camA, lookA);
    const blastBias = camA.clone().sub(new THREE.Vector3(0, 1, 0)).normalize();
    function shardData(n, seed, speedMul) {
      const r = rng(seed);
      const arr = [];
      for (let i = 0; i < n; i++) {
        const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const d = new THREE.Vector3(s * Math.cos(th), Math.abs(u) * 0.8 + 0.2, s * Math.sin(th));
        d.addScaledVector(blastBias, r() < 0.55 ? 1.6 : 0.2).normalize();
        arr.push({
          p0: new THREE.Vector3((r() - 0.5) * 3.4, 0.4 + r() * 1.0, (r() - 0.5) * 3.4),
          v: d.multiplyScalar((5 + r() * 14) * speedMul),
          axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
          spin: 3 + r() * 10, s: 0.05 + Math.pow(r(), 2) * 0.32, a0: r() * 6,
        });
      }
      return arr;
    }
    const sdD = shardData(NS_D, 101, 1.0), sdH = shardData(NS_H, 202, 1.2);
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
    const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
    function updShards(mesh, data, dt) {
      if (dt < 0) { mesh.visible = false; return; }
      mesh.visible = true;
      const k = 0.9;
      const f = (1 - Math.exp(-k * dt)) / k;
      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        _p.copy(d.v).multiplyScalar(f).add(d.p0);
        _p.y -= 0.9 * dt * dt;
        _q.setFromAxisAngle(d.axis, d.a0 + d.spin * dt);
        const grow = Math.min(1, dt * 12);
        _s.setScalar(d.s * grow);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    const chipSparks = makeSparks(140, 9, { color: 0xff6040, hdr: 6, speed: 9, life: 1.0, width: 0.035, gravity: -6 });
    chipSparks.mesh.position.set(0, 1.2, 0);
    chipShot.add(chipSparks.mesh);
    const blastSparks = makeSparks(160, 19, { color: 0xffa070, hdr: 4, speed: 16, life: 1.2, width: 0.05, gravity: -4, bias: blastBias.clone().multiplyScalar(0.6) });
    blastSparks.mesh.position.set(0, 1.4, 0);
    chipShot.add(blastSparks.mesh);
    const blastShock = makeShock(0xff3a50, 5, 0.05);
    blastShock.group.rotation.x = -Math.PI / 2;
    blastShock.group.position.y = 1.2;
    chipShot.add(blastShock.group);

    // =============================================================== SHOT B: CANDLE CANYON
    const canyon = new THREE.Group();
    scene.add(canyon);
    const L = 150, YS = 60;
    const price = (u) => {
      const uu = Math.max(0, u);
      return 1 - 0.5 * Math.pow(Math.min(uu, 1.3), 1.15) + 0.035 * Math.sin(u * 29 + 1.3) + 0.018 * Math.sin(u * 83 + 0.4);
    };
    const P = (u, out = new THREE.Vector3()) => out.set(2.2 * Math.sin(u * 4.5), YS * price(u), -L * u);

    // price line (opaque HDR tube -> bloom)
    const curvePts = [];
    for (let i = 0; i <= 260; i++) curvePts.push(P(-0.1 + (i / 260) * 1.5));
    const curve = new THREE.CatmullRomCurve3(curvePts);
    const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.16).multiplyScalar(9), fog: false });
    const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 700, 0.13, 6, false), lineMat);
    canyon.add(line);

    const candleMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xff1030, emissiveIntensity: 0.2 });
    const wickMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.15, 0.2).multiplyScalar(3) });
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const candles = [], wicks = [];
    {
      const r = rng(404);
      // chart candles flanking the line
      const N = 90;
      for (let i = 0; i < N; i++) {
        const u0 = -0.1 + (i / N) * 1.45, du = 1.45 / N;
        const o = YS * price(u0), c = YS * price(u0 + du);
        const top = Math.max(o, c), bot = Math.min(o, c);
        for (const side of [-1, 1]) {
          const pc = P(u0 + du / 2);
          const x = pc.x + side * 2.3;
          const hBody = Math.max(0.4, top - bot);
          candles.push({ x, y: (top + bot) / 2, z: pc.z, sx: 1.1, sy: hBody, sz: L * du * 0.62, c: c < o ? 1 : 0.35 });
          wicks.push({ x, y: (top + bot) / 2, z: pc.z, sy: hBody + 1 + r() * 3.5 });
        }
      }
      // canyon walls: giant candles
      for (const side of [-1, 1]) for (let row = 0; row < 2; row++) {
        const n = 42;
        for (let i = 0; i < n; i++) {
          const u = -0.12 + (i / n) * 1.5 + r() * 0.012;
          const pc = P(u);
          const x = pc.x + side * (7.5 + row * 5.5 + r() * 2.5);
          const top = pc.y + 4 + r() * 22 + row * 6;
          const H = 14 + r() * 40;
          const w = 2.2 + r() * 1.6;
          candles.push({ x, y: top - H / 2, z: pc.z + (r() - 0.5) * 1.5, sx: w, sy: H, sz: w, c: 0.35 + r() * 0.75 });
          wicks.push({ x, y: top - H / 2, z: pc.z, sy: H + 4 + r() * 10, w: 0.18 });
        }
      }
    }
    const candleIM = new THREE.InstancedMesh(boxGeo, candleMat, candles.length);
    const wickIM = new THREE.InstancedMesh(boxGeo, wickMat, wicks.length);
    {
      const m = new THREE.Matrix4(), col = new THREE.Color();
      candles.forEach((c, i) => {
        m.makeScale(c.sx, c.sy, c.sz).setPosition(c.x, c.y, c.z);
        candleIM.setMatrixAt(i, m);
        col.setRGB(0.4 * c.c, 0.03 * c.c, 0.05 * c.c);
        candleIM.setColorAt(i, col);
      });
      wicks.forEach((w, i) => {
        m.makeScale(w.w ?? 0.1, w.sy, w.w ?? 0.1).setPosition(w.x, w.y, w.z);
        wickIM.setMatrixAt(i, m);
      });
    }
    candleIM.frustumCulled = false; wickIM.frustumCulled = false;
    canyon.add(candleIM, wickIM);
    const grid = new THREE.GridHelper(600, 120, 0xff2a44, 0x4a0812);
    grid.position.set(0, YS * price(1.3) - 30, -L * 0.6);
    canyon.add(grid);
    const endGlow = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(150,20,35,1)'], [0.3, 'rgba(50,4,10,0.7)'], [1, 'rgba(0,0,0,0)']]),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    endGlow.position.copy(P(1.6)).add(new THREE.Vector3(0, -10, -40));
    canyon.add(endGlow);

    // speed lines (camera space)
    const NSL = 110;
    const slMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.35, 0.4).multiplyScalar(2.5), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const speedLines = new THREE.InstancedMesh(boxGeo, slMat, NSL);
    speedLines.frustumCulled = false;
    const slData = [];
    {
      const r = rng(88);
      for (let i = 0; i < NSL; i++) {
        const a = r() * Math.PI * 2, rad = 2.2 + Math.pow(r(), 0.6) * 9;
        slData.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.62, off: r(), len: 2 + r() * 6, w: 0.015 + r() * 0.03 });
      }
    }
    camera.add(speedLines);

    // =============================================================== 3D SLAM TEXT (camera space)
    const textRig = new THREE.Group();
    textRig.position.z = -TEXT_D;
    camera.add(textRig);
    // depth-clear helper so the slam text always sits on top of the world
    const clearer = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    clearer.position.z = -1;
    clearer.frustumCulled = false;
    clearer.renderOrder = 9;
    clearer.onBeforeRender = (r) => r.clearDepth();
    camera.add(clearer);

    const redChrome = new THREE.MeshStandardMaterial({ color: 0xff1a30, metalness: 0.92, roughness: 0.26, envMap, envMapIntensity: 0.6,
      emissive: 0xff1030, emissiveIntensity: 0.12 });
    const redChromeHot = new THREE.MeshStandardMaterial({ color: 0xff2a40, metalness: 0.92, roughness: 0.2, envMap, envMapIntensity: 1.3,
      emissive: 0xff1a3a, emissiveIntensity: 0.2 });
    const redEdge = new THREE.MeshStandardMaterial({ color: 0x330008, emissive: 0xff2040, emissiveIntensity: 2.6, metalness: 0.3, roughness: 0.4 });
    const hotEdge = new THREE.MeshStandardMaterial({ color: 0x552222, emissive: 0xffa090, emissiveIntensity: 1, metalness: 0, roughness: 0.4 });
    const pulseMats = [redEdge, hotEdge];

    const dela = assets.fonts.dela;
    function mkText(str, size, mats, maxW, depth) {
      const t = makeText3D(dela, str, { size, depth: depth ?? size * 0.28, bevel: size * 0.03, curveSegments: 5, materials: mats });
      const holder = new THREE.Group();
      holder.add(t.group);
      t.group.traverse((o) => { if (o.isMesh) o.renderOrder = 10; });
      const fit = Math.min(1, maxW / Math.max(0.001, t.width));
      holder.userData.fit = fit;
      holder.visible = false;
      textRig.add(holder);
      // deterministic shatter vectors per glyph
      const r = rng(str.length * 97 + Math.round(size * 13));
      t.glyphs.forEach((g, i) => {
        const cx = t.glyphs.length > 1 ? (i / (t.glyphs.length - 1)) * 2 - 1 : 0;
        g.v = new THREE.Vector3(cx * (4 + r() * 5) + (r() - 0.5) * 3, (r() - 0.3) * 7, 3 + r() * 7);
        g.axis = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
        g.spin = (r() < 0.5 ? -1 : 1) * (5 + r() * 9);
        g.ph = r() * 6;
      });
      return { t, holder };
    }
    const T1 = mkText('キオクシア', 1.4, [redChrome, redEdge], 9.2);
    const T2 = mkText('急落', 3.1, [redChromeHot, hotEdge], 9.0, 0.95);
    const T3 = mkText('高値から', 1.3, [redChrome, redEdge], 8.0);
    const T4 = mkText('−50%', 3.3, [redChromeHot, hotEdge], 10.6, 1.0);

    // camera-space slam fx
    const slamFx = [];
    for (const [i, tt, y, col] of [[0, T_DROP, 1.2, 0xff4a4a], [1, T_KYU, -0.1, 0xffa080], [2, T_TAKA, 2.3, 0xff4a5a], [3, T_HALF, -0.5, 0xffb090]]) {
      const sp = makeSparks(i % 2 ? 130 : 90, 500 + i, { color: col, hdr: 6, speed: i % 2 ? 14 : 10, life: 0.8, width: 0.035, gravity: -5, flat: 0.4, spread: 3 });
      sp.mesh.position.set(0, y, -0.8);
      const sh = makeShock(i % 2 ? 0xffd0c0 : 0xff3a50, i % 2 ? 4 : 3, i % 2 ? 0.035 : 0.05);
      sh.group.position.set(0, y, -1.5);
      textRig.add(sp.mesh, sh.group);
      slamFx.push({ t0: tt, sp, sh, big: i % 2 === 1 });
    }

    function wobble(T, t) {
      T.t.glyphs.forEach((g, i) => {
        g.mesh.position.copy(g.home);
        g.mesh.rotation.set(Math.sin(t * 1.7 + g.ph) * 0.06, Math.sin(t * 2.1 + i) * 0.12, 0);
        g.mesh.scale.setScalar(1);
      });
    }
    function shatter(T, dt) {
      T.t.glyphs.forEach((g) => {
        g.mesh.position.copy(g.home).addScaledVector(g.v, dt * (1 - dt * 0.2));
        g.mesh.position.y -= 3 * dt * dt;
        g.mesh.quaternion.setFromAxisAngle(g.axis, g.spin * dt);
        g.mesh.scale.setScalar(Math.max(0, 1 - dt * 1.1));
      });
    }

    const tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3();

    return {
      scene,
      camera,
      update(t, lt, fx) {
        const bp = beatPulse(t);
        const inChip = t < T_CUT;
        chipShot.visible = inChip;
        stars.visible = inChip;
        backGlow.visible = inChip;
        canyon.visible = !inChip;
        speedLines.visible = !inChip;
        camera.fov = 40;
        camera.updateProjectionMatrix();

        // ---------------- texts
        [T1, T2, T3, T4].forEach((T) => { T.holder.visible = false; });
        if (inChip) {
          // キオクシア
          if (t >= T_DROP && t < T_EXP + 0.95) {
            const m = easeOutCubic(seg(t, T_KYU - 0.16, T_KYU + 0.04));
            T1.holder.visible = true;
            T1.holder.position.set(0, lerp(1.25, 2.62, m), 0);
            T1.holder.scale.setScalar(slam(t, T_DROP, 0.18, 3.0) * T1.holder.userData.fit * lerp(1, 0.6, m));
            if (t < T_EXP) wobble(T1, t); else shatter(T1, t - T_EXP);
          }
          if (t >= T_KYU && t < T_EXP + 0.95) {
            T2.holder.visible = true;
            T2.holder.position.set(0, -0.15, 0);
            const pump = 1 + 0.03 * bp;
            T2.holder.scale.setScalar(slam(t, T_KYU, 0.2, 2.6) * T2.holder.userData.fit * pump);
            if (t < T_EXP) wobble(T2, t); else shatter(T2, t - T_EXP);
          }
        } else {
          if (t >= T_TAKA) {
            T3.holder.visible = true;
            T3.holder.position.set(0, 2.35, 0);
            T3.holder.scale.setScalar(slam(t, T_TAKA, 0.18, 3.0) * T3.holder.userData.fit);
            wobble(T3, t);
          }
          if (t >= T_HALF) {
            T4.holder.visible = true;
            T4.holder.position.set(0, -0.55, 0);
            T4.holder.scale.setScalar(slam(t, T_HALF, 0.2, 3.2) * T4.holder.userData.fit * (1 + 0.025 * bp));
            wobble(T4, t);
          }
        }
        for (const s of slamFx) {
          s.sp.update(t - s.t0);
          s.sh.update(t - s.t0, s.big ? 11 : 7, s.big ? 0.75 : 0.6);
        }
        redEdge.emissiveIntensity = 0.75 + bp * 0.5;
        hotEdge.emissiveIntensity = 0.6 + bp * 0.4;
        // text shake follows camera shake a bit
        const tsh = 0.12 * (hit(t, T_DROP, 4) + hit(t, T_KYU, 6) + hit(t, T_TAKA, 7) + 1.6 * hit(t, T_HALF, 5));
        textRig.position.set(fbm1(t * 20, 71) * tsh, fbm1(t * 20, 83) * tsh, -TEXT_D);

        if (inChip) {
          // ---------------- SHOT A
          scene.fog.density = 0.002;
          scene.fog.color.setHex(0x12020a);
          chipCam(t, camera.position, tmpL);
          camera.lookAt(tmpL);
          camera.rotateZ(0.05 * Math.sin(t * 0.9) - 0.04);
          backGlow.position.copy(camera.position).multiplyScalar(-1).setLength(170);
          backGlow.lookAt(camera.position);

          const crack = 0.7 * easeOutCubic(seg(t, T_DROP, T_DROP + 0.3)) + 0.3 * easeOutCubic(seg(t, T_KYU, T_KYU + 0.3));
          for (const c of cracks) {
            const d = c.userData;
            const part = clamp01(crack * 1.35 - d.order * 0.9) ;
            c.visible = part > 0.001;
            if (!c.visible) continue;
            const len = d.L * part;
            c.scale.set(len, 1, d.w * (0.7 + 0.5 * bp));
            c.position.set(d.x + d.dx * len / 2, 0.14, d.z + d.dz * len / 2);
          }
          crackMat.color.setRGB(1, 0.12, 0.2).multiplyScalar(5 + bp * 5 + 6 * hit(t, T_DROP, 3));

          const e = easeOutQuart(seg(t, T_EXP, T_EXP + 1.3));
          const ex = t >= T_EXP ? t - T_EXP : 0;
          layers.forEach((l, i) => {
            l.position.y = l.userData.y0 + e * (0.35 + i * 0.42) + (i - 3.5) * 0.02 * Math.sin(ex * 2 + i);
            l.rotation.y = e * (i - 3.5) * 0.045 + ex * 0.02;
            l.rotation.z = e * Math.sin(i * 1.7) * 0.03;
            l.position.x = e * Math.sin(i * 2.3) * 0.15;
          });
          layerTop.emissiveIntensity = 0.6 + e * 2.2 + bp * 0.8;
          lid.position.set(e * -1.2 + ex * 0.2, lidY0 + e * 5.2 + ex * 0.5, e * 2.4);
          lid.rotation.set(-e * 1.1 - ex * 0.3, e * 0.4, e * 0.6 + ex * 0.2);
          chip.rotation.y = 0.12 + (t - T_DROP) * 0.03;
          chip.position.y = -0.1 * hit(t, T_DROP, 5);
          core.intensity = 40 * hit(t, T_DROP, 3) + (t >= T_EXP ? 60 * hit(t, T_EXP, 4) + 45 * e : 0) + 25 * bp;
          keyW.intensity = 2.2; hemi.intensity = 0.5;
          rimW.intensity = 3 + 3 * bp;

          updShards(shardsD, sdD, t - T_EXP);
          updShards(shardsH, sdH, t - T_EXP);
          chipSparks.update(t - T_DROP);
          blastSparks.update(t - T_EXP);
          blastShock.update(t - T_EXP, 16, 0.9);

          // fx
          const hD = hit(t, T_DROP, 4.5), hK = hit(t, T_KYU, 7), hE = hit(t, T_EXP, 5);
          fx.flash = 0.9 * hit(t, T_DROP, 5) + 0.5 * hit(t, T_KYU, 12) + 0.7 * hit(t, T_EXP, 11);
          fx.flashColor = t >= T_EXP ? [1, 0.55, 0.4] : [1, 0.08, 0.14];
          fx.shake = 0.03 + 0.55 * hD + 0.3 * hK + 0.6 * hE;
          fx.shakeRot = 0.035 * hD + 0.02 * hK + 0.04 * hE;
          fx.chroma = 3 + 30 * hD + 18 * hK + 26 * hE;
          fx.radialBlur = 0.35 * hD + 0.3 * hK + 0.5 * hE;
          fx.glitch = 0.5 * hit(t, T_DROP, 18) + 0.25 * hit(t, T_EXP, 20);
          fx.bloom = 0.42 + bp * 0.22 + 0.12 * hE;
          fx.bloomThreshold = 0.95;
          fx.bloomRadius = 0.45;
          fx.tint = [1.08, 0.9, 0.92];
          fx.contrast = 1.12;
          fx.vignette = 0.55;
        } else {
          // ---------------- SHOT B: canyon dive
          const u = easeInOutCubic(seg(t, T_CUT, T_END));
          scene.fog.density = 0.017;
          const dim = 1 - 0.7 * smoothstep(T_TAKA - 0.1, T_TAKA + 0.25, t);
          candleMat.color.setRGB(dim, dim, dim);
          keyW.intensity = 0.8 * dim; hemi.intensity = 0.15; rimW.intensity = 1.6 * dim;
          scene.fog.color.setHex(0x060003);
          P(u, tmpV);
          camera.position.set(tmpV.x, tmpV.y + 3.6 + 1.5 * (1 - u), tmpV.z + 4.5);
          P(u + 0.075, tmpL);
          camera.lookAt(tmpL.x, tmpL.y + 0.4, tmpL.z);
          camera.rotateZ(0.09 * Math.sin((t - T_CUT) * 1.4) + 0.04);
          camera.fov = 42 + 6 * Math.sin(Math.PI * u) + 3 * hit(t, T_HALF, 5);
          camera.updateProjectionMatrix();
          // speed lines
          const m = new THREE.Matrix4();
          const travel = u * L * 1.4 + (t - T_CUT) * 12;
          slData.forEach((d, i) => {
            const z = -70 + ((travel + d.off * 72) % 72);
            m.makeScale(d.w, d.w, d.len).setPosition(d.x, d.y, z);
            speedLines.setMatrixAt(i, m);
          });
          speedLines.instanceMatrix.needsUpdate = true;
          const vel = Math.sin(Math.PI * u);
          slMat.opacity = 0.25 + 0.65 * vel;
          lineMat.color.setRGB(1, 0.1, 0.16).multiplyScalar((5 + 4 * bp) * dim);
          candleMat.emissiveIntensity = (0.05 + 0.08 * bp) * dim;
          core.intensity = 0;

          const hC = hit(t, T_CUT, 6), h3 = hit(t, T_TAKA, 6), h4 = hit(t, T_HALF, 4);
          fx.flash = 0.35 * hC + 0.45 * hit(t, T_TAKA, 12) + 0.85 * hit(t, T_HALF, 10);
          fx.flashColor = t >= T_HALF ? [1, 0.25, 0.28] : [1, 0.1, 0.15];
          fx.shake = 0.04 + 0.1 * vel + 0.2 * hC + 0.25 * h3 + 0.55 * h4;
          fx.shakeRot = 0.01 + 0.02 * h3 + 0.045 * h4;
          fx.chroma = 4 + 6 * vel + 12 * hC + 16 * h3 + 32 * h4;
          fx.radialBlur = 0.04 + 0.1 * vel + 0.3 * hC + 0.25 * h3 + 0.65 * h4;
          fx.glitch = 0.35 * hit(t, T_CUT, 20) + 0.3 * hit(t, T_HALF, 16);
          fx.bloom = 0.38 + bp * 0.2 + 0.3 * h4;
          fx.bloomThreshold = 1.0;
          fx.bloomRadius = 0.45;
          fx.tint = [1.08, 0.9, 0.92];
          fx.contrast = 1.12;
          fx.vignette = 0.62;
          fx.contrast = 1.2;
          fx.tint = [1.04, 0.88, 0.9];
        }
      },

      hud(g, t, lt, fx) {
        if (t < T_CUT) {
          if (t < T_DROP + 0.25) return;
          const a = clamp01((t - T_DROP - 0.25) / 0.2);
          const x = 80, y = 830, w = 470, h = 170;
          panel(g, x, y, w, h, { stroke: COLORS.red, fill: 'rgba(30,0,6,0.55)', alpha: a });
          glowText(g, '285A', x + 26, y + 46, { font: FONTS.orb(46), color: COLORS.red, alpha: a });
          glowText(g, '▼', x + 180, y + 46, { font: FONTS.noto(40), color: COLORS.redHot, alpha: a * (0.6 + 0.4 * ((t * 4) % 1 < 0.5 ? 1 : 0.4)) });
          glowText(g, 'キオクシア', x + 236, y + 48, { font: FONTS.noto(28), color: COLORS.white, alpha: a * 0.85, glow: false });
          // falling sparkline
          const r = rng(12);
          const N = 44;
          const reveal = clamp01((t - T_DROP - 0.2) / 2.6);
          const nShow = Math.max(2, Math.floor(N * reveal));
          g.save();
          g.globalAlpha = a;
          g.beginPath();
          for (let i = 0; i < nShow; i++) {
            const u = i / (N - 1);
            const v = (u < 0.15 ? 0.1 - u * 0.2 : 0.07 + Math.pow((u - 0.15) / 0.85, 0.8) * 0.9) + (r() - 0.5) * 0.08;
            const px = x + 26 + u * (w - 52), py = y + 82 + clamp01(v) * 70;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.strokeStyle = COLORS.red;
          g.lineWidth = 3;
          g.shadowColor = COLORS.red;
          g.shadowBlur = 12;
          g.stroke();
          g.restore();
          if (t >= T_EXP) {
            const b = clamp01((t - T_EXP) / 0.15);
            glowText(g, 'SELL-OFF', x + w - 10, y - 22, { font: FONTS.orb(22), color: COLORS.redHot, align: 'right', alpha: b * (0.5 + 0.5 * ((t * 6) % 1 < 0.5 ? 1 : 0)) });
          }
        } else {
          const a = clamp01((t - T_CUT - 0.3) / 0.25);
          if (a <= 0) return;
          // left altitude-style gauge: 高値 -> 半値
          const gx = 110, gy0 = 300, gy1 = 760;
          const u = easeInOutCubic(seg(t, T_CUT, T_END));
          g.save();
          g.globalAlpha = a;
          g.strokeStyle = 'rgba(255,42,68,0.55)';
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(gx, gy0); g.lineTo(gx, gy1); g.stroke();
          for (let i = 0; i <= 10; i++) {
            const yy = lerp(gy0, gy1, i / 10);
            g.beginPath(); g.moveTo(gx, yy); g.lineTo(gx + (i % 5 === 0 ? 22 : 10), yy); g.stroke();
          }
          g.restore();
          glowText(g, '高値', gx + 32, gy0, { font: FONTS.noto(24), color: COLORS.white, alpha: a * 0.8, glow: false });
          glowText(g, '半値', gx + 32, gy1, { font: FONTS.noto(24), color: COLORS.redHot, alpha: a });
          const my = lerp(gy0, gy1, u);
          g.save();
          g.globalAlpha = a;
          g.fillStyle = COLORS.red;
          g.shadowColor = COLORS.red; g.shadowBlur = 14;
          g.beginPath(); g.moveTo(gx - 6, my); g.lineTo(gx - 26, my - 11); g.lineTo(gx - 26, my + 11); g.closePath(); g.fill();
          g.restore();
          // caption
          const cx = 960, cy = 1000;
          g.save();
          g.font = FONTS.noto(32);
          const tw = g.measureText('上場来高値 → 半値').width;
          g.restore();
          brackets(g, cx - tw / 2 - 26, cy - 30, tw + 52, 60, { color: COLORS.red, alpha: a * 0.9, len: 16 });
          glowText(g, '上場来高値 → 半値', cx, cy, { font: FONTS.noto(32), color: COLORS.white, align: 'center', glow: COLORS.red, alpha: a });
        }
      },
    };
  },
};
