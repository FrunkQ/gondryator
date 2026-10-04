// The Tuning screen: a falling piano roll (Synthesia style) of everything the music parser
// heard, with every one of its knobs as a slider. Hits fall from the top and land on the
// "now" line as they sound, so you can see and hear at once whether the parse is right.

import { Analyzer } from '../analysis/analyzer';
import type { AutoTuneResult } from '../analysis/autotune';
import { DEFAULT_TUNING, TUNING_PARAMS, TUNING_PRESETS, type Tuning } from '../analysis/tuning';
import { applyDelta, emptyScore, type Score, type ScoreEvent } from '../score/types';
import type { Player } from '../audio/player';
import { toMono } from '../audio/player';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (p: number) => `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
const hz = (p: number) => 440 * 2 ** ((p - 69) / 12);

type Lane = 'kick' | 'snare' | 'hat' | 'bass' | 'melody' | 'pad' | 'vocals';
const COLOURS: Record<Lane, string> = {
  kick: '#ff5a5f', snare: '#ffb347', hat: '#4fd8ff', bass: '#b07cff', melody: '#6fe08a', pad: '#5b8cff', vocals: '#ff79c6',
};
const DRUMS: Lane[] = ['kick', 'snare', 'hat'];
const LO = 24, HI = 96; // C1..C7

function laneOf(e: ScoreEvent): Lane {
  if (e.kind === 'kick' || e.kind === 'snare' || e.kind === 'hat') return e.kind;
  if (e.stem === 'bass') return 'bass';
  if (e.stem === 'vocals') return 'vocals';
  return e.dur >= 1.2 ? 'pad' : 'melody';
}

function laneLabel(e: ScoreEvent): string {
  const l = laneOf(e);
  return DRUMS.includes(l) ? l : `${l} ${noteName(e.pitch ?? 60)}`;
}

export interface TuningHost {
  /** The loaded track, if any. */
  audio(): AudioBuffer | null;
  player: Player;
  /** Start or pause playback (keeps the show's own state right). */
  togglePlay(): void;
  /** Re-run the show with these settings. */
  apply(t: Tuning): void;
  /** Search for settings that suit the loaded song, starting from `start`. */
  autoTune(start: Tuning, onProgress: (p: number) => void): Promise<AutoTuneResult | null>;
}

export class TuningScreen {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private info: HTMLDivElement;
  private tip: HTMLDivElement;
  private tuning: Tuning;
  private score: Score | null = null;
  private job = 0;
  private analysed = 0;
  private pxPerSec = 140;
  private open = false;
  private mouse: { x: number; y: number } | null = null;
  private boxes: { x: number; y: number; w: number; h: number; e: ScoreEvent }[] = [];
  private pausedAt = 0;
  private parsedBuf: AudioBuffer | null = null;

  constructor(private host: TuningHost, initial: Tuning) {
    this.tuning = { ...initial };
    const el = this.el = document.createElement('div');
    el.id = 'tuning';
    el.className = 'ui hidden';
    el.innerHTML = `
      <div class="tn-roll"><canvas></canvas><div class="tn-info"></div><div class="tn-tip hidden"></div></div>
      <aside class="tn-panel">
        <header><h2>Tuning screen</h2><button class="ghost tn-close" title="Back to the show (T)">✕</button></header>
        <p class="tn-lede">Everything the music parser heard, falling onto the line as it sounds. Move a slider and the track is re-parsed.</p>
        <div class="tn-row">
          <button class="tn-play">▶ Play</button>
          <label class="tn-zoom">Zoom <input type="range" min="40" max="400" value="140"></label>
        </div>
        <div class="tn-legend">${(Object.keys(COLOURS) as Lane[]).map(l => `<span><i style="background:${COLOURS[l]}"></i>${l}</span>`).join('')}</div>
        <label class="tn-preset">Preset <select>${TUNING_PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}</select></label>
        <div class="tn-params"></div>
        <p class="tn-autonote"></p>
        <div class="tn-row tn-actions">
          <button class="tn-auto" title="Try a couple of dozen settings on a loud stretch of this song and keep the ones that give the tidiest parse">✨ Auto-tune</button>
          <button class="tn-apply" title="Restart the show with these settings">Apply to the show</button>
          <button class="ghost tn-reset">Reset</button>
          <button class="ghost tn-copy" title="Copy the settings as JSON">Copy</button>
        </div>
      </aside>`;
    this.canvas = el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.info = el.querySelector('.tn-info')!;
    this.tip = el.querySelector('.tn-tip')!;
    this.buildParams();
    el.querySelector('.tn-close')!.addEventListener('click', () => this.toggle(false));
    el.querySelector('.tn-play')!.addEventListener('click', () => this.host.togglePlay());
    el.querySelector<HTMLInputElement>('.tn-zoom input')!.addEventListener('input', e => { this.pxPerSec = Number((e.target as HTMLInputElement).value); });
    el.querySelector('.tn-apply')!.addEventListener('click', () => { this.host.apply({ ...this.tuning }); this.toggle(false); });
    const preset = el.querySelector<HTMLSelectElement>('.tn-preset select')!;
    preset.addEventListener('change', () => {
      this.tuning = { ...DEFAULT_TUNING, ...TUNING_PRESETS[Number(preset.value)].values };
      this.buildParams();
      this.reparse();
    });
    const auto = el.querySelector<HTMLButtonElement>('.tn-auto')!;
    auto.addEventListener('click', async () => {
      if (auto.disabled || !this.host.audio()) return;
      auto.disabled = true;
      const r = await this.host.autoTune({ ...this.tuning }, p => { auto.textContent = `✨ Tuning… ${Math.round(p * 100)}%`; });
      auto.disabled = false;
      auto.textContent = '✨ Auto-tune';
      if (!r) return;
      this.tuning = { ...r.tuning };
      this.buildParams();
      this.reparse();
      el.querySelector('.tn-autonote')!.textContent = r.changes.length
        ? `Auto-tune changed ${r.changes.join(', ')}. Apply to the show to ride with them; they are kept for this song.`
        : 'Auto-tune found nothing better than these settings.';
    });
    el.querySelector('.tn-reset')!.addEventListener('click', () => { this.tuning = { ...DEFAULT_TUNING }; this.buildParams(); this.reparse(); });
    el.querySelector('.tn-copy')!.addEventListener('click', () => void navigator.clipboard?.writeText(JSON.stringify(this.tuning, null, 2)).catch(() => {}));
    this.canvas.addEventListener('pointermove', e => { const r = this.canvas.getBoundingClientRect(); this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    this.canvas.addEventListener('pointerleave', () => { this.mouse = null; });
    // Paused: the wheel scrolls through the track.
    this.canvas.addEventListener('wheel', e => {
      if (this.host.player.playing) return;
      e.preventDefault();
      this.pausedAt = Math.max(0, this.pausedAt - e.deltaY / this.pxPerSec);
    }, { passive: false });
  }

  get isOpen() { return this.open; }

  /** Show these settings (a new song, or auto-tune finished in the background). */
  setTuning(t: Tuning) {
    this.tuning = { ...t };
    this.buildParams();
    if (this.open) this.reparse();
  }

  toggle(on = !this.open) {
    this.open = on;
    this.el.classList.toggle('hidden', !on);
    if (on) {
      this.pausedAt = Math.max(0, this.host.player.time);
      requestAnimationFrame(this.frame);
    }
  }

  private buildParams() {
    const box = this.el.querySelector('.tn-params')!;
    box.innerHTML = '';
    let group = '';
    for (const p of TUNING_PARAMS) {
      if (p.group !== group) { group = p.group; const h = document.createElement('h3'); h.textContent = group; box.appendChild(h); }
      const row = document.createElement('label');
      row.className = 'tn-param';
      row.title = p.help;
      const changed = this.tuning[p.key] !== DEFAULT_TUNING[p.key];
      row.innerHTML = `<span>${p.label}</span><output>${this.tuning[p.key]}</output><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${this.tuning[p.key]}">`;
      row.classList.toggle('changed', changed);
      const input = row.querySelector('input')!, out = row.querySelector('output')!;
      let timer = 0;
      input.addEventListener('input', () => {
        this.tuning[p.key] = Number(input.value);
        out.textContent = input.value;
        row.classList.toggle('changed', this.tuning[p.key] !== DEFAULT_TUNING[p.key]);
        clearTimeout(timer);
        timer = window.setTimeout(() => this.reparse(), 250);
      });
      box.appendChild(row);
    }
  }

  /** Parse the whole track again with the current settings, a slice at a time. */
  private reparse() {
    const buf = this.host.audio();
    const job = ++this.job;
    this.parsedBuf = buf;
    if (!buf) { this.score = null; return; }
    const a = new Analyzer(toMono(buf), buf.sampleRate, { chunkSec: 6, tuning: this.tuning });
    const score = emptyScore({ title: '', artist: '', album: '', durationSec: buf.duration, art: null, hash: '' }, buf.duration);
    this.score = score;
    this.analysed = 0;
    const tick = () => {
      if (job !== this.job) return;
      const t0 = performance.now();
      while (!a.finished && performance.now() - t0 < 30) {
        const d = a.step();
        if (d) applyDelta(score, d);
      }
      this.analysed = a.analyzedSec;
      if (!a.finished) setTimeout(tick, 0);
      else score.final = true;
    };
    tick();
  }

  private frame = () => {
    if (!this.open) return;
    // A new track (or the first one) arrived: parse it.
    if (this.host.audio() !== this.parsedBuf) this.reparse();
    this.draw();
    requestAnimationFrame(this.frame);
  };

  private draw() {
    const c = this.canvas, g = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0d0f14';
    g.fillRect(0, 0, W, H);
    const player = this.host.player;
    const now = player.playing ? player.time : this.pausedAt;
    if (player.playing) this.pausedAt = now;
    (this.el.querySelector('.tn-play') as HTMLElement).textContent = player.playing ? '❚❚ Pause' : '▶ Play';

    const keysH = 46;
    const nowY = H - keysH;
    const yOf = (t: number) => nowY - (t - now) * this.pxPerSec;
    const drumW = 64, gutter = 56;
    const pianoX = gutter + drumW * 3 + 10, pianoW = Math.max(100, W - pianoX - 8);
    const keyW = pianoW / (HI - LO + 1);
    const xOfPitch = (p: number) => pianoX + (Math.min(HI, Math.max(LO, p)) - LO) * keyW;
    const tTop = now + nowY / this.pxPerSec, tBot = now - keysH / this.pxPerSec - 0.5;
    const score = this.score;

    // Black-key shading behind the roll, and octave lines.
    for (let p = LO; p <= HI; p++) {
      const black = [1, 3, 6, 8, 10].includes(p % 12);
      if (black) { g.fillStyle = '#12151c'; g.fillRect(xOfPitch(p), 0, keyW, nowY); }
      if (p % 12 === 0) { g.fillStyle = '#232836'; g.fillRect(xOfPitch(p), 0, 1, nowY); }
    }
    for (let i = 0; i < 3; i++) { g.fillStyle = i % 2 ? '#10131a' : '#141823'; g.fillRect(gutter + i * drumW, 0, drumW, nowY); }

    if (score) {
      // Beats and bars.
      g.font = '11px system-ui, sans-serif';
      for (const b of score.beats) {
        if (b.t < tBot || b.t > tTop) continue;
        const y = yOf(b.t);
        g.fillStyle = b.downbeat ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
        g.fillRect(gutter, y, W - gutter, 1);
        if (b.downbeat) { g.fillStyle = '#7d8597'; g.fillText(`bar ${b.bar}`, 6, y - 3); }
      }
      // Sections.
      for (const s of score.sections) {
        if (s.t < tBot || s.t > tTop) continue;
        const y = yOf(s.t);
        g.fillStyle = '#f2c94c'; g.fillRect(0, y - 1, W, 2);
        g.font = 'bold 12px system-ui, sans-serif';
        g.fillText(`${s.label.toUpperCase()}  energy ${s.energy.toFixed(2)}`, pianoX + 6, y - 5);
      }
      // Events.
      this.boxes.length = 0;
      const active = new Map<number, string>();
      const drumHit: Partial<Record<Lane, number>> = {};
      g.font = '10px system-ui, sans-serif';
      for (const e of score.events) {
        if (e.t > tTop) break;
        const lane = laneOf(e);
        const end = e.t + Math.max(e.dur, 0);
        if (end < tBot) continue;
        let x: number, w: number;
        if (DRUMS.includes(lane)) { x = gutter + DRUMS.indexOf(lane) * drumW + 6; w = drumW - 12; }
        else { x = xOfPitch(e.pitch ?? 60); w = Math.max(3, keyW - 1); }
        const y1 = yOf(e.t), y0 = DRUMS.includes(lane) ? y1 - 7 : Math.min(y1 - 4, yOf(end));
        const h = y1 - y0;
        const sounding = e.t <= now && now <= Math.max(end, e.t + 0.12);
        g.globalAlpha = 0.35 + 0.65 * e.vel;
        g.fillStyle = COLOURS[lane];
        g.fillRect(x, y0, w, h);
        g.globalAlpha = 1;
        if (sounding) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x - 1, y0 - 1, w + 2, h + 2); }
        if (sounding) {
          if (DRUMS.includes(lane)) drumHit[lane] = e.vel;
          else active.set(Math.round(e.pitch ?? 60), COLOURS[lane]);
        }
        // Label the block when there is room: name, length, velocity.
        if (!DRUMS.includes(lane)) {
          g.fillStyle = COLOURS[lane];
          g.fillText(`${laneLabel(e)} · ${e.dur.toFixed(2)}s`, x + w + 3, y1 - 2);
        } else if (this.pxPerSec > 100) {
          g.fillStyle = '#0d0f14';
          g.fillText(e.vel.toFixed(2), x + 3, y1 - 1);
        }
        this.boxes.push({ x, y: y0, w, h, e });
      }
      // The keyboard.
      for (let p = LO; p <= HI; p++) {
        const black = [1, 3, 6, 8, 10].includes(p % 12);
        g.fillStyle = active.get(p) ?? (black ? '#2a2e38' : '#d9dce3');
        g.fillRect(xOfPitch(p) + 0.5, nowY + 2, keyW - 1, black ? keysH * 0.6 : keysH - 4);
        if (p % 12 === 0 && keyW > 5) { g.fillStyle = '#555'; g.font = '9px system-ui'; g.fillText(noteName(p), xOfPitch(p) + 1, H - 6); }
      }
      // Drum pads.
      DRUMS.forEach((d, i) => {
        const v = drumHit[d];
        g.fillStyle = v ? COLOURS[d] : '#262a33';
        g.fillRect(gutter + i * drumW + 4, nowY + 4, drumW - 8, keysH - 8);
        g.fillStyle = v ? '#0d0f14' : '#9aa1ad'; g.font = 'bold 11px system-ui';
        g.fillText(d.toUpperCase(), gutter + i * drumW + 10, nowY + keysH / 2 + 4);
      });
    }
    // The now line.
    g.fillStyle = '#ffffff'; g.fillRect(0, nowY, W, 2);

    // Header numbers.
    if (score) {
      const count = (f: (e: ScoreEvent) => boolean) => score.events.filter(f).length;
      const bpm = score.tempo.length ? score.tempo[score.tempo.length - 1].bpm : 0;
      const parts = [
        `${now.toFixed(1)}s`,
        bpm ? `${bpm.toFixed(1)} BPM` : 'tempo: listening…',
        `kick ${count(e => e.kind === 'kick')}`, `snare ${count(e => e.kind === 'snare')}`, `hat ${count(e => e.kind === 'hat')}`,
        `bass ${count(e => e.stem === 'bass')}`, `melody ${count(e => e.kind === 'note' && e.stem !== 'bass' && e.dur < 1.2)}`, `pad ${count(e => e.kind === 'note' && e.stem !== 'bass' && e.dur >= 1.2)}`,
        `${score.sections.length} sections`,
        score.final ? `parsed (${score.analysis.mode})` : `parsing ${Math.round((this.analysed / score.track.durationSec) * 100)}%`,
      ];
      this.info.textContent = parts.join('  ·  ');
    } else this.info.textContent = 'Load a track (or the demo) first: the tuning screen parses whatever is loaded.';

    // Hover: everything the parser knows about one hit.
    const hit = this.mouse && [...this.boxes].reverse().find(b => this.mouse!.x >= b.x - 2 && this.mouse!.x <= b.x + b.w + 2 && this.mouse!.y >= b.y - 2 && this.mouse!.y <= b.y + b.h + 2);
    if (hit && this.mouse) {
      const e = hit.e;
      const lines = [
        `<b style="color:${COLOURS[laneOf(e)]}">${laneOf(e)}</b> (${e.stem}, ${e.kind})`,
        e.pitch != null ? `${noteName(e.pitch)} · MIDI ${e.pitch} · ${hz(e.pitch).toFixed(1)} Hz` : 'unpitched',
        `at ${e.t.toFixed(3)} s · length ${e.dur.toFixed(3)} s`,
        `velocity ${e.vel.toFixed(2)}${e.bar != null ? ` · bar ${e.bar}, step ${(e.step ?? 0) + 1}/16` : ''}`,
      ];
      this.tip.innerHTML = lines.join('<br>');
      this.tip.classList.remove('hidden');
      this.tip.style.left = `${Math.min(W - 230, this.mouse.x + 14)}px`;
      this.tip.style.top = `${Math.max(4, this.mouse.y - 70)}px`;
    } else this.tip.classList.add('hidden');
  }
}
