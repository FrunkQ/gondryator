// A made-up score for the dynamometer's rehearsal (ui/dyno.ts): a busy four-to-the-floor song,
// written straight out as a score (no audio, no analysis), so a ride can be run off screen on it
// before the rider's own song arrives. Built to be a fair worst case: every instrument playing, a
// build, then a drop at `SYNTH_DROP` with everything in.

import type { Beat, EnvelopeKey, Phrase, Score, ScoreEvent, Section } from './types';
import { emptyScore } from './types';

const BPM = 124, BEAT = 60 / BPM, BAR = BEAT * 4;
/** Where the drop lands, in seconds: the rehearsal rides from just before it. */
export const SYNTH_DROP = 24 * BAR;

export function synthScore(): Score {
  const plan: { bars: number; label: Section['label']; energy: number; group: number }[] = [
    { bars: 8, label: 'intro', energy: 0.3, group: 0 },
    { bars: 16, label: 'verse', energy: 0.65, group: 1 },
    { bars: 16, label: 'drop', energy: 1, group: 2 },
    { bars: 8, label: 'breakdown', energy: 0.4, group: 3 },
  ];
  const bars = plan.reduce((a, p) => a + p.bars, 0);
  const dur = bars * BAR + 2;
  const s = emptyScore({ title: 'Rehearsal', artist: 'Gondryator', album: '', durationSec: dur, art: null, hash: 'rehearsal' }, dur);
  s.tempo = [{ t: 0, bpm: BPM }];
  const events: ScoreEvent[] = [], beats: Beat[] = [], sections: Section[] = [], phrases: Phrase[] = [];
  const ev = (t: number, kind: ScoreEvent['kind'], stem: ScoreEvent['stem'], pitch: number | null, dur: number, vel: number, bar: number, step: number) =>
    events.push({ id: `r${events.length}`, t, dur, stem, kind, pitch, vel, bar, step });
  const melody = [72, 75, 79, 77, 75, 72, 70, 72], bassLine = [45, 45, 57, 45, 41, 41, 53, 41];
  let bar = 0;
  for (const p of plan) {
    sections.push({ t: bar * BAR, label: p.label, energy: p.energy, bar, group: p.group });
    for (let b = 0; b < p.bars; b++, bar++) {
      const tb = bar * BAR, busy = p.energy > 0.5, full = p.energy > 0.9;
      if (bar % 4 === 0) phrases.push({ t: tb, bar, bars: 4, id: p.group, repeatOf: null, entering: [] });
      if (bar % 2 === 0) ev(tb, 'note', 'other', 60 + (bar % 4), BAR * 2, 0.5, bar, 0); // pads
      for (let q = 0; q < 4; q++) {
        const t = tb + q * BEAT;
        beats.push({ t, bar, beat: q + 1, downbeat: q === 0, strength: q === 0 ? 1 : 0.6 });
        if (busy) ev(t, 'kick', 'drums', null, 0.1, 0.9, bar, q * 4);
        if (busy && q % 2 === 1) ev(t, 'snare', 'drums', null, 0.1, 0.8, bar, q * 4);
        for (let e = 0; e < (full ? 4 : 2); e++) ev(t + e * BEAT / (full ? 4 : 2), 'hat', 'drums', null, 0.05, 0.5, bar, q * 4 + e);
        if (busy) ev(t + BEAT / 2, 'note', 'bass', bassLine[(bar % 2) * 4 + q], BEAT / 2, 0.8, bar, q * 4 + 2);
        if (p.label !== 'intro') for (let e = 0; e < (full ? 2 : 1); e++) ev(t + e * BEAT / 2, 'note', 'other', melody[(q * 2 + e + bar) % 8], BEAT / 2, 0.7, bar, q * 4 + e * 2);
      }
    }
  }
  s.events = events.sort((a, b) => a.t - b.t);
  s.beats = beats; s.sections = sections; s.phrases = phrases;
  s.moments = [
    { t: SYNTH_DROP - 4 * BAR, kind: 'build', size: 0.7, bar: 20, beat: 1, dur: 4 * BAR },
    { t: SYNTH_DROP, kind: 'drop', size: 1, bar: 24, beat: 1 },
    { t: 40 * BAR, kind: 'break', size: 0.6, bar: 40, beat: 1 },
  ];
  // Continuous curves at 50 Hz, shaped by the sections, with a wobble on the beat.
  const rate = 50, n = Math.ceil(dur * rate);
  const env = (f: (t: number, e: number) => number) => ({ rate, values: Array.from({ length: n }, (_, i) => { const t = i / rate; let e = 0.3; for (const x of sections) if (x.t <= t) e = x.energy; return f(t, e); }) });
  const pulse = (t: number) => Math.exp(-((t % BEAT) / BEAT) * 4);
  const curves: Partial<Record<EnvelopeKey, (t: number, e: number) => number>> = {
    mix: (t, e) => e * (0.7 + 0.3 * pulse(t)),
    drums: (t, e) => (e > 0.5 ? e * pulse(t) : 0.1),
    bass: (t, e) => (e > 0.5 ? e * 0.8 : 0),
    other: (t, e) => e * 0.7,
    bright: (t, e) => e * 0.8,
    rise: t => (t > SYNTH_DROP - 4 * BAR && t < SYNTH_DROP ? (t - SYNTH_DROP + 4 * BAR) / (4 * BAR) : 0),
    contour: t => 0.5 + 0.4 * Math.sin(t * 0.8),
    leadPitch: t => 72 + 5 * Math.sin(t * 0.8),
    bassPitch: (t, e) => (e > 0.5 ? 45 + 3 * Math.sin(t * 0.4) : 0),
    voice: () => 0,
  };
  for (const [k, f] of Object.entries(curves)) s.envelopes[k as EnvelopeKey] = env(f!);
  s.frontierSec = dur;
  s.final = true;
  return s;
}
