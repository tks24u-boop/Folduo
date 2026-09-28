// s1_orbit — global 0.000–9.375 (bars 1–5).
// Low orbit over Earth's night side -> sunrise burst over the limb (3.75) -> hero NAND chip rises,
// avatar coin orbits, gold 3D 「最高値更新」 slam (5.625) -> pre-drop push-in (7.5) -> glitch 「しかし——」 (8.906).
// Self-contained: all 3D assets are built in-scene (procedural Earth shader, sun sprites, chip, coin, streaks).
import * as THREE from 'three';
import { makeText3D } from '../lib/text3d.js';
import {
  seg, lerp, smoothstep, easeOutExpo, easeOutCubic, easeInCubic, easeInQuad, easeInOutCubic, slam, hit,
} from '../lib/ease.js';
import { beatPulse, subPulse } from '../lib/beats.js';
import { rng, hash1, fbm1 } from '../lib/rand.js';
import { glowText, panel, brackets, typed, ticker, FONTS, COLORS } from '../lib/hudkit.js';

const R = 50;
const ALT = 4;
const DELTA = Math.acos(R / (R + ALT)); // horizon dip angle
const T_SUN = 3.75, T_SLAM = 5.625, T_PRE = 7.5, T_GL = 8.90625;
const FOV = 45;
const TAN_V = Math.tan((FOV / 2) * Math.PI / 180);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

function radialTex(stops, size = 256) {
  return canvasTex(size, size, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}

const EARTH_VS = /* glsl */`
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
void main(){
  vObj = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const EARTH_FS = /* glsl */`
uniform vec3 uSunDir; uniform float uSun; uniform float uR; uniform vec3 uCity;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1.,0.)), u.x), mix(h21(i+vec2(0.,1.)), h21(i+vec2(1.,1.)), u.x), u.y); }
float lights(vec2 g, float thr, out float fw){
  vec2 id = floor(g); vec2 f = fract(g);
  vec2 r = vec2(h21(id), h21(id + 17.3)) * 0.6 + 0.2;
  float d = length(f - r);
  fw = length(fwidth(g));
  float sz = 0.035 + 0.05 * h21(id + 9.1);
  float on = step(thr, h21(id + 3.7));
  return on * (1.0 - smoothstep(sz * 0.25, sz + fw * 0.9, d)) * (0.5 + h21(id + 5.5));
}
void main(){
  vec3 p = normalize(vObj);
  float lat = asin(clamp(p.x, -1.0, 1.0));
  float lon = atan(p.y, p.z);
  vec2 uv = vec2(lon, lat) * uR;
  float dens = vn(uv * 0.11) * 0.6 + vn(uv * 0.33 + 7.0) * 0.3 + vn(uv * 1.1 + 3.0) * 0.1;
  float land = smoothstep(0.42, 0.55, dens);
  float city = smoothstep(0.55, 0.78, dens);
  float fw1, fw2;
  float l1 = lights(uv * 2.4, 0.8 - city * 0.45, fw1);
  float l2 = lights(uv * 7.0 + 11.0, 0.85 - city * 0.5, fw2);
  float L = (l1 * (0.5 + city * 2.5) + l2 * (0.3 + city * 1.2)) * land;
  float far = clamp(fw1 * 1.6, 0.0, 1.0);
  L = mix(L, land * (0.02 + city * 0.12), far);
  vec3 col = vec3(0.003, 0.006, 0.016) + land * vec3(0.006, 0.008, 0.014);
  col += L * uCity * 1.3;
  vec3 V = normalize(cameraPosition - vW);
  float ndv = max(dot(normalize(vN), V), 0.0);
  col += vec3(0.02, 0.07, 0.22) * pow(1.0 - ndv, 4.0) * 1.6;
  float sd = max(dot(-V, uSunDir), 0.0);
  col += vec3(1.0, 0.42, 0.12) * pow(sd, 90.0) * uSun * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

const ATM_FS = /* glsl */`
uniform vec3 uSunDir; uniform float uSun; uniform float uR; uniform float uH;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 rd = normalize(vW - cameraPosition);
  vec3 oc = cameraPosition;
  float tca = -dot(oc, rd);
  float b = sqrt(max(dot(oc, oc) - tca * tca, 0.0));
  float hgt = (b - uR) / uH;
  float glow;
  if (hgt > 0.0) glow = exp(-hgt * 5.0) * (1.0 - smoothstep(0.6, 1.0, hgt));
  else glow = exp(hgt * 25.0) * 0.6 + 0.01;
  float s = max(dot(rd, uSunDir), 0.0);
  vec3 blue = vec3(0.12, 0.42, 1.0);
  vec3 col = blue * glow * 0.8;
  col += vec3(1.0, 0.55, 0.22) * glow * (pow(s, 14.0) * 0.7 + pow(s, 200.0) * 2.5) * uSun;
  col += vec3(0.4, 0.65, 1.0) * pow(max(1.0 - abs(hgt) * 8.0, 0.0), 2.0) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

const STREAK_VS = /* glsl */`
attribute float aSeed; varying vec2 vUv; varying float vSeed;
void main(){ vUv = uv; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STREAK_FS = /* glsl */`
uniform float uTime; uniform vec3 uColor; uniform float uAmp;
varying vec2 vUv; varying float vSeed;
void main(){
  float e = 1.0 - abs(vUv.x * 2.0 - 1.0); e = e * e;
  float f = pow(vUv.y, 2.2);
  float pulse = 0.55 + 0.45 * sin(vUv.y * 22.0 - uTime * 38.0 + vSeed * 40.0);
  float head = smoothstep(0.85, 1.0, vUv.y) * 1.2;
  gl_FragColor = vec4(uColor * (f * pulse + head) * e * uAmp, 1.0);
}`;

export default {
  async create(ctx) {
    const { assets, envMap } = ctx;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010207);
    const camera = new THREE.PerspectiveCamera(FOV, ctx.aspect, 0.1, 3000);
    const CAM_POS = new THREE.Vector3(0, R + ALT, 0);
    camera.position.copy(CAM_POS);
    camera.rotation.order = 'YXZ';
    scene.add(camera);

    // ---------------- Lights ----------------
    scene.add(new THREE.HemisphereLight(0x3a5cff, 0x050208, 0.35));
    const sunLight = new THREE.DirectionalLight(0xffd7a0, 0);
    scene.add(sunLight);
    scene.add(sunLight.target);

    // ---------------- Stars ----------------
    const starGroup = new THREE.Group();
    scene.add(starGroup);
    const dotTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']], 64);
    const starMats = [];
    {
      const r = rng(1234);
      const mk = (n, size, bright) => {
        const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const u = r() * 0.9 + 0.05; // upper hemisphere bias
          const th = r() * Math.PI * 2;
          const y = u * 2 - 1;
          const s = Math.sqrt(1 - y * y);
          const d = 1500;
          pos[i * 3] = s * Math.cos(th) * d;
          pos[i * 3 + 1] = CAM_POS.y + (y * 0.9 + 0.1) * d;
          pos[i * 3 + 2] = s * Math.sin(th) * d;
          const k = (0.4 + r() * 0.6) * bright;
          const tintR = r();
          col[i * 3] = k * (tintR > 0.8 ? 1.0 : 0.8);
          col[i * 3 + 1] = k * 0.88;
          col[i * 3 + 2] = k * (tintR < 0.3 ? 1.3 : 1.0);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const mat = new THREE.PointsMaterial({
          size, sizeAttenuation: false, vertexColors: true, map: dotTex, transparent: true,
          depthWrite: false, blending: THREE.AdditiveBlending,
        });
        starMats.push(mat);
        starGroup.add(new THREE.Points(geo, mat));
      };
      mk(2600, 2.2, 1.0);
      mk(260, 4.5, 2.2);
    }

    // Nebula (soft canvas clouds, far away, upper-left sky)
    const nebTex = canvasTex(512, 256, (g, w, h) => {
      const r = rng(77);
      for (let i = 0; i < 40; i++) {
        const x = r() * w, y = h * 0.5 + (r() - 0.5) * h * 0.6, rad = 40 + r() * 110;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        const c = r() < 0.5 ? '90,60,200' : r() < 0.5 ? '40,110,255' : '200,60,160';
        gr.addColorStop(0, `rgba(${c},0.18)`);
        gr.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }
    });
    const nebMat = new THREE.SpriteMaterial({ map: nebTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
    const neb = new THREE.Sprite(nebMat);
    neb.position.set(-600, CAM_POS.y + 520, -1100);
    neb.scale.set(1900, 950, 1);
    neb.material.rotation = -0.35;
    scene.add(neb);

    // ---------------- Earth ----------------
    const earthUni = {
      uSunDir: { value: new THREE.Vector3(0, 0, -1) }, uSun: { value: 0 }, uR: { value: R },
      uCity: { value: new THREE.Color(1.0, 0.6, 0.22) }, uH: { value: R * 0.03 },
    };
    const earthMat = new THREE.ShaderMaterial({ uniforms: earthUni, vertexShader: EARTH_VS, fragmentShader: EARTH_FS });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 256, 160), earthMat);
    scene.add(earth);
    const atmMat = new THREE.ShaderMaterial({
      uniforms: earthUni, vertexShader: EARTH_VS, fragmentShader: ATM_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const atm = new THREE.Mesh(new THREE.SphereGeometry(R * 1.03, 256, 128), atmMat);
    scene.add(atm);

    // ---------------- Sun ----------------
    const sunCoreTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,250,235,1)'], [0.2, 'rgba(255,220,160,0.6)'], [0.45, 'rgba(255,170,80,0.15)'], [1, 'rgba(255,120,40,0)']]);
    const haloTex = radialTex([[0, 'rgba(255,230,180,0.9)'], [0.1, 'rgba(255,200,120,0.35)'], [0.35, 'rgba(255,140,60,0.08)'], [1, 'rgba(255,100,40,0)']]);
    const streakTex = canvasTex(1024, 64, (g, w, h) => {
      const gx = g.createLinearGradient(0, 0, w, 0);
      gx.addColorStop(0, 'rgba(120,170,255,0)');
      gx.addColorStop(0.35, 'rgba(140,190,255,0.35)');
      gx.addColorStop(0.5, 'rgba(255,255,255,1)');
      gx.addColorStop(0.65, 'rgba(140,190,255,0.35)');
      gx.addColorStop(1, 'rgba(120,170,255,0)');
      g.fillStyle = gx;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-in';
      const gy = g.createLinearGradient(0, 0, 0, h);
      gy.addColorStop(0, 'rgba(0,0,0,0)');
      gy.addColorStop(0.5, 'rgba(0,0,0,1)');
      gy.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gy;
      g.fillRect(0, 0, w, h);
    });
    const mkSprite = (map, depthTest) => new THREE.Sprite(new THREE.SpriteMaterial({
      map, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, transparent: true,
    }));
    const sunCore = mkSprite(sunCoreTex, true);
    const sunHalo = mkSprite(haloTex, false);
    const sunStreak = mkSprite(streakTex, false);
    const sunStreak2 = mkSprite(streakTex, false);
    scene.add(sunCore, sunHalo, sunStreak, sunStreak2);

    // ---------------- Stage (camera-relative hero objects) ----------------
    const stage = new THREE.Group();
    camera.add(stage);
    const keyLight = new THREE.DirectionalLight(0xdfe8ff, 1.3);
    keyLight.position.set(-5, 6, 4);
    stage.add(keyLight);
    const keyTarget = new THREE.Object3D();
    keyTarget.position.set(0, 0, -8);
    stage.add(keyTarget);
    keyLight.target = keyTarget;
    const fillLight = new THREE.DirectionalLight(0x6a8cff, 0.8);
    fillLight.position.set(6, -2, 3);
    fillLight.target = keyTarget;
    stage.add(fillLight);

    // Lens-flare ghosts (camera space)
    const ghostTex = radialTex([[0, 'rgba(255,255,255,0.0)'], [0.6, 'rgba(255,255,255,0.25)'], [0.85, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 128);
    const ghosts = [
      { k: 0.35, s: 0.5, c: [0.4, 0.8, 1.0] }, { k: -0.25, s: 0.9, c: [0.3, 1.0, 0.6] },
      { k: -0.6, s: 0.35, c: [1.0, 0.6, 0.3] }, { k: -1.05, s: 1.4, c: [0.5, 0.4, 1.0] },
    ].map((o) => {
      const sp = mkSprite(ghostTex, false);
      sp.material.color.setRGB(...o.c);
      stage.add(sp);
      return { ...o, sp };
    });

    // Chip
    const chipRoot = new THREE.Group();
    stage.add(chipRoot);
    const chipPivot = new THREE.Group();
    chipRoot.add(chipPivot);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x07080c, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, envMap, envMapIntensity: 0.12,
    });
    const goldMat = new THREE.MeshPhysicalMaterial({
      color: 0xffc85a, metalness: 1, roughness: 0.22, envMap, envMapIntensity: 0.22, emissive: 0x6a3a00, emissiveIntensity: 0.5,
    });
    const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 4.0, 1.5), toneMapped: false });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.34, 3.2), bodyMat);
    chipPivot.add(body);
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.04, 2.3), bodyMat);
    inlay.position.y = 0.19;
    chipPivot.add(inlay);
    // gold frame on top
    const frameW = 0.07;
    for (const [x, z, w, d] of [[0, -1.15, 2.37, frameW], [0, 1.15, 2.37, frameW], [-1.15, 0, frameW, 2.37], [1.15, 0, frameW, 2.37]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), goldMat);
      m.position.set(x, 0.2, z);
      chipPivot.add(m);
    }
    // green neon edge
    for (const [x, z, w, d] of [[0, -1.62, 3.26, 0.05], [0, 1.62, 3.26, 0.05], [-1.62, 0, 0.05, 3.26], [1.62, 0, 0.05, 3.26]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), edgeMat);
      m.position.set(x, 0.17, z);
      chipPivot.add(m);
    }
    // circuit dots
    {
      const n = 36;
      const dots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.02, 0.08), edgeMat, n);
      const r = rng(9);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const side = i % 4, u = (r() - 0.5) * 2.0;
        const off = 1.32 + r() * 0.12;
        const x = side === 0 ? u : side === 1 ? u : side === 2 ? -off : off;
        const z = side === 0 ? -off : side === 1 ? off : u;
        m4.makeTranslation(x, 0.18, z);
        dots.setMatrixAt(i, m4);
      }
      chipPivot.add(dots);
    }
    // pins
    {
      const per = 14, n = per * 4;
      const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.06, 0.34), goldMat, n);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const yAxis = new THREE.Vector3(0, 1, 0);
      let k = 0;
      for (let s = 0; s < 4; s++) {
        for (let i = 0; i < per; i++) {
          const u = -1.4 + (2.8 * i) / (per - 1);
          const pos = s === 0 ? [u, -0.1, -1.72] : s === 1 ? [u, -0.1, 1.72] : s === 2 ? [-1.72, -0.1, u] : [1.72, -0.1, u];
          q.setFromAxisAngle(yAxis, s < 2 ? 0 : Math.PI / 2);
          m4.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(1, 1, 1));
          pins.setMatrixAt(k++, m4);
        }
      }
      chipPivot.add(pins);
    }
    // "285A" on top
    const labelFont = assets.fonts.orbitron || assets.fonts.dela;
    const chipText = makeText3D(labelFont, '285A', { size: 0.62, depth: 0.08, bevel: 0.01, material: goldMat });
    chipText.group.rotation.x = -Math.PI / 2;
    chipText.group.position.set(0, 0.25, 0.1);
    chipPivot.add(chipText.group);
    const nandText = makeText3D(labelFont, 'NAND', { size: 0.22, depth: 0.03, bevel: 0.0, material: edgeMat });
    nandText.group.rotation.x = -Math.PI / 2;
    nandText.group.position.set(0, 0.23, -0.72);
    chipPivot.add(nandText.group);
    // under-glow
    const glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
    const chipGlow = mkSprite(glowTex, true);
    chipGlow.material.color.setRGB(0.1, 1.0, 0.45);
    chipGlow.position.set(0, -0.6, -0.8);
    chipGlow.scale.set(7.5, 5, 1);
    chipRoot.add(chipGlow);
    const chipGreen = new THREE.PointLight(0x1dff8f, 0, 12, 1.5);
    chipGreen.position.set(0, -2.2, 1.5);
    chipRoot.add(chipGreen);

    // Exhaust / light streaks below the chip
    const streakUni = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.15, 1.6, 0.6) }, uAmp: { value: 1 } };
    {
      const N = 18, r = rng(55);
      const pos = [], uvs = [], seeds = [], idx = [];
      for (let i = 0; i < N; i++) {
        const x = (r() - 0.5) * 2.8, z = (r() - 0.5) * 1.6;
        const w = 0.035 + r() * 0.1, len = 3 + r() * 6, top = -0.3 - r() * 0.4;
        const b = pos.length / 3;
        pos.push(x - w / 2, top - len, z, x + w / 2, top - len, z, x + w / 2, top, z, x - w / 2, top, z);
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        const s = r();
        seeds.push(s, s, s, s);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
      geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        uniforms: streakUni, vertexShader: STREAK_VS, fragmentShader: STREAK_FS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const streaks = new THREE.Mesh(geo, mat);
      streaks.frustumCulled = false;
      chipRoot.add(streaks);
    }

    // Rising green particles
    const riseN = 160;
    const riseSeeds = [];
    const risePos = new Float32Array(riseN * 3);
    {
      const r = rng(321);
      for (let i = 0; i < riseN; i++) riseSeeds.push([(r() - 0.5) * 9, (r() - 0.5) * 4, r(), 0.8 + r() * 1.6]);
    }
    const riseGeo = new THREE.BufferGeometry();
    riseGeo.setAttribute('position', new THREE.BufferAttribute(risePos, 3));
    const riseMat = new THREE.PointsMaterial({
      size: 5, sizeAttenuation: false, map: dotTex, color: new THREE.Color(0.3, 2.0, 0.9), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const rise = new THREE.Points(riseGeo, riseMat);
    rise.frustumCulled = false;
    chipRoot.add(rise);

    // Avatar coin
    const coinRoot = new THREE.Group();
    chipRoot.add(coinRoot);
    const coinFace = new THREE.MeshStandardMaterial({ map: assets.avatar, metalness: 0.2, roughness: 0.45, envMap, envMapIntensity: 0.06, emissive: 0xffffff, emissiveMap: assets.avatar, emissiveIntensity: 0.5 });
    const coinRim = new THREE.MeshPhysicalMaterial({ color: 0xffc85a, metalness: 1, roughness: 0.2, envMap, envMapIntensity: 0.25, emissive: 0x553000, emissiveIntensity: 0.6 });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.13, 64), [coinRim, coinFace, coinFace]);
    coin.rotation.x = Math.PI / 2;
    const coinSpin = new THREE.Group();
    coinSpin.add(coin);
    coinRoot.add(coinSpin);
    const ringTex = canvasTex(256, 256, (g, w, h) => {
      const cg = g.createConicGradient(0, w / 2, h / 2);
      ['#ff3b5c', '#ffb23b', '#f9ff3b', '#3bff7a', '#3bd9ff', '#6a5bff', '#ff3bd4', '#ff3b5c'].forEach((c, i, a) => cg.addColorStop(i / (a.length - 1), c));
      g.shadowColor = '#ffffff';
      g.shadowBlur = 24;
      g.strokeStyle = cg;
      g.lineWidth = 22;
      g.beginPath(); g.arc(w / 2, h / 2, 86, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 8; g.globalAlpha = 0.6;
      g.beginPath(); g.arc(w / 2, h / 2, 108, 0, Math.PI * 2); g.stroke();
    });
    const coinRing = mkSprite(ringTex, true);
    coinRing.scale.set(2.3, 2.3, 1);
    coinRing.material.color.setRGB(1.2, 1.2, 1.2);
    coinRoot.add(coinRing);

    // Gold 3D slam text
    const textFace = new THREE.MeshPhysicalMaterial({
      color: 0xffb640, metalness: 1, roughness: 0.32, envMap, envMapIntensity: 0.05,
      emissive: 0x6a3a00, emissiveIntensity: 0.25, clearcoat: 1, clearcoatRoughness: 0.08,
    });
    const textSide = new THREE.MeshPhysicalMaterial({
      color: 0xb87a1a, metalness: 1, roughness: 0.3, envMap, envMapIntensity: 0.18,
      emissive: 0xff9a1a, emissiveIntensity: 1.6,
    });
    const title = makeText3D(assets.fonts.dela, '最高値更新', { size: 1.02, depth: 0.34, bevel: 0.035, materials: [textFace, textSide] });
    const titleRoot = new THREE.Group();
    titleRoot.add(title.group);
    stage.add(titleRoot);
    const TITLE_Z = -5.4;
    const titleLight = new THREE.PointLight(0xffe0a0, 0, 10, 1.2);
    titleLight.position.set(0, 1.5, TITLE_Z + 3);
    stage.add(titleLight);

    // Sparks + shockwave at the slam
    const sparkN = 220;
    const sparkSeeds = [];
    {
      const r = rng(4242);
      for (let i = 0; i < sparkN; i++) {
        const a = r() * Math.PI * 2, sp = 3 + r() * 9;
        sparkSeeds.push([Math.cos(a) * sp * 1.4, Math.sin(a) * sp * 0.9, (r() - 0.3) * 5, r()]);
      }
    }
    const sparkPos = new Float32Array(sparkN * 3);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({
      size: 6, sizeAttenuation: false, map: dotTex, color: new THREE.Color(3.0, 2.0, 0.8), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.frustumCulled = false;
    stage.add(sparks);
    const shockMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.3, 0.9, 0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const shock = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 96), shockMat);
    stage.add(shock);

    // ---------------- helpers ----------------
    const sunDir = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const chipScreen = { x: 960, y: 540, ok: false };
    const sunNdc = new THREE.Vector3();

    const sunElev = (t) => -DELTA - 0.05 + 0.058 * easeInCubic(seg(t, 2.7, T_SUN)) + Math.max(0, t - T_SUN) * 0.008;
    const SUN_AZ = 0.44;

    return {
      scene,
      camera,
      update(t, lt, fx) {
        // ---- camera ----
        const pitch1 = -(DELTA + 0.14), pitch2 = -(DELTA - 0.152);
        const tilt = easeInOutCubic(seg(t, 2.8, 4.6));
        const pitch = lerp(pitch1, pitch2, tilt) + Math.sin(t * 0.7) * 0.006;
        const yaw = Math.sin(t * 0.35) * 0.025 - 0.02 + t * 0.002;
        const roll = lerp(-0.06, 0.02, tilt) + Math.sin(t * 0.5) * 0.012;
        camera.position.copy(CAM_POS);
        camera.rotation.set(pitch, yaw, roll);
        // forward glide over the surface (Earth rolls under us), accelerating in the pre-drop
        const pre = seg(t, T_PRE, T_GL);
        earth.rotation.x = t * 0.075 + easeInCubic(pre) * 0.12;
        const fovPunch = hit(t, T_SUN, 4) * 3 - easeInQuad(pre) * 6;
        camera.fov = FOV + fovPunch;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        // ---- stars / nebula ----
        const starA = smoothstep(0.0, 1.2, t);
        starMats[0].opacity = starA;
        starMats[1].opacity = starA;
        nebMat.opacity = 0.35 * smoothstep(0.3, 2.0, t) * (1 - 0.5 * hit(t, T_SUN, 2));

        // ---- sun ----
        const e = sunElev(t);
        sunDir.set(Math.sin(SUN_AZ) * Math.cos(e), Math.sin(e), -Math.cos(SUN_AZ) * Math.cos(e)).normalize();
        const sunPos = tmp.copy(CAM_POS).addScaledVector(sunDir, 900);
        const creep = smoothstep(2.9, T_SUN, t);
        const burst = hit(t, T_SUN, 4.5);
        const after = t >= T_SUN ? 1 : 0;
        const sunI = (creep * 0.5 + after * (0.55 + burst * 1.2)) * (1 - easeInCubic(seg(t, T_PRE, T_GL)) * 0.7);
        sunCore.position.copy(sunPos);
        sunHalo.position.copy(sunPos);
        sunStreak.position.copy(sunPos);
        sunStreak2.position.copy(sunPos);
        sunCore.scale.setScalar(80 * (1 + burst * 0.6));
        sunCore.material.color.setRGB(2.4, 2.0, 1.5).multiplyScalar((0.3 + 0.7 * creep) * (1 - easeInCubic(seg(t, T_PRE, T_GL)) * 0.6));
        sunHalo.scale.setScalar(260 * (0.7 + sunI * 0.5));
        sunHalo.material.color.setRGB(1.0, 0.75, 0.45).multiplyScalar(sunI * (t >= T_SUN ? 0.08 : 0.16));
        sunHalo.material.depthTest = t < T_SUN + 0.3;
        const streakLen = 2600 * (0.3 + 0.7 * after) * (1 + burst * 0.8);
        sunStreak.scale.set(streakLen, 60 * (0.6 + burst), 1);
        sunStreak.material.color.setRGB(0.3, 0.42, 0.7).multiplyScalar(creep * 0.3 + after * (0.45 + burst * 1.2));
        sunStreak2.scale.set(streakLen * 0.45, 16, 1);
        sunStreak2.material.color.setRGB(0.8, 0.7, 0.5).multiplyScalar(creep * 0.3 + after * (0.5 + burst * 1.2));
        earthUni.uSunDir.value.copy(sunDir);
        earthUni.uSun.value = creep * 0.8 + after * (0.7 + burst * 1.3);
        sunLight.position.copy(CAM_POS).addScaledVector(sunDir, 50);
        sunLight.target.position.copy(CAM_POS).addScaledVector(sunDir, -10);
        sunLight.intensity = after * (1.2 + burst * 1.2) + creep * 0.3;

        // lens ghosts (camera space) from the sun's screen position
        sunNdc.copy(sunPos).project(camera);
        const ghostA = after * (0.12 + burst * 0.6) * (sunNdc.z < 1 ? 1 : 0);
        for (const gh of ghosts) {
          const d = 10;
          gh.sp.position.set(sunNdc.x * gh.k * TAN_V * ctx.aspect * d, sunNdc.y * gh.k * TAN_V * d, -d);
          gh.sp.scale.setScalar(gh.s);
          gh.sp.material.opacity = ghostA;
        }

        // ---- stage shake (moves hero objects too) ----
        const hs = hit(t, T_SLAM, 7) * 0.12 + hit(t, T_SUN, 6) * 0.05 + easeInQuad(pre) * 0.05 + (t > T_GL ? 0.06 : 0);
        stage.position.set(fbm1(t * 19, 5) * hs, fbm1(t * 19, 9) * hs, 0);

        // ---- chip ----
        const chipOn = t >= T_SUN;
        chipRoot.visible = chipOn;
        const riseP = easeOutExpo(seg(t, T_SUN + 0.05, T_SUN + 1.6));
        const push = easeInCubic(pre);
        const D = lerp(9.5, 3.6, push) - (t - T_SUN) * 0.12;
        const yOff = lerp(-7.5, 0.05, riseP) + Math.sin(t * 1.3) * 0.06 + (t - T_SUN) * 0.03;
        chipRoot.position.set(-0.15 + push * 0.15, yOff + push * 0.1, -D);
        chipPivot.rotation.set(Math.PI / 2 - 0.42 + (1 - riseP) * 0.5 - push * 0.15, Math.sin(t * 0.6) * 0.18 + 0.12 - (1 - riseP) * 0.3, Math.sin(t * 0.45) * 0.05 - 0.06);
        const kick = t >= T_SUN ? beatPulse(t, 9) : 0;
        const glitching = t >= T_GL;
        const glowK = (1 + kick * 0.8 - push * 0.35);
        if (!glitching) edgeMat.color.setRGB(0.2 * glowK, 2.2 * glowK, 0.8 * glowK);
        else edgeMat.color.setRGB(5, 0.3, 0.4);
        chipGlow.material.opacity = (0.15 + kick * 0.12) * riseP * (1 - push);
        chipGlow.material.color.setRGB(glitching ? 1.0 : 0.1, glitching ? 0.08 : 1.0, glitching ? 0.1 : 0.45);
        chipGreen.intensity = (1.5 + kick * 2.5 + push * 3) * riseP;
        chipGreen.color.set(glitching ? 0xff2a44 : 0x1dff8f);
        streakUni.uTime.value = t;
        streakUni.uAmp.value = (0.7 + kick * 0.6 + push * 0.4) * (0.5 + 0.5 * riseP) * (1 + (1 - riseP) * 1.2);
        streakUni.uColor.value.setRGB(glitching ? 1.8 : 0.15, glitching ? 0.12 : 1.6, glitching ? 0.2 : 0.6);
        // rising particles (closed form)
        for (let i = 0; i < riseN; i++) {
          const [x, z, ph, sp] = riseSeeds[i];
          const u = (ph + (t - T_SUN) * sp * 0.35 * (1 + push * 3)) % 1;
          risePos[i * 3] = x * (0.6 + u * 0.5);
          risePos[i * 3 + 1] = -7 + u * 12;
          risePos[i * 3 + 2] = z;
        }
        riseGeo.attributes.position.needsUpdate = true;
        riseMat.opacity = riseP * 0.9;
        riseMat.color.setRGB(glitching ? 2.0 : 0.3, glitching ? 0.2 : 2.0, glitching ? 0.25 : 0.9);

        // ---- coin orbit ----
        const orbA = (t - T_SUN) * (Math.PI * 2 / 2.5) + 1.2;
        const orbR = 3.0 - push * 1.1;
        coinRoot.position.set(Math.cos(orbA) * orbR, Math.sin(orbA) * orbR * 0.3 + 0.35, Math.sin(orbA) * orbR);
        coinRoot.visible = t >= T_SUN + 0.25;
        coinRoot.scale.setScalar(easeOutCubic(seg(t, T_SUN + 0.25, T_SUN + 0.9)));
        coinSpin.rotation.set(0.15 * Math.sin(t * 2), -0.5 + Math.sin(t * 1.6) * 0.35, 0);
        coinRing.material.rotation = -t * 2.2;
        coinRing.material.opacity = 0.75 + kick * 0.25;

        // ---- gold title slam ----
        const tOn = t >= T_SLAM && t < 7.36;
        titleRoot.visible = tOn;
        if (tOn) {
          const s = slam(t, T_SLAM, 0.18, 3.0);
          const fly = easeInCubic(seg(t, 7.0, 7.34));
          titleRoot.position.set(0, 0.12 + fly * 7 + Math.sin(t * 1.2) * 0.03, TITLE_Z + (t - T_SLAM) * 0.12);
          titleRoot.scale.setScalar(s * (1 + fly * 0.3));
          titleRoot.rotation.set(-0.06 + Math.sin(t * 0.9) * 0.02 - fly * 0.4, Math.sin(t * 0.7) * 0.06, 0);
          title.glyphs.forEach((gl, i) => {
            const wob = hit(t, T_SLAM + i * 0.03, 5);
            gl.mesh.rotation.y = Math.sin(t * 2.2 + i) * 0.05 + wob * 0.25 * Math.sin(i * 2.1);
            gl.mesh.position.y = gl.home.y + Math.sin(t * 2.4 + i * 0.9) * 0.02;
          });
          textSide.emissiveIntensity = 0.35 + hit(t, T_SLAM, 7) * 0.8 + kick * 0.2;
          textFace.emissiveIntensity = 0.25 + hit(t, T_SLAM, 8) * 0.3;
        }
        titleLight.intensity = tOn ? 0.4 + hit(t, T_SLAM, 5) * 3 : 0;
        // sparks
        const sdt = t - T_SLAM;
        sparks.visible = sdt >= 0 && sdt < 1.6;
        if (sparks.visible) {
          for (let i = 0; i < sparkN; i++) {
            const [vx, vy, vz, ph] = sparkSeeds[i];
            const k = 2.2;
            const f = (1 - Math.exp(-k * sdt)) / k;
            sparkPos[i * 3] = vx * f;
            sparkPos[i * 3 + 1] = vy * f - 2.5 * sdt * sdt + 0.1;
            sparkPos[i * 3 + 2] = TITLE_Z + 0.3 + vz * f;
          }
          sparkGeo.attributes.position.needsUpdate = true;
          sparkMat.opacity = Math.exp(-sdt * 2.2) * 0.8;
        }
        shock.visible = sdt >= 0 && sdt < 0.8;
        if (shock.visible) {
          shock.position.set(0, 0.1, TITLE_Z - 0.2);
          shock.scale.set(0.6 + easeOutCubic(seg(sdt, 0, 0.8)) * 9, 0.6 + easeOutCubic(seg(sdt, 0, 0.8)) * 5.5, 1);
          shockMat.opacity = Math.exp(-sdt * 4.5);
        }

        // ---- fx ----
        fx.bloom = 0.8 + creep * 0.3 + burst * 0.8 + (t >= T_SUN ? -0.2 + kick * 0.2 - push * 0.35 : 0) - (tOn ? 0.2 : 0);
        fx.bloomRadius = 0.5 + burst * 0.25;
        fx.bloomThreshold = t >= T_SUN ? lerp(0.9, 0.55, burst) : 0.3;
        fx.vignette = 0.5;
        fx.grain = 0.03;
        fx.fade = 1 - smoothstep(0.0, 1.0, t);
        fx.exposure = 1.0 + hit(t, T_SUN, 6) * 0.25;
        fx.flash = Math.max(hit(t, T_SUN, 13) * 0.55, hit(t, T_SLAM, 16) * 0.3);
        fx.flashColor = t >= T_SLAM ? [1, 0.82, 0.45] : [1, 0.88, 0.62];
        fx.shake = hit(t, T_SUN, 5) * 0.08 + hit(t, T_SLAM, 7) * 0.25 + push * 0.05;
        fx.shakeRot = hit(t, T_SLAM, 7) * 0.02 + push * 0.004;
        fx.chroma = 2 + hit(t, T_SUN, 5) * 12 + hit(t, T_SLAM, 6) * 26 + push * 16;
        fx.radialBlur = hit(t, T_SUN, 5) * 0.25 + hit(t, T_SLAM, 8) * 0.3 + push * 0.4 + subPulse(t, 4, 20) * pre * 0.08;
        fx.saturation = 1.08;
        fx.contrast = 1.05;

        if (glitching) {
          const gt = t - T_GL;
          const q = Math.floor(t * 40);
          const flick = hash1(q * 1.7 + 3);
          fx.glitch = gt < 0.04 ? 1.0 : gt < 0.1 ? 0.5 : 0.1 + flick * 0.18;
          const red = smoothstep(0, 0.06, gt);
          fx.tint = [lerp(1, 1.0, red), lerp(1, 0.1, red), lerp(1, 0.13, red)];
          fx.exposure = lerp(0.6, 0.08, easeOutCubic(seg(gt, 0.0, 0.2))) * (flick > 0.85 ? 1.8 : 1);
          fx.bloom = 0.7;
          fx.chroma = 30 - gt * 20;
          fx.scan = 0.5;
          fx.flash = hit(t, T_GL, 18) * 0.35;
          fx.flashColor = [1, 0.15, 0.2];
          fx.radialBlur = 0.15;
          fx.shake = 0.05;
          fx.saturation = 1.3;
          fx.vignette = 0.75;
        }

        // ---- chip screen position for the HUD leader line ----
        tmp.set(-1.3, 0.2, -1.3).applyMatrix4(chipPivot.matrixWorld);
        chipRoot.updateMatrixWorld(true);
        tmp.set(-1.2, 0.2, -1.2);
        chipPivot.localToWorld(tmp);
        tmp.project(camera);
        chipScreen.x = (tmp.x + 1) * 960;
        chipScreen.y = (1 - tmp.y) * 540;
        chipScreen.ok = tmp.z < 1;
      },

      hud(g, t, lt, fx) {
        // ---- boot panel (left-middle) ----
        if (t < 4.5) {
          const a = t < T_SUN ? smoothstep(0.15, 0.45, t) : 1 - smoothstep(T_SUN, 4.4, t);
          const x = 110, y = 400;
          panel(g, x, y, 520, 200, { alpha: a * 0.85, fill: 'rgba(3,12,24,0.42)', stroke: 'rgba(57,230,255,0.5)', lineWidth: 1.5 });
          brackets(g, x - 10, y - 10, 540, 220, { alpha: a, len: 20, lineWidth: 2 });
          const l1 = typed('> SYS BOOT .......... OK', t, 0.3, 40);
          const l2 = typed('MARKET FEED ... ONLINE', t, 0.75, 24);
          const l3 = typed('TSE 285A // キオクシア', t, 1.7, 14);
          const l4 = typed('SIGNAL ||||||  ORBIT: NIGHT SIDE', t, 2.5, 30);
          glowText(g, l1, x + 24, y + 38, { font: FONTS.mono(24), color: COLORS.dim, alpha: a, blur: 6 });
          glowText(g, l2, x + 24, y + 82, { font: FONTS.mono(32), color: COLORS.cyan, alpha: a, blur: 14 });
          glowText(g, l3, x + 24, y + 128, { font: FONTS.noto(32), color: COLORS.white, glow: COLORS.cyan, alpha: a, blur: 14 });
          glowText(g, l4, x + 24, y + 170, { font: FONTS.mono(22), color: COLORS.cyan, alpha: a * 0.75, blur: 6 });
          // blinking cursor
          if ((t * 3) % 1 < 0.55) {
            const lines = [[l1, 38, 24, 'mono'], [l2, 82, 32, 'mono'], [l3, 128, 32, 'noto'], [l4, 170, 22, 'mono']];
            let cur = lines[0];
            for (const L of lines) if (L[0].length) cur = L;
            g.save();
            g.font = cur[3] === 'noto' ? FONTS.noto(cur[2]) : FONTS.mono(cur[2]);
            const w = g.measureText(cur[0]).width;
            g.globalAlpha = a;
            g.fillStyle = COLORS.cyan;
            g.fillRect(x + 28 + w, y + cur[1] - cur[2] * 0.4, cur[2] * 0.5, cur[2] * 0.8);
            g.restore();
          }
          // "ONLINE" status dot
          if (l2.endsWith('ONLINE')) {
            g.save();
            g.globalAlpha = a;
            g.fillStyle = COLORS.green;
            g.shadowColor = COLORS.green; g.shadowBlur = 14;
            g.beginPath(); g.arc(x + 480, y + 82, 8, 0, Math.PI * 2); g.fill();
            g.restore();
          }
        }

        // ---- leader-line label on the chip ----
        if (t >= 4.25 && t < 7.9 && chipScreen.ok) {
          const p = easeOutCubic(seg(t, 4.25, 4.75));
          const a = 1 - smoothstep(7.55, 7.9, t);
          const ax = chipScreen.x, ay = chipScreen.y;
          const ex = 640, ey = 300, lx = 250;
          g.save();
          g.globalAlpha = a;
          g.strokeStyle = COLORS.green;
          g.shadowColor = COLORS.green; g.shadowBlur = 10;
          g.lineWidth = 2.5;
          g.beginPath();
          g.moveTo(ax, ay);
          const p1 = Math.min(1, p * 2), p2 = Math.max(0, p * 2 - 1);
          g.lineTo(lerp(ax, ex, p1), lerp(ay, ey, p1));
          if (p2 > 0) g.lineTo(lerp(ex, lx, p2), ey);
          g.stroke();
          g.fillStyle = COLORS.green;
          g.beginPath(); g.arc(ax, ay, 7 + beatPulse(t) * 4, 0, Math.PI * 2); g.fill();
          g.lineWidth = 2;
          g.beginPath(); g.arc(ax, ay, 16 + beatPulse(t) * 10, 0, Math.PI * 2); g.stroke();
          g.restore();
          if (p2 > 0.3) {
            const ta = a * smoothstep(0.3, 1, p2);
            glowText(g, 'キオクシア (285A)', lx, ey - 38, { font: FONTS.noto(48), color: COLORS.white, glow: COLORS.green, blur: 16, alpha: ta });
            glowText(g, 'NAND FLASH  ▲ MOMENTUM', lx + 2, ey + 28, { font: FONTS.mono(22), color: COLORS.green, alpha: ta * 0.9, blur: 8 });
          }
        }

        // ---- green ticker ----
        if (t >= 4.0 && t < T_GL) {
          const a = smoothstep(4.0, 4.35, t);
          g.save();
          g.globalAlpha = a;
          g.fillStyle = 'rgba(0,26,12,0.62)';
          g.fillRect(0, 898, 1920, 48);
          g.fillStyle = COLORS.green;
          g.shadowColor = COLORS.green; g.shadowBlur = 8;
          g.fillRect(0, 896, 1920, 2);
          g.fillRect(0, 946, 1920, 1);
          g.restore();
          g.save();
          g.globalAlpha = a;
          ticker(g, [
            { text: 'AI半導体 爆上げ ▲', color: COLORS.green },
            { text: 'キオクシア 285A ▲', color: '#b9ffd9' },
            { text: 'BULL RUN ▲', color: COLORS.green },
            { text: 'NAND ▲', color: '#b9ffd9' },
          ], 922, t, { font: FONTS.noto(30), speed: 260, gap: 70 });
          g.restore();
        }

        // ---- pre-drop: speed lines + BULL METER ----
        if (t >= T_PRE && t < T_GL) {
          const I = easeInQuad(seg(t, T_PRE, T_GL));
          g.save();
          g.lineCap = 'round';
          for (let i = 0; i < 90; i++) {
            const ang = hash1(i * 3.1) * Math.PI * 2;
            const ph = hash1(i * 7.7 + 1);
            const sp = 0.8 + hash1(i * 5.3) * 1.4;
            const u = (ph + (t - T_PRE) * sp * (1 + 2.5 * I)) % 1;
            const r0 = 260 + u * 1000;
            const len = 60 + 380 * I * u;
            const c = Math.cos(ang), s = Math.sin(ang);
            g.strokeStyle = i % 3 === 0 ? 'rgba(210,255,230,1)' : 'rgba(29,255,143,1)';
            g.globalAlpha = (0.15 + 0.6 * I) * u;
            g.lineWidth = 1.5 + hash1(i) * 2.5;
            g.beginPath();
            g.moveTo(960 + c * r0, 540 + s * r0);
            g.lineTo(960 + c * (r0 + len), 540 + s * (r0 + len));
            g.stroke();
          }
          g.restore();

          const fill = easeInQuad(seg(t, T_PRE + 0.05, 8.72));
          const a = smoothstep(T_PRE, T_PRE + 0.15, t);
          const x = 1700, y = 250, w = 46, h = 520;
          const full = fill >= 0.999;
          const flashA = full ? ((t * 12) % 1 < 0.5 ? 1 : 0.55) : 1;
          glowText(g, 'BULL METER', x + w / 2, y - 36, { font: FONTS.orb(22), color: COLORS.green, align: 'center', alpha: a, blur: 10 });
          panel(g, x - 8, y - 8, w + 16, h + 16, { alpha: a, fill: 'rgba(0,20,10,0.55)', stroke: COLORS.green, cut: 8 });
          g.save();
          g.globalAlpha = a * flashA;
          const fh = h * fill;
          const grd = g.createLinearGradient(0, y + h, 0, y);
          grd.addColorStop(0, '#0a7a44');
          grd.addColorStop(1, '#8dffc6');
          g.fillStyle = grd;
          g.shadowColor = COLORS.green; g.shadowBlur = 22;
          g.fillRect(x, y + h - fh, w, fh);
          g.shadowBlur = 0;
          g.fillStyle = 'rgba(0,0,0,0.45)';
          for (let k = 1; k < 20; k++) g.fillRect(x, y + (h * k) / 20 - 1, w, 2);
          g.restore();
          for (let k = 0; k <= 4; k++) {
            g.save();
            g.globalAlpha = a * 0.8;
            g.fillStyle = COLORS.green;
            g.fillRect(x - 22, y + (h * k) / 4 - 1, 12, 2);
            g.restore();
          }
          glowText(g, `${Math.round(fill * 100)}%`, x + w / 2, y + h + 50, { font: FONTS.orb(40), color: full ? COLORS.white : COLORS.green, glow: COLORS.green, align: 'center', alpha: a, blur: 18 });
          if (full) glowText(g, 'MAX', x + w / 2, y + h + 94, { font: FONTS.orb(24), color: COLORS.green, align: 'center', alpha: a * flashA, blur: 12 });
        }

        // ---- glitch: しかし—— ----
        if (t >= T_GL) {
          const gt = t - T_GL;
          const q = Math.floor(t * 40);
          // red glitch bars
          g.save();
          for (let i = 0; i < 7; i++) {
            const hy = hash1(q * 13.1 + i * 7.3);
            if (hy < 0.45) continue;
            g.globalAlpha = 0.25 + 0.4 * hash1(q + i);
            g.fillStyle = i % 2 ? COLORS.red : 'rgba(255,255,255,0.8)';
            g.fillRect(hash1(q * 3.3 + i) * 1200, hash1(q * 5.1 + i * 2.2) * 1080, 200 + hash1(i + q) * 700, 3 + hash1(q + i * 9) * 16);
          }
          g.restore();
          if (t >= 8.95) {
            const a = smoothstep(8.95, 8.975, t);
            const jx = (hash1(q * 2.7) - 0.5) * (gt < 0.2 ? 18 : 5);
            const jy = (hash1(q * 4.1) - 0.5) * (gt < 0.2 ? 8 : 2);
            // warning triangle
            g.save();
            g.globalAlpha = a;
            const tx = 960 + jx, ty = 392 + jy, s = 52;
            g.strokeStyle = COLORS.red;
            g.lineWidth = 7;
            g.lineJoin = 'round';
            g.shadowColor = COLORS.red; g.shadowBlur = 20;
            g.beginPath();
            g.moveTo(tx, ty - s); g.lineTo(tx + s * 1.1, ty + s * 0.8); g.lineTo(tx - s * 1.1, ty + s * 0.8); g.closePath();
            g.stroke();
            g.fillStyle = COLORS.red;
            g.fillRect(tx - 4, ty - s * 0.35, 8, s * 0.7);
            g.fillRect(tx - 4, ty + s * 0.45, 8, 8);
            g.restore();
            // RGB-split text
            g.save();
            g.globalAlpha = a * 0.6;
            glowText(g, 'しかし——', 960 + jx - 6, 560 + jy, { font: FONTS.noto(140), color: COLORS.red, align: 'center', glow: false });
            glowText(g, 'しかし——', 960 + jx + 6, 560 + jy, { font: FONTS.noto(140), color: '#39e6ff', align: 'center', glow: false, alpha: 0.5 });
            g.restore();
            glowText(g, 'しかし——', 960 + jx, 560 + jy, { font: FONTS.noto(140), color: COLORS.white, glow: COLORS.red, align: 'center', blur: 30, alpha: a });
            glowText(g, 'SIGNAL LOST', 960 + jx, 680 + jy, { font: FONTS.mono(30), color: COLORS.redHot, align: 'center', alpha: a * ((t * 8) % 1 < 0.6 ? 1 : 0.3), spacing: 8 });
          }
        }
      },
    };
  },
};
