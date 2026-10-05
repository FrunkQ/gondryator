// The sound pass, main-thread half: runs YAMNet (sounds.worker.ts) over the song from the start,
// alongside the fast parser, and turns what it hears into cues on the score (score.sounds) and a
// voice envelope (score.envelopes.voice: how sure it is that someone is singing or talking).
//
// It runs early on purpose: intros are full of samples, dialogue and effects, and the show wants
// them before the train leaves the station. Cues are appended front to back with a frontier of
// their own (score.soundsFrontier); a cue's `dur` keeps growing while the sound goes on.
//
// The 521 classes of AudioSet are grouped into a few families (SoundKind in score/types.ts). Music
// itself (instruments, genres) is ignored: the fast parser already hears that better.

import type { Score, SoundCue, SoundKind } from '../score/types';
import type { SoundFrame } from './sounds.worker';

const R = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** YAMNet class indexes per family (see the AudioSet class map). */
const FAMILIES: Record<SoundKind, number[]> = {
  speech: [0, 1, 2, 3, 4, 5, 12, 63],
  shout: R(6, 11),
  laugh: R(13, 18),
  sing: R(24, 32),
  crowd: [58, 61, 62, 64, 65, 66],
  animal: R(67, 131).filter(i => i !== 87 && i !== 120 && i !== 125), // (not cowbell, patter, buzz)
  nature: R(277, 293).filter(i => i !== 279 && i !== 290),
  siren: [302, 303, 304, 312, 313, 316, 317, 318, 319, 324, 325, 349, 350, ...R(382, 397)],
  engine: R(294, 347).filter(i => ![302, 303, 304, 312, 313, 316, 317, 318, 319, 324, 325].includes(i)),
  impact: [352, 353, ...R(420, 430), 434, 437, 454, 455, ...R(460, 464)],
  whoosh: [452, 453, 466, 467],
  tick: [400, 401, 402],
  beep: [475, 476, 477, 489],
};
/**
 * How sure the classifier must be before a family counts. Families that music itself often
 * sounds like (singing, synth beeps, engines in a bass drone) need more.
 */
export const SOUND_THRESHOLD: Record<SoundKind, number> = {
  speech: 0.3, shout: 0.3, laugh: 0.3, sing: 0.35, crowd: 0.3, animal: 0.3, nature: 0.3,
  siren: 0.3, engine: 0.4, impact: 0.3, whoosh: 0.25, tick: 0.3, beep: 0.45,
};
const KIND_OF = new Map<number, SoundKind>();
for (const [k, ids] of Object.entries(FAMILIES)) for (const i of ids) KIND_OF.set(i, k as SoundKind);

const SR = 16000;
const CHUNK = 6;

/** A free look at the machine first: tiny devices skip the sound pass. Returns why, or null to go ahead. */
export function soundsPrecheck(): string | null {
  const mem = (navigator as any).deviceMemory;
  if (mem !== undefined && mem < 2) return 'not enough memory';
  if (typeof WebAssembly !== 'object') return 'no WebAssembly';
  return null;
}

export class SoundPass {
  state: 'loading' | 'running' | 'done' | 'skipped' = 'loading';
  failed = '';
  /** Seconds to load the model, and how many times faster than real time it classifies. */
  loadMs = 0;
  speed = 0;
  private worker: Worker | null = null;
  private open = new Map<SoundKind, SoundCue>();
  private hop = 0.975;

  constructor(private audio: AudioBuffer, private score: Score, private onChange: () => void, private onDone: () => void) {}

  async start() {
    const sc = this.score;
    sc.sounds = [];
    sc.soundsFrontier = 0;
    sc.envelopes.voice = { rate: 1 / this.hop, values: [] };
    const pcm = await resample(this.audio, SR);
    const w = new Worker(new URL('./sounds.worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
    w.onerror = e => this.giveUp(e.message || 'worker failed');
    // A failure deep inside the WebAssembly loader may never surface: give up after a while.
    setTimeout(() => { if (this.state === 'loading' && this.worker === w) this.giveUp('the model did not load'); }, 60_000);
    const url = (p: string) => new URL(p, document.baseURI).href;
    w.postMessage({
      type: 'start', pcm, chunkSec: CHUNK,
      modelUrl: url('models/yamnet/yamnet.tflite'),
      loaderUrl: url('models/mediapipe/audio_wasm_module_internal.js'),
      wasmUrl: url('models/mediapipe/audio_wasm_module_internal.wasm'),
    }, [pcm.buffer]);
  }

  stop() { this.worker?.terminate(); this.worker = null; }

  get status() {
    if (this.failed) return `sound pass failed: ${this.failed}`;
    const n = this.score.sounds?.length ?? 0;
    return `sounds ${this.state === 'done' ? 'done' : Math.round(((this.score.soundsFrontier ?? 0) / this.audio.duration) * 100) + '%'} · ${this.speed.toFixed(0)}× · ${n} cue${n === 1 ? '' : 's'}`;
  }

  private giveUp(why: string) {
    this.failed = why;
    this.state = 'skipped';
    this.stop();
    this.onChange();
  }

  private onMessage(m: any) {
    const sc = this.score;
    if (m.type === 'ready') { this.loadMs = m.loadMs; this.state = 'running'; this.onChange(); }
    else if (m.type === 'error') this.giveUp(m.message);
    else if (m.type === 'chunk') {
      const frames = m.frames as SoundFrame[];
      if (frames.length > 1) this.hop = Math.max(0.2, frames[1].t - frames[0].t);
      const voice = sc.envelopes.voice!;
      voice.rate = 1 / this.hop;
      for (const f of frames) {
        // The strongest class of each family in this window.
        const best = new Map<SoundKind, [number, string]>();
        for (const [i, score, name] of f.cats) {
          const k = KIND_OF.get(i);
          if (k && score > (best.get(k)?.[0] ?? 0)) best.set(k, [score, name]);
        }
        const v = Math.max(best.get('sing')?.[0] ?? 0, best.get('speech')?.[0] ?? 0, best.get('shout')?.[0] ?? 0);
        const at = Math.round(f.t / this.hop);
        while (voice.values.length < at) voice.values.push(voice.values[voice.values.length - 1] ?? 0);
        voice.values[at] = v;
        for (const k of Object.keys(FAMILIES) as SoundKind[]) {
          const hit = best.get(k);
          const cue = this.open.get(k);
          if (hit && hit[0] >= SOUND_THRESHOLD[k]) {
            if (cue && f.t <= cue.t + cue.dur + this.hop * 0.5) {
              // Still going: it grows (cues are live objects, so a renderer sees the new length).
              cue.dur = f.t + this.hop - cue.t;
              if (hit[0] > cue.score) { cue.score = hit[0]; cue.label = hit[1]; }
            } else {
              const c: SoundCue = { t: f.t, dur: this.hop, kind: k, label: hit[1], score: hit[0] };
              this.open.set(k, c);
              sc.sounds!.push(c);
            }
          }
        }
      }
      sc.soundsFrontier = Math.min(this.audio.duration, m.b);
      this.speed = m.b / Math.max(0.001, m.wallSec);
      this.onChange();
    } else if (m.type === 'done') {
      sc.soundsFrontier = this.audio.duration;
      this.state = 'done';
      this.stop();
      this.onChange();
      this.onDone();
    }
  }
}

/** The cues sounding at time t (a cue's length can still grow while the pass runs). */
export function soundsAt(score: Score, t: number): SoundCue[] {
  return (score.sounds ?? []).filter(c => c.t <= t && t < c.t + c.dur);
}

/** The song as mono audio at another sample rate, through the browser's own resampler. */
async function resample(buf: AudioBuffer, rate: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(buf.duration * rate), rate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}
