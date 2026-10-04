// Headless end-to-end run: serves the built app, plays a track, takes screenshots and reports
// the frame rate, sync state, and the section-7 refocus metric.
//   node tools/e2e.mjs [--file test-tracks/test-124.mp3] [--wander] [--webgl] [--shots 6,14,30] [--out shots]
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const has = k => args.includes('--' + k);
const root = arg('root', 'dist');
const out = arg('out', 'shots');
const file = arg('file', null);
const shots = arg('shots', '3,9,14,20,30').split(',').map(Number);
const query = arg('query', '') + (has('wander') ? '&wander' : '') + (has('webgl') ? '&webgl' : '') + (file || has('landing') ? '' : '&demo') + (has('nodebug') ? '' : '&debug') + (has('virtual') ? '&virtual' : '');
fs.mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({
  // CHROME=/path/to/chrome to choose a browser; otherwise Playwright's own (or this container's).
  executablePath: process.env.CHROME ?? (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined),
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1280)), height: Number(arg('h', 720)) } });
page.setDefaultTimeout(180000);
const logs = [];
page.on('console', m => { const l = `[${m.type()}] ${m.text()}`; logs.push(l); if (m.type() === 'error' && !l.includes('404')) console.error(l.slice(0, 400)); });
page.on('pageerror', e => { logs.push(`[pageerror] ${e.message}`); console.error('[pageerror]', e.message.slice(0, 400)); });
if (has('progress')) setInterval(async () => { try { const g = await page.evaluate(() => window.__gondry && { p: window.__gondry.phase, s: window.__gondry.s, fps: window.__gondry.fps, o: window.__gondry.objects }); console.error('progress', JSON.stringify(g)); } catch {} }, 15000).unref();
await page.goto(`http://localhost:${port}/?${query}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/00-landing.png`, timeout: 180000 });
if (file) {
  await page.setInputFiles('#file', file);
}
if (arg('look', null)) await page.evaluate(([y, p]) => { window.app.look.targetYaw = y * Math.PI / 180; window.app.look.targetPitch = p * Math.PI / 180; }, arg('look').split(',').map(Number).concat([0]));
const t0 = Date.now();
let i = 0;
for (const at of shots) {
  const wait = at * 1000 - (Date.now() - t0);
  if (has('virtual')) {
    // Shots are show times: wait until the virtual clock gets there.
    await page.waitForFunction(t => window.__gondry && window.__gondry.phase !== 'landing' && window.__gondry.phase !== 'title' && window.__gondry.s >= t, at, { timeout: 900000, polling: 250 });
  } else if (wait > 0) await page.waitForTimeout(wait);
  if (arg('switch', null)) { const [when, id] = arg('switch').split(':'); if (Number(when) === at) { await page.selectOption('#pack', id); await page.waitForTimeout(1500); } }
  const st = await page.evaluate(() => window.__gondry);
  const name = `${out}/${String(++i).padStart(2, '0')}-${at}s.png`;
  await page.screenshot({ path: name });
  console.log(name, JSON.stringify({ phase: st?.phase, s: st?.s?.toFixed(2), fps: st?.fps?.toFixed(0), frontier: st?.frontier, final: st?.final, objects: st?.objects, backend: st?.backend, metric: st?.metric ? `${st.metric.hits}/${st.metric.total} ${JSON.stringify(st.metric.byLayer)}` : null, signalStop: st?.signalStop, yaw: st?.yaw, sections: (st?.sections || []).map(x => x.label + '@' + x.t.toFixed(1)).join(' ') }));
}
console.log('--- console ---');
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
server.close();
