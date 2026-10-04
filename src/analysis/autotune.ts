// Auto-tune: find parser settings that suit one song, with no answer key. A stretch of the song
// is parsed again and again with different settings, and each parse is scored on what any good
// parse of real music looks like:
//   - the beat is steady, and kicks and snares sit on its grid;
//   - each instrument plays a plausible number of hits per bar (none where its band is busy is
//     as wrong as forty);
//   - when the mid band is busy there is a melody, it covers a fair share of the time, and it
//     moves in steps rather than leaping about by octaves.
// The search is a coordinate descent over the knobs that matter most, a step at a time, so a
// caller can spread it over frames or run it in a worker.

import { Analyzer } from './analyzer';
import { DEFAULT_TUNING, TUNING_PARAMS, type Tuning } from './tuning';
import type { ScoreEvent, Beat } from '../score/types';

export interface ParseScore {
  total: number;
  parts: Record<string, number>;
}

export interface AutoTuneResult {
  tuning: Tuning;
  score: ParseScore;
  baseline: ParseScore;
  evals: number;
  /** The knobs that changed, as "label: from -> to". */
  changes: string[];
}

/** The settings the search moves, in the order it tries them. */
const KNOBS: (keyof Tuning)[] = ['kickFloor', 'kickGrid', 'snareFloor', 'hatFloor', 'leadClarity', 'leadPresence', 'bassYin', 'snareNoise', 'hatPeak', 'kickDecayDb', 'tempoCentre', 'beatTightness'];

/** Up to `sec` seconds from the busy middle of the song (a quiet intro tells the search little). */
export function excerpt(pcm: Float32Array, sr: number, sec = 32): Float32Array {
  const n = Math.min(pcm.length, Math.round(sec * sr));
  if (n >= pcm.length) return pcm;
  // Loudest stretch, judged on one-second blocks.
  const block = Math.round(sr), blocks = Math.floor(pcm.length / block);
  const e = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) { let s = 0; for (let i = b * block; i < (b + 1) * block; i += 8) s += pcm[i] * pcm[i]; e[b] = s; }
  const w = Math.floor(n / block);
  let best = 0, bestAt = 0, run = 0;
  for (let b = 0; b < blocks; b++) {
    run += e[b];
    if (b >= w) run -= e[b - w];
    if (b >= w - 1 && run > best) { best = run; bestAt = b - w + 1; }
  }
  const start = Math.min(pcm.length - n, bestAt * block);
  return pcm.subarray(start, start + n);
}

/** Parse `pcm` with `tuning` and score the result (see the top of this file). */
export function scoreParse(pcm: Float32Array, sr: number, tuning: Tuning): ParseScore {
  const a = new Analyzer(pcm, sr, { chunkSec: 8, tuning });
  const events: ScoreEvent[] = [], beats: Beat[] = [];
  const mid: number[] = [];
  while (!a.finished) {
    const d = a.step();
    if (!d) continue;
    events.push(...d.events);
    beats.push(...d.beats);
    if (d.envelopes.other) mid.push(...d.envelopes.other);
  }
  const dur = pcm.length / sr;
  const parts: Record<string, number> = {};
  // Steady beat.
  const ibi: number[] = [];
  for (let i = 1; i < beats.length; i++) ibi.push(beats[i].t - beats[i - 1].t);
  // Robust to the odd dropped beat: the share of beats within 5% of the typical gap.
  const med = [...ibi].sort((x, y) => x - y)[ibi.length >> 1] ?? 0;
  parts.steady = ibi.length > 8 ? ibi.filter(x => Math.abs(x - med) < med * 0.05).length / ibi.length : 0;
  // Hits on the grid: beats and eighths for drums, sixteenths for hats.
  const subdivide = (n: number) => {
    const g: number[] = [];
    for (let i = 0; i < beats.length; i++) {
      g.push(beats[i].t);
      if (i + 1 < beats.length) for (let k = 1; k < n; k++) g.push(beats[i].t + (beats[i + 1].t - beats[i].t) * k / n);
    }
    return g;
  };
  const eighths = subdivide(2), sixteenths = subdivide(4);
  const onGrid = (kind: string) => {
    const grid = kind === 'hat' ? sixteenths : eighths;
    const tol = kind === 'hat' ? 0.03 : 0.045;
    const hits = events.filter(e => e.kind === kind);
    if (!hits.length || !grid.length) return 0;
    let ok = 0, g = 0;
    for (const e of hits) {
      while (g + 1 < grid.length && grid[g + 1] <= e.t) g++;
      const d = Math.min(Math.abs(e.t - grid[g]), Math.abs((grid[g + 1] ?? Infinity) - e.t));
      if (d < tol) ok++;
    }
    return ok / hits.length;
  };
  parts.kickGrid = onGrid('kick') * 2;
  parts.snareGrid = onGrid('snare') * 1.4;
  parts.hatGrid = onGrid('hat') * 0.6;
  // Plausible hits per bar.
  const bars = Math.max(1, beats.length / 4);
  const busyMid = mid.length ? mid.reduce((s, x) => s + x, 0) / mid.length > 0.35 : false;
  const per = (f: (e: ScoreEvent) => boolean) => events.filter(f).length / bars;
  const inRange = (x: number, lo: number, hi: number) => x <= 0 ? 0 : x < lo ? Math.exp(-Math.log(lo / x) * 1.5) : x > hi ? Math.exp(-Math.log(x / hi) * 1.5) : 1;
  parts.kicks = inRange(per(e => e.kind === 'kick'), 1.5, 8);
  parts.snares = inRange(per(e => e.kind === 'snare'), 0.8, 4.5);
  parts.hats = inRange(per(e => e.kind === 'hat'), 2, 16);
  parts.bass = inRange(per(e => e.stem === 'bass'), 1, 16);
  const lead = events.filter(e => e.stem === 'other' && e.kind === 'note' && e.dur < 1.2);
  if (busyMid) {
    parts.melody = inRange(lead.length / bars, 1, 16);
    parts.coverage = Math.min(1, lead.reduce((s, e) => s + e.dur, 0) / dur / 0.3);
    let steps = 0;
    for (let i = 1; i < lead.length; i++) if (Math.abs((lead[i].pitch ?? 0) - (lead[i - 1].pitch ?? 0)) <= 7) steps++;
    parts.stepwise = lead.length > 4 ? steps / (lead.length - 1) : 0;
  }
  const total = Object.values(parts).reduce((s, x) => s + x, 0);
  return { total, parts };
}

/**
 * The search, one parse per step. Yields progress (0..1); returns the best settings found.
 * `budget` caps the number of parses.
 */
export function* autoTune(pcm: Float32Array, sr: number, start: Tuning = DEFAULT_TUNING, budget = 26): Generator<number, AutoTuneResult> {
  const clip = excerpt(pcm, sr);
  let best = { ...start };
  const baseline = scoreParse(clip, sr, best);
  let bestScore = baseline;
  let evals = 1;
  yield evals / budget;
  for (const factor of [1.45, 1.2]) {
    for (const key of KNOBS) {
      if (evals >= budget) break;
      const p = TUNING_PARAMS.find(q => q.key === key)!;
      const tries = key === 'tempoCentre' ? [best[key] * 0.8, best[key] * 1.2] : key === 'beatTightness' ? [best[key] / 3, best[key] * 3] : [best[key] / factor, best[key] * factor];
      for (const v0 of tries) {
        if (evals >= budget) break;
        const v = Math.round(Math.min(p.max, Math.max(p.min, v0)) / p.step) * p.step;
        if (Math.abs(v - best[key]) < p.step / 2) continue;
        const cand = { ...best, [key]: Number(v.toFixed(4)) };
        const sc = scoreParse(clip, sr, cand);
        evals++;
        // Keep a change only if it clearly helps: noise in the score must not wander the knobs.
        if (sc.total > bestScore.total + 0.02) { best = cand; bestScore = sc; }
        yield evals / budget;
      }
    }
  }
  const changes: string[] = [];
  for (const p of TUNING_PARAMS) if (best[p.key] !== start[p.key]) changes.push(`${p.label}: ${start[p.key]} → ${best[p.key]}`);
  return { tuning: best, score: bestScore, baseline, evals, changes };
}

/** Run the whole search at once (workers, tests). */
export function autoTuneSync(pcm: Float32Array, sr: number, start: Tuning = DEFAULT_TUNING, budget = 26): AutoTuneResult {
  const it = autoTune(pcm, sr, start, budget);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

