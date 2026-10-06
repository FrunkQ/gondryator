// Draws docs/img/note-aligner.svg: where a note lands on screen for four ways of looking out of
// the train's window, and the note aligner's curve underneath. Reads the curve from
// src/packs/views.ts (VIEW.window.hitCurve), so re-run it after changing that:
//   node tools/note-aligner-svg.mjs
import fs from 'fs';

const src = fs.readFileSync(new URL('../src/packs/views.ts', import.meta.url), 'utf8');
const curve = JSON.parse(/hitCurve:\s*(\[\[.*?\]\])/.exec(src)[1]);
const place = y => {
  if (y <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (y <= curve[i][0]) {
    const [y0, p0] = curve[i - 1], [y1, p1] = curve[i], k = (y - y0) / (y1 - y0);
    return p0 + (p1 - p0) * k * k * (3 - 2 * k);
  }
  return curve[curve.length - 1][1];
};
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
// The train: 52° vertical field of view on a 16:9 screen.
const HALF = deg(Math.atan(Math.tan(rad(26)) * 16 / 9));
const hitYaw = y => Math.max(-77, Math.min(77, y + HALF * 0.9 * place(y)));
const C = { entry: '#0f9d8a', middle: '#e09a12', leaving: '#d6337f', ink: '#22252b', dim: '#6b7280', bg: '#fbfaf7', line: '#c9c4b8', fan: '#5b7cfa' };
const mix = (a, b, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - k) + parseInt(b.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
const colour = p => p >= 0 ? mix(C.middle, C.entry, p) : mix(C.middle, C.leaving, -p);
const word = p => p > 0.5 ? 'entry edge' : p < -0.5 ? 'leaving edge' : 'middle';

const PW = 230, PH = 210, GAP = 14, X0 = 20, Y0 = 64, D = 112;
const panels = [
  [-70, 'Looking back down the line'],
  [-16, 'Resting view'],
  [40, 'Obliquely up the line'],
  [72, 'Right up the line'],
];
const W = X0 * 2 + panels.length * PW + (panels.length - 1) * GAP;
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 560" width="${W}" height="560" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`);
out.push(`<rect width="${W}" height="560" rx="14" fill="${C.bg}"/>`);
out.push(`<text x="${X0}" y="32" font-size="19" font-weight="700" fill="${C.ink}">When does a note hit?</text>`);
out.push(`<text x="${X0}" y="52" font-size="13" fill="${C.dim}">Seen from above. The train travels right, so the scenery slides past right to left. The dot is where a note's object is as the note sounds.</text>`);
out.push(`<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.dim}"/></marker>`);
panels.forEach((_, i) => out.push(`<clipPath id="c${i}"><rect x="${X0 + i * (PW + GAP)}" y="${Y0}" width="${PW}" height="${PH}" rx="10"/></clipPath>`));
out.push('</defs>');

panels.forEach(([yaw, title], i) => {
  const px = X0 + i * (PW + GAP), cx = px + PW / 2, cy = Y0 + PH - 30, sy = cy - D;
  const p = place(yaw), hy = hitYaw(yaw), col = colour(p);
  const dir = a => [Math.sin(rad(a)), -Math.cos(rad(a))];
  out.push(`<rect x="${px}" y="${Y0}" width="${PW}" height="${PH}" rx="10" fill="#ffffff" stroke="${C.line}"/>`);
  out.push(`<g clip-path="url(#c${i})">`);
  // The field of view: a fan from the eye.
  const R = 400, [ax, ay] = dir(yaw - HALF), [bx, by] = dir(yaw + HALF);
  out.push(`<path d="M${cx},${cy} L${cx + ax * R},${cy + ay * R} A${R},${R} 0 0 1 ${cx + bx * R},${cy + by * R} Z" fill="${C.fan}" fill-opacity="0.10" stroke="${C.fan}" stroke-opacity="0.35"/>`);
  // The scenery line, sliding left.
  out.push(`<line x1="${px}" y1="${sy}" x2="${px + PW}" y2="${sy}" stroke="${C.line}" stroke-width="2" stroke-dasharray="6 5"/>`);
  out.push(`<line x1="${px + PW - 18}" y1="${sy - 12}" x2="${px + PW - 58}" y2="${sy - 12}" stroke="${C.dim}" stroke-width="1.5" marker-end="url(#ar)"/>`);
  // The gaze.
  const [gx, gy] = dir(yaw);
  out.push(`<line x1="${cx}" y1="${cy}" x2="${cx + gx * 300}" y2="${cy + gy * 300}" stroke="${C.fan}" stroke-width="1.5" stroke-dasharray="3 4"/>`);
  // Where the note lands: on the scenery line, along the hit angle.
  const hx = cx + D * Math.tan(rad(hy));
  out.push(`<line x1="${cx}" y1="${cy}" x2="${hx}" y2="${sy}" stroke="${col}" stroke-width="2"/>`);
  out.push(`<circle cx="${hx}" cy="${sy}" r="13" fill="${col}" fill-opacity="0.18"/><circle cx="${hx}" cy="${sy}" r="6.5" fill="${col}"/>`);
  out.push('</g>');
  // The window and the eye.
  out.push(`<line x1="${cx - 46}" y1="${cy - 12}" x2="${cx + 46}" y2="${cy - 12}" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="${C.ink}"/>`);
  out.push(`<text x="${px + 12}" y="${Y0 + 22}" font-size="13" font-weight="600" fill="${C.ink}">${title}</text>`);
  out.push(`<text x="${px + 12}" y="${Y0 + PH - 10}" font-size="12" fill="${C.dim}">gaze ${yaw > 0 ? '+' : ''}${yaw}°</text>`);
  out.push(`<text x="${px + PW - 12}" y="${Y0 + PH - 10}" font-size="12.5" font-weight="700" fill="${col}" text-anchor="end">${word(p)}</text>`);
});

// The curve: place on screen against gaze.
const gx0 = X0 + 110, gx1 = W - X0 - 20, gy0 = 330, gy1 = 520;
const X = y => gx0 + (y + 90) / 180 * (gx1 - gx0), Y = p => gy0 + (1 - p) / 2 * (gy1 - gy0);
out.push(`<text x="${X0}" y="${gy0 - 18}" font-size="14" font-weight="700" fill="${C.ink}">The note aligner's curve (hitCurve, src/packs/views.ts)</text>`);
for (const [p, label] of [[1, 'entry edge'], [0, 'middle'], [-1, 'leaving edge']]) {
  out.push(`<line x1="${gx0}" y1="${Y(p)}" x2="${gx1}" y2="${Y(p)}" stroke="${C.line}" stroke-width="1"/>`);
  out.push(`<text x="${gx0 - 10}" y="${Y(p) + 4}" font-size="12" fill="${colour(p)}" font-weight="600" text-anchor="end">${label}</text>`);
}
for (const y of [-90, -45, 0, 45, 90]) out.push(`<text x="${X(y)}" y="${gy1 + 18}" font-size="11.5" fill="${C.dim}" text-anchor="middle">${y > 0 ? '+' : ''}${y}°</text>`);
out.push(`<text x="${X(-90)}" y="${gy1 + 34}" font-size="11.5" fill="${C.dim}">← looking back down the line</text>`);
out.push(`<text x="${X(0)}" y="${gy1 + 34}" font-size="11.5" fill="${C.dim}" text-anchor="middle">square out of the window</text>`);
out.push(`<text x="${X(90)}" y="${gy1 + 34}" font-size="11.5" fill="${C.dim}" text-anchor="end">looking up the line →</text>`);
const pts = [];
for (let y = -90; y <= 90; y += 1) pts.push([X(y), Y(place(y))]);
for (let k = 0; k < pts.length - 1; k++) out.push(`<line x1="${pts[k][0].toFixed(1)}" y1="${pts[k][1].toFixed(1)}" x2="${pts[k + 1][0].toFixed(1)}" y2="${pts[k + 1][1].toFixed(1)}" stroke="${colour(place(-90 + k))}" stroke-width="3.5" stroke-linecap="round"/>`);
for (const [y, p] of curve) out.push(`<circle cx="${X(y)}" cy="${Y(p)}" r="3.5" fill="#fff" stroke="${C.ink}" stroke-width="1.5"/>`);
for (const [yaw] of panels) out.push(`<line x1="${X(yaw)}" y1="${gy0 - 4}" x2="${X(yaw)}" y2="${gy1 + 4}" stroke="${C.fan}" stroke-width="1" stroke-dasharray="3 4"/><circle cx="${X(yaw)}" cy="${Y(place(yaw))}" r="6" fill="${colour(place(yaw))}" stroke="#fff" stroke-width="2"/>`);
out.push('</svg>');
fs.writeFileSync(new URL('../docs/img/note-aligner.svg', import.meta.url), out.join('\n') + '\n');
console.log('wrote docs/img/note-aligner.svg');
