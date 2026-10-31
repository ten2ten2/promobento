# Trusted scene blocks

`kinetic-title` and `drawn-steps` adapt the typography and whiteboard grammars of
[huashu-motion@52467f99c602b76ba86d511d37acdfe93fa1e16e](https://github.com/alchaincyf/huashu-motion/tree/52467f99c602b76ba86d511d37acdfe93fa1e16e/runtime/clip/grammars).
Copyright © 2026 Huashu, MIT; the complete license is in [LICENSE.huashu](../film-runtime/src/LICENSE.huashu).
The port uses PromoBento's own fact-bound text slots and does not include upstream fonts, characters or demo assets.

`canvas-title` executes the upstream `y5_kinetic_type` single-line title drawing
through a scene-local stage with a separately licensed font and bound text slot;
it does not include the upstream character, fonts or demo assets.

`vox-clip` executes the upstream `y2_vox` image choreography through a scene-local clip stage.
It admits only separately cleared still images and deliberately omits upstream text, fonts and demo media;
the seven imported clip grammars and their license are described in [clip/NOTICE.md](../film-runtime/src/clip/NOTICE.md).

`device-3d` and `object-studio` use **Three.js 0.186.1**, MIT, copyright © 2010–2026 three.js authors.
The exact package and integrity are pinned in `pnpm-lock.yaml`; the distributed renderer image includes
`node_modules/.pnpm/three@0.186.1/node_modules/three/LICENSE` with the full notice.
The browser bundle retains the upstream license comments.

Sources: [Three.js r186](https://github.com/mrdoob/three.js/tree/r186),
[MIT license](https://github.com/mrdoob/three.js/blob/r186/LICENSE).
Geometry and choreography in `src/device-3d.ts` are original PromoBento work, not an imported branded device model.
Image textures still require their own verified material rights before processing.

`object-studio` adapts the procedural studio sky, curved backdrop, lights and rounded screenshot screen from
[huashu-motion@52467f99](https://github.com/alchaincyf/huashu-motion/blob/52467f99c602b76ba86d511d37acdfe93fa1e16e/runtime/three/om-three.js),
Copyright © 2026 Huashu, MIT. It consumes one separately cleared product image, retains no upstream demo assets
or author likeness, and does not expose unrestricted Three.js or the upstream GLB/SVG/HDR loaders.
