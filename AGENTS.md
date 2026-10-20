# PromoBento — agent guide

## Start here

- Read `README.md` and `docs/implementation-status.md`; use `docs/prd/README.md` to find task-specific requirements.
- For application implementation, read 01, 04, 08, 13 and **14**, plus `docs/v2.2-CODEX_START.md`. Continue from the actual unfinished milestone, not the highest document version.
- 03 owns output formats, 05 billing/refunds, 10 website language/themes and unrestricted mixed-language video text, 11 UI, 12 authentication/URI, 13 creative methods, and 14 cross-system contracts. Keep related specifications consistent.
- Code-style paths in PRDs are repository-root relative; Markdown links are relative to the containing file.

## Toolchain

- Use mise for tool versions/tasks and pnpm for packages. Retain React/TypeScript, Cloudflare and Waffo.
- At bootstrap or intentional dependency updates, choose current stable versions **within deployment and dependency compatibility bounds**, then pin exact versions and commit generated lockfiles. Follow `docs/dependency-policy.md`.
- Normal installs reproduce the lockfile. Unrelated edits do not upgrade dependencies or replace pins with whatever is installed locally.

## Commands

```bash
mise trust
mise install
mise run install
mise run check:repo
mise run check:contracts
mise run test:contracts
mise run check:ui-reference
mise run check:agent-reference
```

Application build/test/deploy commands in08 are targets until real implementations exist. Contract reference tests are not runtime D1, browser isolation, payment or video tests.

## Product and code boundaries

- Composition source is video truth. Allow Agent-authored custom animation **only in isolated execution environments**; share deterministic frame logic between preview and render. Do not hardcode scene/style/animation enums.
- Keep output strictly15/30 seconds at30fps, using existing six platform presets. Website locale/theme never changes video text, frames or billing. User video copy may mix languages.
- Use one `project_revisions` identity and guarded draft-pointer updates. Freeze **all legal preset/aspect source variants before payment**, encode later, and never invoke an Agent to invent a missing paid variant.
- Preserve tenant isolation, immutable snapshots, existing Google+email authentication, server-verified payment rights, idempotent ledgers and refund protections.14 defines creative-operation metering;05 retains purchased entitlements.
- Validate external inputs, resources and long-running permissions server-side. No platform/payment/model secrets in generated code, browser previews, images, logs or evidence.
- Audit third-party code/assets separately. Pin reviewed huashu-motion adoptions; GSAP, fonts, samples and the author character are not automatically covered by a repository MIT license.

## Verification and handoff

- Run affected checks through mise and report the actual environment. If pinned tools are unavailable, state which compatible local checks ran and which did not; never claim the full toolchain passed.
- Keep application progress distinct from documentation/schema/reference tests. M0b requires real Cloudflare capability, recovery and isolation evidence; local PoC does not satisfy that gate.
- Missing external credentials do not block unrelated work. Report the specific unverified integrations.
- Update meaningful decisions/status without creating routine evidence diaries. Preserve existing source files and remote changes.
- Commit completed changes directly to remote `main` unless directed otherwise; use fast-forward updates with an expected-head check.
