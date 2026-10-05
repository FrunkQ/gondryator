// Headless end-to-end run: serves the built app, plays a track, takes screenshots and reports
// the frame rate, sync state, and the section-7 refocus metric.
//   node tools/e2e.mjs [--file test-tracks/test-124.mp3] [--wander] [--webgl] [--shots 6,14,30] [--out shots] [--strict]
// Needs a build in dist/ (npm run build) and a Chromium: CHROME=/path/to/chrome, or Playwright's own
// (npx playwright-core install chromium). --progress reports every 10 s; --timeout N gives up after N s
// (exit 3, or 1 if errors were seen). --strict exits 1 on any page error or console error, or if
// the ride never starts. `npm run smoke` does all of that for you from a fresh clone.
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
const shots = arg('shots', '3,9,14,20,30').split(',').filter(Boolean).map(Number);
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

if (!fs.existsSync(path.join(root, 'index.html'))) { console.error(`No build in ${root}/: run npm run build first.`); process.exit(2); }
const browser = await chromium.launch({
  // CHROME=/path/to/chrome to choose a browser; otherwise Playwright's own (or this container's).
  executablePath: process.env.CHROME ?? (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined),
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1280)), height: Number(arg('h', 720)) } });
page.setDefaultTimeout(180000);
const logs = [];
const errors = [];
page.on('console', m => { const l = `[${m.type()}] ${m.text()}`; logs.push(l); if (m.type() === 'error' && !l.includes('404')) { errors.push(l); console.error(l.slice(0, 400)); } });
page.on('pageerror', e => { logs.push(`[pageerror] ${e.message}`); errors.push(`[pageerror] ${e.message}`); console.error('[pageerror]', e.message.slice(0, 400)); });
// --progress: a line every 10 s saying where the ride has got to. --timeout 300: give up after that
// many seconds, say where it was stuck, and exit 3 (inconclusive: slow software rendering is not a bug).
let lastState = null;
const poll = async () => { try { lastState = await page.evaluate(() => window.__gondry && { phase: window.__gondry.phase, s: window.__gondry.s, fps: window.__gondry.fps }); } catch {} return lastState; };
const started = Date.now();
if (has('progress')) setInterval(async () => {
  const g = await poll();
  console.log(`  … ${Math.round((Date.now() - started) / 1000)} s: ${g ? `${g.phase === 'title' || g.phase === 'landing' ? 'warming up at the station' : g.phase} (song at ${(g.s ?? 0).toFixed(1)} s, ${Math.round(g.fps ?? 0)} fps)` : 'page loading'}`);
}, 10000).unref();
const limit = Number(arg('timeout', 0));
if (limit) setTimeout(async () => {
  const g = await poll();
  console.error(`\nTIMED OUT after ${limit} s, stuck at: ${g ? `${g.phase}, song at ${(g.s ?? 0).toFixed(1)} s, ${Math.round(g.fps ?? 0)} fps` : 'the page never reported'}.`);
  if (errors.length) { console.error('Errors seen:'); for (const e of errors.slice(0, 10)) console.error('  ' + e.slice(0, 300)); }
  // (exit straight away: closing the browser first would make the pending waits throw)
  process.exit(errors.length ? 1 : 3);
}, limit * 1000).unref();
await page.goto(`http://localhost:${port}/?${query}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/00-landing.png`, timeout: 180000 });
if (file) {
  await page.setInputFiles('#file', file);
}
if (arg('look', null)) await page.evaluate(([y, p]) => { window.app.look.targetYaw = y * Math.PI / 180; window.app.look.targetPitch = p * Math.PI / 180; }, arg('look').split(',').map(Number).concat([0]));
const t0 = Date.now();
let i = 0;
// --title 5,10: shots during the title run (title clock seconds since load, virtual clock only).
for (const at of (arg('title', '') ? arg('title').split(',').map(Number) : [])) {
  await page.waitForFunction(t => window.__gondry && (window.__gondry.phase !== 'title' && window.__gondry.phase !== 'landing' || window.__gondry.s >= t), at, { timeout: 900000, polling: 250 });
  const st = await page.evaluate(() => window.__gondry);
  const name = `${out}/${String(++i).padStart(2, '0')}-title-${at}s.png`;
  await page.screenshot({ path: name });
  console.log(name, JSON.stringify({ phase: st?.phase, s: st?.s?.toFixed(2), yaw: st?.yaw, frontier: st?.frontier }));
}
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
  console.log(name, JSON.stringify({ phase: st?.phase, s: st?.s?.toFixed(2), fps: st?.fps?.toFixed(0), frontier: st?.frontier, final: st?.final, objects: st?.objects, backend: st?.backend, metric: st?.metric ? `${st.metric.hits}/${st.metric.total} ${JSON.stringify(st.metric.byLayer)}` : null, signalStop: st?.signalStop, viz: st?.viz, yaw: st?.yaw, sections: (st?.sections || []).map(x => x.label + '@' + x.t.toFixed(1)).join(' ') }));
}
const final = await page.evaluate(() => window.__gondry).catch(() => null);
console.log('--- console ---');
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
server.close();
if (has('strict')) {
  const ran = final && final.phase !== 'landing' && final.phase !== 'title' && final.s > 0;
  if (errors.length || !ran) {
    console.error(`\nFAILED: ${errors.length} error(s)${ran ? '' : `, and the ride never got going (phase ${final?.phase ?? 'unknown'})`}.`);
    for (const e of errors.slice(0, 10)) console.error('  ' + e.slice(0, 300));
    process.exit(1);
  }
  console.log(`\nOK: the ride played to ${final.s.toFixed(1)} s with no errors.`);
}
