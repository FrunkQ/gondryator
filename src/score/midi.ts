// Score <-> Standard MIDI File.
// Export: type-1 MIDI, one track per stem/kind, with the tempo map (for UE5 tools such as Midi Engine 3).
// Import: a user-supplied MIDI file replaces the matching analysis stages (best quality).

import type { Score, ScoreEvent, Stem, EventKind } from './types';

const PPQ = 480;

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}

function secToTicks(score: Score, t: number): number {
  const tempo = score.tempo.length ? score.tempo : [{ t: 0, bpm: 120 }];
  let ticks = 0;
  for (let i = 0; i < tempo.length; i++) {
    const a = tempo[i].t, b = i + 1 < tempo.length ? tempo[i + 1].t : Infinity;
    if (t <= a) break;
    const span = Math.min(t, b) - a;
    ticks += span * (tempo[i].bpm / 60) * PPQ;
  }
  // Time before the first tempo entry.
  if (t < tempo[0].t) ticks = t * (tempo[0].bpm / 60) * PPQ;
  return Math.round(ticks);
}

function track(name: string, events: { tick: number; data: number[] }[]): number[] {
  events.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
  const out: number[] = [0x00, 0xff, 0x03, ...vlq(name.length), ...[...name].map(c => c.charCodeAt(0) & 0x7f)];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(Math.max(0, e.tick - last)), ...e.data);
    last = e.tick;
  }
  out.push(0x00, 0xff, 0x2f, 0x00);
  return [0x4d, 0x54, 0x72, 0x6b, (out.length >>> 24) & 255, (out.length >>> 16) & 255, (out.length >>> 8) & 255, out.length & 255, ...out];
}

const DRUM_NOTE: Record<string, number> = { kick: 36, snare: 38, hat: 42, hit: 39 };

export function scoreToMidi(score: Score): Uint8Array {
  const tracks: number[][] = [];
  // Tempo track.
  const tempoEvents = (score.tempo.length ? score.tempo : [{ t: 0, bpm: 120 }]).map(x => {
    const us = Math.round(60_000_000 / x.bpm);
    return { tick: secToTicks(score, x.t), data: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] };
  });
  tempoEvents.push({ tick: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] });
  for (const s of score.sections) {
    const txt = s.label;
    tempoEvents.push({ tick: secToTicks(score, s.t), data: [0xff, 0x06, txt.length, ...[...txt].map(c => c.charCodeAt(0))] });
  }
  tracks.push(track('tempo + sections', tempoEvents));

  const groups = new Map<string, ScoreEvent[]>();
  for (const e of score.events) {
    const key = e.stem === 'drums' ? `drums:${e.kind}` : e.stem === 'other' && e.dur >= 1.2 ? 'other:pads' : `${e.stem}:notes`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  let ch = 0;
  for (const [key, evs] of groups) {
    const drums = key.startsWith('drums');
    const channel = drums ? 9 : ch++ % 9;
    const out: { tick: number; data: number[] }[] = [];
    for (const e of evs) {
      const note = drums ? DRUM_NOTE[e.kind] ?? 37 : Math.max(0, Math.min(127, e.pitch ?? 60));
      const vel = Math.max(1, Math.min(127, Math.round(e.vel * 127)));
      const on = secToTicks(score, e.t), off = Math.max(on + 1, secToTicks(score, e.t + e.dur));
      out.push({ tick: on, data: [0x90 | channel, note, vel] }, { tick: off, data: [0x80 | channel, note, 0] });
    }
    tracks.push(track(key, out));
  }
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...header, ...tracks.flat()]);
}

// ------------------------------------------------------------------ import

interface RawNote { t: number; dur: number; pitch: number; vel: number; channel: number; track: number }

export interface MidiImport {
  events: ScoreEvent[];
  stems: Set<Stem>;
  /** Kinds now covered by MIDI, which the analysis should not also produce. */
  covers: (e: ScoreEvent) => boolean;
}

export function parseMidi(buf: ArrayBuffer): MidiImport {
  const u8 = new Uint8Array(buf);
  const be16 = (o: number) => (u8[o] << 8) | u8[o + 1];
  const be32 = (o: number) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'MThd') throw new Error('Not a MIDI file');
  const ntracks = be16(10), division = be16(12);
  let o = 8 + be32(4);
  // Gather tempo changes (in ticks) and notes from all tracks.
  const tempos: { tick: number; us: number }[] = [];
  const raw: { tick: number; end: number; pitch: number; vel: number; channel: number; track: number }[] = [];
  const names: string[] = [];
  for (let tr = 0; tr < ntracks && o < u8.length; tr++) {
    const len = be32(o + 4);
    let p = o + 8;
    const end = p + len;
    let tick = 0, status = 0;
    const open = new Map<number, { tick: number; vel: number }>();
    while (p < end) {
      let delta = 0, b: number;
      do { b = u8[p++]; delta = (delta << 7) | (b & 0x7f); } while (b & 0x80);
      tick += delta;
      let st = u8[p];
      if (st & 0x80) p++; else st = status;
      if (st === 0xff) {
        const type = u8[p++];
        let l = 0;
        do { b = u8[p++]; l = (l << 7) | (b & 0x7f); } while (b & 0x80);
        if (type === 0x51) tempos.push({ tick, us: (u8[p] << 16) | (u8[p + 1] << 8) | u8[p + 2] });
        if (type === 0x03) names[tr] = new TextDecoder().decode(u8.subarray(p, p + l));
        p += l;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        let l = 0;
        do { b = u8[p++]; l = (l << 7) | (b & 0x7f); } while (b & 0x80);
        p += l;
        continue;
      }
      status = st;
      const type = st & 0xf0, chn = st & 0x0f;
      const d1 = u8[p++];
      const d2 = type === 0xc0 || type === 0xd0 ? 0 : u8[p++];
      const key = chn * 128 + d1;
      if (type === 0x90 && d2 > 0) open.set(key, { tick, vel: d2 });
      else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
        const on = open.get(key);
        if (on) { raw.push({ tick: on.tick, end: tick, pitch: d1, vel: on.vel / 127, channel: chn, track: tr }); open.delete(key); }
      }
    }
    o = end;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, us: 500000 });
  const toSec = (tick: number) => {
    let sec = 0;
    for (let i = 0; i < tempos.length; i++) {
      const a = tempos[i].tick, b = i + 1 < tempos.length ? tempos[i + 1].tick : Infinity;
      if (tick <= a) break;
      sec += ((Math.min(tick, b) - a) / division) * (tempos[i].us / 1e6);
    }
    return sec;
  };
  const notes: RawNote[] = raw.map(r => ({ t: toSec(r.tick), dur: toSec(r.end) - toSec(r.tick), pitch: r.pitch, vel: r.vel, channel: r.channel, track: r.track }));

  // Assign stems: channel 10 = drums; then by track name; else the lowest-pitched track is bass.
  const byTrack = new Map<number, RawNote[]>();
  for (const n of notes) if (n.channel !== 9) { if (!byTrack.has(n.track)) byTrack.set(n.track, []); byTrack.get(n.track)!.push(n); }
  const avgPitch = (ns: RawNote[]) => ns.reduce((a, n) => a + n.pitch, 0) / ns.length;
  let bassTrack = -1, lowest = 999;
  for (const [tr, ns] of byTrack) {
    const nm = (names[tr] ?? '').toLowerCase();
    if (nm.includes('bass')) { bassTrack = tr; break; }
    const a = avgPitch(ns);
    if (a < lowest && a < 52) { lowest = a; bassTrack = tr; }
  }
  const events: ScoreEvent[] = [];
  const stems = new Set<Stem>();
  for (const n of notes) {
    let stem: Stem, kind: EventKind = 'note';
    if (n.channel === 9) {
      stem = 'drums';
      kind = n.pitch === 35 || n.pitch === 36 ? 'kick' : n.pitch === 38 || n.pitch === 40 || n.pitch === 39 ? 'snare' : n.pitch === 42 || n.pitch === 44 || n.pitch === 46 ? 'hat' : 'hit';
    } else {
      const nm = (names[n.track] ?? '').toLowerCase();
      stem = n.track === bassTrack ? 'bass' : nm.includes('vox') || nm.includes('vocal') ? 'vocals' : 'other';
    }
    stems.add(stem);
    events.push({ id: '', t: Math.round(n.t * 1000) / 1000, dur: Math.max(0.03, Math.round(n.dur * 1000) / 1000), stem, kind, pitch: stem === 'drums' ? null : n.pitch, vel: n.vel });
  }
  events.sort((a, b) => a.t - b.t);
  return {
    events, stems,
    covers: e => stems.has(e.stem) || (e.stem === 'other' && stems.has('vocals')),
  };
}
