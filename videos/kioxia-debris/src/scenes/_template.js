// Reference scene showing the scene contract. Copy patterns from here; do not import it.
//
// A scene module default-exports { create(ctx) } returning:
//   scene   THREE.Scene
//   camera  THREE.PerspectiveCamera (aspect = ctx.aspect)
//   update(t, lt, fx)   t = global seconds, lt = seconds since this scene's start.
//                       MUST be a pure function of t (frames render out of order, in parallel).
//                       Mutate `fx` (see src/lib/fx.js) for bloom/flash/shake/glitch/etc.
//   hud(g, t, lt, fx)   optional 2D overlay on a 1920x1080 logical canvas (sRGB colours).
import * as THREE from 'three';
import { makeText3D } from '../lib/text3d.js';
import { seg, easeOutExpo, slam, hit } from '../lib/ease.js';
import { B, beatPulse } from '../lib/beats.js';
import { glowText, FONTS, COLORS } from '../lib/hudkit.js';

export default {
  async create(ctx) {
    const { assets } = ctx;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02030a);
    const camera = new THREE.PerspectiveCamera(40, ctx.aspect, 0.1, 500);

    scene.add(new THREE.HemisphereLight(0x8899ff, 0x110000, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(4, 6, 8);
    scene.add(key);

    const red = new THREE.MeshStandardMaterial({ color: 0xff1133, emissive: 0x550010, metalness: 0.6, roughness: 0.25 });
    const title = makeText3D(assets.fonts.dela, '急落', { size: 2.2, depth: 0.6, bevel: 0.04, material: red });
    scene.add(title.group);

    const coinMat = new THREE.MeshStandardMaterial({ map: assets.avatar, metalness: 0.1, roughness: 0.5 });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.12, 64), [
      new THREE.MeshStandardMaterial({ color: 0xffc85a, metalness: 1, roughness: 0.3 }), coinMat, coinMat,
    ]);
    coin.rotation.x = Math.PI / 2;
    coin.position.set(0, -2.4, 0);
    scene.add(coin);

    const T0 = 0.5; // slam time (scene-local)
    return {
      scene,
      camera,
      update(t, lt, fx) {
        camera.position.set(Math.sin(lt * 0.4) * 2, 0.5, 9 - easeOutExpo(seg(lt, 0, 1.5)) * 2);
        camera.lookAt(0, -0.4, 0);
        const s = slam(lt, T0, 0.2, 3.5);
        title.group.scale.setScalar(s);
        title.group.visible = s > 0;
        title.glyphs.forEach((gl, i) => { gl.mesh.rotation.y = Math.sin(lt * 2 + i) * 0.15; });
        coin.rotation.z = lt * 2;
        fx.flash = hit(lt, T0, 10) * 0.8;
        fx.flashColor = [1, 0.2, 0.3];
        fx.shake = hit(lt, T0, 6) * 0.25;
        fx.chroma = 4 + hit(lt, T0, 5) * 20;
        fx.bloom = 1.0 + beatPulse(t) * 0.4;
      },
      hud(g, t, lt, fx) {
        glowText(g, 'キオクシア 285A', 120, 980, { font: FONTS.noto(54), color: COLORS.red });
        glowText(g, '▼ −50%', 1800, 980, { font: FONTS.orb(64), color: COLORS.red, align: 'right' });
      },
    };
  },
};
