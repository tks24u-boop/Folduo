// Final display-space pass: radial blur, chromatic aberration, glitch, grade, scanlines,
// vignette, HUD composite, flash, grain, letterbox, fade.
export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    tHud: { value: null },
    uRes: { value: [1920, 1080] },
    uTime: { value: 0 },
    uFrame: { value: 0 },
    uChroma: { value: 0 },
    uVignette: { value: 0.45 },
    uGrain: { value: 0.05 },
    uGlitch: { value: 0 },
    uScan: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: [1, 1, 1] },
    uFade: { value: 0 },
    uHud: { value: 1 },
    uTint: { value: [1, 1, 1] },
    uLift: { value: [0, 0, 0] },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uRadial: { value: 0 },
    uLetterbox: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tHud;
    uniform vec2 uRes;
    uniform float uTime, uFrame, uChroma, uVignette, uGrain, uGlitch, uScan, uFlash, uFade, uHud;
    uniform vec3 uFlashColor, uTint, uLift;
    uniform float uSat, uContrast, uRadial, uLetterbox;
    varying vec2 vUv;

    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

    vec3 sampleScene(vec2 uv) {
      vec2 d = uv - 0.5;
      float px = uChroma / uRes.x;
      vec2 dir = d * 2.0;
      vec3 c;
      c.r = texture2D(tDiffuse, uv - dir * px).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv + dir * px).b;
      return c;
    }

    void main() {
      vec2 uv = vUv;

      // --- glitch: horizontal slice displacement, quantised in time
      float gSlice = 0.0;
      if (uGlitch > 0.001) {
        float tq = floor(uFrame / 3.0);
        float band = floor(uv.y * mix(12.0, 48.0, hash(vec2(tq, 1.7))));
        float r = hash(vec2(band, tq));
        if (r < uGlitch * 0.55) {
          gSlice = (hash(vec2(band, tq + 9.1)) - 0.5) * 0.12 * uGlitch;
          uv.x += gSlice;
        }
      }

      // --- radial zoom blur
      vec3 col;
      if (uRadial > 0.001) {
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 12; i++) {
          float k = float(i) / 11.0;
          vec2 suv = mix(uv, vec2(0.5), k * uRadial * 0.12);
          float w = 1.0 - k * 0.6;
          acc += sampleScene(suv) * w;
          wsum += w;
        }
        col = acc / wsum;
      } else {
        col = sampleScene(uv);
      }
      if (uGlitch > 0.001 && abs(gSlice) > 0.0) {
        col.r = texture2D(tDiffuse, uv + vec2(gSlice * 0.6, 0.0)).r;
        col.b = texture2D(tDiffuse, uv - vec2(gSlice * 0.6, 0.0)).b;
      }

      // --- grade
      col = col * uTint + uLift * (1.0 - col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;

      // --- scanlines
      if (uScan > 0.001) {
        float s = 0.5 + 0.5 * sin(vUv.y * uRes.y * 1.5708);
        col *= 1.0 - uScan * 0.35 * s;
      }

      // --- vignette
      vec2 d = vUv - 0.5;
      d.x *= uRes.x / uRes.y;
      float v = smoothstep(1.05, 0.25, length(d));
      col *= mix(1.0, v, uVignette);

      // --- HUD (premultiplied alpha canvas), shares the glitch offset
      vec2 huv = vec2(vUv.x + gSlice, vUv.y);
      vec4 h = texture2D(tHud, huv);
      if (uGlitch > 0.001 && abs(gSlice) > 0.0) {
        h.r = texture2D(tHud, huv + vec2(gSlice * 0.5, 0.0)).r;
      }
      col = col * (1.0 - h.a * uHud) + h.rgb * uHud;

      // --- flash
      col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));

      // --- grain
      float n = hash(vUv * uRes + fract(uFrame * 0.6180339) * 100.0) - 0.5;
      col += n * uGrain;

      // --- letterbox
      if (uLetterbox > 0.001) {
        float bar = uLetterbox * 0.5;
        if (vUv.y < bar || vUv.y > 1.0 - bar) col = vec3(0.0);
      }

      col *= 1.0 - clamp(uFade, 0.0, 1.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};
