// Pack format (spec section 9). A pack is plain JSON so it can be loaded at runtime
// (drop a pack.json on the page) without rebuilding. Models are referenced by name: either
// one of the built-in procedural models (render/models.ts) or a glTF URL in `assets`.

import type { EventKind, Stem } from '../score/types';

export type ThemeName = string;

export interface PackLayer {
  id: string;
  /** Distance from the camera's travel line, metres. */
  depth: number;
  /** Random extra depth (metres) so a layer is not a perfect line. */
  depthJitter?: number;
  /** Model names per theme; one is picked per event, deterministically from the music. */
  models: Record<ThemeName, string[]>;
  /** Base scale; velocity adds up to +scaleByVel. */
  scale?: number;
  scaleByVel?: number;
  /** If set, the model's height follows pitch: scaleY = 1 + (pitch - pitchCenter) * heightPerSemitone. */
  pitchCenter?: number;
  heightPerSemitone?: number;
  /** If set, the model's length along travel follows duration: length = dur x train speed x this. */
  lengthByDur?: number;
  /** Colour tints per theme (multiplied with the model's own colours). */
  tints?: Record<ThemeName, string[]>;
  /** Ground offset, metres (e.g. sink hills). */
  y?: number;
  /** Which side of the track. 1 = in front of the window (default), -1 = behind (wraparound packs). */
  side?: 1 | -1;
}

export interface MappingRule {
  match: { stem?: Stem; kind?: EventKind; minDur?: number; maxDur?: number; minVel?: number };
  layer: string;
  /** 1 = top tier (refocused into the viewer's gaze), 2 = mid, 3 = ambient (never moved). */
  tier: 1 | 2 | 3;
  /** perform mode: which move the troupe makes for this event (e.g. 'stomp', 'clap'). */
  role?: string;
  /** Optional thinning, e.g. only every 2nd hat. */
  every?: number;
}

export interface AmbientLayer {
  depthMin: number;
  depthMax: number;
  /** Objects per 100 m of travel, per theme. */
  density: Record<ThemeName, number>;
  models: Record<ThemeName, string[]>;
  scale?: [number, number];
}

export interface TroupeSpec {
  id: string;
  /** How this troupe moves: one of the built-in choreographies. */
  style: 'stompers' | 'climbers' | 'walkers' | 'swimmers' | 'hoppers';
  count: number;
  body: string;
  accent: string;
  /** Where on the stage: angle (degrees, 0 = towards the camera's start) and radius (m). */
  at: { angle: number; radius: number; spread: number };
  label?: string;
}

/** Regularly spaced scenery shown while the title block runs (before the music is synced). */
export interface IdleLayer { model: string; depth: number; spacing: number; jitter?: number; chance?: number }

export interface SectionTheme {
  name: ThemeName;
  ground: { base: string; stripes: string[]; rows?: boolean };
}

export interface RigSpec {
  type: 'lateral-rail' | 'dolly-forward' | 'locked-off' | 'orbit';
  /** orbit: radius (m), seconds per revolution, and the height the camera looks at. */
  orbitRadius?: number;
  orbitPeriod?: number;
  lookAtY?: number;
  /** Cruise speed, m/s. */
  speed: number;
  /** How much section energy changes speed (0..1). */
  speedByEnergy?: number;
  eyeHeight: number;
  /** Look-around limits, degrees. */
  maxYaw: number;
  /** How far the viewer may turn, degrees, if more than maxYaw (180: right round to the other window). */
  lookYaw?: number;
  maxPitch: number;
  fov: number;
}

export interface Pack {
  id: string;
  name: string;
  credits: string;
  /** The music video this pack pays homage to (official upload). */
  inspiration?: { title: string; url: string };
  viewpoint: 'fixed-window' | 'wraparound' | 'cockpit';
  rig: RigSpec;
  spawnMode: 'pass-by' | 'replicate' | 'perform' | 'loop-layer';
  layers: PackLayer[];
  mapping: MappingRule[];
  ambient: AmbientLayer[];
  idle?: IdleLayer[];
  themes: SectionTheme[];
  /** Theme order as sections advance. A section label can force a theme. */
  themeCycle: ThemeName[];
  themeBySection?: Partial<Record<string, ThemeName>>;
  /** Lighting keyframes over track position 0..1. */
  /** 0..1: how milky the sky is (Star Guitar's bleached summer haze is about 0.6). */
  haze?: number;
  light: { at: number; sky: string; horizon: string; sun: string; sunIntensity: number; sunElevation: number; fog?: number }[];
  title: { template: 'station-board'; stationPrefix?: string };
  /** Things that happen on structure: overpass at new sections, passing train in breakdowns. */
  sectionEvents?: { onNewSection?: string; onBreakdown?: string };
  /** perform mode: the cast. Mapping rules send events to a troupe by its id (as `layer`). */
  troupes?: TroupeSpec[];
  /** perform mode: text and colours for the stage screen. */
  stage?: { floor: string; ring: string[]; screen: string };
  /** Effects: a look per section (cycled), or forced for some section labels. */
  fx?: { cycle: ('clean' | 'prism' | 'trip' | 'kaleido' | 'liquid' | 'thermal' | 'echo' | 'fold')[]; bySection?: Partial<Record<string, 'clean' | 'prism' | 'trip' | 'kaleido' | 'liquid' | 'thermal' | 'echo' | 'fold'>> };
  /** Optional glTF models: name -> url. */
  assets?: Record<string, string>;
  window: { width: number; height: number; bottom: number; pillar: number; distance: number; frame: string; wall: string };
}
