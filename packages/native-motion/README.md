# Native motion adapter

This package executes the complete pinned huashu-motion project contract. `index.html` and local project files are the creative source; the SaaS manifest only transports verified files and states product output limits.

- `prepareNativeProject(directory, manifest)` checks file identity, installs missing pinned native libraries, validates root dimensions/duration, and runs the upstream source check.
- `previewNativeProject(prepared, composition, times?)` uses upstream Chrome capture, returning PNGs, exact times, native browser metadata and page errors.
- `renderNativeProject(prepared, composition, out, onLog?)` runs upstream runtime refresh, soundtrack preparation, full-video renderer and mix. One browser worker is used initially.
- `editNativeProject(directory, {html | values, baseToken, label?})` uses native optimistic writes and history.

Every Node import comes from trusted application/upstream code. Author HTML/JS only executes in sandboxed Chromium. The container controller owns broker authorization; this package never receives a bearer or calls a model.

`upstream.lock.json` records all 315 original files from huashu-motion commit `52467f99c602b76ba86d511d37acdfe93fa1e16e`. `scripts/verify-upstream.mjs <directory>` verifies a fresh complete source extraction. `scripts/apply-cloud-patch.mjs <directory>` then applies exact checked adaptations to six CLI files: a project-only virtual HTTP origin instead of file pages, native timeline length checks, media path confinement and restricted FFmpeg demuxers. A trusted helper is copied alongside them; all seven adapted files are hashed in the installation marker and checked before use. The native animation engine is unchanged. The Docker image preserves all upstream templates, fonts, examples, CLI, Studio and method references; it does not publish the local Studio as a SaaS API.

See the [container interface and verification](../../apps/render-container/README.md) for job outputs, deployment boundaries and real browser smoke commands.
