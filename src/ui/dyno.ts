// The dynamometer: while the landing card waits for a song, the ride runs on the rollers. It reads
// what the machine says about itself (graphics backend, GPU, cores, memory), times a burst of
// plain JavaScript (the analysers' kind of work), times the landing screen's own frames, and then
// holds a rehearsal: this ride's real scenery (or the disco's real show), scheduled from a made-up
// busy song (score/synth.ts) and drawn off screen at this window's own size for a few seconds, from
// just before its drop. Nothing of it is shown.
// The verdict is the landing's frame time, plus what the rehearsal adds on top of the landing scene
// (each rehearsal frame is timed against the same scene without it, so waiting for the graphics
// card cancels out), plus the scheduler's own time a frame. On a desktop card the first, synthetic
// version of this test predicted 3 fps for a ride that ran at 52, and called a phone that rode at
// 60 fps "slow" for drawing with WebGL: real scenery on a real-sized frame is what counts. The whole
// profile can be saved from the frame analyser (P).

import * as THREE from 'three/webgpu';

export type DynoLevel = 'ok' | 'tricky' | 'slow' | 'none';

/** The landing screen's own frames, timed while nothing else runs. */
export interface DynoLive { medianMs: number; p90Ms: number; fps: number; frames: number; pixelRatio: number; size: string }

/**
 * The ride, run off screen on a made-up song. `step` advances the shows (the scheduler's work);
 * `show(true)` swaps the busy rehearsal in for whatever the landing screen is showing, just for the
 * off-screen draw.
 */
export interface Rehearsal {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Song time to start from (just before the drop). */
  from: number;
  /** Build its shaders without it ever showing on screen (frames keep drawing while they build). */
  compile(): Promise<void>;
  step(s: number, dt: number): void;
  show(on: boolean): void;
  /** Objects on show now (instances), for the profile. */
  objects(): number;
  dispose(): void;
}

export interface DynoRehearsal {
  what: string;
  /** Frames drawn and seconds of song ridden. */
  frames: number;
  seconds: number;
  /** Size drawn, in pixels (the window at its drawing resolution). */
  size: string;
  /** Median off-screen draw of the landing scene, and of the scene with the ride in it (ms). */
  baseMs: number;
  rideMs: number;
  /** What the ride adds on the graphics card, and the scheduler's time a frame (ms). */
  extraMs: number;
  cpuMs: number;
  /** Most objects on show at once. */
  objects: number;
  compileMs: number;
}

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
  live: DynoLive | null;
  rehearsal: DynoRehearsal | null;
  /** Frames per second expected for this ride, and the frame time it comes from. */
  estimate: { fps: number; frameMs: number; screenPixels: number };
  /** What a comfortable machine has, for comparison. */
  recommended: Record<string, string>;
}

const frame = () => new Promise<number>(r => requestAnimationFrame(r));
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };

/** How long the rehearsal rides, in seconds of wall clock (it stops sooner if frames are very slow). */
const REHEARSAL_SEC = 4;

export class Dyno {
  result: DynoResult | null = null;
  aborted = false;

  constructor(private renderer: THREE.WebGPURenderer, private pixelRatio: () => number = () => 1, private rehearse?: () => Rehearsal) {}

  /** Times the real frames for a while (median and 90th percentile; startup hitches don't count). */
  private async live(n = 180): Promise<DynoLive> {
    const dts: number[] = [];
    let last = await frame();
    const start = last;
    for (let i = 0; i < n && !this.aborted && last - start < 3000; i++) {
      const t = await frame();
      dts.push(t - last); last = t;
    }
    dts.sort((a, b) => a - b);
    const med = dts[dts.length >> 1] ?? 16.7, p90 = dts[Math.floor(dts.length * 0.9)] ?? med;
    return { medianMs: +med.toFixed(2), p90Ms: +p90.toFixed(2), fps: Math.round(1000 / med), frames: dts.length, pixelRatio: +this.pixelRatio().toFixed(2), size: `${window.innerWidth}x${window.innerHeight}` };
  }

  /** Runs the whole test, a slice per animation frame so the landing stays smooth. */
  async run(onProgress: (p: number) => void): Promise<DynoResult> {
    const spec = await this.spec();
    onProgress(0.03);
    await frame();
    const cpu = this.cpu();
    onProgress(0.06);
    const none = spec.software === true || !spec.backend;
    // Let the landing settle (its shaders build in the first frames), then time it.
    for (let i = 0; i < 30 && !none; i++) await frame();
    const live = none ? null : await this.live();
    onProgress(0.3);
    let rehearsal: DynoRehearsal | null = null;
    if (!none && this.rehearse && !this.aborted) {
      try { rehearsal = await this.rehearsal(this.rehearse, p => onProgress(0.3 + 0.7 * p)); }
      catch (e) { console.warn('Dynamometer rehearsal failed', e); }
    }
    onProgress(1);
    this.result = this.verdict(spec, cpu, live, rehearsal);
    return this.result;
  }

  /**
   * Rides the rehearsal for a few seconds. Every frame the shows are stepped (timed: that is the
   * scheduler's share), then one off-screen draw is timed, alternating between the landing scene as
   * it is and the scene with the busy ride swapped in. Both wait for the graphics card to finish,
   * so that wait cancels out of the difference.
   */
  private async rehearsal(make: () => Rehearsal, onProgress: (p: number) => void): Promise<DynoRehearsal> {
    const r = this.renderer;
    const reh = make();
    try {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.RenderTarget(Math.max(1, size.x), Math.max(1, size.y));
      const draw = async (on: boolean, n = 2) => {
        const was = r.getRenderTarget();
        reh.show(on);
        r.setRenderTarget(rt);
        const t0 = performance.now();
        try { for (let i = 0; i < n; i++) r.render(reh.scene, reh.camera); } finally { r.setRenderTarget(was); reh.show(false); }
        await r.readRenderTargetPixelsAsync(rt, 0, 0, 1, 1); // waits for the card to finish
        return (performance.now() - t0) / n;
      };
      // Build its shaders first (not timed: the real ride builds them at the station).
      let s = reh.from;
      const c0 = performance.now();
      reh.step(s, 1 / 60);
      await reh.compile();
      await draw(true, 1);
      const compileMs = performance.now() - c0;
      onProgress(0.15);
      const base: number[] = [], ride: number[] = [], cpu: number[] = [];
      let objects = 0, frames = 0, last = await frame();
      const t0 = last;
      while (!this.aborted && last - t0 < REHEARSAL_SEC * 1000 && frames < 400) {
        const now = await frame();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now; s += dt; frames++;
        const c = performance.now();
        reh.step(s, dt);
        cpu.push(performance.now() - c);
        objects = Math.max(objects, reh.objects());
        (frames % 2 ? ride : base).push(await draw(frames % 2 === 1));
        onProgress(0.15 + 0.85 * Math.min(1, (performance.now() - t0) / (REHEARSAL_SEC * 1000)));
      }
      rt.dispose();
      const baseMs = median(base), rideMs = median(ride), cpuMs = median(cpu);
      return {
        what: 'this ride on a made-up busy song, from just before its drop, drawn off screen',
        frames, seconds: +(s - reh.from).toFixed(2), size: `${size.x}x${size.y}`,
        baseMs: +baseMs.toFixed(2), rideMs: +rideMs.toFixed(2), extraMs: +Math.max(0, rideMs - baseMs).toFixed(2), cpuMs: +cpuMs.toFixed(2),
        objects, compileMs: Math.round(compileMs),
      };
    } finally {
      reh.dispose();
    }
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
    // (?dyno=full runs the whole test even in software, for the headless checks.)
    out.software = /swiftshader|llvmpipe|softpipe|basic render|software/.test(name) && new URLSearchParams(location.search).get('dyno') !== 'full';
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

  private verdict(spec: Record<string, any>, cpu: { msFor10M: number; cores: number }, live: DynoLive | null, reh: DynoRehearsal | null): DynoResult {
    // The ride's frame: the landing's own frame (which already has the sky, the ground, the carriage
    // and the effects passes in it), plus what the busy ride adds. Without a rehearsal, allow a
    // third more than the landing. (The landing runs at the display's refresh when it can, so on a
    // fast machine this errs slow by up to a frame's slack: fine for a warning.)
    const frameMs = !live ? 0 : reh ? live.medianMs + reh.extraMs + reh.cpuMs : live.medianMs * 1.35;
    const fps = frameMs ? 1000 / frameMs : 0;
    const advice: string[] = [];
    let level: DynoLevel = 'ok';
    if (spec.software || !spec.backend) {
      level = 'none';
      advice.push('No 3D acceleration: the browser is drawing in software. Turn on hardware acceleration in the browser\'s settings, or try another machine.');
    } else {
      // (WebGL alone is no verdict: a phone on WebGL rode at 60 fps. The frames decide.)
      const what = reh ? 'A test ride off screen' : 'The start screen';
      if (fps && fps < 24) { level = 'slow'; advice.push(`${what} ran at about ${Math.round(fps)} fps in this window, so the ride is likely to be jerky. A smaller window helps; the resolution also drops by itself.`); }
      else if (fps && fps < 40) { level = 'tricky'; advice.push(`${what} ran at about ${Math.round(fps)} fps in this window: the busiest moments may stutter. The resolution and detail drop by themselves when they do.`); }
    }
    // Deep listen runs a neural network beside the ride: it wants a reasonable processor and memory.
    const weakCpu = cpu.msFor10M > 700 || (cpu.cores && cpu.cores <= 2) || (spec.memoryGB && spec.memoryGB <= 4);
    const light = level === 'none' || level === 'slow' || !!weakCpu;
    if (spec.backend === 'WebGL2' && level !== 'none' && level !== 'ok') advice.push('This browser is drawing with WebGL; one with WebGPU (a recent Chrome or Edge) is usually faster.');
    if (light && level !== 'none') advice.push('Running light: deep listen (the neural note transcriber) is not run by default, so the notes come from the fast parser. You are welcome to kick it off: below, or with the 🎧 button during a ride.');
    const headline = level === 'none' ? 'Needs 3D acceleration' : level === 'slow' ? 'Slow machine: running light' : level === 'tricky' ? (light ? 'Frames may stutter; running light' : 'Frames may stutter') : light ? 'Running light' : 'All clear';
    return {
      when: new Date().toISOString(), level, light, headline, advice, spec, cpu, live, rehearsal: reh,
      estimate: { fps: Math.round(fps), frameMs: +frameMs.toFixed(2), screenPixels: Math.round(window.innerWidth * window.innerHeight * (live?.pixelRatio ?? 1) ** 2) },
      recommended: {
        browser: 'a recent Chrome or Edge (WebGPU)',
        gpu: 'any dedicated graphics card, a recent integrated one, or a recent phone',
        cpu: '4 cores or more, 10M-step test under 400 ms',
        memory: '8 GB or more',
      },
    };
  }
}
