import fs from 'node:fs';
const { Analyzer } = await import(process.cwd() + '/.cache/analyzer.mjs');
const base = process.argv[2]; const [from,to]=[+process.argv[3],+process.argv[4]];
const wav = fs.readFileSync(base + '.wav'); const truth = JSON.parse(fs.readFileSync(base + '.truth.json','utf8'));
const sr = wav.readUInt32LE(24); const n = wav.readUInt32LE(40) / 2; const pcm = new Float32Array(n);
for (let i = 0; i < n; i++) pcm[i] = wav.readInt16LE(44 + i * 2) / 32768;
const a = new Analyzer(pcm, sr); const ev=[]; const beats=[];
while(!a.finished){const d=a.step(); if(d){ev.push(...d.events);beats.push(...d.beats);}}
const rows=[];
for(const e of ev) if(e.t>=from&&e.t<to) rows.push([e.t,'EST '+e.kind+' '+e.stem+' p'+e.pitch+' v'+e.vel+' d'+e.dur]);
for(const k of ['kicks','snares','hats']) for(const t of truth[k]) if(t>=from&&t<to) rows.push([t,'TRU '+k]);
for(const k of ['bass','lead']) for(const x of truth[k]) if(x.t>=from&&x.t<to) rows.push([x.t,'TRU '+k+' m'+x.m]);
for(const b of beats) if(b.t>=from&&b.t<to) rows.push([b.t,'BEAT '+b.bar+'.'+b.beat]);
rows.sort((x,y)=>x[0]-y[0]); for(const r of rows) console.log(r[0].toFixed(3),r[1]);
