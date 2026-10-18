# Instructions for PromoBento contributors and coding agents

## Repository scope

This repository starts with PRD v1.1, configuration seeds, contract examples, and an executable repository check. Application implementation begins at M0. Read `docs/implementation-status.md` for the current distinction between specified, implemented, and verified work. Update that file as implementation proceeds; do not infer completion from a specification or a placeholder.

Requirements are written in Chinese. Product UI, accessibility labels, help, policies, errors, and generated video copy launch in English. Communicate with the user in the language used in the conversation.

## Read before implementation

1. Read `README.md` and `docs/prd/README.md`.
2. Read `docs/prd/01-product-prd.md`, `02-ux-and-flows.md`, `03-platform-presets.md`, and `10-i18n-and-themes.md` in that same directory.
3. Read the architecture, Waffo billing, testing, growth, and execution chapters (`04` through `08`). Consult `09-sources-and-decisions.md` for sources and external setup requirements.
4. Inspect the root `config/`, `locales/`, and `contracts/` inputs and `docs/implementation-decisions.md` before adding runtime packages.

Paths written as `config/...`, `contracts/...`, `locales/...`, or `docs/...` in the PRD are relative to the repository root. Markdown links are relative to their containing file.

## Requirement precedence

Follow system and developer instructions, then the user's latest explicit decisions. Within these product documents, format details are owned by chapter `03`, billing by `05`, and language and themes by `10`. Resolve and update conflicting documents together. Do not silently narrow scope because a different implementation is easier.

The root README and this file are navigation and working guidance, not a second full PRD. Prices, quotas, model choices, and performance budgets are documented product hypotheses or settings. Record authorized changes and version the corresponding policy; preserve rights already purchased.

## Preserve these product boundaries

- Use PromoBento and `promobento.com`. A selected name or a `pending` configuration field does not prove domain ownership, a working mailbox, or a production integration.
- Both initial cohorts are P0: software product teams and content teams already earning from courses, digital products, or memberships.
- Use React, TypeScript, Vite/React Router, mise/pnpm, Cloudflare, and Waffo.ai. Solve integration risks in M0 without silently substituting infrastructure or a different payment provider.
- Deliver the six specified platform presets and four layouts. Video durations are 15 or 30 seconds. Preserve the distinction between product recommendations and verified platform limits.
- Use real customer assets and confirmed facts. AI produces validated structured scenes, not executable user code or invented commercial claims. Manual editing consumes no AI generation quota.
- Provide the actual browser preview using the shared deterministic scene renderer. Paid cloud exports use the planned Chromium/FFmpeg container flow.
- Keep uploads private, tenant-scoped, validated, and immutable once referenced by a frozen version. Fixture assets and hashes are examples only.
- Billing is based on projects and finished content versions. One version includes all platform exports; re-downloads, same-version supplemental platforms, and system retries do not consume another version unit.
- Only server-verified Waffo state grants paid rights. Preserve signature validation, business idempotency, immutable purchase snapshots, the rights ledger, durable inbox/outbox, reconciliation, and refund-versus-delivery arbitration.
- After the complete initial artifact batch passes validation and the reservation, grant, and project guards pass, mark the release ready, consume its reservation, and set its publication time in the same atomic commit. Allow downloads only from the committed ready state. An extra-pack purchase defaults to `top_up_only`; it automatically starts an export only when the user explicitly chooses `purchase_and_export`. Exporting with existing credits follows the normal export flow and does not require a new checkout.
- Keep normal access expiry and media deletion separate. Preserve paid retention and refund behavior specified in chapters `01`, `04`, and `05`.
- Build i18n from P0, but the first production allowlists contain only `en` for UI and video copy. Preserve customer names, URLs, and source media. Do not expose unsupported language controls.
- Support System, Light, and Dark in P0, including persistence, SSR first paint, and cache isolation. UI theme and `uiLocale` do not alter video fingerprints or credits; video `language`, `direction`, and `videoStyle` are content snapshot fields.
- Review upstream source and asset licenses when introducing actual third-party code. The current repository contains references to huashu projects, not a vendored copy of their implementation or assets.

## Development workflow

- Start with M0 in `docs/prd/08-codex-execution.md`, then proceed through M1–M4. Use actual exit criteria rather than assumed completion or a fixed calendar.
- Create `apps/`, `packages/`, and test directories when adding their first real implementation. Keep the web preview and cloud renderer on a shared scene implementation.
- Recheck official framework, Cloudflare, and Waffo compatibility at bootstrap. The currently pinned Node/pnpm pair has been used for repository checks; that is not a claim of application or SDK compatibility. Record actual choices and lock exact versions.
- Add real migrations, environment examples, build commands, and tests as their implementation becomes concrete. Do not invent account IDs, credentials, production successes, or API methods.
- Keep secrets out of source, front-end bundles, image layers, and logs. Use Cloudflare's appropriate secret and binding mechanisms during implementation.
- If an external account or credential is missing, implement and verify the unaffected work, record the specific unresolved integration, and report the material blocker. Do not replace a live integration with a mock while claiming it is verified.
- Keep changes focused. Use meaningful verification for the behavior being changed. A document check does not satisfy billing, tenant isolation, rendering, or release gates.

## Available checks and evidence

Current executable checks:

```bash
node scripts/check-repo.mjs
pnpm run check:repo
```

`.mise.toml` exposes the same task as `mise run check:repo`. The initial environment's verification scope is recorded in `docs/evidence/repository-check.md`.

The application commands listed in PRD chapter `08` are requirements for later implementation. Do not add scripts that print success without performing the requested check. Keep production and sandbox results separate.

Record material implementation choices in `docs/implementation-decisions.md`; update `docs/implementation-status.md` and add real evidence under `docs/evidence/`. Keep secrets and private customer assets out of evidence committed to this repository.

## Completion report

For each delivery, explain what changed and why, what code actually works, the commands and environments actually used, remaining P0 work, and external checks not yet performed. Link the relevant evidence. Distinguish document checks, local mocks, test-provider checks, and real production validation.
