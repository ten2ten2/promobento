// Package passed native samples for owner listening. Never synthesize, normalize or call a model.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {AUDIO_STYLES} from '../../packages/audio/src/catalog.mjs';

const [sourceArg,destinationArg,run]=process.argv.slice(2),source=resolve(sourceArg??''),destination=resolve(destinationArg??'');
if(!sourceArg||!destinationArg||!/^\d{8,20}$/.test(run??'')||![source,destination].every(path=>path.startsWith(resolve('artifacts')+'/')))throw Error('AUDIO_REVIEW_PRIVATE_PATHS_AND_SOURCE_RUN_REQUIRED');
if(existsSync(destination))throw Error('AUDIO_REVIEW_DESTINATION_EXISTS');
const index=parseCanonicalJson(readFileSync(join(source,'index.json')));
if(index.status!=='rendered'||index.samples.length!==AUDIO_STYLES.length||new Set(index.samples.map(sample=>sample.style)).size!==AUDIO_STYLES.length
 ||index.samples.some(sample=>!AUDIO_STYLES.includes(sample.style)||sample.status!=='rendered'||sample.sampleFrames!==1440000||sample.file!==sample.style+'/mixed.wav'))throw Error('AUDIO_REVIEW_PASSED_SAMPLES_REQUIRED');
const names={mallet:'马林巴',pulse:'电子脉冲',lofi:'Lo-fi',funk:'Funk',trap:'Trap',chiptune:'像素音色',ambient:'氛围',piano:'钢琴',cinematic:'电影感',pizzicato:'拨弦',acoustic:'原声',guofeng:'国风',synthwave:'Synthwave'};
mkdirSync(destination,{recursive:true});
const samples=index.samples.map(sample=>{const file=sample.style+'.wav';copyFileSync(join(source,sample.file),join(destination,file));
 return{style:sample.style,file,durationSeconds:30,lufs:sample.lufs,truePeak:sample.truePeak,audioPlanHash:sample.audioPlanHash,ownerReview:'pending'};});
const decisionRef='docs/evidence/2026-10-24-s1-audio-review/owner-decision.json';
const decision=existsSync(decisionRef)?parseCanonicalJson(readFileSync(decisionRef)):null;
const retained=decision?.sourceRun===run&&decision.decidedBy==='owner'&&decision.decision==='retain_all'
 &&decision.samples.length===samples.length&&samples.every(sample=>decision.samples.some(approved=>approved.style===sample.style&&approved.audioPlanHash===sample.audioPlanHash&&approved.decision==='retain'));
const ownerReview=retained?'retained_by_owner':'pending';for(const sample of samples)sample.ownerReview=ownerReview;
const sourceUrl='https://github.com/ten2ten2/promobento/actions/runs/'+run;
writeFileSync(join(destination,'review.json'),canonical({kind:'s1_audio_owner_review',sourceRun:run,sourceUrl,playbackRate:1,ownerReview,...(retained?{ownerDecisionRef:decisionRef}:{}),samples})+'\n');
writeFileSync(join(destination,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>S1 配乐试听</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f4ed;color:#173038;font:17px/1.6 system-ui,sans-serif}main{max-width:1040px;margin:auto;padding:56px 28px 64px}header{margin-bottom:38px}.eyebrow{color:#236f67;font-size:14px;letter-spacing:2px}h1{font-size:clamp(30px,5vw,46px);line-height:1.2;margin:14px 0 16px;letter-spacing:-1px}p{margin:8px 0;color:#526369}.list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 38px}section{padding:24px 0;border-top:1px solid #cdd6cd}h2{font-size:21px;margin:0 0 15px}h2 span{font-size:14px;font-weight:400;color:#526369;margin-left:9px}audio{display:block;width:100%}footer{margin-top:38px;color:#526369;font-size:15px}a{color:#236f67}@media(max-width:640px){main{padding:30px 20px}.list{grid-template-columns:1fr}}
</style><main><header><div class="eyebrow">S1 · ${retained?'13 种配乐已保留':'待负责人试听'}</div><h1>${retained?'保留的 13 种配乐':'选出值得留下的配乐'}</h1><p>13 种风格，每段 30 秒。按默认 1× 逐段试听。</p><p>${retained?'负责人已选择保留现有 13 种配乐。':'反馈格式：保留 / 调整 / 停用 + 风格名；需要调整时注明听感。'}</p></header><div class="list">
${samples.map(sample=>`<section><h2>${names[sample.style]}<span>${sample.style}</span></h2><audio controls preload="metadata" aria-label="试听 ${names[sample.style]}" src="${sample.file}"></audio></section>`).join('\n')}
</div><footer>直接打开本页即可播放，无需联网。<a href="${sourceUrl}">原始 CI 产物</a> · 许可来源：packages/audio/src/NOTICE.md</footer></main></html>`);
console.log(canonical({status:'prepared_for_owner_listening',entry:join(destination,'index.html'),samples:samples.length,sourceRun:run,ownerReview}));
