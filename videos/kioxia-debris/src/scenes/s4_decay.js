// s4_decay — 24.375–35.625 (bars 14–19): orbit decay → re-entry → countdown 3·2·1 → whiteout.
// Pure function of t. Uses space.js (Earth / nebula / stars) when available, in-scene fallbacks otherwise.
import * as THREE from 'three';
import { makeText3D } from '../lib/text3d.js';
import { seg, clamp01, lerp, easeOutBack, easeInQuad, easeOutCubic, hit, smoothstep } from '../lib/ease.js';
import { beatPulse } from '../lib/beats.js';
import { rng } from '../lib/rand.js';
import { glowText, panel, hazard, blink, FONTS, COLORS } from '../lib/hudkit.js';

const T0 = 24.375, T_RE = 28.125, T_TXT = 31.875, T3 = 32.8125, T2 = 33.75, T1 = 34.6875, TEND = 35.625;

const TK = 5 / 12; // text lives 5 units in front of the camera (in front of the coin), scaled to match
const slamS = (t, t0, dur = 0.18, from = 3) => (t < t0 ? 0 : lerp(from, 1, easeOutBack(clamp01((t - t0) / dur), 2.2)));

export default {
  async create(ctx) {
    const { assets } = ctx;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02030a);
    const camera = new THREE.PerspectiveCamera(40, ctx.aspect, 0.05, 2000);
    scene.add(camera);

    // ---------------- space environment ----------------
    let earth = null, nebula = null, stars = null;
    try {
      const sp = await import('../lib/space.js');
      stars = sp.createStarfield({ count: 5000, seed: 4 });
      scene.add(stars.points);
      nebula = sp.createNebula({ seed: 4, res: 1024 });
      scene.add(nebula.mesh);
      nebula.setMood(0.85);
      earth = sp.createEarth({ radius: 20, seed: 1, segments: 160, res: 2048 });
      scene.add(earth.group);
      earth.setMood(0.7);
      earth.setSun(new THREE.Vector3(0.25, -0.35, -0.9).normalize());
      try { earth.setParams({ sun: 8 }); } catch (e) {}
    } catch (e) {
      console.warn('s4: space.js fallback', e);
      earth = null;
    }
    if (!earth) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.SphereGeometry(20, 96, 64), new THREE.MeshStandardMaterial({ color: 0x0a2244, emissive: 0x220806, roughness: 0.8 }));
      g.add(m);
      const atm = new THREE.Mesh(new THREE.SphereGeometry(20.6, 96, 64), new THREE.MeshBasicMaterial({ color: 0xff6a30, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, side: THREE.BackSide }));
      g.add(atm);
      scene.add(g);
      earth = { group: g, update() {}, setMood() {}, setParams() {} };
    }

    // lights
    scene.add(new THREE.HemisphereLight(0x6677aa, 0x220800, 0.5));
    const sunL = new THREE.DirectionalLight(0xfff0dd, 1.4);
    sunL.position.set(-0.45, 0.35, -0.82).multiplyScalar(50);
    scene.add(sunL);
    const earthGlowL = new THREE.PointLight(0xff5a20, 0, 30, 1.5);
    scene.add(earthGlowL);

    // ---------------- coin ----------------
    const coin = new THREE.Group();
    scene.add(coin);
    const rimMat = new THREE.MeshPhysicalMaterial({ color: 0xffc85a, metalness: 1, roughness: 0.22, envMap: ctx.envMap, envMapIntensity: 0.9, emissive: new THREE.Color(0xff5a10), emissiveIntensity: 0, clearcoat: 1 });
    const faceMat = new THREE.MeshStandardMaterial({ map: assets.avatar, metalness: 0.25, roughness: 0.4, envMap: ctx.envMap, envMapIntensity: 0.3, emissive: new THREE.Color(0xff6a20), emissiveIntensity: 0 });
    const coinMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.16, 72), [rimMat, faceMat, faceMat]);
    coinMesh.rotation.x = Math.PI / 2;
    coin.add(coinMesh);
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 12, 72), rimMat);
    coin.add(torus);

    // plasma sheath (additive shells below the coin = direction of travel)
    const plasmaMats = [];
    const plasma = new THREE.Group();
    scene.add(plasma);
    const shellGeo = new THREE.SphereGeometry(1, 32, 24);
    [[1.45, 1.2, 0xff8a2a], [1.9, 1.9, 0xff4a10], [2.6, 2.9, 0xff2a08]].forEach(([s, len, c], i) => {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      plasmaMats.push(m);
      const mesh = new THREE.Mesh(shellGeo, m);
      mesh.scale.set(s, s * len, s);
      mesh.position.y = -0.5 - i * 0.6;
      plasma.add(mesh);
    });
    const coreGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.7, 0.25), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(1.12, 32, 24), coreGlowMat);
    coreGlow.scale.set(1.1, 0.5, 1.1);
    coreGlow.position.y = -0.55;
    plasma.add(coreGlow);

    // streaks (heat trail / speed lines) — instanced thin boxes flowing upward past the coin
    const R = rng(404);
    const NSTREAK = 70;
    const streakMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.8, 0.3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 1, 0.035), streakMat, NSTREAK);
    const streakData = [];
    for (let i = 0; i < NSTREAK; i++) {
      const a = R() * Math.PI * 2, r = 0.6 + R() * 3.2;
      streakData.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, ph: R() * 20, sp: 14 + R() * 18, len: 1.5 + R() * 4 });
    }
    scene.add(streaks);

    // debris cloud (shards orbiting the coin)
    const NSH = 110;
    const shardMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.9, roughness: 0.3, envMap: ctx.envMap, envMapIntensity: 1.2, emissive: new THREE.Color(0xff3020), emissiveIntensity: 0.25 });
    const shardGeo = new THREE.TetrahedronGeometry(0.12, 0);
    shardGeo.scale(1.6, 0.35, 1);
    const shards = new THREE.InstancedMesh(shardGeo, shardMat, NSH);
    const shData = [];
    for (let i = 0; i < NSH; i++) {
      shData.push({ r: 1.8 + R() * 4.2, a: R() * Math.PI * 2, w: (0.25 + R() * 0.5) * (R() < 0.5 ? -1 : 1), y: (R() - 0.5) * 2.6, tilt: (R() - 0.5) * 0.8, rs: R() * 4 + 1, s: 0.5 + R() * 1.6, ax: new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize() });
    }
    scene.add(shards);
    // gold shards (chip fragments) — a few brighter ones
    const goldShMat = new THREE.MeshStandardMaterial({ color: 0xffc85a, metalness: 1, roughness: 0.25, envMap: ctx.envMap, emissive: new THREE.Color(0xff8a2a), emissiveIntensity: 1.2 });
    const NG = 24;
    const goldSh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.03, 0.16), goldShMat, NG);
    const gData = [];
    for (let i = 0; i < NG; i++) gData.push({ r: 2 + R() * 3.5, a: R() * Math.PI * 2, w: (0.3 + R() * 0.4) * (R() < 0.5 ? -1 : 1), y: (R() - 0.5) * 2.2, rs: R() * 3 + 1 });
    scene.add(goldSh);

    // ---------------- 3D text (camera space) ----------------
    const lightRig = new THREE.Group();
    camera.add(lightRig);
    const keyL = new THREE.PointLight(0xffffff, 9, 40, 2); keyL.position.set(3, 3, -1); lightRig.add(keyL);
    const rimL = new THREE.PointLight(0xff7a2a, 14, 40, 2); rimL.position.set(-2, -1.5, -8); lightRig.add(rimL);
    const fillL = new THREE.PointLight(0x88aaff, 8, 40, 2); fillL.position.set(-5, 2, -6); lightRig.add(fillL);

    const hotMat = new THREE.MeshPhysicalMaterial({ color: 0xffc9a0, metalness: 1, roughness: 0.2, envMap: ctx.envMap, envMapIntensity: 1.0, emissive: new THREE.Color(0xff8a2a), emissiveIntensity: 0.35, clearcoat: 1 });
    const numMat = new THREE.MeshPhysicalMaterial({ color: 0xff3a2a, metalness: 1, roughness: 0.2, envMap: ctx.envMap, envMapIntensity: 1.5, emissive: new THREE.Color(0xff3a14), emissiveIntensity: 0.5, clearcoat: 1 });

    const dFont = assets.fonts.dela;
    const nFont = assets.fonts.orbitron || assets.fonts.dela;
    const txt = makeText3D(dFont, 'デブリになる', { size: 1.25, depth: 0.35, bevel: 0.03, material: hotMat });
    const txtHolder = new THREE.Group(); txtHolder.add(txt.group); camera.add(txtHolder);
    txtHolder.position.set(0, 2.55 * TK, -12 * TK);
    const nums = ['3', '2', '1'].map((c) => {
      const tt = makeText3D(nFont, c, { size: 5.0, depth: 1.0, bevel: 0.06, material: numMat });
      const h = new THREE.Group(); h.add(tt.group); camera.add(h);
      h.position.set(0, -1.1 * TK, -12 * TK);
      h.visible = false;
      return { tt, h };
    });
    txtHolder.visible = false;

    // shockwave ring (camera space)
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 96), ringMat);
    ring.position.set(0, -1.1 * TK, -12.5 * TK);
    camera.add(ring);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), e3 = new THREE.Euler();
    const tmp = new THREE.Vector3();

    return {
      scene,
      camera,
      update(t, lt, fx) {
        // ---- phase values
        const heat = t < T_RE ? 0 : t < T_TXT ? 0.8 * easeInQuad(seg(t, T_RE, T_TXT - 0.3)) : lerp(0.8, 1, seg(t, T_TXT, T_TXT + 0.5));
        const reentry = t >= T_RE;
        const count = t >= T_TXT;

        // coin world position: sinks toward Earth (Earth centre at origin, radius 20)
        const alt = lerp(27.5, 24.4, easeInQuad(seg(t, T0, T_RE))) - (reentry ? 1.2 * seg(t, T_RE, TEND) : 0);
        coin.position.set(Math.sin(t * 0.35) * 0.4, alt, 0);
        // tumble on 2 axes (slows / stabilises in re-entry so the face reads)
        const tumble = reentry ? 0.35 : 1;
        coin.rotation.set(0.35 + t * 1.3 * tumble, t * 0.9 * tumble, Math.sin(t * 0.7) * 0.5);
        plasma.position.copy(coin.position);
        rimMat.emissiveIntensity = heat * 1.6;
        faceMat.emissiveIntensity = heat * 0.25;
        const cK = count ? 0.35 : 1;
        const flick = cK * 0.85 + 0.15 * Math.sin(t * 53) * Math.sin(t * 31);
        plasmaMats[0].opacity = heat * 0.1 * flick;
        plasmaMats[1].opacity = heat * 0.07 * flick;
        plasmaMats[2].opacity = heat * 0.035 * flick;
        coreGlowMat.opacity = heat * 0.2 * cK;
        plasma.scale.setScalar(count ? 0.9 : 0.8 + heat * 0.5);
        earthGlowL.position.set(coin.position.x, coin.position.y - 1.5, 0.5);
        earthGlowL.intensity = heat * 12;

        // streaks
        const sOp = reentry ? clamp01(heat * 1.4) : 0;
        streakMat.opacity = sOp * 0.35 * cK;
        streaks.visible = sOp > 0.01;
        if (streaks.visible) {
          for (let i = 0; i < NSTREAK; i++) {
            const d = streakData[i];
            const span = 16;
            const yy = ((d.ph + t * d.sp) % span) - 5;
            v.set(coin.position.x + d.x, coin.position.y + yy, d.z);
            sc.set(1, d.len * (0.6 + heat), 1);
            q.identity();
            m4.compose(v, q, sc);
            streaks.setMatrixAt(i, m4);
          }
          streaks.instanceMatrix.needsUpdate = true;
        }

        // shards orbit coin (debris cloud)
        const spread = 1 + (reentry ? 0.35 * seg(t, T_RE, TEND) : 0);
        for (let i = 0; i < NSH; i++) {
          const d = shData[i];
          const a = d.a + d.w * t;
          v.set(coin.position.x + Math.cos(a) * d.r * spread, coin.position.y + d.y + Math.sin(a * 2 + d.tilt) * 0.3, Math.sin(a) * d.r * spread);
          q.setFromAxisAngle(d.ax, t * d.rs + i);
          sc.setScalar(d.s);
          m4.compose(v, q, sc);
          shards.setMatrixAt(i, m4);
        }
        shards.instanceMatrix.needsUpdate = true;
        shardMat.emissiveIntensity = 0.25 + heat * 0.8;
        for (let i = 0; i < NG; i++) {
          const d = gData[i];
          const a = d.a + d.w * t;
          v.set(coin.position.x + Math.cos(a) * d.r * spread, coin.position.y + d.y, Math.sin(a) * d.r * spread);
          e3.set(t * d.rs, t * d.rs * 0.7 + i, i);
          q.setFromEuler(e3);
          sc.setScalar(1);
          m4.compose(v, q, sc);
          goldSh.setMatrixAt(i, m4);
        }
        goldSh.instanceMatrix.needsUpdate = true;
        goldShMat.emissiveIntensity = 0.5 + heat * 1.2;

        // ---- camera
        if (!reentry) {
          // chase camera: behind/above, slow push, slight orbit
          const p = seg(t, T0, T_RE);
          const ang = -0.5 + p * 0.55;
          const dist = lerp(9.5, 7.0, easeOutCubic(p));
          camera.position.set(coin.position.x + Math.sin(ang) * dist, coin.position.y + lerp(2.6, 1.6, p), Math.cos(ang) * dist);
          camera.lookAt(coin.position.x, coin.position.y - 1.2, 0);
        } else if (!count) {
          // tight on the coin, Earth's glowing limb below
          const p = seg(t, T_RE, T_TXT);
          const ang = 0.3 - p * 0.5;
          const dist = lerp(4.6, 3.6, p);
          camera.position.set(coin.position.x + Math.sin(ang) * dist, coin.position.y + 0.9, Math.cos(ang) * dist);
          camera.lookAt(coin.position.x, coin.position.y - 0.4, 0);
        } else {
          // countdown: coin burning behind the numbers
          const p = seg(t, T_TXT, TEND);
          const dist = lerp(8.2, 6.8, p);
          const ang = 0.12 * Math.sin(p * 2);
          camera.position.set(coin.position.x + Math.sin(ang) * dist, coin.position.y + 0.8, Math.cos(ang) * dist);
          camera.lookAt(coin.position.x, coin.position.y + 0.15, 0);
        }

        // ---- env
        if (earth.update) earth.update(t);
        if (stars && stars.update) stars.update(t);
        if (nebula && nebula.update) nebula.update(t);
        if (earth.setParams) earth.setParams({ halo: 1 + heat * 0.4, atmo: 1 + heat * 0.3 });

        // ---- text slams
        const sTxt = slamS(t, T_TXT, 0.18, 3);
        txtHolder.visible = count && t < TEND;
        txtHolder.scale.setScalar((sTxt || 1) * TK);
        txt.glyphs.forEach((gl, i) => { gl.mesh.rotation.y = Math.sin(t * 3 + i) * 0.1; gl.mesh.position.y = gl.home.y + Math.sin(t * 5 + i * 0.8) * 0.03; });
        hotMat.emissiveIntensity = 0.18 + hit(t, T_TXT, 6) * 1.0 + beatPulse(t) * 0.1;
        const nT = [T3, T2, T1];
        let lastHit = -1;
        nums.forEach((n, i) => {
          const a = nT[i], b = i < 2 ? nT[i + 1] : TEND;
          const on = t >= a && t < b;
          n.h.visible = on;
          if (on) {
            n.h.scale.setScalar(TK * slamS(t, a, 0.17, 3.2) * (1 + (t - a) * 0.06));
            n.h.rotation.set(0, Math.sin((t - a) * 2) * 0.12, 0);
            lastHit = a;
          }
        });
        numMat.emissiveIntensity = 0.5 + (lastHit > 0 ? hit(t, lastHit, 5) * 1.5 : 0);
        // shockwave ring
        if (lastHit > 0) {
          const k = t - lastHit;
          ring.visible = k < 0.45;
          ring.scale.setScalar(TK * (1 + k * 22));
          ringMat.opacity = Math.max(0, 1 - k / 0.45) * 0.9;
        } else ring.visible = false;

        // ---- fx
        fx.bloom = 0.75 + heat * 0.2 + beatPulse(t) * 0.15;
        fx.bloomThreshold = 1.0;
        fx.vignette = 0.55;
        fx.tint = [1.05, 0.95, 0.9];
        fx.chroma = 2 + heat * 2;
        const alarm = blink(t, 2, 0.5);
        let shake = 0.02 + (reentry ? 0.05 + heat * 0.12 : 0);
        let flash = 0, chroma = 0, rb = reentry && !count ? heat * 0.15 : 0;
        if (count) { fx.exposure = 0.8; fx.bloom = 0.6; }
        // cut punch at scene start
        flash += hit(t, T0, 10) * 0.35;
        flash += hit(t, T_RE, 8) * 0.45;
        shake += hit(t, T_RE, 5) * 0.2;
        // text slam
        flash += hit(t, T_TXT, 10) * 0.6; shake += hit(t, T_TXT, 6) * 0.3; chroma += hit(t, T_TXT, 7) * 14;
        for (const a of nT) { flash += hit(t, a, 10) * 0.7; shake += hit(t, a, 6) * 0.38; chroma += hit(t, a, 7) * 16; rb += hit(t, a, 12) * 0.25; }
        fx.flashColor = [1, 0.55, 0.3];
        // whiteout / burn
        const wo = smoothstep(35.33, 35.6, t);
        if (wo > 0) { fx.flashColor = [1, lerp(0.55, 0.9, wo), lerp(0.3, 0.8, wo)]; flash = Math.max(flash, wo); }
        if (t < T_RE && alarm) fx.tint = [1.1, 0.92, 0.85];
        fx.flash = Math.min(1, flash);
        fx.shake = shake;
        fx.shakeRot = shake * 0.05;
        fx.chroma += chroma;
        fx.radialBlur = Math.min(0.8, rb);
      },
      hud(g, t, lt, fx) {
        const bl = blink(t, 2.5, 0.6);
        const count = t >= T_TXT;
        const wo = 1 - smoothstep(35.3, 35.55, t);
        if (wo <= 0) return;
        g.save();
        g.globalAlpha = wo;
        if (t < T_RE) {
          // warning panel
          const a = clamp01((t - T0) / 0.25);
          panel(g, 470, 150, 560, 150, { stroke: COLORS.orange, fill: 'rgba(40,12,0,0.55)', alpha: a });
          glowText(g, '⚠ 軌道維持 不能', 500, 200, { font: FONTS.noto(52), color: COLORS.orange, alpha: a * (0.55 + 0.45 * bl) });
          glowText(g, 'ORBIT DECAY', 502, 264, { font: FONTS.orb(34), color: COLORS.white, spacing: 6, alpha: a });
          // gauge
          const gp = 1 - seg(t, T0 + 0.3, T_RE - 0.4);
          const pct = Math.round(gp * 100);
          const gx = 470, gy = 860, gw = 640, gh = 26;
          glowText(g, '証拠金維持率', gx, gy - 38, { font: FONTS.noto(34), color: COLORS.white, alpha: a });
          glowText(g, `${pct}%`, gx + gw, gy - 38, { font: FONTS.orb(40), color: pct < 30 ? COLORS.red : COLORS.orange, align: 'right', alpha: a });
          g.save(); g.globalAlpha = a * wo;
          g.fillStyle = 'rgba(255,138,42,0.15)'; g.fillRect(gx, gy, gw, gh);
          g.fillStyle = pct < 30 ? COLORS.red : COLORS.orange;
          g.shadowColor = g.fillStyle; g.shadowBlur = 16;
          g.fillRect(gx, gy, gw * gp, gh);
          g.strokeStyle = COLORS.orange; g.lineWidth = 2; g.strokeRect(gx, gy, gw, gh);
          for (let i = 1; i < 10; i++) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(gx + (gw * i) / 10 - 1, gy, 2, gh); }
          g.restore();
        }
        // ETA readout (whole scene until countdown)
        if (!count) {
          const eta = Math.max(0, TEND - t).toFixed(2);
          panel(g, 1370, 150, 460, 140, { stroke: COLORS.orange, fill: 'rgba(30,8,0,0.5)' });
          glowText(g, 'DEBRIS ETA', 1400, 190, { font: FONTS.orb(28), color: COLORS.orange, spacing: 4 });
          glowText(g, `T−${eta}s`, 1800, 250, { font: FONTS.orb(56), color: bl ? COLORS.orange : '#ffd2a8', align: 'right' });
        }
        if (t >= T_RE) {
          // hazard bands top / bottom (avoid global HUD zones)
          const ha = count ? 0.85 : 1;
          hazard(g, 440, 0, 1480, 40, t, { color: COLORS.orange, alpha: ha, speed: 160 });
          hazard(g, 0, 1040, 1470, 40, t, { color: COLORS.orange, alpha: ha, speed: -160 });
          if (!count) {
            const wb = blink(t, 3, 0.55);
            glowText(g, 'WARNING', 960, 150, { font: FONTS.orb(88), color: COLORS.red, align: 'center', spacing: 14, alpha: wb, blur: 30 });
            glowText(g, '大気圏再突入', 960, 930, { font: FONTS.noto(48), color: COLORS.orange, align: 'center', alpha: 0.9 });
            glowText(g, `HEAT ${Math.round(seg(t, T_RE, T_TXT) * 1650 + 120)}°C`, 470, 990, { font: FONTS.orb(30), color: COLORS.orange });
          } else {
            glowText(g, 'IMPACT SEQUENCE', 960, 1000, { font: FONTS.orb(30), color: COLORS.orange, align: 'center', spacing: 8, alpha: 0.6 + 0.4 * bl });
          }
        }
        g.restore();
      },
    };
  },
};
