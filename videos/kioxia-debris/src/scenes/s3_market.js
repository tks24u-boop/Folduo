// s3_market — global 16.875-24.375 (bars 10-13). The whole market is red; then it gets personal.
// Part A (16.875-20.625): curved red LED stock board, tracking camera, 「日経平均」+ ▼ slam at 18.75.
// Part B (20.625-24.375): MY ACCOUNT — avatar coin on red neon grid, odometer rolls to −83,000,000, locks 22.5.
// All assets built in-scene (self-contained fallbacks) so the scene never depends on libs being ready.
import * as THREE from 'three';
import { makeText3D } from '../lib/text3d.js';
import { seg, clamp01, lerp, easeOutCubic, easeInOutCubic, easeInCubic, slam, hit, smoothstep } from '../lib/ease.js';
import { beatPulse } from '../lib/beats.js';
import { glowText, ticker, FONTS, COLORS, blink } from '../lib/hudkit.js';
import { rng } from '../lib/rand.js';

const S0 = 16.875;
const CUT = 20.625 - S0; // 3.75 local
const SLAM_A = 18.75 - S0; // 1.875
const LOCK = 22.5 - S0; // 5.625
const STAMP = 23.0 - S0; // 6.125

function boardTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#050102'; g.fillRect(0, 0, 2048, 512);
  const names = ['半導体', '電機', '銀行', '商社', '自動車', '精密', '化学', '鉄鋼', '通信', '小売', '不動産', '機械', '海運', '医薬', '建設', '保険'];
  const r = rng(77);
  const cols = 8, rows = 4, cw = 2048 / cols, ch = 512 / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const px = x * cw, py = y * ch;
    g.fillStyle = '#1a0306'; g.fillRect(px + 6, py + 6, cw - 12, ch - 12);
    g.strokeStyle = '#ff2a44'; g.lineWidth = 3; g.strokeRect(px + 8, py + 8, cw - 16, ch - 16);
    g.fillStyle = '#ff3a50';
    g.font = "900 44px 'Noto Sans JP'"; g.textBaseline = 'middle';
    g.fillText(names[(x + y * cols) % names.length], px + 24, py + 42);
    g.font = "900 64px 'Noto Sans JP'";
    g.fillText('▼', px + cw - 86, py + 46);
    // falling mini chart (illustrative, no values)
    g.beginPath();
    let yy = py + 78;
    g.moveTo(px + 20, yy);
    for (let k = 1; k <= 12; k++) { yy += (r() * 7 - 1.5); g.lineTo(px + 20 + k * (cw - 40) / 12, yy); }
    g.lineWidth = 4; g.stroke();
    const bw = (0.4 + r() * 0.55) * (cw - 40);
    g.fillStyle = '#ff2a44'; g.fillRect(px + 20, py + ch - 22, bw, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function digitStripTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 1280;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 1280);
  g.fillStyle = '#fff';
  g.font = "900 104px 'Orbitron'"; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let d = 0; d < 10; d++) g.fillText(String(d), 64, d * 128 + 66);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 0.1);
  return tex;
}

function glyphTexture(str, font) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff'; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(str, 64, 66);
  return new THREE.CanvasTexture(c);
}

export default {
  async create(ctx) {
    const { assets, envMap } = ctx;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030104);
    scene.fog = new THREE.Fog(0x030104, 18, 60);
    const camera = new THREE.PerspectiveCamera(45, ctx.aspect, 0.1, 200);

    const hemi = new THREE.HemisphereLight(0x8899ff, 0x220004, 0.35);
    scene.add(hemi);

    // ---------------- PART A: board ----------------
    const A = new THREE.Group();
    scene.add(A);
    const btex = boardTexture();
    btex.repeat.set(-3, 1);
    const boardMat = new THREE.MeshBasicMaterial({ map: btex, side: THREE.BackSide, color: new THREE.Color(0.55, 0.42, 0.44), fog: false });
    const board = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 9, 96, 1, true, Math.PI - 0.95, 1.9), boardMat);
    board.position.set(0, 4.3, 10);
    A.add(board);
    // LED top strip
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.4), side: THREE.BackSide, fog: false });
    const strip = new THREE.Mesh(new THREE.CylinderGeometry(23.9, 23.9, 0.18, 96, 1, true, Math.PI - 0.95, 1.9), stripMat);
    strip.position.set(0, 8.95, 10); A.add(strip);
    const strip2 = strip.clone(); strip2.position.y = -0.25; A.add(strip2);
    // glossy floor
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x060203, metalness: 0.9, roughness: 0.22, envMap, envMapIntensity: 0.6 });
    const floorA = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), floorMat);
    floorA.rotation.x = -Math.PI / 2; floorA.position.y = -0.3; A.add(floorA);
    // fake reflection: flipped dim board below floor seen through semi-transparent floor? cheap: glow plane
    const reflMat = new THREE.MeshBasicMaterial({ map: btex, side: THREE.BackSide, color: new THREE.Color(0.12, 0.04, 0.05), fog: false, transparent: true, opacity: 0.4, depthWrite: false });
    const refl = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 9, 96, 1, true, Math.PI - 0.95, 1.9), reflMat);
    refl.scale.y = -1; refl.position.set(0, -4.9, 10); A.add(refl);
    floorA.renderOrder = 1; floorMat.transparent = true; floorMat.opacity = 0.82;

    const keyA = new THREE.DirectionalLight(0xffffff, 1.6); keyA.position.set(3, 6, 10); A.add(keyA);
    const rimA = new THREE.PointLight(0xff2a44, 14, 30, 1.6); rimA.position.set(0, 3, -5); A.add(rimA);
    const fillA = new THREE.PointLight(0xff5a6e, 6, 20, 1.6); fillA.position.set(-6, 1, 6); A.add(fillA);

    const chrome = new THREE.MeshPhysicalMaterial({ color: 0x9aa0b0, metalness: 1, roughness: 0.3, envMap, envMapIntensity: 0.5, clearcoat: 1, clearcoatRoughness: 0.2, emissive: 0x2a0408, emissiveIntensity: 0.4 });
    const redChrome = new THREE.MeshPhysicalMaterial({ color: 0xff2a44, metalness: 1, roughness: 0.2, envMap, envMapIntensity: 1.4, clearcoat: 1, emissive: 0xff1030, emissiveIntensity: 0.9 });
    const nkFace = new THREE.MeshStandardMaterial({ color: 0xd8dae4, metalness: 0.6, roughness: 0.4, envMap, envMapIntensity: 0.35, emissive: 0x000000 });
    const nk = makeText3D(assets.fonts.dela, '日経平均', { size: 1.35, depth: 0.45, bevel: 0.03, materials: [nkFace, redChrome] });
    const nkPlate = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 2.6), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.72, depthWrite: false }));
    nkPlate.position.set(1.4, 2.0, -0.9); A.add(nkPlate);
    const nkG = new THREE.Group(); nkG.add(nk.group); A.add(nkG);
    const shape = new THREE.Shape();
    shape.moveTo(-1.0, 0.75); shape.lineTo(1.0, 0.75); shape.lineTo(0, -1.0); shape.closePath();
    const arrowGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 3 });
    arrowGeo.translate(0, 0, -0.27);
    const arrow = new THREE.Mesh(arrowGeo, redChrome);
    const arG = new THREE.Group(); arG.add(arrow); A.add(arG);
    const TEXT_POS = new THREE.Vector3(-1.2, 2.0, 0);
    const ARROW_POS = new THREE.Vector3(3.9, 2.0, 0);

    // shockwave ring + sparks (shared fallback fx)
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.5, 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 96), ringMat);
    scene.add(ring);
    const NSP = 90;
    const spGeo = new THREE.BufferGeometry();
    const spPos = new Float32Array(NSP * 3);
    spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
    const spVel = [];
    { const r = rng(9); for (let i = 0; i < NSP; i++) { const a = r() * Math.PI * 2, e = (r() - 0.3) * 1.2, s = 4 + r() * 9; spVel.push([Math.cos(a) * s, Math.sin(e) * s + 2, Math.sin(a) * s * 0.6 + 2]); } }
    const spMat = new THREE.PointsMaterial({ color: new THREE.Color(5, 1.2, 0.8), size: 0.09, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks = new THREE.Points(spGeo, spMat); sparks.frustumCulled = false; scene.add(sparks);
    function burst(lt, t0, origin) {
      const d = lt - t0;
      if (d < 0 || d > 1.4) { sparks.visible = false; ring.visible = false; return; }
      sparks.visible = true; ring.visible = true;
      for (let i = 0; i < NSP; i++) {
        const v = spVel[i];
        spPos[i * 3] = origin.x + v[0] * d * Math.exp(-d * 1.2);
        spPos[i * 3 + 1] = origin.y + v[1] * d * Math.exp(-d * 1.2) - 4 * d * d;
        spPos[i * 3 + 2] = origin.z + v[2] * d * Math.exp(-d * 1.2);
      }
      spGeo.attributes.position.needsUpdate = true;
      spMat.opacity = Math.exp(-d * 2.2);
      ring.position.copy(origin);
      ring.lookAt(camera.position);
      ring.scale.setScalar(0.5 + easeOutCubic(clamp01(d / 0.9)) * 14);
      ringMat.opacity = Math.exp(-d * 3.5);
    }

    // ---------------- PART B: my account ----------------
    const Bg = new THREE.Group();
    scene.add(Bg);
    const floorB = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x050204, metalness: 0.85, roughness: 0.25, envMap, envMapIntensity: 0.5 }));
    floorB.rotation.x = -Math.PI / 2; Bg.add(floorB);
    const grid = new THREE.GridHelper(80, 64, 0xff2a44, 0xff2a44);
    grid.material.color = new THREE.Color(1.3, 0.06, 0.15);
    grid.material.vertexColors = false; grid.material.transparent = true; grid.material.opacity = 0.75;
    grid.position.y = 0.01; Bg.add(grid);

    // coin
    const faceMat = new THREE.MeshStandardMaterial({ map: assets.avatar, metalness: 0.15, roughness: 0.45, emissive: 0xffffff, emissiveMap: assets.avatar, emissiveIntensity: 0.0 });
    const rimMat = new THREE.MeshPhysicalMaterial({ color: 0xffc85a, metalness: 1, roughness: 0.22, envMap, envMapIntensity: 1.5, clearcoat: 1, emissive: 0xff2a44, emissiveIntensity: 0 });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.26, 72), [rimMat, faceMat, faceMat]);
    coin.rotation.x = Math.PI / 2;
    coin.rotation.y = Math.PI / 2;
    const coinG = new THREE.Group(); coinG.add(coin); coinG.position.set(0, 1.62, 0); Bg.add(coinG);
    const coinRing = new THREE.Mesh(new THREE.TorusGeometry(1.66, 0.05, 12, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.5) }));
    coinG.add(coinRing);
    // glow puddle under coin
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.03, 0.06), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    puddle.rotation.x = -Math.PI / 2; puddle.position.y = 0.02; Bg.add(puddle);

    const spot = new THREE.SpotLight(0xffffff, 24, 30, 0.42, 0.6, 1.5);
    spot.position.set(1.5, 9, 5); spot.target = coinG; Bg.add(spot);
    const rimL = new THREE.PointLight(0xff2a44, 70, 14, 1.5); rimL.position.set(-3.5, 2.5, -2); Bg.add(rimL);
    const rimR = new THREE.PointLight(0xff2a44, 70, 14, 1.5); rimR.position.set(3.5, 2.5, -2); Bg.add(rimR);
    const keyB = new THREE.DirectionalLight(0xffe0d0, 0.5); keyB.position.set(-2, 4, 8); Bg.add(keyB);

    // odometer
    const odo = new THREE.Group(); odo.position.set(0, 5.2, -2.5); Bg.add(odo);
    const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x14161c, metalness: 1, roughness: 0.3, envMap, envMapIntensity: 1.2, clearcoat: 1 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(10.6, 1.9, 0.4), frameMat); frame.position.z = -0.25; odo.add(frame);
    const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 0.3, 0.5) });
    const edgeT = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.05, 0.05), edgeMat); edgeT.position.set(0, 0.97, -0.05); odo.add(edgeT);
    const edgeB2 = edgeT.clone(); edgeB2.position.y = -0.97; odo.add(edgeB2);
    const digitRed = new THREE.Color(2.2, 0.12, 0.2);
    const wheels = [];
    const layout = ['-', 'd', 'd', ',', 'd', 'd', 'd', ',', 'd', 'd', 'd'];
    const widths = layout.map((k) => (k === ',' ? 0.35 : 0.88));
    const totalW = widths.reduce((a, b) => a + b, 0);
    let xx = -totalW / 2;
    const minusTex = glyphTexture('−', "900 110px 'Noto Sans JP'");
    const commaTex = glyphTexture(',', "900 100px 'Orbitron'");
    let place = 7;
    layout.forEach((k, i) => {
      const w = widths[i];
      const cx = xx + w / 2; xx += w;
      if (k === 'd') {
        const tex = digitStripTexture();
        const m = new THREE.MeshBasicMaterial({ map: tex, color: digitRed.clone(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.35), m);
        mesh.position.set(cx, 0, 0.01);
        const back = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.45), new THREE.MeshBasicMaterial({ color: 0x0c0204 }));
        back.position.set(cx, 0, -0.03);
        odo.add(back); odo.add(mesh);
        wheels.push({ tex, place: place--, mat: m });
      } else {
        const m = new THREE.MeshBasicMaterial({ map: k === '-' ? minusTex : commaTex, color: digitRed.clone(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(k === ',' ? 0.5 : 0.8, k === ',' ? 0.5 * 1 : 0.8), m);
        mesh.position.set(cx, k === ',' ? -0.45 : 0, 0.01);
        odo.add(mesh);
      }
    });
    const TARGET = 83000000;

    // coin rain (instanced)
    const NR = 140;
    const rainMat = new THREE.MeshPhysicalMaterial({ color: 0xff3048, metalness: 1, roughness: 0.25, envMap, envMapIntensity: 1.3, emissive: 0xff1030, emissiveIntensity: 0.8 });
    const rain = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 20), rainMat, NR);
    rain.frustumCulled = false; Bg.add(rain);
    const rainData = [];
    { const r = rng(31); for (let i = 0; i < NR; i++) rainData.push({ x: (r() - 0.5) * 20, z: -9 + r() * 5.8, y0: 9 + r() * 12, v: 5 + r() * 4, rx: r() * 6, ry: r() * 6, sp: 3 + r() * 8 }); }
    const dummy = new THREE.Object3D();

    const cloud = new THREE.Vector3();
    return {
      scene,
      camera,
      update(t, lt, fx) {
        fx.bloom = 0.75 + beatPulse(t) * 0.3; fx.bloomThreshold = 0.55; fx.contrast = 1.12;
        fx.vignette = 0.55;
        fx.chroma = 2 + beatPulse(t) * 3;
        if (lt < CUT) {
          A.visible = true; Bg.visible = false; rain.visible = false;
          // camera: fast track along the board, settle into the slam, then slow push
          const p1 = easeOutCubic(seg(lt, 0, 2.0));
          const cx = lerp(-7.5, 0.4, p1) + (lt - 2.0 > 0 ? (lt - 2.0) * 0.25 : 0);
          const cz = lerp(8.5, 9.2, p1) - seg(lt, 1.875, 3.75) * 1.1;
          camera.position.set(cx, 2.4 + Math.sin(lt * 0.9) * 0.15, cz);
          camera.lookAt(cx * 0.35 + 0.2, 2.6, -4);
          camera.fov = 45; camera.updateProjectionMatrix();
          btex.offset.x = lt * 0.035;
          stripMat.color.setRGB(2 + beatPulse(t) * 1.5, 0.1, 0.2);
          const sN = slam(lt, SLAM_A, 0.18, 3.0);
          const sA = slam(lt, SLAM_A + 0.06, 0.2, 3.4);
          nkG.visible = sN > 0; arG.visible = sA > 0; nkPlate.visible = sN > 0; nkPlate.scale.set(Math.min(1, sN), Math.min(1, sN), 1);
          nkG.position.copy(TEXT_POS); nkG.scale.setScalar(sN);
          nk.glyphs.forEach((gl, i) => { gl.mesh.rotation.y = Math.sin(lt * 1.6 + i * 1.3) * 0.03; });
          arG.position.copy(ARROW_POS);
          arG.position.y += -Math.max(0, lt - SLAM_A - 0.2) * 0.12 + Math.sin(lt * 3) * 0.05;
          arG.scale.setScalar(sA);
          arrow.rotation.y = Math.sin(lt * 1.2) * 0.35;
          redChrome.emissiveIntensity = 0.7 + beatPulse(t) * 1.2;
          const h = hit(lt, SLAM_A, 9);
          fx.flash = h * 0.65; fx.flashColor = [1, 0.15, 0.22];
          fx.shake = hit(lt, SLAM_A, 6) * 0.3; fx.shakeRot = hit(lt, SLAM_A, 6) * 0.02;
          fx.chroma += hit(lt, SLAM_A, 7) * 26;
          fx.radialBlur = hit(lt, SLAM_A, 8) * 0.35 + hit(lt, 0, 6) * 0.3;
          cloud.set(1.2, 2.0, 0.2);
          burst(lt, SLAM_A, cloud);
          if (lt < 0.2) { fx.flash = Math.max(fx.flash, hit(lt, 0, 14) * 0.3); fx.flashColor = [1, 0.3, 0.35]; }
        } else {
          A.visible = false; Bg.visible = true; nkG.visible = false; arG.visible = false;
          const lb = lt - CUT; // 0..3.75
          // slow push-in + slight orbit
          const ang = -0.28 + lb * 0.07;
          const rad = lerp(11.5, 8.6, easeInOutCubic(seg(lb, 0, 3.75)));
          camera.position.set(Math.sin(ang) * rad, 2.6 + lb * 0.12, Math.cos(ang) * rad);
          camera.lookAt(0, 3.1, -0.5);
          camera.fov = 45; camera.updateProjectionMatrix();
          coinG.rotation.y = Math.sin(lb * 0.9) * 0.22;
          coinG.position.y = 1.62 + Math.sin(lb * 2.1) * 0.03;
          const bp = beatPulse(t, 7);
          rimMat.emissiveIntensity = bp * 1.6 + (lt > LOCK ? 0.4 : 0);
          coinRing.material.color.setRGB(2 + bp * 4, 0.15 + bp * 0.2, 0.3 + bp * 0.3);
          rimL.intensity = 10 + bp * 25; rimR.intensity = 10 + bp * 25;
          puddle.material.opacity = 0.35 + bp * 0.4;
          // odometer: accelerating ease-in 0 -> 83,000,000, locks at LOCK
          const p = easeInCubic(seg(lt, CUT, LOCK));
          const val = p * TARGET;
          for (const w of wheels) {
            const q = val / Math.pow(10, w.place);
            let d;
            if (w.place === 0) d = q % 10;
            else {
              const lower = (val / Math.pow(10, w.place - 1)) % 10; // next digit (continuous)
              d = (Math.floor(q) % 10) + clamp01(lower - 9);
            }
            w.tex.offset.y = 0.9 - d / 10;
          }
          const lockH = hit(lt, LOCK, 5);
          const odoPulse = lt >= LOCK ? 1 + lockH * 0.8 : 1;
          digitRed.setRGB(2.2 * odoPulse, 0.12, 0.2);
          odo.children.forEach((c) => { if (c.material && c.material.map) c.material.color.copy(digitRed); });
          odo.scale.setScalar(1 + hit(lt, LOCK, 8) * 0.12);
          // impact at lock
          fx.flash = hit(lt, LOCK, 8) * 0.7 + hit(lt, CUT, 14) * 0.25; fx.flashColor = [1, 0.18, 0.25];
          fx.shake = hit(lt, LOCK, 5) * 0.35 + (lt < LOCK ? seg(lt, CUT, LOCK) * 0.04 : 0);
          fx.shakeRot = hit(lt, LOCK, 5) * 0.025;
          fx.chroma += hit(lt, LOCK, 6) * 30 + hit(lt, STAMP, 9) * 12;
          fx.radialBlur = hit(lt, LOCK, 7) * 0.4 + hit(lt, CUT, 8) * 0.3;
          fx.shake += hit(lt, STAMP, 10) * 0.12;
          cloud.set(0, 5.2, -2.2);
          burst(lt, LOCK, cloud);
          // coin rain after lock
          const dr = lt - LOCK;
          rain.visible = dr >= 0;
          if (dr >= 0) {
            for (let i = 0; i < NR; i++) {
              const r = rainData[i];
              let y = r.y0 - r.v * dr - 3 * dr * dr;
              if (y < 0.1) y = 0.1 + (((y - 0.1) % 0.2) + 0.2) * 0; // settle on floor
              dummy.position.set(r.x, y, r.z);
              const spin = y > 0.1 ? dr * r.sp : 0;
              dummy.rotation.set(r.rx + spin, r.ry + spin * 0.7, 0);
              dummy.scale.setScalar(1);
              dummy.updateMatrix();
              rain.setMatrixAt(i, dummy.matrix);
            }
            rain.instanceMatrix.needsUpdate = true;
          }
        }
      },
      hud(g, t, lt, fx) {
        if (lt < CUT) {
          // news ticker band (below global top-left zone)
          const a = clamp01(lt / 0.25);
          g.save(); g.globalAlpha = a;
          g.fillStyle = 'rgba(40,0,6,0.78)'; g.fillRect(0, 142, 1920, 52);
          g.fillStyle = '#ff2a44'; g.fillRect(0, 142, 1920, 3); g.fillRect(0, 191, 1920, 3);
          ticker(g, [
            { text: '日経平均 ▼', color: COLORS.redHot },
            { text: '半導体 総崩れ', color: COLORS.white },
            { text: 'キオクシア 高値から半値', color: COLORS.redHot },
            { text: '全面安', color: COLORS.white },
          ], 168, lt + 3, { speed: 420, gap: 110, font: FONTS.noto(32) });
          g.fillStyle = '#ff2a44'; g.fillRect(0, 142, 170, 52);
          g.font = FONTS.noto(28); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText('速報', 50, 168);
          g.restore();
          glowText(g, 'MARKET  ▼  ALL RED', 120, 1010, { font: FONTS.orb(26), color: COLORS.red, alpha: 0.85, spacing: 4 });
        } else {
          const lb = lt - CUT;
          glowText(g, 'MY ACCOUNT', 150, 420, { font: FONTS.orb(28), color: COLORS.white, align: 'left', spacing: 8, alpha: clamp01(lb / 0.2) * 0.9 });
          glowText(g, '含み損', 150, 490, { font: FONTS.noto(64), color: COLORS.redHot, align: 'left', alpha: clamp01(lb / 0.25) });
          // stamp 追証
          if (lt >= STAMP) {
            const s = slam(lt, STAMP, 0.16, 2.8);
            g.save();
            g.translate(1440, 640);
            g.rotate(-0.22);
            g.scale(s, s);
            g.globalAlpha = clamp01((lt - STAMP) / 0.05);
            g.shadowColor = '#ff2a44'; g.shadowBlur = 30;
            g.strokeStyle = '#ff2a44'; g.lineWidth = 12;
            g.strokeRect(-200, -110, 400, 220);
            g.lineWidth = 4; g.strokeRect(-182, -92, 364, 184);
            g.fillStyle = '#ff2a44'; g.font = FONTS.noto(150); g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText('追証', 0, 6);
            g.restore();
          }
          if (lt >= LOCK - 0.3) {
            const on = blink(t, 3, 0.6);
            if (on) glowText(g, '⚠ MARGIN CALL', 1440, 820, { font: FONTS.orb(30), color: COLORS.red, align: 'center', spacing: 6 });
          }
          glowText(g, 'ACCOUNT STATUS: CRITICAL', 120, 1010, { font: FONTS.mono(28), color: COLORS.red, alpha: 0.8 });
        }
      },
    };
  },
};
