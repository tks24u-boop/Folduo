// s5_finale — global 35.625-45.000. Silence -> 破産寸前 punchline -> debris rescue -> end card.
import * as THREE from 'three';
import { makeText3D } from '../lib/text3d.js';
import { seg, easeOutExpo, easeOutBack, easeInOutCubic, slam, hit, clamp01, smoothstep } from '../lib/ease.js';
import { glowText, panel, FONTS, COLORS } from '../lib/hudkit.js';
import { hash1 } from '../lib/rand.js';

const T_SLAM = 36.5625, T_JOKE = 38.4375, T_SPACE = 39.375, T_CAP = 40.3125, T_GACHI = 41.25, T_END = 43.125;

export default {
  async create(ctx) {
    const { assets, envMap } = ctx;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(40, ctx.aspect, 0.1, 2000);

    // ---------- lights ----------
    const hemi = new THREE.HemisphereLight(0x8899ff, 0x220004, 0.5);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(4, 6, 10); scene.add(key);
    const rim = new THREE.DirectionalLight(0xff3344, 3.0); rim.position.set(-6, 3, -6); scene.add(rim);
    const rim2 = new THREE.PointLight(0x39e6ff, 0, 60, 1.5); rim2.position.set(6, 2, 4); scene.add(rim2);

    // ---------- group A: 破産寸前 ----------
    const gA = new THREE.Group(); scene.add(gA);
    const smokeMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uK: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec2 vUv; uniform float uT; uniform float uK;
        float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
        float fb(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n(p);p*=2.03;a*=.5;}return s;}
        void main(){ vec2 p=vUv*vec2(3.2,1.8); float f=fb(p+vec2(uT*0.08,-uT*0.05)+fb(p*1.3-uT*0.04));
          float d=length(vUv-0.5); vec3 c=mix(vec3(0.02,0.0,0.0),vec3(0.55,0.03,0.04),f*f*1.4)*(1.2-d*1.4);
          c+=vec3(0.35,0.02,0.02)*smoothstep(0.55,0.0,d)*0.6; gl_FragColor=vec4(c*uK,1.0);}`,
      depthWrite: false,
    });
    const smoke = new THREE.Mesh(new THREE.PlaneGeometry(80, 45), smokeMat);
    smoke.position.z = -20; gA.add(smoke);
    const redChrome = new THREE.MeshPhysicalMaterial({
      color: 0xff1a2a, emissive: 0x6a0008, emissiveIntensity: 1.0, metalness: 0.95, roughness: 0.18,
      clearcoat: 1, clearcoatRoughness: 0.1, envMap, envMapIntensity: 1.6,
    });
    const hasan = makeText3D(assets.fonts.dela, '破産寸前', { size: 2.0, depth: 0.7, bevel: 0.05, material: redChrome });
    gA.add(hasan.group);
    // sparks (points)
    const NS = 160;
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPos = new Float32Array(NS * 3);
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({ color: 0xffaa55, size: 0.12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks = new THREE.Points(sparkGeo, sparkMat); gA.add(sparks);
    const sparkVel = []; for (let i = 0; i < NS; i++) {
      const a = hash1(i * 3.1) * Math.PI * 2, e = (hash1(i * 7.7) - 0.5) * 1.6, sp = 6 + hash1(i * 1.3) * 14;
      sparkVel.push([Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp * 0.5]);
    }
    // shockwave ring
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5533, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 96), ringMat); gA.add(ring);

    // ---------- group B: space ----------
    const gB = new THREE.Group(); scene.add(gB);
    let stars = null, earth = null, sun = null;
    try {
      const sp = await import('../lib/space.js');
      stars = sp.createStarfield({ count: 5000, seed: 5 }); gB.add(stars.points);
      earth = sp.createEarth({ radius: 20, seed: 1, segments: 128 }); gB.add(earth.group);
      earth.setMood?.(0);
      try { sun = sp.createSun({ size: 1, earth, intensity: 1 }); gB.add(sun.group); } catch (e) { sun = null; }
    } catch (e) {
      console.warn('s5 space fallback', e.message);
      const pts = new Float32Array(3000 * 3);
      for (let i = 0; i < 3000; i++) {
        const u = hash1(i * 1.7) * 2 - 1, th = hash1(i * 5.3) * Math.PI * 2, r = 400, s = Math.sqrt(1 - u * u);
        pts[i * 3] = Math.cos(th) * s * r; pts[i * 3 + 1] = u * r; pts[i * 3 + 2] = Math.sin(th) * s * r;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      stars = { points: new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false })), update() {} };
      gB.add(stars.points);
      const eg = new THREE.Group();
      eg.add(new THREE.Mesh(new THREE.SphereGeometry(20, 96, 64), new THREE.MeshStandardMaterial({ color: 0x2a6adf, emissive: 0x06122a, roughness: 0.7 })));
      const at = new THREE.Mesh(new THREE.SphereGeometry(20.8, 64, 32), new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, side: THREE.BackSide }));
      eg.add(at);
      earth = { group: eg, update() {}, setSun() {} }; gB.add(eg);
    }
    const sunDir = new THREE.Vector3(0.7, 0.35, 0.6).normalize();
    earth.setSun?.(sunDir); sun?.setDirection?.(sunDir);

    // coin
    const coinG = new THREE.Group(); gB.add(coinG);
    const faceMat = new THREE.MeshStandardMaterial({ map: assets.avatar, metalness: 0.2, roughness: 0.45, emissive: 0xffffff, emissiveMap: assets.avatar, emissiveIntensity: 0.04 });
    const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0xffc85a, metalness: 1, roughness: 0.22, envMap, envMapIntensity: 1.4, emissive: 0x3a2200 });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.14, 64), [edgeMat, faceMat, faceMat]);
    coin.rotation.x = Math.PI / 2; coinG.add(coin);
    const glowRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const glowRing = new THREE.Mesh(new THREE.RingGeometry(1.08, 1.22, 96), glowRingMat); coinG.add(glowRing);

    // craft (in-scene)
    const craft = new THREE.Group(); gB.add(craft);
    const hull = new THREE.MeshPhysicalMaterial({ color: 0xd8dde6, metalness: 0.85, roughness: 0.3, envMap, envMapIntensity: 1.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a2030, metalness: 0.6, roughness: 0.4 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a3a8a, emissive: 0x0a1a44, metalness: 0.5, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.0), hull); craft.add(body);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.5, 24), dark); nose.rotation.z = Math.PI / 2; nose.position.x = -1.0; craft.add(nose);
    const plateMat = new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, blending: THREE.AdditiveBlending });
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), plateMat); plate.rotation.y = -Math.PI / 2; plate.position.x = -1.26; craft.add(plate);
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 2.2), panelMat); w.position.set(0.2, 0, s * 1.65); craft.add(w); }
    const thrMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const thr = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 20, 1, true), thrMat); thr.rotation.z = Math.PI / 2; thr.position.x = 1.6; craft.add(thr);
    let libCraft = null;
    try {
      const cm = await import('../lib/craft.js');
      if (cm.createDebrisCraft) { libCraft = cm.createDebrisCraft({}); }
    } catch (e) { libCraft = null; }
    if (libCraft && libCraft.group) {
      craft.children.forEach((c) => (c.visible = false));
      craft.add(libCraft.group);
    }
    const capRingMat = new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const capRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 96), capRingMat); gB.add(capRing);

    // gachiho text
    const goldMat = new THREE.MeshPhysicalMaterial({ color: 0xffd98a, emissive: 0x6a4000, emissiveIntensity: 0.55, metalness: 1, roughness: 0.16, clearcoat: 1, envMap, envMapIntensity: 0.8 });
    const whiteMat = new THREE.MeshPhysicalMaterial({ color: 0xdde6ff, emissive: 0x334466, emissiveIntensity: 0.5, metalness: 0.9, roughness: 0.2, clearcoat: 1, envMap, envMapIntensity: 0.9 });
    const t1 = makeText3D(assets.fonts.dela, 'それでも', { size: 0.9, depth: 0.3, bevel: 0.03, material: new THREE.MeshStandardMaterial({ color: 0x9aa4b8, metalness: 0.2, roughness: 0.6, emissive: 0x101828 }) });
    const t2 = makeText3D(assets.fonts.dela, 'ガチホが正義。', { size: 1.25, depth: 0.4, bevel: 0.04, material: goldMat });
    const gT = new THREE.Group(); gT.add(t1.group); gT.add(t2.group); scene.add(gT);

    const col = new THREE.Color();
    const tmpV = new THREE.Vector3();

    return {
      scene, camera,
      update(t, lt, fx) {
        stars?.update?.(t); earth?.update?.(t);
        const phaseA = t >= T_SLAM && t < T_SPACE;
        const phaseB = t >= T_SPACE;
        gA.visible = phaseA; gB.visible = phaseB; gT.visible = false;
        hemi.intensity = 0.5; rim.color.set(0xff3344); rim2.intensity = 0;
        if (t < T_SLAM) {
          // black
          fx.globalHud = 0; fx.bloom = 0; gA.visible = false; gB.visible = false;
          camera.position.set(0, 0, 12); camera.lookAt(0, 0, 0);
          return;
        }
        if (phaseA) {
          const l = t - T_SLAM;
          camera.position.set(Math.sin(l * 0.3) * 0.4, 0.2 + Math.sin(l * 0.5) * 0.1, 13 - easeOutExpo(seg(l, 0, 0.3)) * 0.8 - l * 0.55);
          camera.lookAt(0, 0.4, 0);
          smokeMat.uniforms.uT.value = t; smokeMat.uniforms.uK.value = 0.28 + hit(t, T_SLAM, 3) * 0.5;
          const s = slam(t, T_SLAM, 0.18, 3.2);
          hasan.group.scale.setScalar(s); hasan.group.position.set(0, 0.6, 0);
          hasan.glyphs.forEach((g, i) => { g.mesh.rotation.y = Math.sin(l * 1.3 + i) * 0.06; g.mesh.position.y = g.home.y + Math.sin(l * 2 + i) * 0.03; });
          for (let i = 0; i < NS; i++) {
            const v = sparkVel[i];
            sparkPos[i * 3] = v[0] * l * Math.exp(-l * 0.8);
            sparkPos[i * 3 + 1] = 0.6 + v[1] * l * Math.exp(-l * 0.8) - 4 * l * l;
            sparkPos[i * 3 + 2] = 1 + v[2] * l;
          }
          sparkGeo.attributes.position.needsUpdate = true;
          sparkMat.opacity = Math.exp(-l * 1.2);
          const rs = 1 + easeOutExpo(seg(l, 0, 0.8)) * 14;
          ring.scale.setScalar(rs); ring.position.set(0, 0.6, -0.5); ringMat.opacity = (1 - seg(l, 0, 0.8)) * 0.9;
          key.position.set(4, 6, 10); key.intensity = 3.2;
          fx.flash = hit(t, T_SLAM, 12) * 0.95; fx.flashColor = [1, 0.25, 0.2];
          fx.shake = hit(t, T_SLAM, 4) * 0.55; fx.shakeRot = hit(t, T_SLAM, 5) * 0.04;
          fx.chroma = 3 + hit(t, T_SLAM, 4) * 32; fx.radialBlur = hit(t, T_SLAM, 6) * 0.5;
          fx.bloom = 0.5 + hit(t, T_SLAM, 3) * 0.8; fx.bloomThreshold = 0.9; fx.vignette = 0.7; fx.tint = [1.05, 0.9, 0.9];
          // joke micro-hit
          fx.shake += hit(t, T_JOKE, 10) * 0.1;
          return;
        }
        // ---------- space ----------
        const end = t >= T_END;
        fx.bloomThreshold = 1.0; fx.bloom = 0.7; sun?.setIntensity?.(0.3);
        hemi.intensity = 0.35; rim.color.set(0x88aaff); rim.intensity = 1.5; key.intensity = 2.0;
        key.position.copy(sunDir).multiplyScalar(20);
        if (!end) {
          const l = t - T_SPACE;
          earth.group.position.set(0, -26, -18);
          camera.position.set(0.5 - l * 0.15, 1.2 + Math.sin(l * 0.4) * 0.15, 11 - l * 0.35);
          camera.lookAt(0, 0.4, 0);
          // coin tumble, captured at T_CAP
          const cp = seg(t, T_SPACE, T_CAP);
          const coinPos = new THREE.Vector3(-0.2 + cp * 0.2, 0.6, 0);
          if (t >= T_CAP) { const k = t - T_CAP; coinPos.set(0 + k * 0.25, 0.6 + k * 0.05, 0); }
          coinG.position.copy(coinPos);
          const spin = t < T_CAP ? l * 1.6 : (T_CAP - T_SPACE) * 1.6 + (t - T_CAP) * 0.3;
          coinG.rotation.set(0.4 + spin * 0.6, spin, 0.2);
          glowRingMat.opacity = 0; coinG.scale.setScalar(1);
          // craft swoop from right
          const a = easeInOutCubic(seg(t, T_SPACE, T_CAP));
          craft.position.set(coinPos.x + 1.4 + (1 - a) * 12, coinPos.y + (1 - a) * 3, (1 - a) * -4);
          craft.rotation.set(0, (1 - a) * 0.6, (1 - a) * 0.3);
          thr.scale.set(1, 0.6 + (1 - seg(t, T_CAP, T_CAP + 0.5)) * 1.0 + Math.sin(t * 40) * 0.1, 1);
          thrMat.opacity = 0.9 - seg(t, T_CAP, T_CAP + 1) * 0.6;
          libCraft?.setThrust?.(1 - seg(t, T_CAP, T_CAP + 0.6) * 0.7);
          const cg = hit(t, T_CAP, 3) * 1.5 + (t > T_CAP ? 0.4 + 0.3 * Math.sin(t * 10) : 0.2);
          plateMat.opacity = Math.min(1, cg); libCraft?.setCaptureGlow?.(cg);
          libCraft?.update?.(t);
          craft.visible = true;
          capRing.visible = t >= T_CAP;
          const rl = t - T_CAP;
          capRing.position.copy(coinPos); capRing.lookAt(camera.position);
          capRing.scale.setScalar(1 + easeOutExpo(seg(rl, 0, 1)) * 8); capRingMat.opacity = (1 - seg(rl, 0, 1)) * 0.5;
          rim2.intensity = hit(t, T_CAP, 2) * 15; rim2.position.set(coinPos.x, coinPos.y + 1, 3);
          fx.flash = hit(t, T_CAP, 8) * 0.6; fx.flashColor = [0.3, 0.9, 1];
          fx.shake = hit(t, T_CAP, 6) * 0.15;
          fx.chroma = 2 + hit(t, T_CAP, 5) * 12;
          // gachiho slam
          if (t >= T_GACHI) {
            gT.visible = true;
            const s = slam(t, T_GACHI, 0.18, 3.0);
            const out = 1 - smoothstep(43.0, 43.125, t);
            gT.scale.setScalar(s * Math.max(0.001, out));
            gT.position.set(camera.position.x, camera.position.y + 0.3, camera.position.z - 9);
            gT.quaternion.copy(camera.quaternion);
            t1.group.position.set(0, 1.0, 0); t2.group.position.set(0, -0.5, 0);
            const hue = (t * 0.25) % 1;
            goldMat.emissive.setHSL(hue, 0.9, 0.18 + hit(t, T_GACHI, 4) * 0.3);
            whiteMat.emissive.setHSL((hue + 0.5) % 1, 0.7, 0.06);
            fx.flash += hit(t, T_GACHI, 9) * 0.8; fx.flashColor = [1, 0.9, 0.6];
            fx.shake += hit(t, T_GACHI, 5) * 0.35; fx.shakeRot = hit(t, T_GACHI, 6) * 0.02;
            fx.chroma += hit(t, T_GACHI, 4) * 24; fx.radialBlur = hit(t, T_GACHI, 6) * 0.35;
            fx.bloom = 0.55 + hit(t, T_GACHI, 3) * 0.5;
            // push coin+craft down/back so text sits clear
            const d = easeOutExpo(seg(t, T_GACHI, T_GACHI + 0.4));
            coinG.position.y -= d * 2.6; craft.position.y -= d * 2.6;
          }
        } else {
          // END CARD
          const l = t - T_END;
          fx.globalHud = 0;
          craft.visible = false; capRing.visible = false;
          earth.group.position.set(0, -27, -14);
          camera.position.set(0, 0.2 + l * 0.05, 10 - l * 0.25);
          camera.lookAt(0, 0, 0);
          coinG.position.set(-3.3, 0.3, 0);
          coinG.rotation.set(Math.PI / 2 * 0 + 0.1 * Math.sin(l), Math.sin(l * 0.8) * 0.35, 0);
          coin.rotation.set(Math.PI / 2, Math.PI / 2, 0);
          coinG.scale.setScalar(1.6);
          glowRingMat.opacity = 0.9; glowRingMat.color.setHSL((t * 0.3) % 1, 1, 0.6);
          glowRing.rotation.z = l;
          fx.bloom = 0.8; fx.fade = smoothstep(44.4, 45.0, t);
          fx.flash = hit(t, T_END, 8) * 0.3; fx.flashColor = [1, 1, 1];
        }
        if (sun) { sun.group.visible = !end && t < T_GACHI - 0.05; if (t >= T_GACHI - 0.05) sun.setIntensity?.(0); }
        sun?.update?.(t, camera, ctx.renderer);
      },
      hud(g, t, lt, fx) {
        if (t < T_SLAM) {
          const f = hash1(Math.floor(t * 20)) > 0.35 ? 1 : 0.2;
          glowText(g, 'NO SIGNAL', 960, 540, { font: FONTS.mono(34), color: 'rgba(220,220,220,0.5)', align: 'center', alpha: f * 0.6, blur: 6 });
          return;
        }
        if (t >= T_JOKE && t < T_SPACE) {
          const p = easeOutBack(seg(t, T_JOKE, T_JOKE + 0.2), 2.5);
          const str = '※キオクシアじゃなくて、俺が。';
          g.save();
          g.translate(960, 900); g.scale(p, p);
          g.font = FONTS.noto(64);
          const w = g.measureText(str).width + 80;
          g.fillStyle = '#ffd400'; g.fillRect(-w / 2 - 8, -58, w + 16, 116);
          g.fillStyle = '#000'; g.fillRect(-w / 2, -50, w, 100);
          glowText(g, str, 0, 2, { font: FONTS.noto(64), color: '#ffffff', align: 'center', glow: false });
          g.restore();
        }
        if (t >= T_CAP && t < T_END) {
          const p = easeOutBack(seg(t, T_CAP, T_CAP + 0.25), 2);
          const a = t < T_GACHI ? 1 : 1 - seg(t, T_GACHI, T_GACHI + 0.25);
          if (a > 0.001) { g.save(); g.translate(1160, 220); g.scale(p, p);
          panel(g, 0, 0, 560, 170, { stroke: COLORS.cyan, fill: 'rgba(4,20,34,0.7)', alpha: a });
          glowText(g, 'デブリ回収 成功', 30, 60, { font: FONTS.noto(56), color: COLORS.cyan, alpha: a });
          glowText(g, 'CAPTURED', 30, 128, { font: FONTS.orb(40), color: COLORS.white, spacing: 8, alpha: a }); }
          g.restore();
        }
        if (t >= T_END) {
          const a = seg(t, T_END, T_END + 0.4);
          glowText(g, 'タック｜デブリになる3秒前', 880, 470, { font: FONTS.noto(64), color: COLORS.white, alpha: a });
          glowText(g, '@tack_trade', 880, 570, { font: FONTS.orb(44), color: COLORS.cyan, alpha: seg(t, T_END + 0.2, T_END + 0.6) });
          glowText(g, '※演出です。投資助言ではありません', 960, 1020, { font: FONTS.noto(26), color: COLORS.dim, align: 'center', alpha: a, glow: false });
        }
      },
    };
  },
};
