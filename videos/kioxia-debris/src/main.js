// Deterministic frame renderer. Driven by tools/render.mjs and tools/still.mjs through
// window.renderFrame(i) / window.renderAt(t) / window.renderSheet(times, cols).
//
// URL params:  ?w=1920&h=1080          output size (HUD always uses 1920x1080 logical coords)
//              &scenes=s1_orbit,s2_crash  only load these scene modules (faster isolated testing)
//              &q=0.95                 JPEG quality
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { loadAssets } from './lib/assets.js';
import { FinalShader } from './lib/finalShader.js';
import { makeFx, applyShake } from './lib/fx.js';
import { drawGlobalHud } from './hud.js';
import * as ease from './lib/ease.js';
import * as rand from './lib/rand.js';
import * as beats from './lib/beats.js';
import * as text3d from './lib/text3d.js';
import * as hudkit from './lib/hudkit.js';

const params = new URLSearchParams(location.search);
const W = +params.get('w') || 1920;
const H = +params.get('h') || 1080;
const JPEG_Q = +params.get('q') || 0.95;
const ONLY = params.get('scenes') ? params.get('scenes').split(',') : null;
const LAB = params.get('lab'); // e.g. /scratch/lab/space_lab.js -> rendered as the only scene over [0, duration)

async function init() {
  const cues = await (await fetch('/src/cues.json')).json();
  const FPS = cues.fps;

  const renderer = new THREE.WebGLRenderer({
    antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const assets = await loadAssets();

  // HUD canvas (drawn every frame, composited in the final pass)
  const hudCanvas = document.createElement('canvas');
  hudCanvas.width = W;
  hudCanvas.height = H;
  const hud = hudCanvas.getContext('2d');
  const hudTex = new THREE.CanvasTexture(hudCanvas);
  hudTex.colorSpace = THREE.NoColorSpace;
  hudTex.premultiplyAlpha = true;
  hudTex.minFilter = THREE.LinearFilter;
  hudTex.generateMipmaps = false;

  // Shared studio-style environment map for metallic / glossy materials (chrome text, gold, glass).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const ctx = {
    THREE, renderer, W, H, aspect: W / H, assets, cues, FPS, envMap,
    lib: { ease, rand, beats, text3d, hudkit },
  };

  // Load scenes
  const scenes = [];
  const sceneList = LAB ? [{ id: 'lab', file: LAB, start: 0, end: cues.duration }] : cues.scenes;
  for (const s of sceneList) {
    if (ONLY && !ONLY.includes(s.id)) continue;
    let mod;
    try {
      mod = await import(s.file.startsWith('/') ? s.file : `./scenes/${s.file}`);
    } catch (e) {
      console.error(`scene ${s.id} failed to import: ${e.message}`);
      mod = { default: placeholderScene(s.id) };
    }
    const def = mod.default;
    let inst;
    try {
      inst = await def.create(ctx);
    } catch (e) {
      console.error(`scene ${s.id} create() failed: ${e.stack || e.message}`);
      inst = await placeholderScene(s.id).create(ctx);
    }
    scenes.push({ id: s.id, start: s.start, end: s.end, inst });
  }

  // Post chain
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.9, 0.55, 0.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const final = new ShaderPass(FinalShader);
  final.uniforms.tHud.value = hudTex;
  final.uniforms.uRes.value = [W, H];
  composer.addPass(final);

  // Pre-compile every scene's shaders once so frame timings are stable.
  for (const s of scenes) {
    try { renderer.compile(s.inst.scene, s.inst.camera); } catch (e) { /* ignore */ }
  }

  const blackScene = new THREE.Scene();
  blackScene.background = new THREE.Color(0x000000);
  const blackCam = new THREE.PerspectiveCamera(50, W / H, 0.1, 10);

  function sceneAt(t) {
    for (const s of scenes) if (t >= s.start - 1e-9 && t < s.end - 1e-9) return s;
    return null;
  }

  function renderAt(t, frame = Math.round(t * FPS)) {
    const fx = makeFx();
    const s = sceneAt(t);
    let scene = blackScene, camera = blackCam, lt = 0;
    if (s) {
      lt = t - s.start;
      s.inst.update(t, lt, fx);
      scene = s.inst.scene;
      camera = s.inst.camera;
    }
    const restore = applyShake(camera, fx, t);

    renderer.toneMappingExposure = fx.exposure;
    bloom.strength = fx.bloom;
    bloom.radius = fx.bloomRadius;
    bloom.threshold = fx.bloomThreshold;
    renderPass.scene = scene;
    renderPass.camera = camera;

    // HUD
    hud.setTransform(1, 0, 0, 1, 0, 0);
    hud.clearRect(0, 0, W, H);
    hud.setTransform(W / 1920, 0, 0, H / 1080, 0, 0);
    if (s && s.inst.hud) {
      hud.save();
      try { s.inst.hud(hud, t, lt, fx); } catch (e) { console.error(`hud ${s.id}: ${e.message}`); }
      hud.restore();
    }
    drawGlobalHud(hud, t, fx);
    hudTex.needsUpdate = true;

    const u = final.uniforms;
    u.uTime.value = t;
    u.uFrame.value = frame;
    u.uChroma.value = fx.chroma * (W / 1920);
    u.uVignette.value = fx.vignette;
    u.uGrain.value = fx.grain;
    u.uGlitch.value = fx.glitch;
    u.uScan.value = fx.scan;
    u.uFlash.value = fx.flash;
    u.uFlashColor.value = fx.flashColor;
    u.uFade.value = fx.fade;
    u.uHud.value = fx.hud;
    u.uTint.value = fx.tint;
    u.uLift.value = fx.lift;
    u.uSat.value = fx.saturation;
    u.uContrast.value = fx.contrast;
    u.uRadial.value = fx.radialBlur;
    u.uLetterbox.value = fx.letterbox;

    composer.render();
    restore();
  }

  window.renderAt = (t) => {
    renderAt(t);
    return renderer.domElement.toDataURL('image/jpeg', JPEG_Q);
  };
  window.renderFrame = (i) => {
    renderAt(i / FPS, i);
    return renderer.domElement.toDataURL('image/jpeg', JPEG_Q);
  };
  /** Contact sheet: renders each time and tiles them with a timestamp label. */
  window.renderSheet = (times, cols = 4) => {
    const rows = Math.ceil(times.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = W * cols;
    sheet.height = H * rows;
    const sg = sheet.getContext('2d');
    sg.fillStyle = '#111';
    sg.fillRect(0, 0, sheet.width, sheet.height);
    times.forEach((t, i) => {
      renderAt(t);
      const x = (i % cols) * W, y = Math.floor(i / cols) * H;
      sg.drawImage(renderer.domElement, x, y, W, H);
      sg.fillStyle = 'rgba(0,0,0,0.7)';
      sg.fillRect(x, y, 150, 34);
      sg.fillStyle = '#ffea00';
      sg.font = "400 26px 'Share Tech Mono'";
      sg.textBaseline = 'top';
      sg.fillText(`t=${t.toFixed(3)}`, x + 6, y + 4);
      sg.strokeStyle = '#000';
      sg.strokeRect(x, y, W, H);
    });
    return sheet.toDataURL('image/jpeg', 0.9);
  };
  window.FPS = FPS;
  window.DURATION = cues.duration;
  window.ready = true;
}

function placeholderScene(id) {
  return {
    create(ctx) {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x220011);
      const camera = new THREE.PerspectiveCamera(50, ctx.aspect, 0.1, 100);
      return {
        scene, camera,
        update() {},
        hud(g) {
          g.fillStyle = '#ff4466';
          g.font = "900 64px 'Orbitron'";
          g.textAlign = 'center';
          g.fillText(`PLACEHOLDER ${id}`, 960, 540);
        },
      };
    },
  };
}

init().catch((e) => {
  console.error('init failed', e.stack || e.message);
  window.initError = String(e.stack || e.message);
});
