// Cues for things that must wind up before they land. The score is known ahead of the music, so
// anything with a run-up (a firework's rocket, a wave rolling in, a wind-up before a slam) can start
// early and arrive exactly on its hit. These helpers say which hits, between two times.
//
// fireworkCues(score, from, to, busy): the hits in (from, to] worth a firework, each with how many
// shells. Section changes, drops and lifts always; a cheering crowd or an impact the sound pass
// heard; and, as `busy` rises (0..1), the big snares and the downbeats of the loud parts.

import { sectionAt, type Score } from '../score/types';

export interface Cue { t: number; shells: number; why: 'section' | 'drop' | 'lift' | 'impact' | 'crowd' | 'snare' | 'downbeat' }

function hash(n: number) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }

export function fireworkCues(sc: Score, from: number, to: number, busy = 1): Cue[] {
  const out: Cue[] = [];
  const inside = (t: number) => t > from && t <= to;
  sc.sections.forEach((sec, i) => { if (i > 0 && inside(sec.t)) out.push({ t: sec.t, shells: 3, why: 'section' }); });
  for (const m of sc.moments ?? []) {
    if (!inside(m.t)) continue;
    if (m.kind === 'drop') out.push({ t: m.t, shells: 5, why: 'drop' });
    else if (m.kind === 'lift') out.push({ t: m.t, shells: 3, why: 'lift' });
  }
  for (const c of sc.sounds ?? []) {
    if (!inside(c.t) || c.t > (sc.soundsFrontier ?? Infinity)) continue;
    if (c.kind === 'crowd') out.push({ t: c.t, shells: 2, why: 'crowd' });
    else if (c.kind === 'impact') out.push({ t: c.t, shells: 1, why: 'impact' });
  }
  if (busy > 0) {
    const E = sc.events;
    let lo = 0, hi = E.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (E[m].t <= from) lo = m + 1; else hi = m; }
    for (let i = lo; i < E.length && E[i].t <= to; i++) {
      const e = E[i];
      if (e.kind !== 'snare' || e.vel < 0.75) continue;
      const energy = sectionAt(sc, e.t).section?.energy ?? 0.5;
      if (hash(Math.round(e.t * 100)) < busy * (energy - 0.3)) out.push({ t: e.t, shells: 1, why: 'snare' });
    }
    if (busy >= 0.5) for (const b of sc.beats) {
      if (b.t > to) break;
      if (!b.downbeat || !inside(b.t)) continue;
      const energy = sectionAt(sc, b.t).section?.energy ?? 0.5;
      if (energy > 0.6) out.push({ t: b.t, shells: 1, why: 'downbeat' });
    }
  }
  // One cue per moment: the biggest wins, and nothing closer than a fifth of a second to another.
  out.sort((a, b) => a.t - b.t || b.shells - a.shells);
  const kept: Cue[] = [];
  for (const c of out) {
    const last = kept[kept.length - 1];
    if (last && c.t - last.t < 0.2) { if (c.shells > last.shells) kept[kept.length - 1] = c; continue; }
    kept.push(c);
  }
  return kept;
}
