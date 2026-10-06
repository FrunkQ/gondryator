// The frame analyser: a picture-in-picture strip of frame times laid against the show clock,
// with every stutter labelled by what happened in that frame (a section or scenery change, a
// shader being built, a new model's first appearance, the sky's reflections being re-baked,
// a long main-thread task...). Anything in the app can call `perf.mark('what')`.

type Frame = { dt: number; s: number; marks: string[] };

const CAP = 7200; // two minutes at 60 fps

class Perf {
  private pending: string[] = [];
  /** Note that something happened this frame. Cheap when the analyser is off. */
  mark(what: string) { if (this.on) this.pending.push(what); }
  on = false;
  take(): string[] { const m = this.pending; this.pending = []; return m; }
}
export const perf = new Perf();

export class FrameAnalyser {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private text: HTMLDivElement;
  private frames: Frame[] = [];
  private last = 0;
  private lastShaders = -1;
  private lastGeo = -1;
  private lastTex = -1;
  private startWall = 0;
  private startShow: number | null = null;
  private refresh = 60;

  /** `profile` gathers the rest of a saved profile: the machine, the dynamometer, the song, the settings. */
  constructor(private renderer: () => any, private profile: () => Record<string, unknown> = () => ({})) {
    const el = this.el = document.createElement('div');
    el.id = 'frames';
    el.className = 'ui hidden';
    el.innerHTML = `<header><b>Frame analyser</b><span class="fa-btns"><button class="ghost fa-reset" title="Start counting again">Reset</button><button class="ghost fa-copy" title="Copy the report to the clipboard">Copy report</button><button class="ghost fa-save" title="Save a performance profile (machine, test scenes, frame times) as a file to share">Save profile</button><button class="ghost fa-close" title="Close (P)">✕</button></span></header><canvas></canvas><div class="fa-text"></div>`;
    this.canvas = el.querySelector('canvas')!;
    this.g = this.canvas.getContext('2d')!;
    this.text = el.querySelector('.fa-text')!;
    el.querySelector('.fa-close')!.addEventListener('click', () => this.toggle(false));
    el.querySelector('.fa-reset')!.addEventListener('click', () => this.reset());
    el.querySelector('.fa-copy')!.addEventListener('click', () => void navigator.clipboard?.writeText(this.report()).catch(() => {}));
    el.querySelector('.fa-save')!.addEventListener('click', () => this.save());
    // Long main-thread tasks (Chromium): a strong hint the stall was JavaScript, not the GPU.
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) perf.mark(`long task ${Math.round(e.duration)} ms`);
      }).observe({ type: 'longtask', buffered: false } as any);
    } catch { /* not supported */ }
    // Estimate the display's refresh rate from the first frames.
    let n = 0, t0 = 0;
    const probe = (t: number) => { if (n === 0) t0 = t; if (++n < 30) requestAnimationFrame(probe); else this.refresh = Math.round(29000 / (t - t0)) || 60; };
    requestAnimationFrame(probe);
  }

  get isOpen() { return perf.on; }

  toggle(on = !perf.on) {
    perf.on = on;
    this.el.classList.toggle('hidden', !on);
    if (on) this.reset();
  }

  reset() { this.frames = []; this.last = 0; this.startWall = performance.now(); this.startShow = null; }

  /** Call once per rendered frame, after rendering. */
  frame(s: number) {
    if (!perf.on) return;
    const now = performance.now();
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    const marks = perf.take();
    this.gpuMarks(marks);
    if (this.startShow === null && s > 0) this.startShow = s;
    if (dt > 0) {
      this.frames.push({ dt, s, marks });
      if (this.frames.length > CAP) this.frames.shift();
    } else if (marks.length && this.frames.length) this.frames[this.frames.length - 1].marks.push(...marks);
    if ((this.frames.length & 7) === 0) this.draw();
  }

  /** New shaders, geometries and textures since the last frame: the usual causes of a GPU hitch. */
  private gpuMarks(marks: string[]) {
    const r = this.renderer();
    if (!r) return;
    const pl = r._pipelines?.programs;
    const shaders = pl ? (pl.vertex?.size ?? 0) + (pl.fragment?.size ?? 0) + (pl.compute?.size ?? 0) : -1;
    const geo = r.info?.memory?.geometries ?? -1, tex = r.info?.memory?.textures ?? -1;
    if (this.lastShaders >= 0 && shaders > this.lastShaders) marks.push(`+${shaders - this.lastShaders} shader${shaders - this.lastShaders > 1 ? 's' : ''} compiled`);
    if (this.lastGeo >= 0 && geo > this.lastGeo) marks.push(`+${geo - this.lastGeo} GPU geometr${geo - this.lastGeo > 1 ? 'ies' : 'y'}`);
    if (this.lastTex >= 0 && tex > this.lastTex) marks.push(`+${tex - this.lastTex} texture${tex - this.lastTex > 1 ? 's' : ''}`);
    this.lastShaders = shaders; this.lastGeo = geo; this.lastTex = tex;
  }

  private stats() {
    const f = this.frames;
    const dts = f.map(x => x.dt).sort((a, b) => a - b);
    const med = dts.length ? dts[dts.length >> 1] : 16.7;
    const budget = 1000 / this.refresh;
    const spikeAt = Math.max(50, med * 2.5);
    const spikes = f.filter(x => x.dt > spikeAt);
    const total = f.reduce((a, x) => a + x.dt, 0);
    const low1 = dts.length ? dts[Math.floor(dts.length * 0.99)] : 0;
    const dropped = f.reduce((a, x) => a + Math.max(0, Math.round(x.dt / budget) - 1), 0);
    const showSpan = f.length > 1 ? f[f.length - 1].s - f[0].s : 0;
    return { med, spikes, spikeAt, fps: total > 0 ? (f.length * 1000) / total : 0, low1, dropped, budget, showSpan, frames: f.length };
  }

  private draw() {
    const c = this.canvas, g = this.g;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const st = this.stats();
    const n = Math.min(this.frames.length, Math.floor(W / 2));
    const recent = this.frames.slice(-n);
    const yOf = (ms: number) => H - Math.min(H - 2, (ms / 100) * H);
    // Guides at one and two frame budgets.
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(0, yOf(st.budget), W, 1); g.fillRect(0, yOf(st.budget * 2), W, 1);
    recent.forEach((fr, i) => {
      const x = W - (n - i) * 2;
      g.fillStyle = fr.dt <= st.budget * 1.2 ? '#5ad17a' : fr.dt <= st.budget * 2.2 ? '#f2c94c' : '#ff5a5f';
      const y = yOf(fr.dt);
      g.fillRect(x, y, 2, H - y);
      if (fr.marks.length) { g.fillStyle = '#9ad0ff'; g.fillRect(x, 0, 2, 4); }
    });
    // Label the biggest recent spikes with their cause.
    g.font = '10px system-ui, sans-serif';
    const big = recent.map((fr, i) => ({ fr, i })).filter(o => o.fr.dt > st.spikeAt).sort((a, b) => b.fr.dt - a.fr.dt).slice(0, 3);
    for (const { fr, i } of big) {
      const x = W - (n - i) * 2;
      g.fillStyle = '#fff';
      const label = `${Math.round(fr.dt)}ms ${fr.marks[0] ?? '?'}`;
      g.fillText(label, Math.max(2, Math.min(W - g.measureText(label).width - 2, x - 20)), Math.max(12, yOf(fr.dt) - 3));
    }
    const worst = [...st.spikes].sort((a, b) => b.dt - a.dt).slice(0, 6);
    this.text.innerHTML =
      `<div>${st.fps.toFixed(0)} fps avg · 1% low ${st.low1.toFixed(0)} ms · median ${st.med.toFixed(1)} ms · ${st.frames} frames · ${st.dropped} dropped at ${this.refresh} Hz · ${st.spikes.length} stutters &gt; ${Math.round(st.spikeAt)} ms</div>` +
      worst.map(f => `<div class="fa-spike"><b>${f.s.toFixed(1)} s</b> ${Math.round(f.dt)} ms · ${f.marks.length ? esc(f.marks.join(', ')) : '<i>nothing marked: GC, the browser, or the GPU driver</i>'}</div>`).join('');
  }

  /** A plain-text report: summary, every stutter with its causes, and cause totals. */
  /**
   * Saves everything about this machine's performance as one JSON file: what it is, how the
   * dynamometer's test scenes ran, and the frame times (with their causes) since the last Reset.
   */
  save() {
    const { spikes, ...stats } = this.stats();
    const data = {
      kind: 'gondryator-perf-profile', version: 1,
      ...this.profile(),
      frames: { stats: { ...stats, spikes: spikes.length }, report: this.report(), refreshHz: this.refresh, log: this.frames.map(f => ({ ms: +f.dt.toFixed(2), s: +f.s.toFixed(3), ...(f.marks.length ? { marks: f.marks } : {}) })) },
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `gondryator-perf-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  report(): string {
    const st = this.stats();
    const causes = new Map<string, { n: number; ms: number }>();
    for (const f of st.spikes) for (const m of (f.marks.length ? f.marks : ['(unmarked)'])) {
      const k = m.replace(/\d+/g, 'N');
      const c = causes.get(k) ?? { n: 0, ms: 0 };
      c.n++; c.ms += f.dt; causes.set(k, c);
    }
    const r = this.renderer();
    const lines = [
      `Gondryator frame report · ${new Date().toISOString()}`,
      `${navigator.userAgent}`,
      `backend ${r?.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2'} · display ~${this.refresh} Hz · ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`,
      `${st.frames} frames over ${st.showSpan.toFixed(1)} s of show · ${st.fps.toFixed(1)} fps avg · median ${st.med.toFixed(1)} ms · 1% low ${st.low1.toFixed(1)} ms · ${st.dropped} dropped frames`,
      `Expected ${Math.round(st.showSpan * this.refresh)} frames for that stretch at ${this.refresh} Hz, got ${st.frames}.`,
      '',
      'Stutter causes (frames over the threshold that carried each mark):',
      ...[...causes.entries()].sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => `  ${v.n}× ${Math.round(v.ms)} ms total  ${k}`),
      '',
      'Every stutter:',
      ...st.spikes.map(f => `  ${f.s.toFixed(2)} s  ${Math.round(f.dt)} ms  ${f.marks.join(', ') || '(unmarked)'}`),
    ];
    return lines.join('\n');
  }
}

function esc(s: string) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)); }
