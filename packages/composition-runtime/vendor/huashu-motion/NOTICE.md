# Adopted visual code and fonts

Sources:

- huashu-motion, https://github.com/alchaincyf/huashu-motion, commit `5f2608c2e12abcf518f74dde86093b19f7f88603`.
- Its `runtime/clip` is attributed to huashu-art-motion commit `57d6760`; original notice and MIT license are preserved in `CLIP-NOTICE.md` and `CLIP-LICENSE`.
- `fonts/` contains the same 42 WOFF files and original `LICENSES.md` / `OFL.txt`. File identities, copyright/license identities, origin and enabled weights are in `fonts/registry.json`. Fonts are OFL 1.1, not MIT. No outlines, internal names or subsets were changed here. Reserved font names and the prohibition on selling font files alone remain applicable.

PromoBento adaptations:

- `src/motion-tools.mjs`: analytic easing/spring/step/stagger/beat functions from `clip/lib/motion.js`; absolute 2D camera math from `camera.js`; arc-length paths, shape interpolation and handwriting from `diagram.js`; Catmull–Rom, resampling and ribbon math from `kit.js`; numeric/text layout idioms from `typo.js`. Browser globals, stage mutation, history and original motion blur were removed.
- Seven command-output components adapt the building blocks/composition grammar of `t1_3b1b`, `t2_keynote_ui`, `t3_finance_chart`, `y1_kurzgesagt`, `y2_vox`, `y3_whiteboard`, `y5_kinetic_type` and `lib/{ui,chart,diagram,collage,typo}`. They are composable, parameterized building blocks, not copied finished films. Source material and captions must still be supplied with approved facts/rights.
- `src/command-painter.mjs`: seeded mulberry32, Perlin/fbm paper, grain, source-colour sampling, halftone, mosaic and brush algorithms from `util.js`, `paint.js`, `collage.js`; bounded tiles, processing resolutions and LRU caches replace full-screen arbitrary buffers and feedback. It accepts validated data in the trusted painter only.
- Text now uses the same selected-face WOFF metrics and glyphs in host validation and browser painting, explicit multiline layout, affine ink bounds and safe-area checks. Italic faces have distinct registered IDs; variable fonts expose only their metric-compatible default instance.

Not adopted: `toon.js`/the author's likeness, storytime character or demo assets, GSAP, native HTML/DOM execution, system fonts, complete 3D/WebGL, old history compensation/motion blur, or unrelated art-motion character rig assets. MIT licenses do not cover third-party fonts or these excluded materials.
