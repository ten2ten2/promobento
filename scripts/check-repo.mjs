#!/usr/bin/env node
// Current specification consistency. Not a live auth, D1, cloud, payment or video test.
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseCanonicalJson} from '../packages/contracts/src/canonical.mjs';
import {repositoryFiles,conflictErrors,checkDocumentation,platformBaseline,platformRuleErrors} from './repo-documentation.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const failures=[],counts={documents:0,links:0,routes:0,apis:0,contrastPairs:0};
const expect=(ok,msg)=>{if(!ok)failures.push(msg);},text=p=>readFileSync(join(root,p),'utf8'),json=p=>parseCanonicalJson(text(p));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),get=(o,k)=>k?.split('.').reduce((v,p)=>v?.[p],o);
function flatten(o,p='',out={}){for(const [k,v]of Object.entries(o)){const key=p?p+'.'+k:k;if(typeof v==='string')out[key]=v;else if(v&&typeof v==='object'&&!Array.isArray(v))flatten(v,key,out);else failures.push('Invalid message '+key);}return out;}
function lum(hex){if(!/^#[0-9a-f]{6}$/i.test(hex??''))throw Error('Invalid color '+hex);const x=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return x[0]*.2126+x[1]*.7152+x[2]*.0722;}
function main(){
 const names=['01-product-prd','02-ux-and-ui','03-platform-presets','04-architecture-and-data','05-waffo-billing','06-testing-and-release','07-growth-and-experiments','08-codex-execution','09-sources-and-decisions','10-i18n-and-themes','12-routing-and-auth','13-agent-native-production','14-production-contracts'];
 const prds=['README.md',...names.map(n=>n+'.md')];for(const p of prds)expect(existsSync(join(root,'docs/prd',p)),'Missing PRD '+p);counts.documents=prds.length;
 for(const p of ['README.md','AGENTS.md','.mise.toml','package.json','pnpm-lock.yaml','docs/implementation-status.md','contracts/production.schema.json','contracts/agent-api.json','config/agent-policy.json','config/input-capabilities.json','config/preview.json','config/content-safety.json','config/public-context.example.json'])expect(existsSync(join(root,p)),'Missing '+p);
 expect(same(readdirSync(join(root,'docs/prd')).filter(p=>p.endsWith('.md')).sort(),[...prds].sort()),'PRD directory differs from the current indexed specification');
 const files=repositoryFiles(root);
 const documentation=checkDocumentation(root,files,{publicContext:json('config/public-context.example.json'),routes:json('config/routes.json').routes});
 failures.push(...documentation.errors,...conflictErrors(root,files));counts.markdown=documentation.documents;counts.links=documentation.links;
 const brand=json('config/brand.json'),locale=json('config/localization.json'),themes=json('config/theme-tokens.json'),ui=json('config/ui-tokens.json'),platforms=json('config/platform-presets.json'),rs=json('config/routes.json'),auth=json('config/auth.json'),messages=json('locales/en.json'),pkg=json('package.json');
 const protocol='2.6.0',prd='v2.6';
 for(const path of ['README.md','AGENTS.md','docs/implementation-status.md','docs/prd/README.md','docs/prd/01-product-prd.md','docs/prd/03-platform-presets.md','docs/prd/13-agent-native-production.md','docs/prd/14-production-contracts.md']){
  const intro=text(path).split('\n').slice(0,8).join('\n');
  const prdVersions=[...intro.matchAll(/\bv\d+\.\d+(?!\d|\.\d)/g)].map(m=>m[0]),protocolVersions=[...intro.matchAll(/(?<![\d.])\d+\.\d+\.\d+(?!\d|\.\d)/g)].map(m=>m[0]);
  expect(prdVersions.length>0&&prdVersions.every(v=>v===prd)&&protocolVersions.length>0&&protocolVersions.every(v=>v===protocol),'PRD/protocol entry mismatch: '+path);
 }
 for(const path of ['contracts/agent-api.json','config/agent-policy.json','config/routes.json','config/preview.json','config/content-safety.json',...readdirSync(join(root,'contracts')).filter(p=>p.endsWith('.example.json')).map(p=>'contracts/'+p)])
  expect(json(path).schemaVersion===protocol,'Protocol envelope mismatch: '+path);
 const productionSchema=json('contracts/production.schema.json');
 expect(productionSchema.$id.endsWith('/'+protocol),'Production Schema protocol ID');
 for(const [name,definition] of Object.entries(productionSchema.$defs))
  if(definition.properties?.schemaVersion?.const)expect(definition.properties.schemaVersion.const===protocol,'Schema protocol constant: '+name);
 for(const path of ['contracts/composition-runtime.d.ts','contracts/render-protocol.d.ts']){
  const versions=[...text(path).matchAll(/(?:apiVersion|protocolVersion|schemaVersion):\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
  expect(versions.length>0&&versions.every(v=>v===protocol),'Runtime/bridge protocol entry mismatch: '+path);
 }
 try{
  const baseline=platformBaseline(root);counts.platformRulesBase=baseline.commit??baseline.reason;
  if(baseline.config)failures.push(...platformRuleErrors(baseline.config,platforms).map(e=>e+' [Git base '+baseline.reference+']'));
 }catch(error){failures.push(error.message);}
 expect(!Object.hasOwn(brand,'domainLookup'),'Stale domain quote retained');
 expect(brand.brandName==='PromoBento'&&brand.appUrl==='https://promobento.com','Brand changed');
 for(const key of ['headline','tagline','description'])expect(typeof brand[key]==='string'&&brand[key]===messages.marketing[key],'Marketing sources differ: '+key);
 expect(locale.scope==='website_ui'&&same(locale.supportedUiLocales,['en']),'Website locale scope');
 expect(!Object.hasOwn(locale,'supportedVideoLanguages')&&!Object.hasOwn(locale,'defaultVideoLanguage'),'Video language allowlist forbidden');
 expect(locale.uiLanguages?.en?.resourceFile==='locales/en.json'&&locale.selection?.showUiLanguageSwitcher===false,'UI resource/switcher');
 expect(same(themes.preferences,['system','light','dark'])&&themes.defaultPreference==='system'&&themes.cssVariablePrefix!==themes.videoCssVariablePrefix,'Theme/video separation');
 expect(ui.scope==='website_ui'&&ui.reference?.productionFeature===false,'Reference is not production');
 for(const p of [ui.sourceDocument,ui.library?.dependencyPolicy,ui.reference?.template,ui.reference?.output,ui.reference?.generator,ui.reference?.checker])expect(typeof p==='string'&&existsSync(join(root,p)),'UI source missing '+p);
 expect(ui.controls.height>=ui.controls.touchTargetMin&&ui.controls.iconButtonSize>=ui.controls.touchTargetMin,'UI touch target');
 for(const [name,theme]of Object.entries(themes.themes)){
  for(const [alias,key]of Object.entries(ui.themeTokenMap))expect(typeof theme.colors[key]==='string',name+' unresolved '+alias);
  for(const rule of themes.contrastRules)for(const bg of rule.backgrounds){const a=lum(theme.colors[rule.foreground]),b=lum(theme.colors[bg]);expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=rule.minimum,name+' contrast '+rule.foreground+'/'+bg);counts.contrastPairs++;}
 }
 const flat=flatten(messages);for(const k of Object.keys(flat))if(k.endsWith('_one'))expect(typeof flat[k.slice(0,-4)+'_other']==='string','Missing plural '+k);
 expect(!['storyboard','template','styleClean','styleBold'].some(k=>Object.hasOwn(messages.editor,k)),'Outdated editor controls');
 expect(rs.status==='prd_seed'&&auth.status==='prd_seed','Seeds cannot claim deployment');
 const routes=rs.routes,byId=new Map(routes.map(r=>[r.id,r])),shapes=new Set();counts.routes=routes.length;expect(byId.size===routes.length,'Duplicate route ID');
 for(const r of routes){expect(/^[a-z][a-z0-9_.]*$/.test(r.id),'Route ID '+r.id);expect(r.path==='/'||/^\/(?:[a-z0-9.-]+|:[A-Za-z][A-Za-z0-9]*)(?:\/(?:[a-z0-9.-]+|:[A-Za-z][A-Za-z0-9]*))*$/.test(r.path),'Route path '+r.path);expect(!r.path.split('/').some(p=>p==='.'||p==='..'),'Dot route');expect(['page','redirect','resource','api'].includes(r.kind)&&['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(r.method),'Route kind/method');expect(typeof rs.authPolicies[r.auth]==='string','Unknown auth');expect(['index','noindex','not_applicable'].includes(r.indexing),'Index policy');expect(r.kind==='api'?r.path.startsWith('/api/'):r.method==='GET'&&!r.path.startsWith('/api/'),'Namespace');expect(r.indexing!=='index'||r.kind==='page'&&r.auth==='public','Private indexed page');expect(r.auth==='public'||r.indexing==='noindex','Protected indexed');expect(r.kind!=='api'||r.indexing==='noindex','API indexed');const signature=r.method+' '+r.path.replace(/:[A-Za-z][A-Za-z0-9]*/g,':param');expect(!shapes.has(signature),'Duplicate route shape');shapes.add(signature);}
 for(const d of rs.redirects){expect(byId.get(d.fromRouteId)?.kind==='redirect'&&byId.get(d.toRouteId)?.kind==='page','Invalid redirect');expect(d.status===302&&d.cacheControl==='private, no-store','Redirect caching');expect(d.preserveQuery.every(k=>k==='workspaceId'),'Redirect passthrough');}
 expect(routes.filter(r=>r.kind==='redirect').every(r=>rs.redirects.filter(d=>d.fromRouteId===r.id).length===1),'Missing redirect rule');
 const apiRows=[...text('docs/prd/04-architecture-and-data.md').matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE|HEAD) (\/api\/[^`]+)` \|/gm)].map(m=>m[1]+' '+m[2]);expect(same(apiRows.sort(),routes.filter(r=>r.kind==='api').map(r=>r.method+' '+r.path).sort()),'API PRD/registry drift');counts.apis=apiRows.length;
 expect(brand.routeSource==='config/routes.json'&&auth.routeSource===brand.routeSource,'Shared route source');
 for(const [key,id]of Object.entries(brand.routeIds)){const r=byId.get(id),p=key==='waffoSuccessPathTemplate'?r?.path.replace(':orderId','{localOrderId}'):r?.path;expect(typeof p==='string'&&brand.paths[key]===p,'Callback mismatch '+key);}expect(same(Object.keys(brand.paths).sort(),Object.keys(brand.routeIds).sort()),'Unresolved brand paths');
 const methods={login:'GET',verify:'GET',link:'GET',googleStart:'POST',googleCallback:'GET',emailRequest:'POST',emailVerify:'POST',emailResend:'POST',session:'GET',logout:'POST',linkConfirm:'POST',registrationConfirm:'POST',cancelFlow:'DELETE'};
 expect(same(Object.keys(auth.routes).sort(),Object.keys(methods).sort()),'Incomplete auth routes');for(const [key,method]of Object.entries(methods))expect(byId.get(auth.routes[key])?.method===method,'Auth method '+key);
 expect(byId.get(auth.routes.googleCallback)?.auth==='oauth_state'&&byId.get(brand.routeIds.waffoWebhook)?.auth==='waffo_signature','External callback auth');
 expect(existsSync(join(root,auth.sourceDocument))&&routes.some(r=>r.kind==='page'&&r.path===auth.flow.returnTo.defaultPath&&r.id.startsWith('app.')),'Auth source/default return');
 expect(same(auth.methods,['google','email_otp'])&&!auth.passwordAuthentication&&!auth.magicLinkAuthentication,'Authentication methods');
 expect(auth.email.transport==='cloudflare_email_service'&&auth.email.requiresWorkersPaid&&auth.email.requiresVerifiedSendingDomain,'Mail prerequisites');
 expect(auth.email.production.fromAddress!==auth.email.staging.fromAddress&&auth.email.staging.controlledRecipientsOnly&&auth.email.localAndCiTransport==='mock','Mail isolation');
 expect(auth.email.defaultMessageLocale===brand.defaultUiLocale&&auth.email.messageLocaleSource==='website_ui_locale','Mail locale');
 const otp=auth.email.otp;expect(otp.digest==='HMAC-SHA-256'&&!otp.storePlaintext&&!otp.resendResetsFailedAttempts&&otp.resendInvalidationScope==='current_flow','OTP security');
 expect(otp.resendAfterSeconds>0&&otp.expiresAfterSeconds>otp.resendAfterSeconds&&auth.flow.expiresAfterSeconds>=otp.expiresAfterSeconds&&auth.flow.proofExpiresAfterSeconds<=auth.flow.expiresAfterSeconds,'OTP lifetimes');
 for(const key of ['maxFailedAttemptsPerFlow','maxSendsPerFlow'])expect(Number.isInteger(otp[key])&&otp[key]>0,'OTP budget');
 for(const part of [auth.flow,auth.session]){const c=part.cookie;expect(part.randomBytes>=32&&c.name.startsWith('__Host-')&&c.path==='/'&&c.httpOnly&&c.secure&&c.hostOnly&&c.sameSite==='Lax'&&!Object.hasOwn(c,'domain'),'Auth cookie');}
 expect(auth.flow.cookie.name!==auth.session.cookie.name&&auth.session.storage==='token_hash_only'&&!auth.session.clearThemeCookieOnLogout,'Session storage');
 expect(auth.accountLinking.existingMethodProofRequired&&auth.accountLinking.newMethodProofRequired&&auth.accountLinking.explicitConfirmationRequired&&!auth.accountLinking.automaticAccountMerge&&!auth.accountLinking.allowIdentityTransfer,'Identity linking');
 for(const key of [...Object.values(auth.email.messageKeys),...Object.values(auth.errorMessageKeys)])expect(typeof flat[key]==='string','Missing auth key '+key);
 for(const key of ['subject','preheader','linkSubject','linkPreheader'])expect(typeof flat[auth.email.messageKeys[key]]==='string'&&!/\{\{\s*code\s*\}\}/.test(flat[auth.email.messageKeys[key]]),'OTP in subject/preheader');
 const expected=['tiktok','instagram_feed','instagram_reels','x','youtube','youtube_shorts'];expect(same(platforms.presets.map(p=>p.id).sort(),[...expected].sort()),'Platform set');expect(same(Object.keys(platforms.aspectLayouts).sort(),['feed','landscape','portrait','square']),'Layout set');
 for(const p of platforms.presets){expect(platforms.encodingProfiles[p.encodingProfile],'Encoding profile');for(const key of [p.labelKey,p.userNoteKey])expect(typeof get(messages,key)==='string','Platform message '+key);for(const a of [p.defaultAspect,...p.optionalAspects])expect(platforms.aspectLayouts[a],'Invalid aspect');}
 const mise=text('.mise.toml');expect(pkg.private===true,'Private tooling package');expect(mise.match(/^node\s*=\s*"([^"]+)"/m)?.[1]===pkg.engines.node,'Node pin');expect('pnpm@'+mise.match(/^pnpm\s*=\s*"([^"]+)"/m)?.[1]===pkg.packageManager,'pnpm pin');
 const tasks={'check:repo':'node scripts/check-repo.mjs','check:contracts':'node scripts/check-production-contracts.mjs','test:contracts':'node --test scripts/*.test.mjs packages/contracts/test/*.test.mjs','build:agent-reference':'node scripts/build-agent-reference.mjs','check:agent-reference':'node scripts/check-agent-reference.mjs'};
 for(const [key,cmd]of Object.entries(tasks)){expect(pkg.scripts[key]===cmd&&mise.includes('[tasks."'+key+'"]')&&mise.includes('run = "'+cmd+'"'),'Task mismatch '+key);}
 for(const file of ['check-production-contracts.mjs','check-agent-reference.mjs']){const result=spawnSync(process.execPath,[join(root,'scripts',file)],{stdio:'inherit'});expect(result.status===0,'Failed '+file);}
}
try{main();}catch(e){failures.push(e.message);}
if(failures.length){console.error('Repository check failed:\n'+failures.map(x=>'- '+x).join('\n'));process.exitCode=1;}else{console.log('Current repository checks passed.');console.log(JSON.stringify({node:process.version,...counts},null,2));console.log('Scope: current documentation, configuration and reference contracts; not live services.');}
