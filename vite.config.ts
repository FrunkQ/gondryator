import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` -> dist/ (normal multi-file build)
// `npm run build:single` -> dist-single/index.html (everything inlined, for sharing as one file)
export default defineConfig(({ mode }) => ({
  base: './',
  // Addons import 'three'; point them at the WebGPU build so there is one copy of three.
  resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
  worker: { format: 'es' },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
}));
