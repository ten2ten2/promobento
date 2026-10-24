// Reuse an already deployed image only when all renderer inputs are unchanged.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {assertRendererPolicyCompatible} from './renderer-policy.mjs';
const {GITHUB_ACTIONS,RENDERER_SHA,RENDERER_DIGEST,CLOUDFLARE_ACCOUNT_ID,WORKER_CONFIG}=process.env;
if(GITHUB_ACTIONS!=='true'||!/^sha256:[a-f0-9]{64}$/.test(RENDERER_DIGEST??'')||!/^([a-f0-9]{40})$/.test(RENDERER_SHA??'')
 ||!/^([a-f0-9]{32})$/.test(CLOUDFLARE_ACCOUNT_ID??'')||!WORKER_CONFIG)throw Error('RENDERER_REUSE_SCOPE_INVALID');
execFileSync('git',['merge-base','--is-ancestor',RENDERER_SHA,'HEAD']);
execFileSync('git',['diff','--quiet',RENDERER_SHA,'HEAD','--','apps/render-container','packages','contracts','config','tests/attacks/film-v1',
 'scripts/build-film-runtime.mjs','scripts/build-render-fonts.mjs','package.json','apps/cloud/package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.mise.toml','.dockerignore',
 ':(exclude)apps/render-container/README.md',':(exclude)config/model-providers.json',':(exclude)config/model-authorization.json',
 ':(exclude)config/agent-policy.json',':(exclude)contracts/model-config.schema.json',':(glob,exclude)packages/**/test/**/*.test.mjs']);
// The runtime does not import model providers/authorizations. For the shared policy, permit
// only a catalog label or model-only director step change; operation/compute budgets, limits and every rendering field stay protected.
// model-config's validator is consumed by the Worker, not the renderer's task/film validators.
assertRendererPolicyCompatible(parseCanonicalJson(execFileSync('git',['show',RENDERER_SHA+':config/agent-policy.json'])),
 parseCanonicalJson(readFileSync('config/agent-policy.json')));
const config=parseCanonicalJson(readFileSync('apps/cloud/wrangler.jsonc','utf8').replace(/^\/\/.*\n/,''));
config.main=resolve('apps/cloud/src/index.ts');
for(const env of Object.values(config.env))for(const db of env.d1_databases??[])db.migrations_dir=resolve('apps/cloud',db.migrations_dir);
config.env.staging.containers[0].images.render={image:`registry.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID}/promobento-staging-sharddo-render@${RENDERER_DIGEST}`};
writeFileSync(WORKER_CONFIG,canonical(config));
writeFileSync('artifacts/staging/renderer-reuse.json',canonical({rendererSourceSha:RENDERER_SHA,imageDigest:RENDERER_DIGEST,scope:'unchanged_renderer_inputs_worker_only_deploy'}));
