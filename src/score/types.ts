// The score: the one data format between analysis and every renderer (spec section 5).
// Renderers never touch raw audio. Everything here is plain JSON so it can be cached,
// exported, and read by a future UE5 renderer.

export type Stem = 'drums' | 'bass' | 'vocals' | 'other' | 'mix';
export type EventKind = 'kick' | 'snare' | 'hat' | 'note' | 'hit';

export interface ScoreEvent {
  id: string;
  /** Onset time in seconds from track start. */
  t: number;
  dur: number;
  stem: Stem;
  kind: EventKind;
  /** MIDI pitch, or null for unpitched events. */
  pitch: number | null;
  /** 0..1 */
  vel: number;
  /** Beat-relative position (bar, beat index 0..3, sixteenth 0..15). Lets packs make a
   * repeated bar produce the same visual pattern. */
  bar?: number;
  step?: number;
}

export interface Beat {
  t: number;
  bar: number;
  /** 1-based beat in bar. */
  beat: number;
  downbeat: boolean;
  strength: number;
}

export interface Section {
  t: number;
  label: 'intro' | 'verse' | 'chorus' | 'breakdown' | 'drop' | 'outro';
  /** 0..1 relative loudness of the section. */
  energy: number;
  /** Bar number where the section starts. */
  bar: number;
  /**
   * Sections that sound alike share a group number (0, 1, 2... in order of first appearance), so a
   * returning chorus can bring its picture back. Missing in scores from MIDI files.
   */
  group?: number;
}

export interface Phrase {
  t: number;
  bar: number;
  bars: number;
  /** Phrases with the same id sound alike. */
  id: number;
  /** Index of the first earlier phrase this one repeats, or null if new material. */
  repeatOf: number | null;
  /** Stems that became active in this phrase. */
  entering: Stem[];
}

/**
 * Continuous curves at 50 Hz: per-band loudness (`mix`, `bass`, `other`, `drums`), plus the shapes
 * between the hits: `contour` (the melody's pitch, 0 low .. 1 high, held through gaps),
 * `bright` (how bright the sound is), `rise` (build-ups: loudness and brightness climbing),
 * `leadPitch` / `bassPitch` (the exact pitch as MIDI with fractions, so slides glide; 0 = silent).
 */
export type EnvelopeKey = Stem | 'mix' | 'contour' | 'bright' | 'rise' | 'leadPitch' | 'bassPitch';

export interface Envelope {
  /** Samples per second. */
  rate: number;
  values: number[];
}

export interface Score {
  version: 1;
  track: {
    title: string;
    artist: string;
    album: string;
    durationSec: number;
    art: string | null;
    hash: string;
  };
  analysis: {
    /** 'bands' = no neural stem separation; stems are approximated by frequency bands. */
    mode: 'bands' | 'stems' | 'midi';
    stems: Stem[];
    engine: string;
    realtimeFactor: number;
  };
  tempo: { t: number; bpm: number }[];
  beats: Beat[];
  sections: Section[];
  phrases: Phrase[];
  events: ScoreEvent[];
  envelopes: Partial<Record<EnvelopeKey, Envelope>>;
  /** Everything with t < frontierSec is final and will never change. */
  frontierSec: number;
  final: boolean;
}

/** Incremental update sent from the analysis worker. Only ever appends. */
export interface ScoreDelta {
  frontierSec: number;
  final: boolean;
  tempo: Score['tempo'];
  beats: Beat[];
  sections: Section[];
  phrases: Phrase[];
  events: ScoreEvent[];
  envelopes: Partial<Record<EnvelopeKey, number[]>>;
  envelopeRate: number;
  realtimeFactor: number;
}

export function emptyScore(track: Score['track'], durationSec: number): Score {
  return {
    version: 1,
    track: { ...track, durationSec },
    analysis: { mode: 'bands', stems: ['drums', 'bass', 'other'], engine: 'gondryator-dsp 0.1', realtimeFactor: 0 },
    tempo: [],
    beats: [],
    sections: [],
    phrases: [],
    events: [],
    envelopes: {},
    frontierSec: 0,
    final: false,
  };
}

export function applyDelta(score: Score, d: ScoreDelta): void {
  score.frontierSec = d.frontierSec;
  score.final = d.final;
  score.analysis.realtimeFactor = d.realtimeFactor;
  for (const x of d.tempo) score.tempo.push(x);
  for (const x of d.beats) score.beats.push(x);
  for (const x of d.sections) score.sections.push(x);
  for (const x of d.phrases) score.phrases.push(x);
  for (const x of d.events) score.events.push(x);
  for (const k of Object.keys(d.envelopes) as EnvelopeKey[]) {
    const env = (score.envelopes[k] ??= { rate: d.envelopeRate, values: [] });
    for (const v of d.envelopes[k]!) env.values.push(v);
  }
}

/** Sample an envelope at time t (linear). */
export function sampleEnvelope(env: Envelope | undefined, t: number): number {
  if (!env || env.values.length === 0) return 0;
  const x = t * env.rate;
  const i = Math.floor(x);
  if (i < 0) return env.values[0];
  if (i >= env.values.length - 1) return env.values[env.values.length - 1];
  const f = x - i;
  return env.values[i] * (1 - f) + env.values[i + 1] * f;
}

export function sectionAt(score: Score, t: number): { section: Section | null; index: number } {
  let idx = -1;
  for (let i = 0; i < score.sections.length; i++) {
    if (score.sections[i].t <= t + 1e-6) idx = i;
    else break;
  }
  return { section: idx >= 0 ? score.sections[idx] : null, index: idx };
}
