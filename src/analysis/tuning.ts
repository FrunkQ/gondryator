// The music parser's knobs, exposed on the Tuning screen. Defaults are the values the analyser
// was calibrated with; every one is a plain number so a tuning can be saved or shared as JSON.

export interface TuningParam {
  key: keyof Tuning;
  label: string;
  group: 'Drums' | 'Bass' | 'Melody' | 'Tempo' | 'Structure';
  min: number; max: number; step: number;
  help: string;
}

export interface Tuning {
  kickFloor: number; kickDecayDb: number; kickGap: number;
  snareFloor: number; snareNoise: number; snareGap: number;
  hatFloor: number; hatPeak: number; hatGap: number;
  bassCutHz: number; bassYin: number; bassMinNote: number;
  leadLowHz: number; leadHighHz: number; leadYin: number; leadMinNote: number; pitchBend: number;
  tempoCentre: number; tempoWidth: number;
  sectionNovelty: number; padPeakiness: number;
}

export const DEFAULT_TUNING: Tuning = {
  kickFloor: 0.35, kickDecayDb: 3.5, kickGap: 0.09,
  snareFloor: 0.4, snareNoise: 0.2, snareGap: 0.09,
  hatFloor: 0.2, hatPeak: 1.25, hatGap: 0.05,
  bassCutHz: 220, bassYin: 0.15, bassMinNote: 0.08,
  leadLowHz: 200, leadHighHz: 1800, leadYin: 0.2, leadMinNote: 0.058, pitchBend: 0.7,
  tempoCentre: 120, tempoWidth: 0.8,
  sectionNovelty: 1.0, padPeakiness: 2.2,
};

export const TUNING_PARAMS: TuningParam[] = [
  { key: 'kickFloor', label: 'Kick sensitivity floor', group: 'Drums', min: 0.05, max: 1, step: 0.01, help: 'Low-band flux peak needed, as a share of the loud 95th percentile. Lower finds more kicks.' },
  { key: 'kickDecayDb', label: 'Kick decay (dB)', group: 'Drums', min: 0, max: 12, step: 0.5, help: 'How far the low band must fall after the hit: separates kicks from sustained bass.' },
  { key: 'kickGap', label: 'Kick min gap (s)', group: 'Drums', min: 0.03, max: 0.3, step: 0.01, help: 'Shortest time between two kicks.' },
  { key: 'snareFloor', label: 'Snare sensitivity floor', group: 'Drums', min: 0.05, max: 1, step: 0.01, help: 'Mid-band flux peak needed. Lower finds more snares and claps.' },
  { key: 'snareNoise', label: 'Snare noisiness', group: 'Drums', min: 0, max: 0.8, step: 0.01, help: 'Spectral flatness needed: snares are noisy, notes are not.' },
  { key: 'snareGap', label: 'Snare min gap (s)', group: 'Drums', min: 0.03, max: 0.3, step: 0.01, help: 'Shortest time between two snares.' },
  { key: 'hatFloor', label: 'Hat sensitivity floor', group: 'Drums', min: 0.02, max: 1, step: 0.01, help: 'High-band flux peak needed. Lower finds more hats and shakers.' },
  { key: 'hatPeak', label: 'Hat peakiness', group: 'Drums', min: 1, max: 3, step: 0.05, help: 'How much a hat must stand out from its neighbours.' },
  { key: 'hatGap', label: 'Hat min gap (s)', group: 'Drums', min: 0.02, max: 0.2, step: 0.005, help: 'Shortest time between two hats.' },
  { key: 'bassCutHz', label: 'Bass band top (Hz)', group: 'Bass', min: 100, max: 500, step: 10, help: 'Bass pitch is tracked below this. Re-runs the band filter.' },
  { key: 'bassYin', label: 'Bass pitch confidence', group: 'Bass', min: 0.05, max: 0.5, step: 0.01, help: 'YIN threshold: higher accepts shakier pitches.' },
  { key: 'bassMinNote', label: 'Bass shortest note (s)', group: 'Bass', min: 0.02, max: 0.4, step: 0.01, help: 'Notes shorter than this are dropped.' },
  { key: 'leadLowHz', label: 'Melody band bottom (Hz)', group: 'Melody', min: 80, max: 600, step: 10, help: 'Melody pitch is tracked above this.' },
  { key: 'leadHighHz', label: 'Melody band top (Hz)', group: 'Melody', min: 600, max: 5000, step: 50, help: 'Melody pitch is tracked below this.' },
  { key: 'leadYin', label: 'Melody pitch confidence', group: 'Melody', min: 0.05, max: 0.5, step: 0.01, help: 'YIN threshold: higher accepts shakier pitches.' },
  { key: 'leadMinNote', label: 'Melody shortest note (s)', group: 'Melody', min: 0.02, max: 0.4, step: 0.005, help: 'Notes shorter than this are dropped.' },
  { key: 'pitchBend', label: 'New note after (semitones)', group: 'Melody', min: 0.3, max: 2, step: 0.05, help: 'A pitch move bigger than this starts a new note.' },
  { key: 'tempoCentre', label: 'Expected tempo (BPM)', group: 'Tempo', min: 60, max: 200, step: 1, help: 'The tempo the beat tracker leans towards when it is unsure.' },
  { key: 'tempoWidth', label: 'Tempo open-mindedness', group: 'Tempo', min: 0.2, max: 2, step: 0.05, help: 'How far from the expected tempo it will happily go (octaves).' },
  { key: 'sectionNovelty', label: 'Section change threshold', group: 'Structure', min: 0.3, max: 3, step: 0.05, help: 'How different the music must get to start a new section.' },
  { key: 'padPeakiness', label: 'Pad chord clarity', group: 'Structure', min: 1.2, max: 5, step: 0.1, help: 'How clear a chord must be to count as a long pad note.' },
];

export function isDefaultTuning(t: Tuning): boolean {
  return (Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]).every(k => t[k] === DEFAULT_TUNING[k]);
}
