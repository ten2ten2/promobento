# PromoBento — agent guide

## Start here

- Read `README.md` and `docs/implementation-status.md`; use `docs/prd/README.md` to find requirements relevant to the task.
- For initial application implementation, read PRD chapters 01, 04, 08 **and 13**, plus `docs/v2.2-CODEX_START.md`, then continue from the current unfinished milestone.
- Chapter 03 owns export formats, 05 billing, 10 localization/themes, 11 UI design, 12 URI/authentication, and **13 free-source Composition / Director / ABC audio / video QA / Agent Studio** rules. Apply the user's latest explicit decisions and keep related specifications consistent.
- Code-style paths in the PRD are relative to the repository root; Markdown links are relative to their containing file.

## Toolchain

- Use mise for tool versions and project tasks, and pnpm for packages. The agreed application stack is React/TypeScript, Cloudflare, and Waffo.
- At bootstrap or an intentional dependency change, select the latest stable release compatible with the target deployment platform and the other dependencies.
- Follow `docs/dependency-policy.md`; record concrete compatibility exceptions. Pin resolved versions in `.mise.toml` and commit generated lockfiles.
- Normal installs reproduce the lockfiles; unrelated edits do not trigger automatic dependency upgrades.

## Commands

```bash
mise trust
mise install
mise run install
mise run check:repo
mise run check:ui-reference
```

Application commands in PRD chapter 08 are implementation targets. Add their mise tasks with real implementations.

## Code and product boundaries

- Follow existing module boundaries and `.editorconfig`; keep shared contracts and configuration authoritative in one place.
- Treat executable Composition source as video truth; allow freely Agent-authored animations **only in isolated sandboxes**. Share deterministic frame seeking between preview and render. Do not hardcode scene/style enums. Videos must be 15/30s @30fps using existing platform presets. Website UI locale/theme is separate; user video copy may mix languages.
- Preserve tenant isolation, immutable snapshots, server-verified payment rights, and idempotent billing; chapter 05 defines the exact transaction rules.
- Validate external input at application boundaries. Keep credentials and private customer assets out of source, bundles, logs, and committed evidence.
- Check applicable licenses when introducing third-party code or assets. Pin huashu-motion adoption to an audited commit; GSAP, samples, fonts and author character have separate restrictions. Keep generated JS off the main origin and do not expose secrets or cross-tenant assets. Keep detailed business rules in the PRD rather than duplicating them here.

## Verification and handoff

- Run the checks affected by the change through mise. Separate local checks from Cloudflare build, workerd, container, and payment-provider verification.
- When an external account or credential is missing, continue unaffected work and identify the integration that remains unverified.
- Update implementation status and material decisions when they change. Report the changes, checks actually run, and remaining limitations.
- Commit completed changes directly to remote `main` unless the user requests another target; use fast-forward updates and preserve existing remote work.
