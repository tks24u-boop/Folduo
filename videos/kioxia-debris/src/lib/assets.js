// Loads fonts (as opentype Font objects for 3D text AND as CSS FontFaces for 2D canvas HUD)
// and image textures. Everything resolves before window.ready is set.
import * as THREE from 'three';
import { parse as parseFont } from 'opentype';

const FONT_FILES = {
  dela: { url: '/assets/fonts/DelaGothicOne.ttf', family: 'Dela Gothic One', weight: '400' },
  noto: { url: '/assets/fonts/NotoSansJP-Black.ttf', family: 'Noto Sans JP', weight: '900' },
  orbitron: { url: '/assets/fonts/Orbitron-Black.ttf', family: 'Orbitron', weight: '900' },
  mono: { url: '/assets/fonts/ShareTechMono.ttf', family: 'Share Tech Mono', weight: '400' },
};

export async function loadAssets() {
  const fonts = {};
  await Promise.all(
    Object.entries(FONT_FILES).map(async ([key, f]) => {
      const buf = await (await fetch(f.url)).arrayBuffer();
      fonts[key] = parseFont(buf);
      const face = new FontFace(f.family, buf, { weight: f.weight });
      await face.load();
      document.fonts.add(face);
    })
  );
  // Make sure every CSS font is usable in canvas right away.
  await document.fonts.ready;

  const loader = new THREE.TextureLoader();
  const avatar = await loader.loadAsync('/assets/avatar.jpg');
  avatar.colorSpace = THREE.SRGBColorSpace;
  avatar.anisotropy = 8;

  // Also keep the raw image for 2D canvas drawing in HUDs.
  const avatarImg = avatar.image;

  return { fonts, avatar, avatarImg };
}
