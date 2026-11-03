# Web

React Router SSR pages and the streaming gateway to Core's named `CoreApi` entrypoint. Web has only `ASSETS` and `CORE_API` bindings; identity, permissions, storage and provider credentials belong to Core.

## Current scope

`/`, `/formats` and `/help` render public HTML and hydrate in the browser. The pages use the brand, platform, font and theme configuration. Each request has its own i18next instance; SSR and hydration start in English with UTC formatting. System light/dark styling works before JavaScript loads. Theme preference writes are a later API. `/robots.txt` prevents indexing while the product is in development; `/sitemap.xml` includes only these implemented pages. The policy files remain unpublished drafts.

The route specification is [config/routes.json](../../config/routes.json); the enabled route IDs are [config/implemented-routes.json](../../config/implemented-routes.json). The PR1 API list is empty. Adding a business API requires its Core handler, contract and tests before adding its ID. Unknown or unimplemented APIs return 404; unsupported methods on enabled routes return 405 with `Allow`.

The gateway preserves request bodies as streams, including original webhook bytes. It forwards opaque cookies, Origin, CSRF proofs, business `Idempotency-Key` and Cloudflare's client IP; it strips client-supplied actor and proxy hints. `x-request-id` is a separate sanitized/generated correlation ID, never an idempotency key. Core checks the proofs and decides identity itself. Responses preserve redirects and separate `Set-Cookie` headers. The gateway never retries a failed mutation. The public page manifest and brand asset allowlist exclude planned private paths and `/brand/README.md` from responses.

## Build and run

From the repository root, after [setup](../../AGENTS.md):

```bash
pnpm --filter @promobento/web build
pnpm --filter @promobento/web typecheck
pnpm --filter @promobento/web dev
```

The build produces the Worker at `build/worker/index.js` and static assets at `build/client`. React Router builds the server and client; the final esbuild step bundles the server with the Worker gateway. `dev` runs this build in local workerd. Rebuild after source changes. The shared multi-Worker tests exercise Web, Core and Preview together; they do not need provider credentials.

`test/ssr.render.test.mjs` runs only in `test:web-browser` / the existing pinned browser CI image, not in `test:saas-local`. It checks hydration under CSP, client navigation, self-hosted fonts, desktop/light and mobile/dark layout, and HTML without JavaScript. It requires the pinned Chrome path through `PROMOBENTO_EVAL_CHROME_PATH` and does not download a browser.

[wrangler.jsonc](wrangler.jsonc) names the staging and production Core bindings. It does not register domains or expose a workers.dev endpoint. Real domain/TLS and deployment checks remain part of G1a in [PRD 08](../../docs/prd/08-codex-execution.md).
