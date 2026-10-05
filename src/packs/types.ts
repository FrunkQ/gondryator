// Pack format (spec section 9). A pack is plain JSON so it can be loaded at runtime
// (drop a pack.json on the page) without rebuilding. Models are referenced by name: either
// one of the built-in procedural models (render/models.ts) or a glTF URL in `assets`.

import type { EventKind, Stem } from '../score/types';

export type ThemeName = string;
export type FxLookName = 'clean' | 'prism' | 'trip' | 'kaleido' | 'liquid' | 'thermal' | 'echo' | 'fold' | 'hyper' | 'tunnel' | 'crt' | 'film' | 'glitch';

export interface PackLayer {
  id: string;
  /** Distance from the camera's travel line, metres. */
  depth: number;
  /** Random extra depth (metres) so a layer is not a perfect line. */
  depthJitter?: number;
  /** Model names per theme; one is picked per event, deterministically from the music. */
  models: Record<ThemeName, string[]>;
  /**
   * Rare finds: now and then (chance per event, 0..1) one of these replaces the usual pick, so a
   * long ride turns up the odd surprise. Seeded by the song, so a song keeps its own.
   */
  rare?: { chance: number; models: Partial<Record<ThemeName, string[]>> };
  /** Base scale; velocity adds up to +scaleByVel. */
  scale?: number;
  scaleByVel?: number;
  /** If set, the model's height follows pitch: scaleY = 1 + (pitch - pitchCenter) * heightPerSemitone. */
  pitchCenter?: number;
  heightPerSemitone?: number;
  /** If set, the model's length along travel follows duration: length = dur x train speed x this. */
  lengthByDur?: number;
  /**
   * Which models may be stretched by lengthByDur (rows, sheds, hedges); everything else keeps its
   * own shape. Stretching is also held between 0.75x and 2x the model's own length, so nothing
   * becomes a sliver (a squashed gasholder seen edge-on) or one endless tenement.
   */
  stretch?: string[];
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

/**
 * A skyline that follows the melody's contour: a model every `spacing` metres whose height is
 * the melody's pitch at the moment you pass it, so the line rises and falls with the tune, and
 * swells further through a build-up (`riseBoost`).
 */
export interface ContourLayer {
  depth: number;
  spacing: number;
  models: Record<ThemeName, string[]>;
  tints?: Record<ThemeName, string[]>;
  /** Height scale at the bottom and the top of the melody's range. */
  minScale: number;
  maxScale: number;
  riseBoost?: number;
  y?: number;
}

/**
 * Slides as one continuous shape: a ridge of hills, a ribbon of light. Wherever the stem's pitch
 * glides (moves smoothly by a semitone or so, with no leaps) for at least `minDur`, segments line
 * up along the way, each as high as the pitch at the moment it comes into view. Separate notes
 * stay separate objects.
 */
export interface RidgeLayer {
  /** Which pitch track: the melody or the bass. */
  pitch: 'leadPitch' | 'bassPitch';
  depth: number;
  spacing: number;
  /** Shortest held line that makes a ridge, seconds. */
  minDur: number;
  models: Record<ThemeName, string[]>;
  tints?: Record<ThemeName, string[]>;
  pitchCenter: number;
  /** Ground ridges: height scale per semitone from pitchCenter, clamped to [minScale, maxScale]. */
  heightPerSemitone?: number;
  minScale?: number;
  maxScale?: number;
  /** Floating ribbons: height above the ground at pitchCenter, and metres per semitone. */
  float?: { y: number; perSemitone: number };
}

/** Regularly spaced scenery shown while the title block runs (before the music is synced). */
export interface IdleLayer { model: string; depth: number; spacing: number; jitter?: number; chance?: number }

export interface SectionTheme {
  name: ThemeName;
  ground: { base: string; stripes: string[]; rows?: boolean };
}

export interface RigSpec {
  type: 'lateral-rail' | 'dolly-forward' | 'locked-off' | 'orbit' | 'static';
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
  /** Where the view rests, degrees (positive yaw looks ahead along the line). */
  startYaw?: number;
  startPitch?: number;
  maxPitch: number;
  fov: number;
  /**
   * Where a sound's object is when it sounds. 'entry' (the default): just coming into view at the
   * leading edge, so everything you watch slide away is what has already played. 'centre': in the
   * middle of the view.
   */
  hitAt?: 'entry' | 'centre';
  /**
   * A fairground track that rises and falls (the Halloween ride): each section of the song sets
   * its own height between `low` and `high` metres, the track swoops there across the change, rolls
   * a gentle swell each phrase, plunges on a drop, and in the loudest parts lifts on each downbeat (`bump`, metres).
   */
  coaster?: { low: number; high: number; bump?: number };
}

export interface Pack {
  id: string;
  name: string;
  credits: string;
  /** The music video this pack pays homage to (official upload). */
  inspiration?: { title: string; url: string };
  viewpoint: 'fixed-window' | 'wraparound' | 'cockpit';
  rig: RigSpec;
  /** pass-by: scenery scheduled past a window; perform: a cast on a stage; visualise: a 360° abstract world (render/visualiser.ts). */
  spawnMode: 'pass-by' | 'replicate' | 'perform' | 'loop-layer' | 'visualise';
  layers: PackLayer[];
  mapping: MappingRule[];
  ambient: AmbientLayer[];
  /** Scenery whose height traces the melody's contour (see ContourLayer). */
  contour?: ContourLayer;
  ridges?: RidgeLayer[];
  idle?: IdleLayer[];
  themes: SectionTheme[];
  /** Theme order as sections advance. A section label can force a theme. */
  themeCycle: ThemeName[];
  themeBySection?: Partial<Record<string, ThemeName>>;
  /** Lighting keyframes over track position 0..1. */
  /** 0..1: how milky the sky is (Star Guitar's bleached summer haze is about 0.6). */
  haze?: number;
  light: { at: number; sky: string; horizon: string; sun: string; sunIntensity: number; sunElevation: number; fog?: number }[];
  /**
   * The card the ride waits at while the song is read: 'station-board' (a lineside shed with the
   * name board, a departures strip and a platform clock) or 'launch-screen' (a floating screen
   * with a T-minus strip and a countdown dial) or 'ghost-gate' (a fairground ghost-train sign:
   * a bulb-lit board on crooked posts, a skull and two pumpkins on top). It stands in the start view (rig.startYaw and
   * startPitch), so the ride rolls up and turns to face it.
   */
  title: { template: 'station-board' | 'launch-screen' | 'ghost-gate'; stationPrefix?: string };
  /**
   * How the ride ends after the last note: 'terminus' (pull into a station with the end board)
   * or 'arrival-screen' (drift up to a floating screen with the end card) or 'ghost-gate' (roll
   * up to the ghost-train sign again, with the end card on it). Default 'terminus'.
   */
  end?: { template: 'terminus' | 'arrival-screen' | 'ghost-gate' };
  /** Things that happen on structure: overpass at new sections, passing train in breakdowns. */
  sectionEvents?: { onNewSection?: string; onBreakdown?: string; /** How far out the breakdown convoy passes, m (default 4.3: the next track). */ breakdownDepth?: number };
  /** perform mode: the cast. Mapping rules send events to a troupe by its id (as `layer`). */
  troupes?: TroupeSpec[];
  /** perform mode: text and colours for the stage screen. */
  stage?: { floor: string; ring: string[]; screen: string };
  /** Effects: a look per section (cycled), or forced for some section labels. */
  fx?: { cycle: FxLookName[]; bySection?: Partial<Record<string, FxLookName>> };
  /**
   * The colours the psychedelic paint, the vortex and the warp use, by name (render/shaders.ts
   * PALETTES: 'embers', 'ocean', 'pumpkin', 'blood', 'toxic', 'cyan-magenta'...). One per section,
   * a returning part gets its colours back. Default: all of the general ones.
   */
  palettes?: string[];
  /** Optional glTF models: name -> url. */
  assets?: Record<string, string>;
  /** What you are riding: 'train' (ground, track, carriage), 'ship' (space all round, an open canopy), 'cart' (a little open fairground car on a track that rises and falls: rig.coaster) or 'void' (nothing: the visualiser draws the whole world). */
  vehicle?: 'train' | 'ship' | 'void' | 'cart';
  /** The window across the aisle: another pack's id, or 'trippy' for a psychedelic mirror of this one. */
  otherSide?: string;
  /**
   * The weather and the night: `rain` (a colour: rain of that colour falls in front of the main
   * window, heavier in loud parts), `lightning` (0..1, how often strikes land on big hits, drops and
   * section changes, on both sides), `pulse` (a colour the sky and the fog throb towards on every kick).
   */
  storm?: { rain?: string; lightning?: number; pulse?: string };
  /** The far window's disco takeover on breaks and drops (render/otherside.ts). Default true. */
  farTakeover?: boolean;
  window: { width: number; height: number; bottom: number; pillar: number; distance: number; frame: string; wall: string };
}
