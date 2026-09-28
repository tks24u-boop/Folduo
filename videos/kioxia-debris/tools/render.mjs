// Full render: N parallel headless browsers each encode a contiguous chunk of frames to an
// intermediate H.264 segment, then segments are concatenated and muxed with the BGM.
//
//   node tools/render.mjs [--w 1920 --h 1080] [--fps 60] [--from 0 --to 45] [--workers 2]
//                         [--audio audio/bgm.wav|none] [--out out/kioxia_shock.mp4] [--crf 17]
// Segments are encoded directly with delivery settings, so chunks rendered on different machines
// can be joined losslessly:  node tools/concat.mjs out/chunks/*.mp4 --audio audio/bgm.wav --out out/final.mp4
// FFMPEG env var overrides the ffmpeg binary.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { startServer, openPage, dataUrlToBuffer, args, ROOT } from './browser.mjs';

const a = args();
const cues = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/cues.json'), 'utf8'));
const W = +(a.w || 1920), H = +(a.h || 1080);
const FPS = +(a.fps || cues.fps);
const from = +(a.from ?? 0), to = +(a.to ?? cues.duration);
const workers = +(a.workers || 2);
const crf = String(a.crf || 17);
const FF = process.env.FFMPEG || 'ffmpeg';
const out = path.resolve(a.out || 'out/kioxia_shock.mp4');
const audio = a.audio === 'none' ? null : path.resolve(a.audio || 'audio/bgm.wav');
const segDir = path.resolve(a.segdir || 'out/segments');
fs.mkdirSync(segDir, { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });

const f0 = Math.round(from * FPS), f1 = Math.round(to * FPS); // [f0, f1)
const total = f1 - f0;
const per = Math.ceil(total / workers);
const { srv, port } = await startServer();
const tStart = Date.now();
let done = 0;

function run(cmd, argv) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
  });
}

async function worker(k) {
  const a0 = f0 + k * per, a1 = Math.min(f1, a0 + per);
  if (a0 >= a1) return null;
  const seg = path.join(segDir, `seg_${String(k).padStart(2, '0')}.mp4`);
  const { browser, page } = await openPage({ port, w: W, h: H, q: +(a.q || 0.95), log: true });
  const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', a.preset || 'medium', '-crf', crf, '-maxrate', '30M', '-bufsize', '60M',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2', '-g', '120', '-bf', '2', '-r', String(FPS), seg],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  try {
    for (let i = a0; i < a1; i++) {
      const url = await page.evaluate((fi) => window.renderFrame(fi), i);
      if (!ff.stdin.write(dataUrlToBuffer(url))) await new Promise((r) => ff.stdin.once('drain', r));
      done++;
      if (done % 30 === 0) {
        const el = (Date.now() - tStart) / 1000;
        const eta = (el / done) * (total - done);
        process.stdout.write(`\r${done}/${total} frames  ${(el / done).toFixed(2)} s/frame  elapsed ${(el / 60).toFixed(1)}m  eta ${(eta / 60).toFixed(1)}m   `);
      }
    }
  } finally {
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    await browser.close();
  }
  return seg;
}

try {
  const segs = (await Promise.all(Array.from({ length: workers }, (_, k) => worker(k)))).filter(Boolean);
  console.log(`\nrendered ${total} frames in ${((Date.now() - tStart) / 60000).toFixed(1)} min`);
  const list = path.join(segDir, 'list.txt');
  fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join('\n'));
  // Join segments losslessly (already delivery-encoded: H.264 High@4.2 yuv420p) + optional AAC audio.
  const argv = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
  if (audio && fs.existsSync(audio)) {
    argv.push('-ss', String(from), '-t', String(to - from), '-i', audio, '-map', '0:v', '-map', '1:a',
      '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest');
  }
  argv.push('-c:v', 'copy', '-movflags', '+faststart', out);
  await run(FF, argv);
  console.log(`wrote ${out}`);
} finally {
  srv.close();
}
