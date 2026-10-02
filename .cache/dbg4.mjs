import fs from 'node:fs';
const { Analyzer } = await import(process.cwd() + '/.cache/analyzer.mjs');
const base=process.argv[2]; const wav=fs.readFileSync(base+".wav");const truth=JSON.parse(fs.readFileSync(base+".truth.json"));
const sr=wav.readUInt32LE(24);const n=wav.readUInt32LE(40)/2;const pcm=new Float32Array(n);for(let i=0;i<n;i++)pcm[i]=wav.readInt16LE(44+i*2)/32768;
const a=new Analyzer(pcm,sr);while(!a.finished){a.step()}
const bp=60/truth.bpm;
for(let i=0;i<60;i++){const f=a.beatFrames[i]; const t=a.frameTime(f); const ph=(t-truth.firstDownbeat)/bp; const tb=((Math.round(ph)%4)+4)%4+1;
 let k=0,s=0; for(const o of a.onsets){ if(Math.abs(o.frame-f)>3) continue; if(o.kind==='kick')k=o.vel; if(o.kind==='snare')s=o.vel;}
 const prev=i>0?a.beatFrames[i-1]:f-a.periodFrames;
 console.log(i, t.toFixed(2),'truthbeat',tb,'k',k.toFixed(2),'s',s.toFixed(2),'h',a.harmonicChange(prev,f).toFixed(2), 'ev', a.downbeatEvidence(i).toFixed(2));}
console.log(a.bars.slice(0,12));
