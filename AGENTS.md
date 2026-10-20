# PromoBento — agent guide

## Start

Read `README.md`, `docs/implementation-status.md` and `docs/prd/README.md`. For implementation read the relevant chapters from the index, including 01, 02, 03, 04, 05, 08, 09, 10, 12, 13 and 14. Chapter 08 is the only milestone sequence; chapter 14 owns cross-system contracts. Follow the actual unfinished stage, not a document version number.

## Toolchain and checks

Use mise for tools/tasks and pnpm for packages. Chapter 08 owns setup, commands and dependency policy; preserve exact pins and frozen lockfiles unless intentionally upgrading after compatibility verification. Run its affected checks and regenerate the offline reference after token/template changes.

Application build/deploy commands exist only when genuinely implemented. Report actual fallback runtime versions and missing pinned-toolchain checks; contract references are not real D1, browser, cloud, payment or video tests.

## Boundaries

- Preserve 15/30 seconds at 30 fps and existing platform target pairs. Agent-authored animation is free-form but runs only in isolated environments, never the main origin or credentialed service.
- Keep user video text unrestricted and mixed-language. Website locale/theme cannot alter output or billing. Preserve Google/email authentication, Cloudflare, Waffo and the two initial user groups.
- Use one `project_revisions` model and CAS acceptance. Freeze all legal target source variants before purchase-and-export; encode later. Creation-only purchases grant credits without a snapshot or export. Never invoke an Agent to invent a missing paid variant.
- The current product specification is v2.4 and the wire protocol is 2.4.0. Use only the catalog in `config/agent-policy.json` and chapter 05. Claim one lifetime trial per internal user across workspaces; preserve consumption through identity linking, copies, deletion and payment. Single export grants no extra AI work; upgrades grant only the entitlement difference.
- Reuse exports by `(project_id, content_hash)`, not snapshot ID alone. Preserve purchase integrity, idempotent ledgers, refunds and tenant/resource authorization; retain personal data only for the purposes and periods in chapter 04. Cloud access revocation does not itself revert copyright or revoke unrelated output licenses.
- Keep source, dependencies, fonts, audio, facts and output identities complete. Audit third-party licenses before first processing, including free previews; repository MIT does not cover every bundled asset. Resolve rights and factual evidence from trusted tenant-scoped records, and validate required AI marking against actual output bytes under chapters 09/14.
- Keep current specification sources and current request structures only. Remove superseded material together with its consumers; retain active work, immutable purchase evidence and required license provenance.

## Handoff

Run affected checks and update current implementation status without fictitious pass records. Missing external credentials do not block unrelated work; list the exact unverified integrations. Do not create routine evidence diaries or empty success scripts.

Commit completed changes directly to remote `main` unless instructed otherwise. Preserve remote work and use fast-forward updates with an expected-head check; do not rewrite Git history.
