# PromoBento — agent guide

## Start

Read `README.md`, `docs/implementation-status.md` and `docs/prd/README.md`, then the chapters relevant to the task. The current product specification is v2.5 and the protocol is 2.5.0. Chapter 08 owns the implementation sequence; chapter 14 owns cross-system contracts. Follow the actual unfinished stage.

## Toolchain and checks

Use mise for tools/tasks and pnpm for packages. Follow chapter 08, preserve exact pins and frozen lockfiles, and run affected checks. Regenerate the offline Studio after its inputs change. CI runs repository and contract checks for `main` pushes and pull requests.

Import canonical JSON, hashing, identities and the full Ajv validator from `packages/contracts`; do not copy implementations into services. Parse original JSON text/bytes with `parseCanonicalJson` before validation. Runtime authors use `contracts/composition-runtime.d.ts`; trusted hosts use `contracts/render-protocol.d.ts`.

Add application commands when their implementations exist. Report actual tools and unrun checks. Contract tests and a CI workflow do not establish real rendering, D1, cloud, email or payment behavior.

## Boundaries

- Preserve 15/30 seconds at 30 fps and existing platform target pairs. Agent-authored animation is free-form but runs only in isolated environments, never the main origin or credentialed service.
- Keep user video text unrestricted and mixed-language. Website locale/theme cannot alter output or billing. Preserve Google/email authentication, Cloudflare, Waffo and the two initial user groups.
- Use one `project_revisions` model and CAS acceptance. Freeze all legal target source variants before purchase-and-export; encode later. Creation-only purchases grant credits without a snapshot or export. Never invoke an Agent to invent a missing paid variant.
- Use the catalog in `config/agent-policy.json` and chapter 05. Claim one lifetime trial per internal user across workspaces; linking, copies, deletion and payment do not reset consumption. Single export grants no extra AI work; upgrades grant only the entitlement difference.
- Reuse exports by `(project_id, content_hash)`, not snapshot ID alone. Preserve purchase integrity, idempotent ledgers, refunds and tenant/resource authorization; retain personal data only for the purposes and periods in chapter 04. Cloud access revocation does not itself revert copyright or revoke unrelated output licenses.
- Freeze source, dependencies, resources, facts, the actual mixed WAV and the selected render profile. Public seeking uses integer frames; subframe sampling belongs to trusted Renderer sessions. Bind Q0/Q1 to exact inputs and approved checker policy, and Q2 to actual output bytes. QA, marking or sampling policy changes alone do not consume another video version.
- Audit asset rights before first processing, including free previews. Repository MIT does not cover every bundled asset. Resolve rights and factual evidence from trusted tenant-scoped records, and verify applicable AI marking on actual output bytes under chapters 09/14.
- Maintain current specifications and request structures. Remove superseded material and its consumers while preserving required asset provenance, user versions and purchase evidence.

## Handoff

Run affected checks and update current implementation status without fictitious pass records. Missing external credentials do not block unrelated work; list the exact unverified integrations. Do not create routine evidence diaries or empty success scripts.

Commit completed changes directly to remote `main` unless instructed otherwise. Preserve remote work and use fast-forward updates with an expected-head check; do not rewrite Git history.
