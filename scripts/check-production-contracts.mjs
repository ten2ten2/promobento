import { load, semanticErrors, schema, validateSchema, digest, contentIdentity, targets } from './contract-validation.mjs';
import { readFileSync } from 'node:fs';
const c = load('contracts/composition.example.json');
const snapshot=load('contracts/release-snapshot.example.json'), facts=load('contracts/fact-manifest.example.json');
const examples = ['composition', 'release-snapshot', 'edit-request', 'fact-manifest', 'export-manifest'];
let failures = [];
for (const name of examples) failures.push(...semanticErrors(load('contracts/' + name + '.example.json'), {composition: c, snapshot, factManifest:facts}).map(e => name + ': ' + e));
for (const [name, value] of Object.entries(load('tests/contracts/protocol-fixtures.json').valid)) failures.push(...validateSchema(value).map(e => name + ': ' + e));
const routes = load('config/routes.json'), api = load('contracts/agent-api.json');
const signatures = new Set();
for (const r of routes.routes) {
  const signature = r.method + ' ' + r.path.replace(/:[A-Za-z][A-Za-z0-9]*/g, ':param');
  if (signatures.has(signature)) failures.push('duplicate route shape: ' + r.id);
  signatures.add(signature);
}
for (const a of api.endpoints) {
  const r = routes.routes.find(r => r.id === a.routeId);
  if (!r || r.path !== a.path || r.method !== a.method || r.auth !== a.auth) failures.push('API/route mismatch: ' + a.routeId);
  for (const ref of [a.requestDef, a.responseDef].filter(Boolean)) if (!schema.$defs[ref]) failures.push('missing API schema: ' + ref);
}
const architecture = readFileSync(new URL('../docs/prd/04-architecture-and-data.md', import.meta.url),'utf8');
const rows=[...architecture.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE|HEAD) (\/api\/[^`]+)` \|/gm)].map(m=>m[1]+' '+m[2]).sort();
const registered=routes.routes.filter(r=>r.kind==='api').map(r=>r.method+' '+r.path).sort();
if(JSON.stringify(rows)!==JSON.stringify(registered))failures.push('API registry/PRD mismatch');
const pageSection=readFileSync(new URL('../docs/prd/02-ux-and-flows.md',import.meta.url),'utf8').split('## 2 首页与首次进入')[0];
const pages=[...new Set(pageSection.split('\n').filter(l=>l.startsWith('| ')).flatMap(l=>[...(l.split('|')[1]??'').matchAll(/`(\/[^`]*)`/g)].map(m=>m[1])))].sort();
if(JSON.stringify(pages)!==JSON.stringify(routes.routes.filter(r=>r.kind!=='api').map(r=>r.path).sort()))failures.push('Page registry/PRD mismatch');

if (routes.routes.some(r => /\/(storyboards|rewrites)$/.test(r.path))) failures.push('retired template routes remain');
const policy = load('config/agent-policy.json');
if (policy.quota.project_v1.priceMinor !== 3900 || policy.quota.extra_versions_v1.priceMinor !== 1200) failures.push('price changed');
if (policy.quota.project_v1.versionUnits !== 3 || policy.quota.extra_versions_v1.versionUnits !== 3) failures.push('version rights changed');
if (policy.enabled && Object.values(policy.cost).some(v => v === null)) failures.push('uncalibrated model/cost gate enabled');
if (targets().length !== 7 || policy.limits.globalContainers !== 4) failures.push('preset/resource invariants');
for (const [file, pattern] of [
  ['docs/prd/13-agent-native-production.md', /首发生成视频文案仍是英语/],
  ['docs/prd/04-architecture-and-data.md', /不接收任意用户代码|拒绝未经模板定义的文件访问/],
  ['docs/prd/10-i18n-and-themes.md', /\| `videoStyle` \| `clean` 或 `bold`/]
]) {
  const text = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  if (pattern.test(text)) failures.push('legacy constraint: ' + file);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Production contract checks passed: schema fixtures, 7 target pairs, API routing, quota/policy and stale-rule guards. Scope: specification only; no live app/cloud/payment/render test.');
