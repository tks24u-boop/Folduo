// Render stills / contact sheets / short preview clips for review.
//
//   node tools/still.mjs --t 3.2,9.4 [--w 1920 --h 1080] [--scenes s1_orbit] [--out scratch/stills]
//        -> scratch/stills/t_03.200.jpg ...
//   node tools/still.mjs --sheet --from 0 --to 9.375 --step 0.5 [--cols 4 --w 480 --h 270] --out scratch/s1.jpg
//        -> one tiled contact sheet with timestamps
//   node tools/still.mjs --clip --from 9 --to 12 [--fps 30 --w 960 --h 540] --out scratch/clip.mp4
//        -> short silent preview video (ffmpeg)
//
// --scenes limits which scene modules are loaded (much faster init; others render black).
// --lab scratch/lab/foo_lab.js renders that module as the only scene over the whole timeline
//      (use it to preview a shared asset in isolation).
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { startServer, openPage, dataUrlToBuffer, args, ROOT } from './browser.mjs';

const a = args();
const { srv, port } = await startServer();
const w = +(a.w || (a.sheet ? 480 : a.clip ? 960 : 1920));
const h = +(a.h || (a.sheet ? 270 : a.clip ? 540 : 1080));
const t0 = Date.now();
let browser;
try {
  const opened = await openPage({ port, w, h, scenes: a.scenes || null, lab: a.lab || null });
  browser = opened.browser;
  const page = opened.page;
  console.log(`init ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (a.sheet) {
    const from = +(a.from ?? 0), to = +(a.to ?? 45), step = +(a.step ?? 0.5);
    const times = a.t ? String(a.t).split(',').map(Number) : [];
    if (!times.length) for (let x = from; x < to - 1e-6; x += step) times.push(+x.toFixed(4));
    const url = await page.evaluate(([ts, c]) => window.renderSheet(ts, c), [times, +(a.cols || 4)]);
    const out = path.resolve(a.out || 'scratch/sheet.jpg');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, dataUrlToBuffer(url));
    console.log(`wrote ${out} (${times.length} frames) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else if (a.clip) {
    const fps = +(a.fps || 30), from = +(a.from ?? 0), to = +(a.to ?? from + 3);
    const out = path.resolve(a.out || 'scratch/clip.mp4');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round((to - from) * fps);
    for (let i = 0; i < n; i++) {
      const t = from + i / fps;
      const url = await page.evaluate((tt) => window.renderAt(tt), t);
      if (!ff.stdin.write(dataUrlToBuffer(url))) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log(`wrote ${out} (${n} frames) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else {
    const times = String(a.t ?? '0').split(',').map(Number);
    const dir = path.resolve(a.out || 'scratch/stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const t of times) {
      const ts = Date.now();
      const url = await page.evaluate((tt) => window.renderAt(tt), t);
      const f = path.join(dir, `${a.prefix || ''}t_${t.toFixed(3).padStart(6, '0')}.jpg`);
      fs.writeFileSync(f, dataUrlToBuffer(url));
      console.log(`wrote ${path.relative(ROOT, f)}  (${Date.now() - ts} ms)`);
    }
  }
} finally {
  if (browser) await browser.close();
  srv.close();
}
