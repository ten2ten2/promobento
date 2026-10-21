import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,sourceValuesBytes} from '@promobento/contracts';
import {mediaCandidate,writeMediaCandidate} from './admission-media.cases.mjs';
import {validateAdmissionResources,admittedMediaCatalog} from '../src/admission-media.mjs';
import {admissionTextMeasurement,admittedFontMetrics} from '../src/admission-fonts.mjs';
import {validateAdmissionDraw,validateAdmissionTextInk} from '../src/admission-commands.mjs';
import {readAdmissionSource} from '../src/admission-source.mjs';
import {admissionEngineOptions} from '../src/admission-engine.mjs';
import {admissionPolicy} from '../src/admission-image.mjs';
import {admissionKeyframePlan} from '../src/admission-capture.mjs';
import {admissionWorkerFailure} from '../src/admission-failure.mjs';
import {admissionObservationBudget} from '../src/admission-observations.mjs';

const candidate=()=>mediaCandidate(),text=()=>({op:'text',id:'headline',fontId:'geist-sans-fixture',text:'Hello',fontSize:48,weight:600,
  x:100,y:220,width:800,height:100,color:'#24352b',opacity:1});
const options=()=>({targetId:'tiktok:portrait',width:1080,height:1920,declarations:candidate().declarations,profile:'canvas-media-v1',resourceRequest:candidate().resources});
test('media source is inert, profile-separated and editable images remain default-deny',()=>{
  const dir=mkdtempSync(join(tmpdir(),'admission-media-unit-'));
  try {
    writeMediaCandidate(dir);writeFileSync(join(dir,'composition.mjs'),'while(true){}');
    const source=readAdmissionSource(dir);assert.equal(source.manifest.capabilityProfile,'canvas-media-v1');
    assert(source.targetFiles.some(file=>file.path==='resources.json'));
    writeFileSync(join(dir,'values.json'),sourceValuesBytes({headline:'Edited',image:'screen-detail'}));
    assert.notEqual(readAdmissionSource(dir).sourceHash,source.sourceHash);
    writeFileSync(join(dir,'values.json'),sourceValuesBytes({headline:'Edited',image:'original-score'}));
    assert.throws(()=>readAdmissionSource(dir),/ADMISSION_VALUES_INVALID/);
    writeFileSync(join(dir,'candidate.json'),canonical({...source.manifest,capabilityProfile:'canvas-commands-v1'}));
    assert.throws(()=>readAdmissionSource(dir),/ADMISSION_SOURCE_INVENTORY/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('resource IDs are trusted registrations, never URLs or author-provided rights',()=>{
  const {resources,declarations}=candidate(),context={declarations,totalFrames:900};
  assert.equal(validateAdmissionResources(resources,context).length,admittedMediaCatalog().resources.length);
  for(const request of [{...resources,resourceIds:[...resources.resourceIds,'unreviewed']},
    {...resources,licenses:[{approved:true}]},{...resources,resourceIds:['https://example.test/image.png']},
    {...resources,resourceIds:['../../private']},{...resources,resourceIds:[...resources.resourceIds,'screen-still']}])
    assert.throws(()=>validateAdmissionResources(request,context),/ADMISSION_RESOURCE/);
  const forged=structuredClone(declarations);forged.fonts[0].assets[0].sha256='a'.repeat(64);
  assert.throws(()=>validateAdmissionResources(resources,{declarations:forged,totalFrames:900}),/FONT_UNAUTHORIZED/);
});
test('frozen audio events reject invalid offsets, automation, markers and duplicate identities',()=>{
  const {resources,declarations}=candidate(),context={declarations,totalFrames:900};
  for(const patch of [{sourceOffsetFrames:1},{frameEndExclusive:901},{fadeOutFrames:900},{sourceId:'screen-demo'},
    {gainAutomation:[{frameOffset:0,gainDb:0},{frameOffset:1,gainDb:0}]}]) {
    const request=structuredClone(resources);Object.assign(request.audioEvents[0],patch);
    assert.throws(()=>validateAdmissionResources(request,context),/ADMISSION_(AUDIO|RESOURCES)/);
  }
  const duplicate=structuredClone(resources);duplicate.audioEvents[1].eventId='score';
  assert.throws(()=>validateAdmissionResources(duplicate,context),/ADMISSION_AUDIO/);
});
test('actual WOFF advances define stable scaled Latin metrics and selected faces',()=>{
  const {declarations}=candidate();assert(admittedFontMetrics().every(face=>Object.keys(face.glyphs).length===191));
  const first=admissionTextMeasurement(declarations,'geist-sans-fixture','Hello',48,600);
  const second=admissionTextMeasurement(declarations,'geist-sans-fixture','Hello',24,600);
  assert.equal(first.width,second.width*2);assert.equal(first.ascent,44.160000000000004);
  assert.equal(first.glyphs.map(glyph=>glyph.character).join(''),'Hello');
  assert.throws(()=>admissionTextMeasurement(declarations,'geist-sans-fixture','你好',48,600),/FONT_GLYPH_MISSING/);
  assert.throws(()=>admissionTextMeasurement(declarations,'geist-sans-fixture','e\u0301',48,600),/FONT_GLYPH_MISSING/);
  assert.throws(()=>admissionTextMeasurement(declarations,'geist-sans-fixture','Hello',48,400),/FONT_WEIGHT_UNDECLARED/);
});
test('data commands reject URLs, unknown images/video, missing glyphs, overflow and duplicate text identities',()=>{
  assert.equal(validateAdmissionDraw({commands:[text()]},options()).commands.length,1);
  const geometry={...options(),profile:'canvas-commands-v1'};
  assert.throws(()=>validateAdmissionDraw({commands:[text()]},geometry),/ADMISSION_DRAW_INVALID/);
  for(const command of [{...text(),text:'你好'},{...text(),text:'a\nb'},{...text(),width:1},{...text(),height:1},{...text(),x:-1},{...text(),x:0,y:0},
    {...text(),url:'https://example.test'},
    {op:'image',resourceId:'original-score',x:0,y:0,width:100,height:100,opacity:1},
    {op:'video',useId:'undeclared',x:0,y:0,width:100,height:100,opacity:1}])
    assert.throws(()=>validateAdmissionDraw({commands:[command]},options()));
  assert.throws(()=>validateAdmissionDraw({commands:[text(),text()]},options()),/TEXT_ID_DUPLICATE/);
});
test('the VM only enables media measurements for the separately admitted profile',()=>{
  const {source,declarations,values}=candidate();
  const input={targetId:'tiktok:portrait',width:1080,height:1920,fps:30,totalFrames:900,seed:'test',values};
  assert.throws(()=>admissionEngineOptions({source,input,declarations,limits:admissionPolicy.engine}),/CAPABILITY_UNAVAILABLE/);
  assert(admissionEngineOptions({source,input,declarations,limits:admissionPolicy.engine,profile:'canvas-media-v1'}));
});
test('actual hinted glyph ink must stay inside every target safe boundary',()=>{
  const ink={left:1080*0.08,top:1920*0.10,right:1080*(1-0.16),bottom:1920*(1-0.22)};
  const check=value=>validateAdmissionTextInk({texts:[{ink:value}]},options());
  assert.doesNotThrow(()=>check(ink));
  for(const [edge,delta] of [['left',-0.001],['top',-0.001],['right',0.001],['bottom',0.001]])
    assert.throws(()=>check({...ink,[edge]:ink[edge]+delta}),/ADMISSION_TEXT_OUTSIDE_SAFE_AREA/);
  for(const value of [undefined,{...ink,right:Infinity},{...ink,left:ink.right+1}])
    assert.throws(()=>check(value),/ADMISSION_TEXT_INK_INVALID/);
});
test('keyframes retain actual required moments and bounded marker coverage without duplicates',()=>{
  const plan=admissionKeyframePlan(900,candidate().declarations,30);
  assert.deepEqual(plan.map(item=>item.frameIndex),[0,30,450,899]);
  assert.deepEqual(plan[1].roles,['densest_commands','marker:open']);
  assert.throws(()=>admissionKeyframePlan(900,{markers:Array.from({length:65},(_,i)=>({id:String(i),frame:i}))}),/KEYFRAME_PLAN_INVALID/);
});
test('audio rejection preserves measured loudness diagnostics without admitting arbitrary stderr fields',()=>{
  const record={kind:'admission_failure',errorCode:'AUDIO_LEVEL_INVALID',error:'AUDIO_LEVEL_INVALID',
    details:{integratedLufs:-17.04,truePeakDbtp:-1.5,normalizationGainDb:8.37}};
  assert.deepEqual(admissionWorkerFailure(canonical(record),1).details,record.details);
  assert.equal(admissionWorkerFailure(canonical({...record,details:{...record.details,unexpected:'data'}}),1).details,undefined);
});
test('browser observation metadata is bounded by actual UTF-8 bytes before retention',()=>{
  const observation={text:'é'},size=Buffer.byteLength(canonical(observation)),charge=admissionObservationBudget(size*2);
  assert.equal(charge(observation),size);assert.equal(charge(observation),size*2);
  assert.throws(()=>charge(observation),error=>error.message==='ADMISSION_MEDIA_OBSERVATION_LIMIT'
    &&error.details.observationBytes===size*2&&error.details.nextObservationBytes===size);
});
