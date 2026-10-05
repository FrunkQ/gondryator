// What a pack's spawn mode looks like to the app: the pass-by Spawner and the perform-mode
// Performer both implement this, so packs swap without the app knowing which is which.
import type * as THREE from 'three/webgpu';
import type { GazeSource } from './spawner';

export interface CardInfo { name: string; line2: string; line3?: string; art?: HTMLImageElement | null }

export interface ShowDriver {
  readonly group: THREE.Object3D;
  readonly activeCount: number;
  metric: { hits: number; total: number; recent: boolean[]; byLayer: Record<string, [number, number]> };
  steering: boolean;
  gazeSpawning: boolean;
  update(s: number, dt: number, gaze: GazeSource, frontier: number, running: boolean): void;
  reset(s: number): void;
  refreshLeads(): void;
  /** How far ahead of the playhead this driver has already scheduled things (seconds). */
  horizon?(): number;
  /** The score's events from `from` on were replaced: drop what was queued from there and re-read them. */
  resync?(from: number): void;
  themeAt(t: number): string;
  /** Show a title/landing/end card in the set. Return false to let the world build a station board. */
  card?(kind: 'landing' | 'title' | 'end', info: CardInfo): boolean;
}
