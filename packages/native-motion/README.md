# Native motion adapter

This package executes the complete pinned huashu-motion project contract. `index.html` and local project files are the creative source; the SaaS manifest only transports verified files and states product output limits.

- `prepareNativeProject(directory, manifest)` checks file identity, installs missing pinned native libraries, validates root dimensions/duration, and runs the upstream source check.
- `previewNativeProject(prepared, composition, times?)` uses upstream Chrome capture, returning PNGs, exact times, native browser metadata and page errors.
- `renderNativeProject(prepared, composition, out, onLog?)` runs upstream runtime refresh, soundtrack preparation, full-video renderer and mix. One browser worker is used initially.
- `editNativeProject(directory, {html | values, baseToken, label?})` uses native optimistic writes and history.

Every Node import comes from trusted application/upstream code. Author HTML/JS only executes in sandboxed Chromium. The container controller owns broker authorization; this package never receives a bearer or calls a model.

`upstream.lock.json` pins 315 upstream blobs at huashu-motion commit `52467f99c602b76ba86d511d37acdfe93fa1e16e`. `scripts/verify-upstream.mjs <directory>` verifies the extraction; `scripts/apply-cloud-patch.mjs <directory>` applies six checked CLI adaptations (virtual project origin, timeline validation, media confinement and restricted demuxers) plus one trusted helper. The seven adapted file hashes are verified before use. The animation engine itself is unchanged. The image retains upstream templates, fonts, examples, CLI and local Studio, without exposing Studio as a SaaS endpoint or injecting upstream personal imagery into customer films.

See the [container interface and verification](../../apps/render-container/README.md) for job outputs, deployment boundaries and real browser smoke commands.
