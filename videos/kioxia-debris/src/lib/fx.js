// Per-frame post-processing parameters. main.js creates a fresh object with these defaults
// every frame; the active scene mutates it inside update(t, lt, fx).
import { fbm1 } from './rand.js';

export function makeFx() {
  return {
    exposure: 1.0, // renderer tone-mapping exposure
    bloom: 0.9, // UnrealBloom strength
    bloomRadius: 0.55,
    bloomThreshold: 0.2, // luminance threshold (post tone-map-ish; lower => more glow)
    chroma: 0.0, // chromatic aberration in pixels at the frame edge (0..40)
    vignette: 0.45, // 0..1
    grain: 0.035, // film grain amount 0..0.3 (keep low: grain is expensive to encode)
    glitch: 0.0, // 0..1 horizontal block displacement + RGB split
    scan: 0.0, // CRT scanlines 0..1
    flash: 0.0, // 0..1 mix toward flashColor
    flashColor: [1, 1, 1],
    fade: 0.0, // 0..1 fade to black (applied last, also darkens HUD)
    shake: 0.0, // camera shake amplitude (world units, applied to camera position)
    shakeRot: 0.0, // camera shake roll/pitch amplitude (radians)
    shakeFreq: 18.0,
    hud: 1.0, // HUD opacity multiplier
    globalHud: 1.0, // 0 hides the persistent global HUD (LIVE badge, handle, frame corners)
    tint: [1, 1, 1], // multiply colour grade
    lift: [0, 0, 0], // add to shadows
    saturation: 1.0,
    contrast: 1.0,
    radialBlur: 0.0, // 0..1 zoom blur from centre (speed / impact)
    letterbox: 0.0, // 0..1 cinematic bars (0.1 ~= 2.35:1)
  };
}

/** Deterministic camera shake. Returns a restore() closure. */
export function applyShake(camera, fx, t) {
  if (!camera || (fx.shake <= 0 && fx.shakeRot <= 0)) return () => {};
  const p = camera.position.clone();
  const q = camera.quaternion.clone();
  const f = fx.shakeFreq;
  camera.position.x += fbm1(t * f, 11) * fx.shake;
  camera.position.y += fbm1(t * f, 23) * fx.shake;
  camera.position.z += fbm1(t * f, 37) * fx.shake * 0.5;
  camera.rotateZ(fbm1(t * f * 0.8, 41) * fx.shakeRot);
  camera.rotateX(fbm1(t * f * 0.8, 53) * fx.shakeRot * 0.5);
  return () => {
    camera.position.copy(p);
    camera.quaternion.copy(q);
  };
}
