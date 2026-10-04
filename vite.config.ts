import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

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
  plugins: mode === 'single' ? [viteSingleFile(), notices] : [notices],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
}));
