import fs from 'node:fs';
const { Analyzer } = await import(process.cwd() + '/.cache/analyzer.mjs');
const base=process.argv[2]; const wav=fs.readFileSync(base+".wav");const truth=JSON.parse(fs.readFileSync(base+".truth.json"));
const sr=wav.readUInt32LE(24);const n=wav.readUInt32LE(40)/2;const pcm=new Float32Array(n);for(let i=0;i<n;i++)pcm[i]=wav.readInt16LE(44+i*2)/32768;
const a=new Analyzer(pcm,sr);const beats=[];while(!a.finished){const d=a.step();if(d)beats.push(...d.beats)}
const h={};for(const t of truth.downbeats){const b=beats.find(b=>Math.abs(b.t-t)<0.07); const k=b?b.beat:'none'; h[k]=(h[k]||0)+1} console.log('truth downbeats land on beat#',h, 'phase', a.downbeatPhase);
