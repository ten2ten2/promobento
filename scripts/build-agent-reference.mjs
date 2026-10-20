import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {load,targets} from './contract-validation.mjs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function generateReference(){
 const ui=load('config/ui-tokens.json'),theme=load('config/theme-tokens.json'),policy=load('config/agent-policy.json'),rules=load('config/platform-presets.json'),brand=load('config/brand.json');
 const svgData=path=>'data:image/svg+xml;base64,'+Buffer.from(read('public'+path)).toString('base64');
 const vars=t=>Object.entries(t.colors).map(([k,v])=>'--ui-'+k+':'+v+';').join('');
 const base=`:root{color-scheme:light;${vars(theme.themes.light)}--font-body:${ui.typography.fontFamily};--font-display:${ui.typography.displayFontFamily};--rail:${ui.layout.editorSceneWidth}px;--inspector:${ui.layout.editorInspectorWidth}px;--touch:${ui.controls.touchTargetMin}px;--radius-control:${ui.radius.md}px;--brand-mark-size:${ui.typography.styles.wordmark.lineHeight}px;--brand-gap:${ui.spacing['2']}px}`;
 const dark=`html[data-theme=dark]{color-scheme:dark;${vars(theme.themes.dark)}}@media(prefers-color-scheme:dark){html[data-theme=system]{color-scheme:dark;${vars(theme.themes.dark)}}}`;
 const legal=targets(rules).map(t=>({id:t.targetId,aspect:t.aspectId,width:t.layout.width,height:t.layout.height,safe:t.layout.safeInsets,label:rules.presets.find(p=>p.id===t.presetId).label+' · '+t.layout.ratio}));
 const options=legal.map(t=>`<option value="${escape(t.id)}">${escape(t.label)}</option>`).join('');
 const offers=Object.fromEntries(Object.entries(policy.quota).filter(([,q])=>Number.isSafeInteger(q?.priceMinor)).map(([sku,q])=>[sku,{priceMinor:q.priceMinor,versionUnits:q.versionUnits,creative_generate:q.creative_generate,agent_patch:q.agent_patch}]));
 const trial={creative_generate:policy.quota.free.creative_generate,agent_patch:policy.quota.free.agent_patch,directionCards:policy.quota.free.directionCardsPerCreativeRun};
 const editLimits={maxComments:policy.patch.maxCommentsPerRound,maxCharacters:policy.patch.maxTotalCommentCodePoints};
 const boot=JSON.stringify({targets:legal,offers,trial,editLimits}).replace(/</g,'\\u003c');
 return read(ui.reference.template).replace('@@TOKENS@@',base+dark).replace('@@TARGET_OPTIONS@@',options).replace('@@BOOT@@',boot)
  .replaceAll('@@BRAND_NAME@@',escape(brand.brandName)).replace('@@BRAND_ICON@@',svgData(brand.assets.icon))
  .replace('@@BRAND_MARK_DARK@@',svgData(brand.assets.markDark)).replace('@@BRAND_MARK_WHITE@@',svgData(brand.assets.markWhite));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=load('config/ui-tokens.json').reference.output,rendered=generateReference();
 if(process.argv.includes('--check')){if(read(output)!==rendered){console.error('Reference differs from current template/configuration.');process.exitCode=1;}else console.log('Current Agent Studio reference is synchronized.');}
 else {writeFileSync(new URL(output,root),rendered);console.log('Generated current offline reference; no service or video was executed.');}
}
