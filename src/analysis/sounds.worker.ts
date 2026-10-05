// The sound pass, worker half: YAMNet (Google's sound classifier, Apache-2.0, run by MediaPipe's
// audio tasks in WebAssembly) listens to the song a few seconds at a time and says, for every
// second or so, which of 521 kinds of sound it hears: music, speech, singing, a crowd, a siren, an
// explosion, birds, rain... The main-thread half (sounds.ts) turns that into cues.
// Input: mono audio at 16 kHz. Nothing leaves the machine; the model ships with the app.

import { AudioClassifier } from '@mediapipe/tasks-audio';

export interface SoundsStart { type: 'start'; pcm: Float32Array; modelUrl: string; loaderUrl: string; wasmUrl: string; chunkSec: number }
/** One classified window: its start (seconds into the song) and [class index, score, label] for each class it heard. */
export interface SoundFrame { t: number; cats: [number, number, string][] }

const SR = 16000;

self.onmessage = async (ev: MessageEvent<SoundsStart>) => {
  const m = ev.data;
  if (m.type !== 'start') return;
  try {
    const t0 = performance.now();
    const classifier = await AudioClassifier.createFromOptions(
      { wasmLoaderPath: m.loaderUrl, wasmBinaryPath: m.wasmUrl },
      { baseOptions: { modelAssetPath: m.modelUrl }, maxResults: 30, scoreThreshold: 0.04 },
    );
    (self as any).postMessage({ type: 'ready', loadMs: performance.now() - t0 });
    const chunk = Math.round(m.chunkSec * SR);
    const t1 = performance.now();
    for (let a = 0; a < m.pcm.length; a += chunk) {
      const part = m.pcm.subarray(a, Math.min(m.pcm.length, a + chunk));
      if (part.length < SR * 0.5) break; // too short to classify
      const results = classifier.classify(part, SR);
      const frames: SoundFrame[] = results.map(r => ({
        t: a / SR + (r.timestampMs ?? 0) / 1000,
        cats: (r.classifications[0]?.categories ?? []).map(c => [c.index, c.score, c.categoryName] as [number, number, string]),
      }));
      (self as any).postMessage({ type: 'chunk', a: a / SR, b: (a + part.length) / SR, frames, wallSec: (performance.now() - t1) / 1000 });
      // Let messages out between chunks.
      await new Promise(r => setTimeout(r, 0));
    }
    classifier.close();
    (self as any).postMessage({ type: 'done' });
  } catch (e: any) {
    (self as any).postMessage({ type: 'error', message: String(e?.message ?? e) });
  }
};
