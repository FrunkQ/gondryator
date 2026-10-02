import fs from 'node:fs';
const { Analyzer } = await import(process.cwd() + '/.cache/analyzer.mjs');
const base = process.argv[2]; const [from,to]=[+process.argv[3],+process.argv[4]];
const wav = fs.readFileSync(base + '.wav');
const sr = wav.readUInt32LE(24); const n = wav.readUInt32LE(40) / 2; const pcm = new Float32Array(n);
for (let i = 0; i < n; i++) pcm[i] = wav.readInt16LE(44 + i * 2) / 32768;
const a = new Analyzer(pcm, sr); while(!a.finished) a.step();
console.log('p95',a.p95);
for(let f=a.timeFrame(from); f<a.timeFrame(to); f++) console.log(a.frameTime(f).toFixed(3), 'L',(a.fluxLow[f]/a.p95.low).toFixed(2),'M',(a.fluxMid[f]/a.p95.mid).toFixed(2),'H',(a.fluxHigh[f]/a.p95.high).toFixed(2),'flat',a.flat[f].toFixed(2),'dbL',a.dbLow[f].toFixed(1),'dbM',a.dbMid[f].toFixed(1), 'odf', a.odf[f].toFixed(2));
