// Debug overlay: event timeline per stem/kind, beats, sections, phrases, the look-ahead
// frontier, and live numbers (fps, backend, analysis speed, refocus metric).
import { sampleEnvelope, type Score } from '../score/types';

const ROWS: { label: string; test: (e: Score['events'][number]) => boolean; color: string }[] = [
  { label: 'kick', test: e => e.kind === 'kick', color: '#ff8a5b' },
  { label: 'snare', test: e => e.kind === 'snare', color: '#ffd166' },
  { label: 'hat', test: e => e.kind === 'hat', color: '#c7e8a3' },
  { label: 'bass', test: e => e.stem === 'bass', color: '#7cc6fe' },
  { label: 'lead', test: e => (e.stem === 'other' || e.stem === 'vocals') && e.dur < 1.2, color: '#c89bff' },
  { label: 'pads', test: e => e.stem === 'other' && e.dur >= 1.2, color: '#9ae6d8' },
];
/** Recognised sounds: speech white, singing pink, crowds gold, sirens red, impacts orange, nature blue, animals green, the rest grey. */
const CUE_COLORS: Record<string, string> = { speech: '#fff', shout: '#fff', laugh: '#ffe9a8', sing: '#ff8ad8', crowd: '#ffd24a', siren: '#ff4a4a', impact: '#ff9a3a', nature: '#5ab0ff', animal: '#9be37a', whoosh: '#b9f3ff' };
/** Sudden changes: drops red, lifts orange, breaks blue, stops grey, builds yellow. */
const MOMENT_COLORS: Record<string, string> = { drop: '#ff5a5a', lift: '#ffa94a', break: '#5aa8ff', stop: '#c0c0c0', build: '#ffe14a' };
const SECTION_COLORS: Record<string, string> = { intro: '#5c6b7a', verse: '#4f7a5c', chorus: '#9a6b2f', breakdown: '#3f5f8f', drop: '#a24a4a', outro: '#5c6b7a' };

export class DebugOverlay {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  visible = false;
  lines: string[] = [];

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'debug';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  toggle(v = !this.visible) { this.visible = v; this.canvas.style.display = v ? 'block' : 'none'; }

  /**
   * @param deep spans of the song deep listen has finished, and its state, for the song strip.
   */
  draw(score: Score | null, s: number, deep?: { spans: [number, number][]; state: string }) {
    if (!this.visible) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(W * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,14,18,0.72)';
    g.fillRect(0, 0, W, H);
    const left = 54, top = 22, bottom = 50, rowH = Math.max(12, (H - top - bottom - 12) / ROWS.length);
    const span0 = -4, span1 = 14;
    const xOf = (t: number) => left + ((t - s - span0) / (span1 - span0)) * (W - left - 8);
    g.font = '11px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';
    if (score) {
      // Sections band.
      for (let i = 0; i < score.sections.length; i++) {
        const a = score.sections[i], b = score.sections[i + 1];
        const x0 = Math.max(left, xOf(a.t)), x1 = Math.min(W - 8, xOf(b ? b.t : score.frontierSec));
        if (x1 <= x0) continue;
        g.fillStyle = SECTION_COLORS[a.label] ?? '#555';
        g.fillRect(x0, 4, x1 - x0, 12);
        g.fillStyle = '#fff';
        if (xOf(a.t) >= left) g.fillText(`${a.label}${a.group !== undefined ? ' ' + String.fromCharCode(65 + a.group) : ''} ${a.energy.toFixed(2)}`, x0 + 3, 10);
      }
      // Phrases: tick marks with ids; repeats marked.
      for (const p of score.phrases) {
        const x = xOf(p.t);
        if (x < left || x > W) continue;
        g.fillStyle = p.repeatOf !== null ? '#ffd166' : '#ffffff';
        g.fillText(`P${p.id}${p.repeatOf !== null ? '↻' : ''}${p.entering.length ? '+' + p.entering.join('/') : ''}`, x + 2, top + 4);
      }
      // Beats.
      for (const b of score.beats) {
        if (b.t < s + span0 || b.t > s + span1) continue;
        const x = xOf(b.t);
        g.fillStyle = b.downbeat ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.14)';
        g.fillRect(x, top, b.downbeat ? 2 : 1, H - top - bottom);
      }
      // Events.
      ROWS.forEach((r, i) => {
        const y = top + 10 + i * rowH;
        g.fillStyle = '#aab';
        g.fillText(r.label, 6, y + rowH / 2);
      });
      const evs = score.events;
      let lo = 0, hi = evs.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (evs[m].t < s + span0 - 5) lo = m + 1; else hi = m; }
      for (let k = lo; k < evs.length && evs[k].t < s + span1; k++) {
        const e = evs[k];
        const ri = ROWS.findIndex(r => r.test(e));
        if (ri < 0) continue;
        const y = top + 10 + ri * rowH;
        const x0 = xOf(e.t), x1 = Math.max(x0 + 2, xOf(e.t + e.dur));
        g.fillStyle = ROWS[ri].color;
        g.globalAlpha = 0.35 + 0.65 * e.vel;
        const hgt = e.pitch !== null && e.stem !== 'drums' ? 4 : rowH * 0.6;
        const yy = e.pitch !== null && e.stem !== 'drums' ? y + rowH - 4 - ((e.pitch % 24) / 24) * (rowH - 6) : y + rowH * 0.2;
        g.fillRect(x0, yy, x1 - x0, hgt);
        g.globalAlpha = 1;
      }
      // The voice curve (sound pass: someone singing or talking, 0..1), pink along the bottom.
      const voice = score.envelopes.voice;
      if (voice?.values.length) {
        const base = H - bottom - 4, amp = rowH * 1.6;
        g.strokeStyle = '#ff8ad8'; g.lineWidth = 1.5; g.beginPath();
        for (let x = left; x < W - 8; x += 3) {
          const t = s + span0 + ((x - left) / (W - left - 8)) * (span1 - span0);
          if (t > (score.soundsFrontier ?? 0)) break;
          const v = sampleEnvelope(voice, t), y = base - v * amp;
          if (x === left) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        g.fillStyle = '#ff8ad8';
        g.fillText('voice', 6, base - amp / 2);
      }
      // Recognised sounds: a labelled bar each, under the phrase marks.
      for (const c of score.sounds ?? []) {
        if (c.t + c.dur < s + span0 || c.t > s + span1) continue;
        const x0 = Math.max(left, xOf(c.t)), x1 = Math.min(W - 8, xOf(c.t + c.dur));
        g.fillStyle = CUE_COLORS[c.kind] ?? '#aaa';
        g.globalAlpha = 0.4 + 0.6 * c.score;
        g.fillRect(x0, top + 11, Math.max(2, x1 - x0), 9);
        g.globalAlpha = 1;
        g.fillStyle = '#111';
        if (x1 - x0 > 30) g.fillText(`${c.kind}: ${c.label}`.slice(0, Math.floor((x1 - x0) / 6.5)), x0 + 2, top + 16);
      }
      // Moments (sudden changes): a marker and its name; a build is a ramp up to its peak.
      for (const m of score.moments ?? []) {
        const end = m.t + (m.dur ?? 0);
        if (end < s + span0 || m.t > s + span1) continue;
        const x = xOf(m.t);
        g.fillStyle = MOMENT_COLORS[m.kind];
        if (m.kind === 'build' && m.dur) {
          const x1 = xOf(end);
          g.globalAlpha = 0.35;
          g.beginPath(); g.moveTo(x, H - bottom); g.lineTo(x1, top + 24); g.lineTo(x1, H - bottom); g.closePath(); g.fill();
          g.globalAlpha = 1;
        } else {
          g.fillRect(x - 1, top + 22, 3, H - top - bottom - 22);
          if (m.kind === 'stop' && m.dur) { g.globalAlpha = 0.25; g.fillRect(x, top + 22, xOf(end) - x, H - top - bottom - 22); g.globalAlpha = 1; }
        }
        g.fillText(`${m.kind} ${m.size.toFixed(2)}`, x + 4, top + 28);
      }
      // Frontier.
      const fx = xOf(score.frontierSec);
      if (fx < W) {
        g.fillStyle = 'rgba(255,80,80,0.25)';
        g.fillRect(Math.max(left, fx), top, W - Math.max(left, fx), H - top - bottom);
        g.fillStyle = '#ff6b6b';
        g.fillRect(fx, top, 2, H - top - bottom);
        g.fillText('frontier', fx + 4, H - bottom - 8);
      }
    }
    // Playhead.
    const px = xOf(s);
    g.fillStyle = '#4cffb0';
    g.fillRect(px - 1, top, 2, H - top - bottom);
    if (score) this.drawSong(score, s, left, W, H - bottom + 8, span0, span1, deep);
    g.fillStyle = '#dde';
    g.fillText(this.lines.join('   '), 6, H - 9);
  }

  /**
   * The whole song in one strip under the timeline: sections coloured by kind and lettered by
   * group (parts that sound alike share a letter), what is analysed so far, how far deep listen
   * has got (the thin line under it), the stretch the timeline above shows, and the playhead.
   */
  private drawSong(score: Score, s: number, left: number, W: number, y: number, span0: number, span1: number, deep?: { spans: [number, number][]; state: string }) {
    const g = this.g;
    const dur = score.track.durationSec || 1;
    const x = (t: number) => left + (Math.min(Math.max(t, 0), dur) / dur) * (W - left - 8);
    const h = 16;
    g.fillStyle = '#aab';
    g.fillText('song', 6, y + h / 2);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(left, y, W - left - 8, h);
    const letters = new Map<number, string>();
    const cur = (() => { let i = -1; score.sections.forEach((sec, k) => { if (sec.t <= s) i = k; }); return i; })();
    score.sections.forEach((sec, i) => {
      const end = score.sections[i + 1]?.t ?? (score.final ? dur : score.frontierSec);
      const x0 = x(sec.t), x1 = x(end);
      g.fillStyle = SECTION_COLORS[sec.label] ?? '#555';
      g.globalAlpha = i === cur ? 1 : 0.7;
      g.fillRect(x0, y, Math.max(1, x1 - x0 - 1), h);
      g.globalAlpha = 1;
      let tag = sec.label === 'intro' || sec.label === 'outro' ? sec.label : sec.label === 'breakdown' ? 'brk' : '';
      if (!tag && sec.group !== undefined) {
        if (!letters.has(sec.group)) letters.set(sec.group, String.fromCharCode(65 + letters.size));
        tag = (sec.label === 'drop' ? 'drop ' : '') + letters.get(sec.group);
        // Back-to-back repeats alternate two takes in the visualiser: C1 C2 C1 C2.
        const same = (k: number) => score.sections[k]?.group === sec.group;
        if (same(i - 1) || same(i + 1)) { let run = 0; while (same(i - run - 1)) run++; tag += (run % 2) + 1; }
      }
      if (!tag) tag = sec.label;
      if (x1 - x0 > g.measureText(tag).width + 4) { g.fillStyle = '#fff'; g.fillText(tag, x0 + 3, y + h / 2); }
      if (i === cur) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x0 + 0.75, y + 0.75, x1 - x0 - 2.5, h - 1.5); }
    });
    // Not analysed yet.
    if (!score.final) {
      const fx = x(score.frontierSec);
      g.fillStyle = 'rgba(255,80,80,0.3)';
      g.fillRect(fx, y, W - 8 - fx, h);
    }
    // Deep listen: the windows it has finished.
    if (deep) {
      g.fillStyle = deep.state === 'skipped' ? 'rgba(160,160,160,0.5)' : '#c89bff';
      if (deep.state === 'skipped') g.fillRect(left, y + h + 2, W - left - 8, 2);
      else for (const [a, b] of deep.spans) g.fillRect(x(a), y + h + 2, Math.max(1, x(b) - x(a)), 3);
    }
    // The sound pass: each recognised sound as a coloured tick above the strip (speech white,
    // singing pink, crowds gold, sirens red, impacts orange, nature blue, the rest grey).
    for (const c of score.sounds ?? []) {
      g.fillStyle = CUE_COLORS[c.kind] ?? '#aaa';
      g.fillRect(x(c.t), y - 7, Math.max(2, x(c.t + c.dur) - x(c.t)), 3);
    }
    for (const m of score.moments ?? []) {
      g.fillStyle = MOMENT_COLORS[m.kind];
      g.fillRect(x(m.t) - 1, y + h + 6, 2, 5);
    }
    // The stretch the timeline above shows, and the playhead.
    g.strokeStyle = 'rgba(76,255,176,0.8)';
    g.lineWidth = 1;
    g.strokeRect(x(s + span0), y - 2, Math.max(2, x(s + span1) - x(s + span0)), h + 4);
    g.fillStyle = '#4cffb0';
    g.fillRect(x(s) - 1, y - 3, 2, h + 6);
  }
}
