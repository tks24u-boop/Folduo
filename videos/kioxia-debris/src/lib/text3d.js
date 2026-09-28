// Real extruded 3D text (Japanese included) built from TTF outlines via opentype.js.
//
//   const t = makeText3D(ctx.assets.fonts.dela, '急落', { size: 2, depth: 0.5, material })
//   scene.add(t.group);            // group is centred on the origin
//   t.glyphs[i].mesh               // per-glyph meshes (for per-letter animation)
//   t.glyphs[i].home               // Vector3 rest position of that glyph inside the group
//
// Geometry is cached by (font, char, size, depth, bevel) so repeated calls are cheap.
import * as THREE from 'three';

const cache = new Map();

function glyphShapes(font, glyph, size) {
  const path = glyph.getPath(0, 0, size);
  const sp = new THREE.ShapePath();
  let open = false;
  for (const c of path.commands) {
    switch (c.type) {
      case 'M': sp.moveTo(c.x, -c.y); open = true; break;
      case 'L': sp.lineTo(c.x, -c.y); break;
      case 'Q': sp.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y); break;
      case 'C': sp.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y); break;
      case 'Z': open = false; break;
    }
  }
  if (!sp.subPaths.length) return [];
  // Solid-contour winding differs between TrueType (CW) and CFF (CCW) outlines.
  // Pick the winding of the largest-area contour as "solid".
  let best = 0, bestSign = -1;
  for (const p of sp.subPaths) {
    const pts = p.getPoints(4);
    const a = THREE.ShapeUtils.area(pts);
    if (Math.abs(a) > best) { best = Math.abs(a); bestSign = Math.sign(a); }
  }
  // ShapeUtils.area > 0  <=> counter-clockwise
  return sp.toShapes(bestSign > 0);
}

function glyphGeometry(font, fontKey, ch, size, depth, bevel, curveSegments) {
  const key = `${fontKey}|${ch}|${size}|${depth}|${bevel}|${curveSegments}`;
  if (cache.has(key)) return cache.get(key);
  const glyph = font.charToGlyph(ch);
  const shapes = glyphShapes(font, glyph, size);
  let geo = null;
  if (shapes.length) {
    geo = new THREE.ExtrudeGeometry(shapes, {
      depth,
      curveSegments,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelOffset: 0,
      bevelSegments: bevel > 0 ? 3 : 0,
    });
    geo.translate(0, 0, -depth / 2);
    geo.computeVertexNormals();
  }
  const adv = (glyph.advanceWidth || font.unitsPerEm) * (size / font.unitsPerEm);
  const out = { geo, adv, glyph };
  cache.set(key, out);
  return out;
}

/**
 * Build 3D text.
 * @param {object} font  opentype Font (ctx.assets.fonts.dela / noto / orbitron / mono)
 * @param {string} str   text; '\n' makes new lines
 * @param {object} o     { size=1, depth=0.25, bevel=0.02, curveSegments=6, letterSpacing=0 (em),
 *                         lineHeight=1.2 (em), align='center'|'left'|'right',
 *                         material (single) | materials ([face, side]) }
 */
export function makeText3D(font, str, o = {}) {
  const size = o.size ?? 1;
  const depth = o.depth ?? 0.25;
  const bevel = o.bevel ?? 0.02;
  const curveSegments = o.curveSegments ?? 6;
  const letterSpacing = (o.letterSpacing ?? 0) * size;
  const lineHeight = (o.lineHeight ?? 1.2) * size;
  const align = o.align ?? 'center';
  const fontKey = font.names?.fullName?.en || font.names?.fontFamily?.en || 'font';
  const material = o.materials || o.material || new THREE.MeshStandardMaterial({ color: 0xffffff });

  const group = new THREE.Group();
  const glyphs = [];
  const lines = str.split('\n');
  const lineWidths = [];
  const lineGlyphs = [];

  for (const line of lines) {
    let x = 0;
    const arr = [];
    const chars = Array.from(line);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const g = glyphGeometry(font, fontKey, ch, size, depth, bevel, curveSegments);
      let kern = 0;
      if (i > 0 && font.getKerningValue) {
        const prev = font.charToGlyph(chars[i - 1]);
        kern = font.getKerningValue(prev, g.glyph) * (size / font.unitsPerEm);
      }
      x += kern;
      arr.push({ ch, g, x });
      x += g.adv + letterSpacing;
    }
    const w = Math.max(0, x - letterSpacing);
    lineWidths.push(w);
    lineGlyphs.push(arr);
  }

  // Vertical metrics: centre the block around the cap-height middle.
  const asc = (font.ascender / font.unitsPerEm) * size;
  const capMid = asc * 0.36;
  const totalH = lineHeight * (lines.length - 1);
  const maxW = Math.max(...lineWidths, 0);

  lineGlyphs.forEach((arr, li) => {
    const w = lineWidths[li];
    const ox = align === 'left' ? -maxW / 2 : align === 'right' ? maxW / 2 - w : -w / 2;
    const oy = totalH / 2 - li * lineHeight - capMid;
    for (const { ch, g, x } of arr) {
      if (!g.geo) continue;
      // Re-centre each glyph mesh on its own middle so per-letter rotation/scale looks right.
      if (!g.geo.userData.centred) {
        g.geo.computeBoundingBox();
        const bb = g.geo.boundingBox;
        const cx = (bb.min.x + bb.max.x) / 2;
        const cy = (bb.min.y + bb.max.y) / 2;
        g.geo.userData.cx = cx;
        g.geo.userData.cy = cy;
        g.geo.translate(-cx, -cy, 0);
        g.geo.userData.centred = true;
      }
      const mesh = new THREE.Mesh(g.geo, material);
      const home = new THREE.Vector3(ox + x + g.geo.userData.cx, oy + g.geo.userData.cy, 0);
      mesh.position.copy(home);
      group.add(mesh);
      glyphs.push({ ch, mesh, home, line: li });
    }
  });

  return { group, glyphs, width: maxW, height: totalH + asc, size };
}

/**
 * Flat text rendered to a CanvasTexture on a plane (cheap; good for labels/decals in 3D).
 * Returns { mesh, texture, aspect }. Uses the CSS font families registered in assets.js:
 * 'Dela Gothic One', 'Noto Sans JP', 'Orbitron', 'Share Tech Mono'.
 */
export function makeTextPlane(str, o = {}) {
  const font = o.font ?? "900 120px 'Noto Sans JP'";
  const color = o.color ?? '#ffffff';
  const pad = o.pad ?? 20;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  const m = g.measureText(str);
  const px = parseInt(font.match(/(\d+)px/)[1], 10);
  c.width = Math.ceil(m.width + pad * 2);
  c.height = Math.ceil(px * 1.4 + pad * 2);
  g.font = font;
  g.textBaseline = 'middle';
  g.fillStyle = color;
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = o.glowBlur ?? 24; }
  g.fillText(str, pad, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const aspect = c.width / c.height;
  const h = o.height ?? 1;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: o.toneMapped ?? false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), mat);
  return { mesh, texture: tex, aspect };
}
