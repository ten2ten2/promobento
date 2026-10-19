# Changelog

## 2026-10-19 — Icon theme toggle and remembered choice

- Replaced the three-option header selector with a sun/moon action button: follow the system initially, then remember explicit Light/Dark choices after a click.
- Kept a Use device setting reset in Appearance and retained the production Cookie, SSR and cache contract, including ordered preference saves.
- Updated the offline reference with isolated browser-only preference memory and preserved the existing visual design and video samples.
- Synchronized the specification and English action labels; recorded the scope of the targeted validation.

## 2026-10-19 — UI specification and visual reference

- Added PRD 11 and advanced the specification set to v1.2, fixing visual direction, typography, spacing, components and responsive layouts.
- Selected shadcn/ui with Base UI, Tailwind CSS, Lucide and Inter for the future application, following the existing compatibility and version-locking policy.
- Added shared UI tokens, expanded Light/Dark interaction colors and included an offline four-page reference generated from its template and tokens.
- Added real mise generation/check tasks and updated repository checks, handoff instructions and evidence without marking application milestones complete.

## 2026-10-19 — Scope localization to the website

- Clarified that multilingual architecture and the English-first launch apply to the website interface.
- Removed the English-only video restriction and language-selection or detection-confirmation prerequisites; user copy can freely mix languages.
- Kept user text separate from website translation resources, with ordinary generation and editing preserving the original language mix.
- Updated PRD, website-only localization seeds, UI messages and repository checks; retained existing billing and immutable output rules.

## 2026-10-19 — Concise agent guidance and mise toolchain

- Shortened AGENTS.md to task navigation, development rules, essential invariants, and the agreed direct-main workflow.
- Made mise the standard tool and task entry point, with a real frozen dependency-install task.
- Updated toolchain targets to Node 26.12.0 and pnpm 12.14.0, using mise 2026.10.13.
- Defined deployment support and dependency compatibility as prerequisites for choosing the latest stable release.
- Separated local tool checks from Workers Builds, workerd, and Container verification; updated repository onboarding for the existing GitHub remote.

## 2026-10-19 — Repository packaging of PRD v1.1

- Organized the full specification under `docs/prd/` and retained a single root copy of every JSON seed and contract example.
- Added the root README, AGENTS.md, onboarding instructions, implementation status, and decision/evidence records.
- Added executable repository checks, exact documentation-tool pins, an actual package-manager lockfile, and Git/editor defaults.
- Updated PRD navigation and distinguished current checks from future application commands.
- Preserved product scope, billing rules, platform defaults, English launch, and System/Light/Dark requirements.

This entry records repository preparation. Application milestones M0–M4 have not been implemented by this packaging change.
