import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {parseCanonicalJson,canonical,createSchemaValidator} from '@promobento/contracts';
import {assertAudioEnvironment} from './audio.mjs';
import {prepareAdmissionMedia} from './admission-media.mjs';
import {analyzeAudioBytes,verifiedToolPcm,measureActiveSpans,prepareCaptions} from './creative-audio/tools.mjs';

const readSchema=name=>{const {$id,$schema,...schema}=parseCanonicalJson(readFileSync(new URL('../../../contracts/'+name,import.meta.url)));return schema;};
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,required,properties});
const schema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://promobento.com/internal/creative-audio-job',oneOf:[
  object({operation:{const:'generate'},totalFrames:{enum:[450,900]},source:readSchema('admission-resources.schema.json').properties.generatedAudio.items,
    audioRights:{anyOf:[{type:'null'},readSchema('admission-audio-rights.schema.json')]}}),
  object({operation:{const:'analyze'},rights:readSchema('admission-audio-file-rights.schema.json')}),
  object({operation:{const:'captions'},request:readSchema('creative-audio-tools.schema.json')})
]};
const validate=createSchemaValidator(schema);

/** Fixed paths in a credential-free capture container; no user JavaScript or shell. */
export async function runCreativeAudioJob(job) {
  if(validate(job).length)throw Error('AUDIO_JOB_INVALID');assertAudioEnvironment();
  let report;
  if(job.operation==='generate') {
    const source=job.source,request={schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:[source.id],generatedAudio:[source],
      audioEvents:[{eventId:'generated',kind:source.kind==='sfx'?'sfx':'music',sourceId:source.id,frameStart:0,frameEndExclusive:job.totalFrames,
        sourceOffsetFrames:0,gainDb:0,fadeInFrames:0,fadeOutFrames:3}]};
    const declarations={markers:[],fonts:[],videoUses:[]};
    const result=prepareAdmissionMedia({request,declarations,input:{totalFrames:job.totalFrames},outputDirectory:'/output',audioRights:job.audioRights});
    report={operation:'generate',resourceManifest:result.resourceManifest,audio:result.report.audio};
  } else if(job.operation==='analyze') {
    if(statSync('/input/audio.wav').size>5760044)throw Error('AUDIO_TOOL_INPUT_LIMIT');
    const bytes=readFileSync('/input/audio.wav');
    report={...analyzeAudioBytes(bytes,job.rights),activeAudio:measureActiveSpans(verifiedToolPcm(bytes,job.rights))};
  } else {
    report=prepareCaptions(job.request);writeFileSync('/output/captions.srt',report.srt);
  }
  writeFileSync('/output/report.json',canonical(report)+'\n');
}
