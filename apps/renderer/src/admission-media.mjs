import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,parseCanonicalJson,createSchemaValidator,digest,audioIdentity} from '@promobento/contracts';
import {prepareFixtureMedia,screenPixels} from './media-assets.mjs';
import {readFixtureLicense} from './fixture-license.mjs';
import {admittedFontDeclarations,admittedFontMetrics,allAdmittedFontDeclarations} from './admission-fonts.mjs';
import {admittedFontCatalog,reviewedAdmissionFonts} from './admission-font-catalog.mjs';
import {generatedAudioCatalog,generatedAudioRequestHash,verifyAudioRights,synthesizeGeneratedAudio} from './creative-audio/index.mjs';
import {sha256} from './environment.mjs';
import {pcm16Wav,mixPcmEvents,measureAudioLoudness,assertAudioEnvironment} from './audio.mjs';
import {synthesizeFixtureAudio} from '../../../tests/fixtures/render/audio-fixture.mjs';

const schema=parseCanonicalJson(readFileSync(new URL('../../../contracts/admission-resources.schema.json',import.meta.url)));
const validate=createSchemaValidator(schema);
const catalog=[
  {id:'geist-sans-fixture',mediaType:'font/woff',path:'fonts/geist-sans-latin-600-normal.woff',licenseRef:'geist-sans-ofl-1.1',description:'Geist Sans Latin, weight 600'},
  {id:'geist-mono-fixture',mediaType:'font/woff',path:'fonts/geist-mono-latin-400-normal.woff',licenseRef:'geist-mono-ofl-1.1',description:'Geist Mono Latin, weight 400'},
  {id:'screen-still',mediaType:'image/png',path:'media/screen-still.png',licenseRef:'fixture-original-cc0',description:'Original fictional software dashboard, overview'},
  {id:'screen-detail',mediaType:'image/png',path:'media/screen-detail.png',licenseRef:'fixture-original-cc0',description:'Original fictional software dashboard, alternate state'},
  {id:'screen-demo',mediaType:'video/mp4',path:'media/screen-demo.mp4',licenseRef:'fixture-original-cc0',description:'Original fictional application VFR screen recording, 30 seconds'},
  {id:'original-score',mediaType:'audio/wav',path:'audio/music.wav',licenseRef:'rights_m0a_procedural_audio_cc0',description:'Original procedural 30-second instrumental score; no speech'},
  {id:'original-cue',mediaType:'audio/wav',path:'audio/cue.wav',licenseRef:'rights_m0a_procedural_audio_cc0',description:'Original procedural six-frame accent; no speech'}
];

/** This is trusted renderer configuration, outside the candidate source package.
 * Registering another provider requires reviewing its byte/hash/license record and
 * adding a bounded decoder in prepareAdmissionMedia; IDs never authorize URLs or
 * candidate-provided license assertions. The public capability is this catalog,
 * not arbitrary uploads or a permanent restriction on future registered assets.
 */
export function admittedMediaCatalog() {return {version:'admitted-media-v2',resources:[...structuredClone(catalog),...admittedFontCatalog()],generatedAudio:generatedAudioCatalog(),
  text:{layout:'multiline-unshaped-latin-cjk-v2',codePoints:[[32,126],[160,255],[12288,12351],[19968,40959],[65281,65374]],fontSize:{min:1,max:512},wrapping:'word-cjk',complexShaping:false},
  resourceSchema:'contracts/admission-resources.schema.json',commandSchema:'contracts/admission-media-commands.schema.json'};}

export function mediaDeclarations({durationSeconds=30}={}) {
  if(![15,30].includes(durationSeconds))throw Error('ADMISSION_DURATION_INVALID');
  return {fonts:admittedFontDeclarations(),videoUses:[{id:'screen-demo',assetPath:'media/screen-demo.mp4',
    sourceStart:{numerator:0,denominator:1},sourceEndExclusive:{numerator:durationSeconds,denominator:1},
    timelineStart:{numerator:0,denominator:1},playbackRate:{numerator:1,denominator:1}}]};
}

/** Source requests are compared with trusted registrations before processing any byte. */
export function validateAdmissionResources(request,{declarations,totalFrames}) {
  if(validate(request).length)throw Error('ADMISSION_RESOURCES_INVALID');
  if(declarations.markers.length>64||new Set(declarations.videoUses.map(use=>use.id)).size!==declarations.videoUses.length
    ||new Set(declarations.fonts.map(font=>font.fontId)).size!==declarations.fonts.length)throw Error('ADMISSION_DECLARATIONS_INVALID');
  const available=[...catalog,...admittedFontCatalog()];
  const generated=request.generatedAudio??[],generatedIds=new Set();
  for(const source of generated) {
    if(generatedIds.has(source.id)||available.some(r=>r.id===source.id)||!request.resourceIds.includes(source.id)
      ||!request.audioEvents.some(e=>e.sourceId===source.id))throw Error('ADMISSION_GENERATED_AUDIO_INVALID');
    generatedIds.add(source.id);
    available.push({id:source.id,mediaType:'audio/wav',path:'audio/generated-'+generatedAudioRequestHash(source,totalFrames).slice(0,24)+'.wav',
      licenseRef:'pending-generated-rights',generated:true});
  }
  const selected=request.resourceIds.map(id=>{
    const resource=available.find(resource=>resource.id===id);if(!resource)throw Error('ADMISSION_RESOURCE_UNAUTHORIZED: '+id);return resource;
  });
  const availableFonts=allAdmittedFontDeclarations();
  for(const font of declarations.fonts) {
    const approved=availableFonts.find(item=>item.fontId===font.fontId);
    if(!approved||canonical(approved)!==canonical(font)||!request.resourceIds.includes(font.fontId))throw Error('ADMISSION_FONT_UNAUTHORIZED');
    if(font.fallbackFontIds.some(id=>!declarations.fonts.some(item=>item.fontId===id)))throw Error('FONT_FALLBACK_UNDECLARED');
  }
  for(const use of declarations.videoUses) {
    if(!selected.some(resource=>resource.path===use.assetPath&&resource.mediaType==='video/mp4'))throw Error('ADMISSION_VIDEO_UNAUTHORIZED');
    const at=value=>value.numerator/value.denominator;
    if(at(use.sourceStart)>=at(use.sourceEndExclusive)||at(use.sourceEndExclusive)>30||at(use.playbackRate)<=0
      ||at(use.timelineStart)>=totalFrames/30)throw Error('ADMISSION_VIDEO_USE_INVALID');
  }
  const ids=new Set();
  for(const event of request.audioEvents) {
    const length=event.frameEndExclusive-event.frameStart,available=event.sourceId==='original-score'?900:generatedIds.has(event.sourceId)?totalFrames:6;
    const generatedSource=generated.find(source=>source.id===event.sourceId);
    if(generatedSource&&event.kind!==(generatedSource.kind==='sfx'?'sfx':'music'))throw Error('ADMISSION_AUDIO_EVENT_INVALID');
    if(ids.has(event.eventId)||!selected.some(resource=>resource.id===event.sourceId&&resource.mediaType==='audio/wav')
      ||length<=0||event.frameEndExclusive>totalFrames||event.sourceOffsetFrames+length>available
      ||event.fadeInFrames+event.fadeOutFrames>length)throw Error('ADMISSION_AUDIO_EVENT_INVALID');
    ids.add(event.eventId);
    if(event.gainAutomation&&(event.gainAutomation[0].frameOffset!==0||event.gainAutomation.at(-1).frameOffset!==length
      ||event.gainAutomation.some((key,i)=>key.frameOffset>length||(i&&key.frameOffset<=event.gainAutomation[i-1].frameOffset))))
      throw Error('ADMISSION_AUDIO_AUTOMATION_INVALID');
  }
  if(declarations.markers.some(marker=>marker.audioEventId&&!ids.has(marker.audioEventId)))throw Error('ADMISSION_AUDIO_MARKER_INVALID');
  return selected;
}

function prepareAudio(request,outputDirectory,frameCount,audioRights) {
  verifyAudioRights(request.generatedAudio??[],frameCount,audioRights);
  if(!request.audioEvents.length)return null;
  assertAudioEnvironment();
  const bytes={},licenses={},sourceLicenses={},generatedReports=[];
  const selected=new Set(request.audioEvents.map(event=>event.sourceId));
  if(selected.has('original-score')||selected.has('original-cue')) {
    const license=readFixtureLicense('tests/fixtures/render/audio-fixture.mjs'),source=synthesizeFixtureAudio();
    if(selected.has('original-score'))bytes['original-score']=pcm16Wav(source.music);
    if(selected.has('original-cue'))bytes['original-cue']=pcm16Wav(source.cue);
    licenses[license.licenseRef]={...license,sourceHashes:Object.values(bytes).map(sha256)};
    for(const id of Object.keys(bytes))sourceLicenses[id]=license.licenseRef;
  }
  for(const source of request.generatedAudio??[]) {
    const ownRights=audioRights?{...audioRights,approvals:audioRights.approvals.filter(a=>a.sourceId===source.id)}:null;
    const rendered=synthesizeGeneratedAudio(source,{totalFrames:frameCount,audioRights:ownRights});
    bytes[source.id]=pcm16Wav(rendered.samples);
    const license={...rendered.rights,sourceHashes:[sha256(bytes[source.id])]};
    licenses[license.licenseRef]=license;sourceLicenses[source.id]=license.licenseRef;
    generatedReports.push({sourceId:source.id,...rendered.report});
  }
  const sources=new Map(Object.values(bytes).map(value=>[sha256(value),value]));
  const audioEvents=request.audioEvents.map(({sourceId,...event})=>({...event,sourceHash:sha256(bytes[sourceId]),licenseRef:sourceLicenses[sourceId]}));
  const raw=mixPcmEvents({events:audioEvents,sources,licenses,frameCount}),rawPath=join(outputDirectory,'before-level.wav');
  let rawPeak=0;for(const sample of raw)rawPeak=Math.max(rawPeak,Math.abs(sample));
  const stagingGain=Math.min(1,.98/Math.max(rawPeak,1e-12));
  writeFileSync(rawPath,pcm16Wav(Float64Array.from(raw,s=>s*stagingGain)));
  const before=measureAudioLoudness(rawPath);rmSync(rawPath);
  const measuredGainDb=Math.min(-16-before.integratedLufs,-1.5-before.truePeakDbtp),gain=stagingGain*10**(measuredGainDb/20),gainDb=20*Math.log10(gain);
  const mixedBytes=pcm16Wav(Float64Array.from(raw,sample=>sample*gain)),mixedPath=join(outputDirectory,'mixed.wav');
  writeFileSync(mixedPath,mixedBytes);const measurement=measureAudioLoudness(mixedPath);
  if(Math.abs(measurement.integratedLufs+16)>0.5||measurement.truePeakDbtp>-1) {
    const error=Error('AUDIO_LEVEL_INVALID');error.details={integratedLufs:measurement.integratedLufs,truePeakDbtp:measurement.truePeakDbtp,
      normalizationGainDb:gainDb};throw error;
  }
  const mixedAudio={resourcePath:'audio/mixed.wav',sha256:sha256(mixedBytes),sampleRate:48000,channels:2,mixerVersion:'mix-v1'};
  const resources=Object.entries(bytes).map(([id,value])=>({path:catalog.find(item=>item.id===id)?.path
    ??'audio/generated-'+generatedAudioRequestHash(request.generatedAudio.find(s=>s.id===id),frameCount).slice(0,24)+'.wav',
    sha256:sha256(value),byteLength:value.length,mediaType:'audio/wav',licenseRef:sourceLicenses[id]}));
  let mixedLicenseRef=Object.keys(licenses)[0];
  if(generatedReports.length) {
    mixedLicenseRef='generated-mix-'+mixedAudio.sha256.slice(0,24);
    licenses[mixedLicenseRef]={licenseRef:mixedLicenseRef,license:'LicenseRef-PromoBento-Generated-Mix',
      sourceLicenseRefs:Object.keys(licenses),sourceHashes:[mixedAudio.sha256],allowedUses:['process','mix','preview','export']};
  }
  resources.push({path:'audio/mixed.wav',sha256:mixedAudio.sha256,byteLength:mixedBytes.length,mediaType:'audio/wav',licenseRef:mixedLicenseRef});
  return {mixedPath,mixedAudio,audioEvents,resources,report:{measurement,normalization:{kind:'constant_gain_before_freeze',gainDb,stagingGain,preMix:before},
    sampleFrames:frameCount*1600,licenseRecords:licenses,generatedSources:generatedReports,audioHash:digest(audioIdentity({audioEvents,mixedAudio})),
    subjectiveListening:'requires_human'}};
}

/** Runs only in the trusted media container, never from source module evaluation. */
export function prepareAdmissionMedia({request,declarations,input,outputDirectory,audioRights=null}) {
  const selected=validateAdmissionResources(request,{declarations,totalFrames:input.totalFrames});
  const licensed=readFixtureLicense('apps/renderer/src/media-assets.mjs');
  const wantsVideo=selected.some(item=>item.mediaType==='video/mp4');
  const prepared=wantsVideo?prepareFixtureMedia({outputDirectory}):null;
  const fontIds=declarations.fonts.map(f=>f.fontId),fonts=reviewedAdmissionFonts(fontIds),routes=new Map(),resources=[],images=[];
  for(const resource of selected) {
    if(resource.mediaType==='font/woff') {
      const paths=fonts.fonts.filter(font=>font.fontId===resource.id).map(font=>font.path);
      for(const admitted of fonts.resources.filter(item=>paths.includes(item.path))) {resources.push(admitted);routes.set(admitted.url,fonts.routes.get(admitted.url));}
    } else if(resource.mediaType==='video/mp4') {
      resources.push(prepared.manifest.resources.find(item=>item.path===resource.path));
      for(const [url,data] of prepared.routes)if(data.contentType!=='font/woff')routes.set(url,data);
    } else if(resource.mediaType==='image/png') {
      const bytes=screenPixels(resource.id==='screen-still'?0:30),hash=sha256(bytes),url='/media-fixture/'+hash+'.png';
      const admitted={path:resource.path,url,sha256:hash,byteLength:bytes.length,mediaType:'image/png',licenseRef:licensed.licenseRef};
      resources.push(admitted);routes.set(url,{bytes,contentType:'image/png',path:resource.path});images.push({...admitted,id:resource.id,width:320,height:180});
    }
  }
  const audio=prepareAudio(request,outputDirectory,input.totalFrames,audioRights);
  const manifest={version:'m0a-media-v1',resources,fonts:fonts.fonts.filter(font=>selected.some(item=>item.id===font.fontId)),
    videos:prepared?.manifest.videos??[],limits:{maxDecodedFrames:8,maxDecodedBytes:8*320*180*4}};
  const resourceManifest={resources:[...resources.map(({url,...resource})=>resource),...(audio?.resources??[])],audioEvents:audio?.audioEvents??[],mixedAudio:audio?.mixedAudio??null};
  return {manifest,routes,images,audio,fontMetrics:admittedFontMetrics(fontIds),resourceManifest,
    report:{catalogVersion:'admitted-media-v2',resourceManifest,manifestHash:digest(resourceManifest),
      video:prepared?.report??null,audio:audio?.report??null,imageResources:images.map(({id,path,sha256})=>({id,path,sha256})),
      licenseEvidence:{originalMedia:licensed,fonts:fonts.registry.fonts.map(({fontId,licenseRef,licenseSha256})=>({fontId,licenseRef,licenseSha256}))}}};
}
