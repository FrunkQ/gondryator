// Runs the analyzer in Node on a test WAV and scores it against the truth file.
//   node tools/eval-analysis.mjs test-tracks/test-124
import fs from 'node:fs';
import { buildSync } from 'esbuild';

buildSync({ entryPoints: ['src/analysis/analyzer.ts'], bundle: true, format: 'esm', platform: 'node', outfile: '.cache/analyzer.mjs', logLevel: 'error' });
const { Analyzer } = await import(process.cwd() + '/.cache/analyzer.mjs?' + Date.now());

const base = process.argv[2] ?? 'test-tracks/test-124';
const wav = fs.readFileSync(base + '.wav');
const truth = JSON.parse(fs.readFileSync(base + '.truth.json', 'utf8'));
const sr = wav.readUInt32LE(24);
const n = wav.readUInt32LE(40) / 2;
const pcm = new Float32Array(n);
for (let i = 0; i < n; i++) pcm[i] = wav.readInt16LE(44 + i * 2) / 32768;

const t0 = performance.now();
const a = new Analyzer(pcm, sr, { chunkSec: 4 });
const score = { events: [], beats: [], sections: [], phrases: [], tempo: [], moments: [] };
const frontiers = [];
let d;
while (!a.finished) {
  d = a.step();
  if (!d) continue;
  frontiers.push([a.analyzedSec, d.frontierSec]);
  for (const k of ['events', 'beats', 'sections', 'phrases', 'tempo', 'moments']) score[k].push(...(d[k] ?? []));
}
const wall = (performance.now() - t0) / 1000;
const dur = n / sr;

function match(est, ref, tol = 0.05) {
  const used = new Set(); let tp = 0; const offs = [];
  for (const r of ref) {
    let best = -1, bd = tol;
    est.forEach((e, i) => { const dd = Math.abs(e - r); if (!used.has(i) && dd <= bd) { bd = dd; best = i; } });
    if (best >= 0) { used.add(best); tp++; offs.push(est[best] - r); }
  }
  const p = est.length ? tp / est.length : 0, r = ref.length ? tp / ref.length : 0;
  const f = p + r ? (2 * p * r) / (p + r) : 0;
  const mo = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : 0;
  return `P ${(p * 100).toFixed(0)}% R ${(r * 100).toFixed(0)}% F ${(f * 100).toFixed(0)}% (n=${est.length}/${ref.length}, offset ${(mo * 1000).toFixed(0)}ms)`;
}
const ev = k => score.events.filter(e => e.kind === k).map(e => e.t);
console.log(`duration ${dur.toFixed(1)}s, analysed in ${wall.toFixed(2)}s = ${(dur / wall).toFixed(0)}x realtime`);
console.log('tempo', score.tempo.map(x => x.bpm).join(', '), 'truth', truth.bpm);
console.log('kick  ', match(ev('kick'), truth.kicks));
console.log('snare ', match(ev('snare'), truth.snares));
console.log('hat   ', match(ev('hat'), truth.hats));
const notes = s => score.events.filter(e => e.kind === 'note' && e.stem === s);
console.log('bass  ', match(notes('bass').map(e => e.t), truth.bass.map(x => x.t), 0.06));
const bassPitchOk = truth.bass.filter(b => notes('bass').some(e => Math.abs(e.t - b.t) < 0.06 && e.pitch === b.m)).length;
console.log('       bass pitch correct', bassPitchOk, '/', truth.bass.length);
const leadNotes = notes('other').filter(e => e.dur < 1.2);
console.log('lead  ', match(leadNotes.map(e => e.t), truth.lead.map(x => x.t), 0.06));
const leadPitchOk = truth.lead.filter(b => leadNotes.some(e => Math.abs(e.t - b.t) < 0.06 && e.pitch === b.m)).length;
console.log('       lead pitch correct', leadPitchOk, '/', truth.lead.length);
console.log('beats ', match(score.beats.map(b => b.t), truth.kicks.length ? (() => { const out = []; const bp = 60 / truth.bpm; for (let t = truth.firstDownbeat; t < dur - 3; t += bp) out.push(t); return out; })() : [], 0.07));
console.log('downb ', match(score.beats.filter(b => b.downbeat).map(b => b.t), truth.downbeats, 0.07));
console.log('sections', score.sections.map(s => `${s.t.toFixed(1)}:${s.label}(${s.energy})`).join(' '));
console.log('truth   ', truth.sections.map(s => `${s.t.toFixed(1)}:${s.label}`).join(' '));
console.log('moments ', score.moments.map(m => `${m.t.toFixed(2)}:${m.kind}(${m.size}${m.dur ? ', ' + m.dur.toFixed(1) + 's' : ''})`).join(' '));
if (truth.moments) {
  // A moment is right if one of the same kind lands within a quarter of a second.
  const hit = truth.moments.filter(r => score.moments.some(m => m.kind === r.kind && Math.abs(m.t - r.t) < 0.25)).length;
  const extra = score.moments.filter(m => !truth.moments.some(r => r.kind === m.kind && Math.abs(m.t - r.t) < 0.25)).length;
  console.log('truth   ', truth.moments.map(m => `${m.t.toFixed(2)}:${m.kind}`).join(' '), `-> found ${hit}/${truth.moments.length}, ${extra} extra`);
}
console.log('phrases', score.phrases.map(p => `${p.bar}:${p.id}${p.repeatOf !== null ? '*' : ''}${p.entering.length ? '+' + p.entering.join('/') : ''}`).join(' '));
console.log('frontier lead (analysed - frontier) max', Math.max(...frontiers.map(([a, f]) => a - f)).toFixed(1), 's; first frontier', frontiers[0]?.[1]);
const pads = notes('other').filter(e => e.dur >= 1.2);
console.log('pads', pads.length, 'truth bars with pads', truth.pads.length);
// Monotonic check
let last = -1, ok = true;
for (const e of score.events) { if (e.t < last - 1e-9) ok = false; last = e.t; }
console.log('events sorted across deltas:', ok);
