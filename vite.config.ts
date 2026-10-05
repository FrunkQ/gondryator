import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
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

// The one-file build: every script and stylesheet inlined into index.html. (A few lines of our own,
// rather than a plugin whose dependency chain drags in an unfixed audit warning.)
const singleFile = (): Plugin => ({
  name: 'single-file',
  enforce: 'post',
  config(config) {
    config.build ??= {};
    config.build.cssCodeSplit = false;
    config.build.assetsDir = '';
    config.build.rollupOptions ??= {};
    (config.build.rollupOptions as any).output = { ...(config.build.rollupOptions as any).output, codeSplitting: false };
  },
  generateBundle(_options, bundle) {
    const esc = (f: string) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const html of Object.values(bundle).filter(b => b.type === 'asset' && /\.html?$/.test(b.fileName))) {
      let src = String((html as any).source);
      for (const [name, b] of Object.entries(bundle)) {
        if (b.type === 'chunk' && /\.[mc]?js$/.test(name)) {
          const code = b.code.replace(/"?__VITE_PRELOAD__"?/g, 'void 0').replace(/<(\/script>|!--)/g, '\\x3C$1').trim();
          src = src.replace(new RegExp(`<script([^>]*?) src="(?:[^"]*?/)?${esc(b.fileName)}"([^>]*)></script>`), (_m, a, z) => `<script${a}${z}>${code}</script>`);
          delete bundle[name];
        } else if (b.type === 'asset' && /\.css$/.test(name)) {
          const css = String(b.source).replace('@charset "UTF-8";', '').trim();
          src = src.replace(new RegExp(`<link([^>]*?) href="(?:[^"]*?/)?${esc(b.fileName)}"([^>]*)>`), (_m, a, z) => `<style${a}${z}>${css}</style>`);
          delete bundle[name];
        }
      }
      (html as any).source = src;
    }
  },
});

// `npm run build` -> dist/ (normal multi-file build)
// `npm run build:single` -> dist-single/index.html (everything inlined, for sharing as one file)
export default defineConfig(({ mode }) => ({
  base: './',
  // Addons import 'three'; point them at the WebGPU build so there is one copy of three.
  resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
  worker: { format: 'es' },
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: mode === 'single' ? [singleFile(), notices] : [notices],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
}));
