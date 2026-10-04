/// <reference lib="webworker" />
// Analysis worker: runs the progressive analyzer front to back and posts score deltas.
// It can also auto-tune the parser for one song (see autotune.ts) and post the settings it found.
import { Analyzer } from './analyzer';
import { autoTune } from './autotune';

let cancelled = false;

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type === 'autotune') {
    cancelled = false;
    const it = autoTune(msg.pcm, msg.sampleRate, msg.tuning);
    for (;;) {
      const r = it.next();
      if (cancelled) return;
      if (r.done) { (self as DedicatedWorkerGlobalScope).postMessage({ type: 'autotune-done', result: r.value }); return; }
      (self as DedicatedWorkerGlobalScope).postMessage({ type: 'autotune-progress', p: r.value });
      await new Promise(r => setTimeout(r, 0)); // let a cancel in
    }
  }
  if (msg.type !== 'start') return;
  cancelled = false;
  const pcm: Float32Array = msg.pcm;
  const a = new Analyzer(pcm, msg.sampleRate, { chunkSec: 3, tuning: msg.tuning });
  const throttle: number = msg.throttleMsPerSec ?? 0;
  const t0 = performance.now();
  while (!a.finished && !cancelled) {
    const before = a.analyzedSec;
    const d = a.step();
    if (d) (self as DedicatedWorkerGlobalScope).postMessage({ type: 'delta', delta: d });
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'progress', analyzedSec: a.analyzedSec, wallSec: (performance.now() - t0) / 1000 });
    const audio = a.analyzedSec - before;
    // Optional artificial slowness, to test the frontier guard.
    await new Promise(r => setTimeout(r, throttle * audio));
  }
};
