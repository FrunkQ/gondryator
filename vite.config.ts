import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// A version stamp (commit and build date), so it is easy to see which build is live.
const commit = (() => {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return (process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || 'dev').slice(0, 7); }
})();
const BUILD = `${commit} · ${new Date().toISOString().slice(0, 10)}`;

// Third-party licence texts ride along at the end of the built page (see THIRD_PARTY_NOTICES.md).
const notices = {
  name: 'third-party-notices',
  transformIndexHtml(html: string) {
    const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/--/g, '- -');
    return html + `\n<!--\nThe Gondryator is public domain (The Unlicense). It includes third-party code under its own licences:\n\n` +
      `three.js (https://threejs.org), MIT licence:\n\n${read('./licenses/three.js-MIT.txt')}\n\n` +
      `MaterialX noise functions (via three.js), Apache License 2.0, Copyright Contributors to the MaterialX Project:\n\n${read('./licenses/MaterialX-Apache-2.0.txt')}\n-->\n`;
  },
};

// `npm run build` -> dist/ (normal multi-file build)
// `npm run build:single` -> dist-single/index.html (everything inlined, for sharing as one file)
export default defineConfig(({ mode }) => ({
  base: './',
  // Addons import 'three'; point them at the WebGPU build so there is one copy of three.
  resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
  worker: { format: 'es' },
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: mode === 'single' ? [viteSingleFile(), notices] : [notices],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
}));
