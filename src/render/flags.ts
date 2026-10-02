// Debug/quality switches from the URL, e.g. ?q=low or ?noshadow&plain.
const p = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const FLAGS = {
  shadows: !p.has('noshadow'),
  physSky: !p.has('nosky'),
  procedural: !p.has('plain'),
  env: !p.has('noenv'),
  /** Ambient occlusion: on by default with WebGPU; ?ao forces it on, ?noao off. */
  ao: p.has('ao') ? true : p.has('noao') ? false : undefined as boolean | undefined,
};
