// Smoke test from a fresh clone: checks what you need, builds, then plays the generated demo song
// on the train and in the non-Gondry view in a headless browser, and fails on any error.
//   npm run smoke            (after npm install)
//   npm run smoke -- --quick (the train only)   npm run smoke -- --timeout 600 (seconds per ride)
// Exit codes: 0 fine, 1 the project is broken, 2 something is missing on this machine (not the
// project's fault: install it and run again), 3 inconclusive: it timed out without errors (software
// rendering can be very slow on some machines). This is a check for contributors and CI; for a
// first look at the app, `npm run dev` and the ?demo URL is all you need.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const perRide = Number(argv[argv.indexOf('--timeout') + 1]) || 300;
const env = msg => { console.error(`\n✗ Environment: ${msg}`); process.exit(2); };
const fail = msg => { console.error(`\n✗ Project: ${msg}`); process.exit(1); };
const step = msg => console.log(`\n▶ ${msg}`);

// 1. Prerequisites.
step('Checking prerequisites');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) env(`Node ${process.versions.node} is too old. The Gondryator needs Node 22.12 or newer (Vite 8). Try "nvm use" (the repo has an .nvmrc) or install the current LTS from nodejs.org.`);
console.log(`  Node ${process.versions.node}: fine`);
if (!fs.existsSync('node_modules/vite')) env('Dependencies are not installed. Run "npm install" first.');
let chrome = process.env.CHROME;
if (!chrome) {
  const { chromium } = await import('playwright-core');
  const own = (() => { try { return chromium.executablePath(); } catch { return ''; } })();
  const box = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  chrome = [own, box].find(p => p && fs.existsSync(p));
}
if (!chrome || !fs.existsSync(chrome)) env([
  'No Chromium for the headless check. Run "npx playwright-core install chromium" (add --with-deps on a bare Linux box),',
  'or point CHROME at a Chrome or Chromium you already have:',
  '  macOS:       CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run smoke',
  '  Linux:       CHROME=$(which google-chrome) npm run smoke',
  "  PowerShell:  $env:CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; npm run smoke",
].join('\n'));
console.log(`  Browser: ${chrome}`);

// 2. Build (TypeScript check included).
step('Building (npm run build)');
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) fail('the build failed (see the TypeScript or Vite errors above).');

// 3. Play the generated demo song.
const rides = quick ? [['train', '']] : [['train', ''], ['non-Gondry view', 'pack=non-gondry']];
for (const [name, q] of rides) {
  step(`Playing the generated demo on the ${name} (software rendering: this can take a few minutes; giving up after ${perRide} s)`);
  const r = spawnSync(process.execPath, ['tools/e2e.mjs', '--webgl', '--virtual', '--nodebug', '--strict', '--w', '320', '--h', '180',
    '--shots', '1.5', '--progress', '--timeout', String(perRide), '--out', `.smoke/${name.replace(/\W+/g, '-')}`, '--query', `${q}&nodeep&nowarm&quick&start=0`], { stdio: 'inherit', env: { ...process.env, CHROME: chrome } });
  if (r.status === 2) env('the headless check could not start (see above).');
  if (r.status === 3) { console.error(`\n? Inconclusive: the ${name} was still going after ${perRide} s, with no errors. This machine renders slowly without a GPU in headless mode; try --timeout 900, or just check it by eye with npm run dev and the ?demo URL.`); process.exit(3); }
  if (r.status !== 0) fail(`the ${name} hit errors or never started (see above). Screenshots are in .smoke/.`);
}
console.log('\n✓ All good: it builds, and the demo plays without errors. Run "npm run dev" and open the printed URL to ride it yourself.');
