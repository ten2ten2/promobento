import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,chmodSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonical,parseCanonicalJson} from '@promobento/contracts';
import {repository,verifiedAdmissionImage} from '../src/admission-image.mjs';
import {runAdmissionSandbox} from '../src/admission-sandbox.mjs';
import {readFixtureLicense} from '../src/fixture-license.mjs';
import {pcm16Wav} from '../src/audio.mjs';
import {sha256} from '../src/environment.mjs';
import {synthesizeFixtureAudio} from '../../../tests/fixtures/render/audio-fixture.mjs';

const out=join(repository,'artifacts/creative-audio',String(Date.now())),temporary=mkdtempSync(join(tmpdir(),'creative-audio-test-'));
mkdirSync(out,{recursive:true});chmodSync(temporary,0o755);
const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
try {
  const image=verifiedAdmissionImage(),license=readFixtureLicense('tests/fixtures/render/audio-fixture.mjs');
  const bytes=pcm16Wav(synthesizeFixtureAudio().music);writeFileSync(join(temporary,'audio.wav'),bytes);
  const rights={kind:'reviewed_audio_file',basis:'CC0-1.0',sourceHash:sha256(bytes),evidenceRef:license.licenseRef,
    reviewer:'verified original engineering fixture license',allowedUses:['process','analyze']};
  const run=async(name,job)=>{
    const output=join(out,name);mkdirSync(output,{mode:0o777});chmodSync(output,0o777);let receipt=0;
    const sandbox=await runAdmissionSandbox({image,mode:'audio-tools',kind:'capture',input:job,signal:controller.signal,
      mounts:[{source:temporary,target:'/input'},{source:output,target:'/output',readonly:false}],onLine(message){assert.equal(message.kind,'audio-tools-complete');receipt++;}});
    assert.equal(receipt,1);return {output,sandbox,report:parseCanonicalJson(readFileSync(join(output,'report.json')))};
  };
  const analysis=await run('analysis',{operation:'analyze',rights}),r=analysis.report;
  assert.equal(r.sourceHash,rights.sourceHash);assert.equal(r.duration,30);assert.equal(r.meterAssumption,'4/4');assert(r.confidence>=0&&r.confidence<=1);
  assert(r.beats.every((t,i)=>t>=0&&t<=30&&(i===0||t>r.beats[i-1])));assert.equal(r.pulseReliable,r.confidence>=.3);
  assert.equal(r.activeAudio.interpretation,'active_audio_not_word_boundaries');
  await assert.rejects(run('wrong-rights',{operation:'analyze',rights:{...rights,sourceHash:'0'.repeat(64)}}),/AUDIO_TOOL_RIGHTS_REQUIRED/);
  const captions=await run('captions',{operation:'captions',request:{operation:'captions',script:'Choose a rhythm. 让想法动起来。',scriptConfirmed:true,
    durationSeconds:6,speechSpans:[[0,2.5],[3,5.8]],spanBasis:'human_confirmed'}});
  assert.equal(captions.report.wordTiming,'interpolated');assert(captions.report.requiresHumanTimingReview);
  const srt=readFileSync(join(captions.output,'captions.srt'),'utf8');assert(srt.includes('Choose a rhythm.'));assert(srt.includes('让想法动起来。'));
  assert(captions.report.words.every(w=>w.timingBasis==='interpolated_within_confirmed_spans'));
  writeFileSync(join(out,'verification.json'),canonical({status:'passed',image,checks:{canonicalWavAnalysis:true,boundedBeatGrid:true,
    fourFourAssumptionExplicit:true,rightsMismatchRejected:true,actualSrt:true,interpolationExplicit:true},
    sandboxes:[analysis.sandbox,captions.sandbox],audioSourceHash:rights.sourceHash})+'\n');
  console.log(JSON.stringify({status:'passed',out}));
} finally {process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);rmSync(temporary,{recursive:true,force:true});}
