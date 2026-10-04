// Deep listen, the main-thread half: runs Basic Pitch (deep.worker.ts) over the song after the
// fast parse and swaps its notes in for the fast parser's melody and bass notes.
//
// The swap has to be safe while the song plays. Renderers walk score.events with pointers, so
// a window of notes is only spliced into the live score when it starts well ahead of the
// playhead (MARGIN seconds: further than anything is scheduled ahead). Windows the music has
// already reached are kept aside, and when the whole song is done a fully upgraded copy is saved
// to the cache, so the next ride on this song is deep from the first note.
//
// What becomes what (the score keeps the shape the renderers expect):
//   notes below E3 (MIDI 52)      bass: the lowest note of each chord
//   everything above              the melody: the top note of each chord
//   held notes (1.2 s and over)   also one pad per chord: its lowest note above the bass

import type { Score, ScoreEvent } from '../score/types';
import type { DeepNote } from './deep.worker';

const WINDOW = 20;
const MARGIN = 20;
const BASS_TOP = 52;
const PAD_DUR = 1.2;
/** Deep listen only runs if the system check transcribes at least this many times faster than real time. */
const MIN_SPEED = 1.5;

/**
 * A first, free look at the machine before downloading anything: phones and small machines skip
 * deep listen. Returns the reason to skip, or null to go ahead with the timed check.
 */
export function deepPrecheck(): string | null {
  const nav = navigator as any;
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad/i.test(navigator.userAgent)) return 'a phone or tablet';
  if ((navigator.hardwareConcurrency ?? 8) < 4) return 'fewer than four processor cores';
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return 'less than 4 GB of memory';
  return null;
}

export class DeepListen {
  backend = '';
  /** 'checking' while the timed system check runs, then 'running', 'done', or 'skipped'. */
  state: 'checking' | 'running' | 'done' | 'skipped' = 'checking';
  /** How many times faster than real time the system check ran. */
  speed = 0;
  /** Called whenever the state or progress changes (for the little note in the bar). */
  onChange: () => void = () => {};
  progress = 0;
  done = false;
  failed = '';
  notes = 0;
  private worker: Worker | null = null;
  private windows = new Map<number, ScoreEvent[]>();
  private total = 0;
  private serial = 0;
  /** Skip the speed check (?deep=force, for tests on slow machines). */
  force = false;

  constructor(
    private audio: AudioBuffer,
    private score: Score,
    private now: () => number,
    private onFinished: (upgraded: Score) => void,
  ) {}

  async start() {
    const pcm = await resample(this.audio, 22050);
    const dur = this.audio.duration;
    // From the first window comfortably ahead of the playhead to the end, then back round from
    // the start (those only make the cached copy better).
    const n = Math.ceil(dur / WINDOW);
    const first = Math.min(n, Math.ceil((this.now() + MARGIN) / WINDOW));
    const order = [...Array(n - first).keys()].map(i => first + i).concat([...Array(first).keys()]);
    const windows = order.map(i => [i * WINDOW, Math.min(dur, (i + 1) * WINDOW)] as [number, number]);
    this.total = windows.length;
    const w = new Worker(new URL('./deep.worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
    w.onerror = e => { this.giveUp(e.message || 'worker failed'); };
    // An error deep inside TensorFlow's own promises never reaches onerror, so the check also
    // gives up if it has not finished within a minute and a half.
    setTimeout(() => { if (this.state === 'checking' && this.worker === w) this.giveUp('the system check did not finish'); }, 90_000);
    const modelUrl = new URL('models/basic-pitch/model.json', document.baseURI).href;
    w.postMessage({ type: 'start', pcm, modelUrl, windows, minSpeed: this.force ? 0 : MIN_SPEED }, [pcm.buffer]);
  }

  stop() { this.worker?.terminate(); this.worker = null; }

  private giveUp(why: string) {
    this.failed = why;
    this.state = 'skipped';
    this.stop();
    this.onChange();
  }

  get status() {
    if (this.failed) return `deep listen failed: ${this.failed}`;
    if (this.state === 'skipped') return `deep listen skipped (${this.speed.toFixed(1)}× real time on ${this.backend})`;
    if (this.state === 'checking') return 'deep listen: checking this machine';
    return `deep listen ${this.done ? 'done' : Math.round(this.progress * 100) + '%'}${this.backend ? ' · ' + this.backend : ''} · ${this.notes} notes`;
  }

  private onMessage(m: any) {
    if (m.type === 'backend') this.backend = m.name;
    else if (m.type === 'bench') {
      this.speed = m.speed;
      this.backend = m.backend;
      this.state = m.speed >= (this.force ? 0 : MIN_SPEED) ? 'running' : 'skipped';
      if (this.state === 'skipped') this.stop();
      this.onChange();
    }
    else if (m.type === 'error') { this.failed = m.message; this.state = 'skipped'; this.stop(); this.onChange(); }
    else if (m.type === 'window') {
      const evs = this.toEvents(m.notes as DeepNote[]);
      this.notes += evs.length;
      this.windows.set(m.a, evs);
      this.progress = this.windows.size / this.total;
      this.onChange();
      // Live upgrade, only where nothing has been scheduled yet.
      if (m.a >= this.now() + MARGIN) splice(this.score, m.a, m.b, evs);
    } else if (m.type === 'done') {
      this.done = true;
      this.state = 'done';
      this.stop();
      this.onChange();
      const copy: Score = structuredClone(this.score);
      for (const [a, evs] of this.windows) splice(copy, a, a + WINDOW, evs.map(e => ({ ...e })));
      copy.analysis.engine = this.score.analysis.engine.replace(/ \+ basic-pitch.*$/, '') + ' + basic-pitch 1.0.1';
      this.onFinished(copy);
    }
  }

  /** Basic Pitch's notes, shaped like the fast parser's: bass, a melody line, and pads. */
  private toEvents(notes: DeepNote[]): ScoreEvent[] {
    const ok = notes.filter(n => n.d >= 0.06 && n.a >= 0.25).sort((x, y) => x.t - y.t);
    const out: ScoreEvent[] = [];
    // Chords: notes starting within 40 ms of each other.
    for (let i = 0; i < ok.length;) {
      let j = i + 1;
      while (j < ok.length && ok[j].t - ok[i].t < 0.04) j++;
      const chord = ok.slice(i, j);
      i = j;
      const bass = chord.filter(n => n.p < BASS_TOP).sort((x, y) => x.p - y.p)[0];
      const upper = chord.filter(n => n.p >= BASS_TOP).sort((x, y) => y.p - x.p);
      if (bass) out.push(this.ev(bass, 'bass'));
      if (upper.length) {
        out.push(this.ev(upper[0], 'other'));
        const pad = upper.slice(1).reverse().find(n => n.d >= PAD_DUR);
        if (pad) out.push(this.ev(pad, 'other'));
      }
    }
    // Bar positions, from the beat grid.
    const beats = this.score.beats;
    for (const e of out) {
      let lo = 0, hi = beats.length - 1;
      if (hi < 1 || e.t < beats[0].t) continue;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (beats[mid].t <= e.t) lo = mid; else hi = mid - 1; }
      const b = beats[lo], nb = beats[lo + 1];
      const frac = nb ? (e.t - b.t) / (nb.t - b.t) : 0;
      e.bar = b.bar;
      e.step = (b.beat - 1) * 4 + Math.min(3, Math.floor(frac * 4));
    }
    return out;
  }

  private ev(n: DeepNote, stem: 'bass' | 'other'): ScoreEvent {
    return { id: `bp${this.serial++}`, t: n.t, dur: n.d, stem, kind: 'note', pitch: n.p, vel: Math.min(1, Math.max(0.1, n.a * 1.2)) };
  }
}

/** Replace the melody and bass notes in [a, b) with new ones, keeping the events sorted. */
function splice(score: Score, a: number, b: number, evs: ScoreEvent[]) {
  const ev = score.events;
  const find = (t: number) => { let lo = 0, hi = ev.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t < t) lo = m + 1; else hi = m; } return lo; };
  const lo = find(a), hi = find(b);
  const kept = ev.slice(lo, hi).filter(e => !(e.kind === 'note' && (e.stem === 'bass' || e.stem === 'other')));
  const merged = kept.concat(evs).sort((x, y) => x.t - y.t);
  ev.splice(lo, hi - lo, ...merged);
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
