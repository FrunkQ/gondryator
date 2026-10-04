# Third-party notices

The Gondryator's own code is public domain under [The Unlicense](LICENSE). It is built on other people's generous work, which keeps its own licence and is credited here with thanks.

## Code included in the app

| What | Used for | Licence |
|---|---|---|
| [three.js](https://threejs.org) © 2010-2026 three.js authors | The 3D engine: WebGPU/WebGL rendering, TSL node materials, post-processing (bloom, after-image, GTAO), the physical sky (`SkyMesh`), `RoomEnvironment`, `BufferGeometryUtils` | MIT, [full text](licenses/three.js-MIT.txt) |
| [MaterialX](https://github.com/AcademySoftwareFoundation/MaterialX) noise functions, © Contributors to the MaterialX Project (Academy Software Foundation), as ported to TSL inside three.js | Perlin and Worley noise behind the procedural textures (`mx_noise_float`, `mx_worley_noise_float`) | Apache 2.0, [full text](licenses/MaterialX-Apache-2.0.txt) |
| [Basic Pitch](https://github.com/spotify/basic-pitch-ts) © 2022 Spotify AB, code and trained model | "Deep listen": transcribes the melody and bass into notes in a background worker (`src/analysis/deep.worker.ts`; the model is in `public/models/basic-pitch/`) | Apache 2.0, [full text](licenses/Apache-2.0.txt) |
| [TensorFlow.js](https://www.tensorflow.org/js) © Google LLC | Runs the Basic Pitch model in the browser (WebGL or plain JavaScript) | Apache 2.0, [full text](licenses/Apache-2.0.txt) |
| [@tonejs/midi](https://github.com/Tonejs/Midi) and [midi-file](https://github.com/carter-thaxton/midi-file) | Pulled in by Basic Pitch (its MIDI export); unused by the app | MIT |

Deep listen's code only loads when it runs, as a separate file next to the page. The standalone build leaves it out.

The standalone build (one HTML file) carries both licence texts in a comment at the end of the file.

## Tools used to build it (not shipped in the app)

TypeScript (Apache 2.0), Vite (MIT), vite-plugin-singlefile (MIT), esbuild (MIT) and Playwright (Apache 2.0, for the headless tests).

## Ideas and research we lean on

No code from these is included; they are credited because the app would not exist without them.

- **Michel Gondry**, whose videos for The Chemical Brothers' *Star Guitar* (2002) and Daft Punk's *Around the World* (1997) are the whole inspiration. All scenery here is original; the songs and videos belong to their makers.
- **YIN pitch detection**: A. de Cheveigné and H. Kawahara, "YIN, a fundamental frequency estimator for speech and music", JASA 2002.
- **Spectral-flux onset detection** and **dynamic-programming beat tracking**, after J. P. Bello et al. (2005) and D. P. W. Ellis (2007).
- **Cosine colour palettes**, after Inigo Quilez.
- **Daylight sky model** in three's `SkyMesh`: A. J. Preetham, P. Shirley and B. Smits, "A Practical Analytic Model for Daylight", SIGGRAPH 1999.
