// "Deep listen": Spotify's Basic Pitch (a small neural network, Apache-2.0) transcribes the
// pitched instruments into notes, much more precisely than the fast parser's hand-made tracker.
// It runs in its own worker after the fast parse has finished, window by window, and sends back
// notes for each window so the score can be upgraded while the song plays.
// Input: mono audio at 22050 Hz (Basic Pitch's rate). Output: notes with time, length, MIDI pitch
// and amplitude. Nothing leaves the machine; the model ships with the app (public/models).

import * as tf from '@tensorflow/tfjs';
import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';

export interface DeepNote { t: number; d: number; p: number; a: number; bend: number }
export interface DeepStart { type: 'start'; pcm: Float32Array; modelUrl: string; windows: [number, number][]; minSpeed: number }

// TensorFlow.js 3 checks `!window` while waiting on the GPU, which throws in a worker (there is
// no window at all). A window that exists but is undefined makes it fall back to setTimeout.
if (!('window' in self)) (self as any).window = undefined;

// Anything that fails inside TensorFlow's own promises still reaches the page as an error.
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  (self as any).postMessage({ type: 'error', message: String(e.reason?.message ?? e.reason) });
});

const SR = 22050;
/** Held between windows while comfortably ahead of the music (the main thread decides; see DeepListen.pace). */
let hold = false;
const PRE = 1, POST = 2;

self.onmessage = async (ev: MessageEvent<DeepStart>) => {
  const m = ev.data as any;
  if (m.type === 'pace') { hold = m.hold; return; }
  if (m.type !== 'start') return;
  try {
    // The GPU if this worker can have one, else plain JavaScript (slower than real time, but it
    // still finishes in the background and the result is cached for next time).
    let backend = 'cpu';
    try { if (await tf.setBackend('webgl')) backend = 'webgl'; } catch { /* no WebGL in this worker */ }
    if (backend !== 'webgl') await tf.setBackend('cpu');
    await tf.ready();
    (self as any).postMessage({ type: 'backend', name: tf.getBackend() });
    const model = tf.loadGraphModel(m.modelUrl);
    const bp = new BasicPitch(model);
    // The system check: warm up (the first run builds the GPU programs), then time four seconds
    // of the song. Too slow to stay comfortably ahead of the music, and it stops here.
    const mid = Math.max(0, Math.floor(m.pcm.length / 2) - 2 * SR);
    await bp.evaluateModel(m.pcm.slice(mid, mid + SR), () => {}, () => {});
    const tb = performance.now();
    const benchSec = Math.min(4, m.pcm.length / SR);
    await bp.evaluateModel(m.pcm.slice(mid, mid + Math.round(benchSec * SR)), () => {}, () => {});
    const speed = benchSec / Math.max(0.001, (performance.now() - tb) / 1000);
    (self as any).postMessage({ type: 'bench', speed, backend: tf.getBackend() });
    if (speed < m.minSpeed) return;
    const t0 = performance.now();
    for (const [a, b] of m.windows) {
      while (hold) await new Promise(r => setTimeout(r, 250));
      const from = Math.max(0, Math.round((a - PRE) * SR)), to = Math.min(m.pcm.length, Math.round((b + POST) * SR));
      if (to - from < SR / 2) { (self as any).postMessage({ type: 'window', a, b, notes: [] }); continue; }
      const audio = m.pcm.subarray(from, to);
      const frames: number[][] = [], onsets: number[][] = [], contours: number[][] = [];
      await bp.evaluateModel(audio, (f: number[][], o: number[][], c: number[][]) => { frames.push(...f); onsets.push(...o); contours.push(...c); }, () => {});
      const raw = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, null, null, true)));
      const off = from / SR;
      const notes: DeepNote[] = [];
      for (const n of raw) {
        const t = n.startTimeSeconds + off;
        if (t < a || t >= b) continue; // the pre- and post-roll belong to the neighbouring windows
        const bends = n.pitchBends ?? [];
        notes.push({ t, d: n.durationSeconds, p: n.pitchMidi, a: n.amplitude, bend: bends.length ? (Math.max(...bends) - Math.min(...bends)) / 3 : 0 });
      }
      (self as any).postMessage({ type: 'window', a, b, notes, wallSec: (performance.now() - t0) / 1000 });
    }
    (self as any).postMessage({ type: 'done', wallSec: (performance.now() - t0) / 1000 });
  } catch (e) {
    (self as any).postMessage({ type: 'error', message: (e as Error).message ?? String(e) });
  }
};
