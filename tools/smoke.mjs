// Smoke test from a fresh clone: checks what you need, builds, then plays the generated demo song
// on the train and in the non-Gondry view in a headless browser, and fails on any error.
//   npm run smoke            (after npm install)
//   npm run smoke -- --quick (the train only)
// Exit codes: 0 fine, 1 the project is broken, 2 something is missing on this machine (not the
// project's fault: install it and run again).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const quick = process.argv.includes('--quick');
const env = msg => { console.error(`\n✗ Environment: ${msg}`); process.exit(2); };
const fail = msg => { console.error(`\n✗ Project: ${msg}`); process.exit(1); };
const step = msg => console.log(`\n▶ ${msg}`);

// 1. Prerequisites.
step('Checking prerequisites');
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) env(`Node ${process.versions.node} is too old. The Gondryator needs Node 22 or newer (Vite 8). Try "nvm use" (the repo has an .nvmrc) or install Node 22 LTS from nodejs.org.`);
console.log(`  Node ${process.versions.node}: fine`);
if (!fs.existsSync('node_modules/vite')) env('Dependencies are not installed. Run "npm install" first.');
let chrome = process.env.CHROME;
if (!chrome) {
  const { chromium } = await import('playwright-core');
  const own = (() => { try { return chromium.executablePath(); } catch { return ''; } })();
  const box = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  chrome = [own, box].find(p => p && fs.existsSync(p));
}
if (!chrome || !fs.existsSync(chrome)) env('No Chromium for the headless check. Run "npx playwright-core install chromium" (add --with-deps on a bare Linux box), or point CHROME at a Chrome or Chromium you already have: CHROME=/path/to/chrome npm run smoke');
console.log(`  Browser: ${chrome}`);

// 2. Build (TypeScript check included).
step('Building (npm run build)');
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) fail('the build failed (see the TypeScript or Vite errors above).');

// 3. Play the generated demo song.
const rides = quick ? [['train', '']] : [['train', ''], ['non-Gondry view', 'pack=non-gondry']];
for (const [name, q] of rides) {
  step(`Playing the generated demo on the ${name}`);
  const r = spawnSync(process.execPath, ['tools/e2e.mjs', '--webgl', '--virtual', '--nodebug', '--strict', '--w', '480', '--h', '270',
    '--shots', '4', '--out', `.smoke/${name.replace(/\W+/g, '-')}`, '--query', `${q}&nodeep`], { stdio: 'inherit', env: { ...process.env, CHROME: chrome } });
  if (r.status === 2) env('the headless check could not start (see above).');
  if (r.status !== 0) fail(`the ${name} hit errors or never started (see above). Screenshots are in .smoke/.`);
}
console.log('\n✓ All good: it builds, and the demo plays without errors. Run "npm run dev" and open the printed URL to ride it yourself.');
