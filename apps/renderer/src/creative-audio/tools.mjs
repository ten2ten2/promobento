import {parseCanonicalJson,createSchemaValidator,digest} from '@promobento/contracts';
import {readFileSync} from 'node:fs';
import {sha256} from '../environment.mjs';
import {readPcm16Wav} from '../audio.mjs';
import {analyze} from './beats.mjs';
import {splitSentences,tokenize,weight,sentenceSpans,placeSentence,placeByAnchors,charTimes,wordsOf,toSrt} from './voice.mjs';

const validate=createSchemaValidator(parseCanonicalJson(readFileSync(new URL('../../../../contracts/creative-audio-tools.schema.json',import.meta.url))));
const validateFileRights=createSchemaValidator(parseCanonicalJson(readFileSync(new URL('../../../../contracts/admission-audio-file-rights.schema.json',import.meta.url))));
export function verifyAudioToolRequest(request) {if(validate(request).length)throw Error('AUDIO_TOOL_REQUEST_INVALID');}

export function verifiedToolPcm(bytes,rights) {
  // Trusted CLI/service supplies a separate reviewed source record, not candidate code.
  if(validateFileRights(rights).length||rights.kind!=='reviewed_audio_file'||!['original_recording_reviewed','licensed_recording_reviewed','CC0-1.0'].includes(rights.basis)
    ||rights.sourceHash!==sha256(bytes)||!rights.evidenceRef||!rights.reviewer||!rights.allowedUses?.includes('process')
    ||!rights.allowedUses?.includes('analyze'))throw Error('AUDIO_TOOL_RIGHTS_REQUIRED');
  return readPcm16Wav(bytes);
}
export function analyzeAudioBytes(bytes,rights) {
  const pcm=verifiedToolPcm(bytes,rights),L=new Float32Array(pcm.sampleFrames),R=new Float32Array(pcm.sampleFrames);
  for(let i=0;i<L.length;i++){L[i]=pcm.samples[i*2];R[i]=pcm.samples[i*2+1];}
  return {sourceHash:sha256(bytes),rightsRef:rights.evidenceRef,...analyze({L,R,rate:48000})};
}

/** Energy threshold observations, not speech recognition; music can also exceed the threshold. */
export function measureActiveSpans(pcm,{thresholdDb=-40,minPauseSeconds=.15}={}) {
  const block=480,threshold=10**(thresholdDb/20),spans=[];let start=null,lastActive=0;
  for(let from=0;from<pcm.sampleFrames;from+=block) {
    let energy=0;const to=Math.min(pcm.sampleFrames,from+block);
    for(let i=from;i<to;i++)energy+=(pcm.samples[2*i]**2+pcm.samples[2*i+1]**2)/2;
    if(Math.sqrt(energy/(to-from))>=threshold) {start??=from/48000;lastActive=to/48000;}
    else if(start!==null&&from/48000-lastActive>=minPauseSeconds){spans.push([start,lastActive]);start=null;}
  }
  if(start!==null)spans.push([start,lastActive]);
  return {algorithmVersion:'pcm-energy-spans-v1',thresholdDb,minPauseSeconds,spans,interpretation:'active_audio_not_word_boundaries'};
}

export function prepareCaptions(request) {
  verifyAudioToolRequest(request);
  if(request.operation!=='captions'||request.scriptConfirmed!==true)throw Error('CONFIRMED_SCRIPT_REQUIRED');
  const spans=request.speechSpans;
  if(spans.some(([a,b],i)=>b<=a||b>request.durationSeconds||(i&&a<spans[i-1][1])))throw Error('CAPTION_SPANS_INVALID');
  const sentences=splitSentences(request.script).map(text=>({text,tokens:tokenize(text,request.keepTerms??[])}));
  if(!sentences.length||!sentences.some(s=>s.tokens.some(t=>t.word)))throw Error('CAPTION_SCRIPT_EMPTY');
  let placed,alignment=null;
  if(request.characterAnchors) {
    const chars=[...request.script].filter(c=>/[\p{L}\p{N}]/u.test(c));
    if(request.characterAnchors.some((a,i)=>a.end<a.start||a.end>request.durationSeconds||(i&&a.start<request.characterAnchors[i-1].start)))throw Error('CAPTION_ANCHORS_INVALID');
    alignment=charTimes(chars,request.characterAnchors);
    placed=placeByAnchors(sentences,spans,alignment.times);
  } else {
    const own=sentenceSpans(sentences.map(s=>s.tokens.reduce((sum,t)=>sum+weight(t),0)),spans);
    placed=sentences.map((s,i)=>({...s,tokens:placeSentence(s.tokens,own[i]?.length?own[i]:[[spans.at(-1)[1],spans.at(-1)[1]]])}));
  }
  const words=wordsOf(placed).map(word=>({...word,timingBasis:'interpolated_within_confirmed_spans'}));
  return {algorithmVersion:'script-captions-v1',scriptHash:digest(request.script),script:request.script,
    scriptConfirmed:true,spanBasis:request.spanBasis,wordTiming:'interpolated',
    alignment:alignment?{matchedFraction:alignment.matched,characters:alignment.times}:null,
    sentences:placed,words,srt:toSrt(placed,{max:request.maxLineUnits??16}),requiresHumanTimingReview:true};
}
