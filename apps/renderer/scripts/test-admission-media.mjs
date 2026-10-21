import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts';
import {repository,verifiedAdmissionImage} from '../src/admission-image.mjs';
import {renderAdmission} from '../src/admission-run.mjs';
import {readAdmissionSource} from '../src/admission-source.mjs';
import {runAdmissionSandbox} from '../src/admission-sandbox.mjs';
import {writeMediaCandidate} from '../test/admission-media.cases.mjs';

const out=join(repository,'artifacts/admission-media',String(Date.now())),temporary=mkdtempSync(join(tmpdir(),'admission-media-'));
mkdirSync(out,{recursive:true});
try {
  const image=verifiedAdmissionImage(),directory=join(temporary,'source');writeMediaCandidate(directory);
  const result=await renderAdmission({sourceDirectory:directory,outputDirectory:join(out,'render')});
  assert.equal(result.report.capabilityProfile,'canvas-media-v1');assert.equal(result.report.capture.frameCount,900);
  assert.equal(result.report.capture.media.encodedAudio.interval.effectiveSampleFrames,1440000);
  assert(result.report.capture.media.encodedAudio.mixedAudioComparison.correlation>=0.97);
  assert(result.report.capture.media.observations.every(item=>item.videos.length===1));
  const pts=result.report.capture.media.video.sourcePts;
  for(const observation of result.report.capture.media.observations) {
    const expected=pts.findLast(point=>point.numerator*30<=observation.frame*point.denominator);
    assert.deepEqual(observation.videos[0].sourcePts,expected,'Exact containing PTS interval at frame '+observation.frame);
  }
  const track=parseCanonicalJson(readFileSync(join(result.out,'text-track.json')));
  assert.equal(track.videoSha256,result.report.capture.video.sha256);
  assert(track.tracks.some(item=>item.text==='Ideas into motion'&&item.frameStart===0&&item.frameEndExclusive===900));
  const keyframes=parseCanonicalJson(readFileSync(join(result.out,'keyframes.json')));
  assert.equal(keyframes.videoSha256,result.report.capture.video.sha256);
  for(const frame of [0,30,450,899])assert(keyframes.keyframes.some(item=>item.frameIndex===frame));
  const editDirectory=join(temporary,'edited');writeMediaCandidate(editDirectory,{title:'Stories into motion',image:'screen-detail'});
  const candidate=readAdmissionSource(editDirectory),input={...candidate.input};delete input.durationSeconds;
  const frames=[0,300,899,0],draws=[];
  await runAdmissionSandbox({image,mode:'evaluate',input:{source:candidate.source,input,declarations:candidate.declarations,
    profile:'canvas-media-v1',resourceRequest:candidate.resourceRequest,frames},onLine:message=>{if(message.kind==='draw')draws.push(message.draw);}});
  assert.equal(draws.length,frames.length);assert.equal(canonical(draws[0]),canonical(draws[3]));
  for(const draw of draws) {
    assert(draw.commands.some(command=>command.op==='text'&&command.text==='Stories into motion'));
    assert(draw.commands.some(command=>command.op==='image'&&command.resourceId==='screen-detail'));
  }
  assert.notEqual(candidate.sourceHash,result.report.sourceHash);
  writeFileSync(join(out,'verification.json'),JSON.stringify({status:'passed',profile:'canvas-media-v1',image,
    checks:{fullFrames:900,encodedAudio:true,trustedTextTrack:true,pts:true,editedFrames:frames.length,
      editedEvidence:'isolated_vm_commands',editedText:true,editedImage:true},
    sourceHash:result.report.sourceHash,editedSourceHash:candidate.sourceHash,render:result.out},null,2)+'\n');
  console.log(JSON.stringify({status:'passed',out}));
} finally {rmSync(temporary,{recursive:true,force:true});}
