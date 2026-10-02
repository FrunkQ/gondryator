// A generated demo track (original, synthesised in the browser), so the app can be tried
// without a music file. Returns a 16-bit WAV in an ArrayBuffer.

export function makeDemoTrack(sr = 44100): ArrayBuffer {
  const bpm = 122;
  const beat = 60 / bpm, bar = beat * 4;
  const structure = [
    { bars: 4, pads: 1, hats: 0.5 },
    { bars: 8, kick: 1, snare: 0.8, hats: 0.7, bass: 1, pads: 0.6 },
    { bars: 8, kick: 1, snare: 0.9, hats: 0.8, hats16: true, bass: 1, lead: 0.9, pads: 0.6 },
    { bars: 4, pads: 1, lead: 0.8 },
    { bars: 8, kick: 1, snare: 0.9, hats: 0.8, hats16: true, bass: 1, lead: 1, pads: 0.7 },
    { bars: 4, pads: 0.8, hats: 0.4 },
  ] as { bars: number; pads?: number; hats?: number; hats16?: boolean; kick?: number; snare?: number; bass?: number; lead?: number }[];
  const totalBars = structure.reduce((a, s) => a + s.bars, 0);
  const lead0 = beat;
  const dur = lead0 + totalBars * bar + 2.5;
  const L = new Float32Array(Math.ceil(dur * sr));
  let seed = 12345;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
  const add = (t: number, len: number, fn: (s: number) => number) => {
    const a = Math.floor(t * sr), n = Math.floor(len * sr);
    for (let i = 0; i < n && a + i < L.length; i++) L[a + i] += fn(i / sr);
  };
  const kick = (t: number, v: number) => { let ph = 0; add(t, 0.35, s => { const f = 45 + 90 * Math.exp(-s / 0.03); ph += (2 * Math.PI * f) / sr; return v * 0.9 * Math.sin(ph) * Math.exp(-s / 0.07); }); };
  const snare = (t: number, v: number) => { let lp = 0; add(t, 0.3, s => { const n = noise(); lp = lp * 0.6 + n * 0.4; return v * (0.5 * (n - 0.5 * lp) * Math.exp(-s / 0.08) + 0.3 * Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s / 0.04)); }); };
  const hat = (t: number, v: number) => { let prev = 0; add(t, 0.1, s => { const n = noise(); const h = n - prev; prev = n; return v * 0.22 * h * Math.exp(-s / 0.025); }); };
  const saw = (ph: number) => 2 * (ph - Math.floor(ph + 0.5));
  const bassNote = (t: number, m: number, len: number, v: number) => { const f = mtof(m); let lp = 0; add(t, len, s => { const env = Math.min(1, s / 0.005) * (s > len - 0.03 ? Math.max(0, (len - s) / 0.03) : 1); const x = saw(f * s) * 0.6 + Math.sin(2 * Math.PI * f * s) * 0.6; lp += 0.12 * (x - lp); return v * 0.45 * env * lp; }); };
  const leadNote = (t: number, m: number, len: number, v: number) => { const f = mtof(m); add(t, len, s => { const env = Math.min(1, s / 0.01) * Math.exp(-s / 0.8) * (s > len - 0.04 ? Math.max(0, (len - s) / 0.04) : 1); return v * 0.2 * env * (Math.sin(2 * Math.PI * f * s) + 0.4 * Math.sin(4 * Math.PI * f * s) + 0.2 * Math.sin(6 * Math.PI * f * s)); }); };
  const pad = (t: number, notes: number[], len: number, v: number) => { add(t, len, s => { const env = Math.min(1, s / 0.3) * Math.min(1, Math.max(0, (len - s) / 0.3)); let x = 0; for (const m of notes) { const f = mtof(m); x += Math.sin(2 * Math.PI * f * s) + 0.3 * Math.sin(2 * Math.PI * f * 1.003 * s); } return v * 0.06 * env * x; }); };
  const key = 45;
  const chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]];
  const bassLine = [0, 0, 12, 0, -4, -4, 8, -4, -2, -2, 10, -2, -5, -5, 7, -5];
  const melody = [12, 15, 19, 17, 15, 12, 10, 12];
  let barIdx = 0;
  for (const sec of structure) {
    for (let b = 0; b < sec.bars; b++) {
      const tb = lead0 + (barIdx + b) * bar;
      const ci = b % 4, ch = chords[ci];
      if (sec.pads) pad(tb, ch.map(c => key + 12 + c), bar, sec.pads);
      for (let q = 0; q < 4; q++) {
        const tq = tb + q * beat;
        if (sec.kick) kick(tq, sec.kick);
        if (sec.snare && (q === 1 || q === 3)) snare(tq, sec.snare);
        if (sec.hats) for (let e = 0; e < (sec.hats16 ? 4 : 2); e++) { if (!sec.hats16 && e === 0 && sec.kick) continue; hat(tq + (e * beat) / (sec.hats16 ? 4 : 2), sec.hats * (e % 2 ? 1 : 0.7)); }
        if (sec.bass) bassNote(tq + beat / 2, key - 12 + bassLine[ci * 4 + q], beat / 2 - 0.02, sec.bass);
      }
      if (sec.lead) for (let k = 0; k < 4; k++) leadNote(tb + k * beat, key + 12 + melody[((b % 2) * 4 + k) % 8] + (ch[0] < 0 ? -2 : 0), beat * 0.9, sec.lead);
    }
    barIdx += sec.bars;
  }
  let peak = 0;
  for (const v of L) peak = Math.max(peak, Math.abs(v));
  const buf = new ArrayBuffer(44 + L.length * 2);
  const dv = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + L.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, L.length * 2, true);
  for (let i = 0; i < L.length; i++) dv.setInt16(44 + i * 2, Math.round((L[i] / peak) * 0.89 * 32767), true);
  return buf;
}
