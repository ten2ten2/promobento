#!/usr/bin/env node
// Repository consistency only. No runtime auth, D1, Cloudflare, payment or render test.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const failures=[], counts={documents:0,links:0,routes:0,apis:0,contrastPairs:0};
const expect=(ok,msg)=>{if(!ok)failures.push(msg);};
const text=p=>readFileSync(join(root,p),'utf8');
const json=p=>JSON.parse(text(p));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const get=(o,k)=>k?.split('.').reduce((v,p)=>v?.[p],o);
function walk(p){return readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isSymbolicLink()?[]:e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);}
function noCode(s){let fence=null;return s.split('\n').filter(l=>{const m=l.match(/^\s*(`{3,}|~{3,})/);if(m){if(!fence)fence=m[1];else if(fence[0]===m[1][0]&&m[1].length>=fence.length)fence=null;return false;}return !fence;}).map(l=>l.replace(/`[^`]*`/g,'')).join('\n');}
function links(file){for(const m of noCode(readFileSync(file,'utf8')).matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)){const t=m[1].replace(/^<|>$/g,'');expect(!/^(sandbox|file):/.test(t),'Non-portable link: '+t);if(/^[a-z][\w+.-]*:/i.test(t)||t.startsWith('//'))continue;const p=t.split(/[?#]/)[0];if(!p)continue;const dest=resolve(dirname(file),decodeURIComponent(p)),rel=relative(root,dest);expect(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep),'Link escapes repo: '+t);expect(existsSync(dest),'Missing link '+relative(root,file)+' -> '+t);counts.links++;}}
function flatten(o,p='',out={}){for(const [k,v]of Object.entries(o)){const key=p?p+'.'+k:k;if(typeof v==='string')out[key]=v;else if(v&&typeof v==='object'&&!Array.isArray(v))flatten(v,key,out);else failures.push('Invalid message '+key);}return out;}
function lum(hex){if(!/^#[0-9a-f]{6}$/i.test(hex??''))throw Error('Invalid color '+hex);const x=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return x[0]*.2126+x[1]*.7152+x[2]*.0722;}
function main(){
 const prds=['README.md','01-product-prd.md','02-ux-and-flows.md','03-platform-presets.md','04-architecture-and-data.md','05-waffo-billing.md','06-testing-and-release.md','07-growth-and-experiments.md','08-codex-execution.md','09-sources-and-decisions.md','10-i18n-and-themes.md','11-ui-design-spec.md','12-routing-and-auth.md','13-agent-native-production.md','14-production-contracts.md'];
 for(const p of prds)expect(existsSync(join(root,'docs/prd',p)),'Missing PRD '+p);counts.documents=prds.length;
 for(const p of ['README.md','AGENTS.md','.mise.toml','package.json','pnpm-lock.yaml','docs/implementation-status.md','docs/implementation-decisions.md','contracts/production.schema.json','contracts/agent-api.json','config/agent-policy.json','config/input-capabilities.json'])expect(existsSync(join(root,p)),'Missing '+p);
 // Do not scan dependencies or generated runtime trees.
 const md=[...readdirSync(root).filter(p=>p.endsWith('.md')).map(p=>join(root,p)),...walk(join(root,'docs')),...walk(join(root,'.github'))].filter(p=>extname(p)==='.md');md.forEach(links);
 const brand=json('config/brand.json'),locale=json('config/localization.json'),themes=json('config/theme-tokens.json'),ui=json('config/ui-tokens.json'),platforms=json('config/platform-presets.json'),rs=json('config/routes.json'),auth=json('config/auth.json'),messages=json('locales/en.json'),pkg=json('package.json');
 expect(brand.brandName==='PromoBento'&&brand.appUrl==='https://promobento.com','Brand changed');
 expect(locale.scope==='website_ui'&&same(locale.supportedUiLocales,['en']),'UI locale scope');
 expect(!Object.hasOwn(locale,'supportedVideoLanguages')&&!Object.hasOwn(locale,'defaultVideoLanguage'),'Video language allowlist forbidden');
 expect(locale.uiLanguages?.en?.resourceFile==='locales/en.json'&&locale.selection?.showUiLanguageSwitcher===false,'UI resource/switcher');
 expect(same(themes.preferences,['system','light','dark'])&&themes.defaultPreference==='system'&&themes.cssVariablePrefix!==themes.videoCssVariablePrefix,'Theme/video separation');
 expect(ui.scope==='website_ui'&&ui.reference?.productionFeature===false,'UI reference not production');
 for(const p of [ui.sourceDocument,ui.library?.dependencyPolicy,ui.reference?.template,ui.reference?.output,ui.reference?.generator])expect(typeof p==='string'&&existsSync(join(root,p)),'UI source missing '+p);
 expect(ui.controls?.height>=ui.controls?.touchTargetMin&&ui.controls?.iconButtonSize>=ui.controls?.touchTargetMin,'UI touch targets');
 for(const [name,theme]of Object.entries(themes.themes)){
  for(const [alias,key]of Object.entries(ui.themeTokenMap??{}))expect(typeof theme.colors[key]==='string',name+' unresolved '+alias);
  for(const rule of themes.contrastRules)for(const bg of rule.backgrounds){const a=lum(theme.colors[rule.foreground]),b=lum(theme.colors[bg]);expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=rule.minimum,name+' contrast '+rule.foreground+'/'+bg);counts.contrastPairs++;}
 }
 const flat=flatten(messages);for(const k of Object.keys(flat))if(k.endsWith('_one'))expect(typeof flat[k.slice(0,-4)+'_other']==='string','Missing plural '+k);
 expect(rs.status==='prd_seed'&&auth.status==='prd_seed','Seeds cannot claim deployment');
 const routes=rs.routes,byId=new Map(routes.map(r=>[r.id,r])),shapes=new Set();counts.routes=routes.length;
 expect(byId.size===routes.length,'Duplicate route ID');
 for(const r of routes){expect(/^[a-z][a-z0-9_.]*$/.test(r.id),'Route ID '+r.id);expect(r.path==='/'||/^\/(?:[a-z0-9.-]+|:[A-Za-z][A-Za-z0-9]*)(?:\/(?:[a-z0-9.-]+|:[A-Za-z][A-Za-z0-9]*))*$/.test(r.path),'Route path '+r.path);expect(!r.path.split('/').some(p=>p==='.'||p==='..'),'Dot route');expect(['page','redirect','resource','api'].includes(r.kind)&&['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(r.method),'Route kind/method');expect(typeof rs.authPolicies[r.auth]==='string','Unknown auth policy');expect(['index','noindex','not_applicable'].includes(r.indexing),'Unknown index policy');expect(r.kind==='api'?r.path.startsWith('/api/'):r.method==='GET'&&!r.path.startsWith('/api/'),'Namespace mismatch');expect(r.indexing!=='index'||r.kind==='page'&&r.auth==='public','Private indexed page');expect(r.auth==='public'||r.indexing==='noindex','Protected route indexed');expect(r.kind!=='api'||r.indexing==='noindex','API indexed');const signature=r.method+' '+r.path.replace(/:[A-Za-z][A-Za-z0-9]*/g,':param');expect(!shapes.has(signature),'Duplicate route shape');shapes.add(signature);}
 for(const d of rs.redirects){expect(byId.get(d.fromRouteId)?.kind==='redirect'&&byId.get(d.toRouteId)?.kind==='page','Invalid redirect');expect(d.status===302&&d.cacheControl==='private, no-store','Unsafe redirect caching');expect(d.preserveQuery.every(k=>k==='workspaceId'),'Redirect passthrough');}
 expect(routes.filter(r=>r.kind==='redirect').every(r=>rs.redirects.filter(d=>d.fromRouteId===r.id).length===1),'Missing redirect rule');
 const apiRows=[...text('docs/prd/04-architecture-and-data.md').matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE|HEAD) (\/api\/[^`]+)` \|/gm)].map(m=>m[1]+' '+m[2]);
 expect(same(apiRows.sort(),routes.filter(r=>r.kind==='api').map(r=>r.method+' '+r.path).sort()),'API PRD/registry drift');counts.apis=apiRows.length;
 const section=text('docs/prd/02-ux-and-flows.md').split('## 2 首页与首次进入')[0];const pages=new Set(section.split('\n').filter(l=>l.startsWith('| ')).flatMap(l=>[...(l.split('|')[1]??'').matchAll(/`(\/[^`]*)`/g)].map(m=>m[1])));
 expect(same([...pages].sort(),routes.filter(r=>r.kind!=='api').map(r=>r.path).sort()),'Page registry drift');
 expect(brand.routeSource==='config/routes.json'&&auth.routeSource===brand.routeSource,'Unshared route source');
 for(const [key,id]of Object.entries(brand.routeIds)){const r=byId.get(id),p=key==='waffoSuccessPathTemplate'?r?.path.replace(':orderId','{localOrderId}'):r?.path;expect(typeof p==='string'&&brand.paths[key]===p,'Brand callback mismatch '+key);}
 expect(same(Object.keys(brand.paths).sort(),Object.keys(brand.routeIds).sort()),'Unresolved brand paths');
 const authMethods={login:'GET',verify:'GET',link:'GET',googleStart:'POST',googleCallback:'GET',emailRequest:'POST',emailVerify:'POST',emailResend:'POST',session:'GET',logout:'POST',linkConfirm:'POST',registrationConfirm:'POST',cancelFlow:'DELETE'};
 expect(same(Object.keys(auth.routes).sort(),Object.keys(authMethods).sort()),'Incomplete auth routes');for(const [key,m]of Object.entries(authMethods))expect(byId.get(auth.routes[key])?.method===m,'Auth route method '+key);
 expect(byId.get(auth.routes.googleCallback)?.auth==='oauth_state'&&byId.get(brand.routeIds.waffoWebhook)?.auth==='waffo_signature','External callback auth');
 expect(existsSync(join(root,auth.sourceDocument))&&routes.some(r=>r.kind==='page'&&r.path===auth.flow.returnTo.defaultPath&&r.id.startsWith('app.')),'Auth source/default return');
 expect(same(auth.methods,['google','email_otp'])&&!auth.passwordAuthentication&&!auth.magicLinkAuthentication,'Auth methods changed');
 expect(auth.email.transport==='cloudflare_email_service'&&auth.email.requiresWorkersPaid&&auth.email.requiresVerifiedSendingDomain,'Mail prerequisites');
 expect(auth.email.production.fromAddress!==auth.email.staging.fromAddress&&auth.email.staging.controlledRecipientsOnly&&auth.email.localAndCiTransport==='mock','Mail isolation');
 expect(auth.email.defaultMessageLocale===brand.defaultUiLocale&&auth.email.messageLocaleSource==='website_ui_locale','Auth locale');
 const otp=auth.email.otp;expect(otp.digest==='HMAC-SHA-256'&&!otp.storePlaintext&&!otp.resendResetsFailedAttempts&&otp.resendInvalidationScope==='current_flow','OTP security');
 expect(otp.resendAfterSeconds>0&&otp.expiresAfterSeconds>otp.resendAfterSeconds&&auth.flow.expiresAfterSeconds>=otp.expiresAfterSeconds&&auth.flow.proofExpiresAfterSeconds<=auth.flow.expiresAfterSeconds,'OTP lifetimes');
 for(const key of ['maxFailedAttemptsPerFlow','maxSendsPerFlow'])expect(Number.isInteger(otp[key])&&otp[key]>0,'OTP budget '+key);
 for(const part of [auth.flow,auth.session]){const c=part.cookie;expect(part.randomBytes>=32&&c.name.startsWith('__Host-')&&c.path==='/'&&c.httpOnly&&c.secure&&c.hostOnly&&c.sameSite==='Lax'&&!Object.hasOwn(c,'domain'),'Auth cookie');}
 expect(auth.flow.cookie.name!==auth.session.cookie.name&&auth.session.storage==='token_hash_only'&&!auth.session.clearThemeCookieOnLogout,'Auth/theme state');
 expect(auth.accountLinking.existingMethodProofRequired&&auth.accountLinking.newMethodProofRequired&&auth.accountLinking.explicitConfirmationRequired&&!auth.accountLinking.automaticAccountMerge&&!auth.accountLinking.allowIdentityTransfer,'Identity linking');
 for(const key of [...Object.values(auth.email.messageKeys),...Object.values(auth.errorMessageKeys)])expect(typeof flat[key]==='string','Missing auth key '+key);
 for(const key of ['subject','preheader','linkSubject','linkPreheader'])expect(typeof flat[auth.email.messageKeys[key]]==='string'&&!/\{\{\s*code\s*\}\}/.test(flat[auth.email.messageKeys[key]]),'OTP in subject/preheader');
 const expected=['tiktok','instagram_feed','instagram_reels','x','youtube','youtube_shorts'];expect(same(platforms.presets.map(p=>p.id).sort(),[...expected].sort()),'Platform set');
 expect(same(Object.keys(platforms.aspectLayouts).sort(),['feed','landscape','portrait','square']),'Layout set');
 for(const p of platforms.presets){expect(platforms.encodingProfiles[p.encodingProfile],'Encoding profile');for(const key of [p.labelKey,p.userNoteKey])expect(typeof get(messages,key)==='string','Platform message '+key);for(const a of [p.defaultAspect,...p.optionalAspects])expect(platforms.aspectLayouts[a],'Invalid aspect');}
 // Keep v1 examples coupled only to their v1 migration manifest, never to v2 production output.
 const scene=json('contracts/scene.example.json'),legacy=json('contracts/legacy/export-manifest.example.json');
 expect(scene.exampleOnly&&legacy.exampleOnly,'Legacy fixtures must be examples');
 for(const k of ['language','direction','videoStyle','projectId','revisionId'])expect(scene[k]===legacy[k],'Legacy '+k+' mismatch');
 expect(['ltr','rtl'].includes(scene.direction)&&scene.brand.name==='Sample Product','Legacy content boundary');
 expect(scene.totalFrames===legacy.durationFrames&&scene.fps===legacy.fps&&scene.totalFrames===scene.fps*scene.durationSeconds,'Legacy time');
 expect(scene.platformPresetVersion===platforms.rulesVersion&&legacy.presetRulesVersion===platforms.rulesVersion,'Legacy presets');
 const facts=new Set(scene.facts.map(f=>f.id)),assets=new Set(scene.assets.map(a=>a.assetVersionId));let next=0;
 for(const s of scene.scenes){expect(s.startFrame===next&&s.durationFrames>0,'Legacy continuity');next+=s.durationFrames;for(const a of Object.keys(platforms.aspectLayouts))expect(s.layoutByAspect[a],'Legacy layout');for(const x of s.factRefs)expect(facts.has(x),'Legacy fact');for(const x of s.assetRefs)expect(assets.has(x),'Legacy asset');}expect(next===scene.totalFrames,'Legacy end');
 const artifacts=new Set(legacy.artifacts.map(a=>a.id));expect(artifacts.size===legacy.artifacts.length,'Legacy artifact IDs');for(const id of legacy.initialArtifactManifest)expect(artifacts.has(id),'Legacy initial artifact');for(const p of legacy.platformMappings)expect(expected.includes(p.platformId)&&artifacts.has(p.videoArtifact)&&artifacts.has(p.coverArtifact),'Legacy mapping');
 const ids=[...text('docs/implementation-decisions.md').matchAll(/^## (REPO-\d+) /gm)].map(m=>m[1]);expect(new Set(ids).size===ids.length,'Duplicate implementation decision ID');
 const mise=text('.mise.toml');expect(pkg.private===true,'Tooling package private');expect(mise.match(/^node\s*=\s*"([^"]+)"/m)?.[1]===pkg.engines?.node,'Node pins');expect('pnpm@'+mise.match(/^pnpm\s*=\s*"([^"]+)"/m)?.[1]===pkg.packageManager,'pnpm pins');
 for(const [key,cmd]of Object.entries({'check:repo':'node scripts/check-repo.mjs','build:ui-reference':'node scripts/build-ui-reference.mjs','check:ui-reference':'node scripts/build-ui-reference.mjs --check','check:contracts':'node scripts/check-production-contracts.mjs','test:contracts':'node --test scripts/production-contracts.test.mjs'}))expect(pkg.scripts?.[key]===cmd,'Task mismatch '+key);
 const check=spawnSync(process.execPath,[join(root,'scripts/check-production-contracts.mjs')],{stdio:'inherit'});expect(check.status===0,'Production contract checks failed');
}
try{main();}catch(e){failures.push(e.message);}
if(failures.length){console.error('Repository check failed:\n'+failures.map(x=>'- '+x).join('\n'));process.exitCode=1;}else{console.log('Repository consistency passed.',JSON.stringify({node:process.version,...counts}));console.log('Scope: specifications/seeds only; NOT live application/auth/mail/payment/render/deployment.');}
