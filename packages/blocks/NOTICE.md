# Trusted scene blocks

`kinetic-title` and `drawn-steps` adapt the typography and whiteboard grammars of
[huashu-motion@52467f99c602b76ba86d511d37acdfe93fa1e16e](https://github.com/alchaincyf/huashu-motion/tree/52467f99c602b76ba86d511d37acdfe93fa1e16e/runtime/clip/grammars).
Copyright © 2026 Huashu, MIT; the complete license is in [LICENSE.huashu](../film-runtime/src/LICENSE.huashu).
The port uses PromoBento's own fact-bound text slots and does not include upstream fonts, characters or demo assets.

`device-3d` uses **Three.js 0.186.1**, MIT, copyright © 2010–2026 three.js authors.
The exact package and integrity are pinned in `pnpm-lock.yaml`; the distributed renderer image includes
`node_modules/.pnpm/three@0.186.1/node_modules/three/LICENSE` with the full notice.
The browser bundle retains the upstream license comments.

Sources: [Three.js r186](https://github.com/mrdoob/three.js/tree/r186),
[MIT license](https://github.com/mrdoob/three.js/blob/r186/LICENSE).
Geometry and choreography in `src/device-3d.ts` are original PromoBento work, not an imported branded device model.
Image textures still require their own verified material rights before processing.
