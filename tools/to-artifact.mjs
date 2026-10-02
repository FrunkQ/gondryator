// Turns the single-file build into an Artifact page body (the host adds doctype/html/head/body).
import fs from 'node:fs';
const [src = 'dist-single/index.html', out = 'dist-single/artifact.html'] = process.argv.slice(2);
let html = fs.readFileSync(src, 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const keep = head.replace(/<meta charset[^>]*>/, '').replace(/<meta name="viewport"[^>]*>/, '');
// Title first (only the first 8 KB are scanned for it).
const title = keep.match(/<title>.*?<\/title>/)[0];
fs.writeFileSync(out, title + '\n' + keep.replace(title, '') + '\n' + body);
console.log('wrote', out, fs.statSync(out).size, 'bytes');
