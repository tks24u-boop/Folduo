// Shared: static server + headless Chromium (SwiftShader WebGL) page factory.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.wav': 'audio/wav',
};

export function startServer(port = 0) {
  return new Promise((resolve) => {
    const srv = http.createServer((q, s) => {
      const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (!p.startsWith(ROOT)) { s.writeHead(403); s.end(); return; }
      fs.readFile(p, (e, d) => {
        if (e) { s.writeHead(404); s.end(); return; }
        s.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        s.end(d);
      });
    });
    srv.listen(port, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

export async function openPage({ port, w = 1920, h = 1080, scenes = null, lab = null, q = 0.95, log = true }) {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--disable-gpu-driver-bug-workarounds', '--max-active-webgl-contexts=4'],
  });
  const page = await browser.newPage({ viewport: { width: Math.min(w, 1920), height: Math.min(h, 1080) } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      errors.push(`[${m.type()}] ${m.text()}`);
      if (log) console.error(`[page ${m.type()}] ${m.text()}`);
    } else if (log && process.env.VERBOSE) console.log(`[page] ${m.text()}`);
  });
  page.on('pageerror', (e) => { errors.push(`[pageerror] ${e.message}`); if (log) console.error(`[pageerror] ${e.message}`); });
  let url = `http://127.0.0.1:${port}/src/index.html?w=${w}&h=${h}&q=${q}`;
  if (scenes) url += `&scenes=${scenes}`;
  if (lab) url += `&lab=${encodeURIComponent(lab.startsWith('/') ? lab : '/' + lab)}`;
  await page.goto(url);
  await page.waitForFunction('window.ready || window.initError', null, { timeout: 300000 });
  const initError = await page.evaluate('window.initError');
  if (initError) throw new Error('init failed: ' + initError);
  return { browser, page, errors };
}

export function dataUrlToBuffer(u) {
  return Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
}

/** Tiny arg parser: --key value / --flag */
export function args() {
  const a = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      if (i + 1 < a.length && !a[i + 1].startsWith('--')) { o[k] = a[i + 1]; i++; } else o[k] = true;
    }
  }
  return o;
}
