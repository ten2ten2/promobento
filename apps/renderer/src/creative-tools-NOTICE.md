# Creative diagnostics attribution

`creative-diagnostics.mjs` adapts the motion heuristics and palette comparison ideas from Huashu's `cli/lib/qa.js` and `cli/lib/swatch.js`, revision `5f2608c2e12abcf518f74dde86093b19f7f88603` of [huashu-motion](https://github.com/alchaincyf/huashu-motion). Copyright (c) 2026 Huashu, [MIT license](creative-tools-LICENSE.txt).

PromoBento bounds decoding to 900 frames at 96 × 54, runs fixed FFmpeg in the capture container and binds results to the encoded video's identity. Findings are editorial review cues, not automatic rejection or factual verification. Still holds and hard cuts can be intentional. Palette comparisons use explicit swatches; they do not infer text/background roles.

`ordered-capture.mjs` and `edit-evidence.mjs` are PromoBento implementations. Parallel capture uses one or two isolated browser contexts, bounded in-flight frames and ordered encoding. Edit evidence decodes an already saved MP4 inside the fixed container; it never reruns the creative source on the host.
