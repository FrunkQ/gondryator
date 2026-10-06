// @ts-nocheck -- TSL node typings are too strict for swizzles and number arguments.
// The dynamometer: while the landing card waits for a song, the ride runs on the rollers. It reads
// what the machine says about itself (graphics backend, GPU, cores, memory), times a burst of
// plain JavaScript (the analysers' kind of work), and draws a few synthetic scenes off screen,
// nothing shown, each a stand-in for one kind of load the rides put on the graphics card:
//   scenery  layered procedural noise, like the surfaces of the train's world
//   sky      a nine-fold fractal and noise, like the non-Gondry view's sky
//   post     many texture reads, like the effects passes (blur, trails, bloom)
// From the frame times at this screen's size it says whether the ride will be smooth, tricky or
// slow, or whether there is no 3D acceleration at all, and whether deep listen (the neural note
// transcriber) can run alongside. The whole profile can be saved from the frame analyser (P).

import * as THREE from 'three/webgpu';
import { Fn, uv, vec2, vec3, float, sin, cos, abs, dot, max, min, length, Loop, mx_noise_float, texture } from 'three/tsl';

export type DynoLevel = 'ok' | 'tricky' | 'slow' | 'none';

export interface DynoTest { name: string; what: string; msPerFrame: number; frames: number; pixels: number }

export interface DynoResult {
  when: string;
  level: DynoLevel;
  /** Deep listen and other background extras are left off. */
  light: boolean;
  /** Plain words for the sign and the pop-up. */
  headline: string;
  advice: string[];
  spec: Record<string, unknown>;
  cpu: { msFor10M: number; cores: number };
  tests: DynoTest[];
  /** Frames per second these tests suggest for each kind of view, at this screen's size. */
  estimate: { ride: number; disco: number; screenPixels: number };
  /** What a comfortable machine has, for comparison. */
  recommended: Record<string, string>;
}

const W = 1280, H = 720;

/** One synthetic scene: a full-screen quad with a shader standing in for one kind of load. */
function scene(kind: 'scenery' | 'sky' | 'post', tex: THREE.Texture) {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const p = uv().mul(vec2(8.0, 4.5));
    if (kind === 'scenery') {
      const acc = float(0.0).toVar();
      for (let i = 0; i < 6; i++) acc.addAssign(mx_noise_float(vec3(p.mul(2 ** i), float(i))).mul(0.5 ** i));
      return vec3(acc, acc.mul(0.8), acc.mul(0.6));
    }
    if (kind === 'sky') {
      const q = vec3(p.x.mul(0.2), p.y.mul(0.2), 0.3).toVar();
      const trap = float(9.0).toVar();
      Loop(9, () => {
        q.assign(abs(q).div(max(dot(q, q), 0.02)).sub(vec3(0.7, 0.6, 0.45)));
        trap.assign(min(trap, abs(q.y)));
      });
      const n = mx_noise_float(vec3(p, 1.0)).add(mx_noise_float(vec3(p.mul(3.0), 2.0)));
      return vec3(trap, sin(n.mul(3.0)), cos(length(q)));
    }
    const acc = vec3(0.0).toVar();
    for (let i = 0; i < 24; i++) acc.addAssign(texture(tex, uv().add(vec2(i * 0.003, (i % 5) * 0.002))).rgb);
    return acc.div(24.0);
  })();
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  return s;
}

const frame = () => new Promise(r => requestAnimationFrame(r));

export class Dyno {
  result: DynoResult | null = null;
  aborted = false;

  constructor(private renderer: THREE.WebGPURenderer) {}

  /** Runs the whole test, a slice per animation frame so the landing stays smooth. */
  async run(onProgress: (p: number) => void): Promise<DynoResult> {
    const r = this.renderer;
    const spec = await this.spec();
    onProgress(0.05);
    await frame();
    const cpu = this.cpu();
    onProgress(0.15);
    const tests: DynoTest[] = [];
    const none = spec.software === true || !spec.backend;
    if (!none) {
      const data = new Uint8Array(256 * 256 * 4).map((_, i) => (i * 2654435761) >>> 24);
      const tex = new THREE.DataTexture(data, 256, 256, THREE.RGBAFormat);
      tex.needsUpdate = true;
      const rt = new THREE.RenderTarget(W, H, { depthBuffer: false });
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const plan = [
        ['scenery', 'layered procedural noise (the ride\'s surfaces)'],
        ['sky', 'nine-fold fractal and noise (the non-Gondry sky)'],
        ['post', '24 texture reads a pixel (the effects passes)'],
      ] as const;
      for (let k = 0; k < plan.length && !this.aborted; k++) {
        const [name, what] = plan[k];
        const sc = scene(name, tex);
        try {
          await r.compileAsync(sc, cam);
          const draw = async (n: number) => {
            const was = r.getRenderTarget();
            r.setRenderTarget(rt);
            for (let i = 0; i < n; i++) r.render(sc, cam);
            r.setRenderTarget(was);
            await r.readRenderTargetPixelsAsync(rt, 0, 0, 1, 1); // waits for the GPU to finish
          };
          await draw(1);
          await frame();
          // Enough frames to time, but never long: stop early on a slow machine.
          let frames = 0, ms = 0;
          for (let b = 0; b < 4 && ms < 600 && !this.aborted; b++) {
            const t0 = performance.now();
            await draw(4);
            ms += performance.now() - t0; frames += 4;
            onProgress(0.15 + 0.8 * (k + (b + 1) / 4) / plan.length);
            await frame();
          }
          tests.push({ name, what, msPerFrame: frames ? ms / frames : Infinity, frames, pixels: W * H });
        } catch (e) {
          tests.push({ name, what: `${what}: failed (${(e as Error).message})`, msPerFrame: Infinity, frames: 0, pixels: W * H });
        }
        sc.traverse(o => { (o as THREE.Mesh).geometry?.dispose(); ((o as THREE.Mesh).material as THREE.Material)?.dispose?.(); });
      }
      rt.dispose(); tex.dispose();
    }
    onProgress(1);
    this.result = this.verdict(spec, cpu, tests);
    return this.result;
  }

  private async spec() {
    const r: any = this.renderer;
    const webgpu = !!r.backend?.isWebGPUBackend;
    const out: Record<string, unknown> = {
      backend: webgpu ? 'WebGPU' : r.backend ? 'WebGL2' : null,
      userAgent: navigator.userAgent,
      cores: navigator.hardwareConcurrency ?? null,
      memoryGB: (navigator as any).deviceMemory ?? null,
      screen: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`,
    };
    const heap = (performance as any).memory;
    if (heap) out.jsHeapMB = { used: Math.round(heap.usedJSHeapSize / 1e6), limit: Math.round(heap.jsHeapSizeLimit / 1e6) };
    try {
      if (webgpu) {
        const info = r.backend.device?.adapterInfo ?? (await (navigator as any).gpu?.requestAdapter())?.info;
        if (info) out.gpu = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
      } else {
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        if (gl && ext) out.gpu = { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
      }
    } catch { /* not told */ }
    const name = JSON.stringify(out.gpu ?? '').toLowerCase();
    out.software = /swiftshader|llvmpipe|softpipe|basic render|software/.test(name);
    return out;
  }

  /** Ten million steps of the arithmetic the analysers do, timed. */
  private cpu() {
    const t0 = performance.now();
    let a = 0.5, b = 0.25;
    for (let i = 0; i < 10_000_000; i++) { a = a * 0.9999 + Math.sin(b) * 1e-4; b += a * 1e-6; }
    const ms = performance.now() - t0 + (a + b) * 0; // (a and b used, so the loop is not dropped)
    return { msFor10M: Math.round(ms), cores: navigator.hardwareConcurrency ?? 0 };
  }

  private verdict(spec: Record<string, any>, cpu: { msFor10M: number; cores: number }, tests: DynoTest[]): DynoResult {
    const ms = (n: string) => tests.find(t => t.name === n)?.msPerFrame ?? Infinity;
    const px = window.innerWidth * window.innerHeight * Math.min(window.devicePixelRatio, 1.5);
    const scale = px / (W * H);
    // A ride is about two scenery loads and two effects passes a frame; the disco about one sky
    // and three effects passes, at no more than one pixel per screen pixel.
    const discoScale = window.innerWidth * window.innerHeight / (W * H);
    const ride = 1000 / Math.max(0.1, (ms('scenery') * 2 + ms('post') * 2) * scale);
    const disco = 1000 / Math.max(0.1, (ms('sky') + ms('post') * 3) * discoScale);
    const worst = Math.min(ride, disco);
    const advice: string[] = [];
    let level: DynoLevel = 'ok';
    if (spec.software || !spec.backend) {
      level = 'none';
      advice.push('No 3D acceleration: the browser is drawing in software. Turn on hardware acceleration in the browser\'s settings, or try another machine.');
    } else {
      if (spec.backend !== 'WebGPU') { level = 'slow'; advice.push('This browser has no WebGPU, so the ride falls back to WebGL, which is far slower here. A recent Chrome or Edge has WebGPU.'); }
      if (worst < 30) { level = 'slow'; advice.push(`The graphics card tested at about ${Math.round(worst)} fps for this window size: expect a jerky ride. A smaller window helps.`); }
      else if (worst < 55 && level === 'ok') { level = 'tricky'; advice.push(`The graphics card tested at about ${Math.round(worst)} fps for this window size: the busiest moments may stutter. The resolution drops by itself when they do.`); }
    }
    const weakCpu = cpu.msFor10M > 250 || (cpu.cores && cpu.cores <= 2) || (spec.memoryGB && spec.memoryGB <= 4);
    const light = level === 'none' || level === 'slow' || !!weakCpu;
    if (light) advice.push('Running light: deep listen (the neural note transcriber) stays off, so the notes come from the fast parser alone.');
    const headline = level === 'none' ? 'Needs 3D acceleration' : level === 'slow' ? 'Slow machine: running light' : level === 'tricky' ? (light ? 'Frames may stutter; running light' : 'Frames may stutter') : light ? 'Running light' : 'All clear';
    return {
      when: new Date().toISOString(), level, light, headline, advice, spec, cpu, tests,
      estimate: { ride: Math.round(ride), disco: Math.round(disco), screenPixels: Math.round(px) },
      recommended: {
        browser: 'a recent Chrome or Edge (WebGPU)',
        gpu: 'any dedicated graphics card, or a recent integrated one, testing at 60 fps or more here',
        cpu: '4 cores or more, 10M-step test under 120 ms',
        memory: '8 GB or more',
      },
    };
  }
}
