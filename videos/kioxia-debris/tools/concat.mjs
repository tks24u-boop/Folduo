// Join chunk files (rendered with tools/render.mjs, possibly on different machines) and mux the BGM.
//   node tools/concat.mjs out/chunks/chunk_0.mp4 out/chunks/chunk_1.mp4 ... --audio audio/bgm.wav --out out/final.mp4
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
const argv = process.argv.slice(2);
const files = [];
let audio = null, out = 'out/kioxia_shock.mp4';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--audio') audio = argv[++i];
  else if (argv[i] === '--out') out = argv[++i];
  else files.push(path.resolve(argv[i]));
}
files.sort();
const list = path.resolve('out/concat_list.txt');
fs.mkdirSync(path.dirname(list), { recursive: true });
fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
const FF = process.env.FFMPEG || 'ffmpeg';
const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
if (audio) args.push('-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest');
args.push('-c:v', 'copy', '-movflags', '+faststart', out);
const r = spawnSync(FF, args, { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`wrote ${out} from ${files.length} chunk(s)`);
