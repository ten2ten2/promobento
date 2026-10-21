import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {parseCanonicalJson,digest,audioIdentity} from '@promobento/contracts';
import {environmentLock,sha256,sha256File} from './environment.mjs';
import {fixtureAudioMarkers,fixtureCueFrequency,synthesizeFixtureAudio} from '../../../tests/fixtures/render/audio-fixture.mjs';

export const AUDIO_SAMPLE_RATE=48000;
export const AUDIO_CHANNELS=2;
export const SAMPLES_PER_FRAME=1600;
export const FIXTURE_MIXER_VERSION='mix-v1';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const maxSamples=900*SAMPLES_PER_FRAME*AUDIO_CHANNELS;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const fail=code=>{throw new Error(code);};

function localAudioFile(path) {
  if (typeof path!=='string'||!path.trim()||path.includes('\0')||/^[a-z][a-z0-9+.-]*:/i.test(path)) fail('AUDIO_LOCAL_FILE_REQUIRED');
  const absolute=resolve(path);
  if (!statSync(absolute,{throwIfNoEntry:false})?.isFile()) fail('AUDIO_LOCAL_FILE_REQUIRED');
  return absolute;
}

/** Canonical bounded PCM16 WAV. Unsupported encodings require a separately admitted decoder. */
export function pcm16Wav(samples) {
  if (!(samples instanceof Float64Array || samples instanceof Float32Array)
    || samples.length%2 || samples.length>maxSamples) fail('AUDIO_PCM_INVALID');
  const bytes=Buffer.alloc(44+samples.length*2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);
  bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(192000,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(samples.length*2,40);
  for (let index=0;index<samples.length;index++) {
    if (!finite(samples[index]) || Math.abs(samples[index])>1) fail('AUDIO_CLIPPING');
    bytes.writeInt16LE(Math.round(samples[index]*32767),44+index*2);
  }
  return bytes;
}

export function readPcm16Wav(input) {
  const bytes=Buffer.from(input);
  if (bytes.length<44 || bytes.length>44+maxSamples*2 || bytes.toString('ascii',0,4)!=='RIFF'
    || bytes.readUInt32LE(4)!==bytes.length-8 || bytes.toString('ascii',8,12)!=='WAVE') fail('AUDIO_WAV_INVALID');
  let format=null,data=null,offset=12;
  while (offset<bytes.length) {
    if (offset+8>bytes.length) fail('AUDIO_WAV_INVALID');
    const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;
    if (end>bytes.length) fail('AUDIO_WAV_INVALID');
    if (kind==='fmt ') {
      if (format || size!==16) fail('AUDIO_WAV_UNSUPPORTED');
      format={encoding:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),sampleRate:bytes.readUInt32LE(start+4),
        byteRate:bytes.readUInt32LE(start+8),blockAlign:bytes.readUInt16LE(start+12),bits:bytes.readUInt16LE(start+14)};
    } else if (kind==='data') {
      if (data) fail('AUDIO_WAV_INVALID');
      data=bytes.subarray(start,end);
    }
    offset=end+(size%2);
  }
  if (offset!==bytes.length || !data || !format || format.encoding!==1 || format.channels!==2 || format.sampleRate!==48000
    || format.bits!==16 || format.byteRate!==192000 || format.blockAlign!==4 || data.length%4) fail('AUDIO_WAV_UNSUPPORTED');
  const samples=new Float64Array(data.length/2);
  for (let index=0;index<samples.length;index++) samples[index]=data.readInt16LE(index*2)/32768;
  return {samples,sampleRate:48000,channels:2,sampleFrames:data.length/4};
}

function licensedSource(event,sources,licenses) {
  const source=sources.get(event.sourceHash),license=licenses?.[event.licenseRef];
  // The caller supplies trusted admission records, never creator assertions.
  // Check them before decoding any source bytes, including a source later muted in the mix.
  if (!license || license.license!=='CC0-1.0' || license.sourceHashes?.includes(event.sourceHash)!==true
    || !['process','mix','preview','export'].every(use=>license.allowedUses?.includes(use))) fail('AUDIO_LICENSE_REQUIRED');
  if (!source || sha256(source)!==event.sourceHash) fail('AUDIO_SOURCE_HASH_MISMATCH');
  return readPcm16Wav(source);
}

/**
 * Event order is fixed. Automation interpolates dB at exact 1/1600-frame sample positions;
 * fades are linear amplitude, multiplied after gain. Empty timeline regions remain zero.
 * This is a reviewed-fixture PCM mixer, not arbitrary audio-format admission.
 */
export function mixPcmEvents({events,sources,licenses,frameCount}) {
  if (!integer(frameCount)||frameCount<1||frameCount>900 || !Array.isArray(events)||events.length>900
    || !(sources instanceof Map)) fail('AUDIO_PLAN_INVALID');
  const samples=new Float64Array(frameCount*SAMPLES_PER_FRAME*2),ids=new Set();
  const decoded=new Map();
  for (const event of events) {
    if (!event || typeof event.eventId!=='string'||!event.eventId || ids.has(event.eventId)) fail('AUDIO_EVENT_ID_INVALID');
    ids.add(event.eventId);
    const length=event.frameEndExclusive-event.frameStart;
    if (!['frameStart','frameEndExclusive','sourceOffsetFrames','fadeInFrames','fadeOutFrames'].every(key=>integer(event[key]))
      || !finite(event.gainDb) || event.gainDb < -96 || event.gainDb > 24 || length<=0 || event.frameEndExclusive>frameCount
      || event.fadeInFrames+event.fadeOutFrames>length) fail('AUDIO_EVENT_INVALID');
    const source=licensedSource(event,sources,licenses);
    // A cached decode cannot bypass a different event's license check.
    const stored=decoded.get(event.sourceHash)||source;decoded.set(event.sourceHash,stored);
    if ((event.sourceOffsetFrames+length)*SAMPLES_PER_FRAME>stored.sampleFrames) fail('AUDIO_SOURCE_RANGE_INVALID');
    const keys=event.gainAutomation??[{frameOffset:0,gainDb:0},{frameOffset:length,gainDb:0}];
    if (!Array.isArray(keys)||keys.length<2||keys.length>256 || keys[0]?.frameOffset!==0||keys.at(-1)?.frameOffset!==length
      || keys.some((key,index)=>!integer(key.frameOffset)||key.frameOffset>length||!finite(key.gainDb)||key.gainDb < -96||key.gainDb > 24
        || (index>0&&key.frameOffset<=keys[index-1].frameOffset))) fail('AUDIO_AUTOMATION_INVALID');
    const sampleLength=length*SAMPLES_PER_FRAME,sourceStart=event.sourceOffsetFrames*SAMPLES_PER_FRAME,
      timelineStart=event.frameStart*SAMPLES_PER_FRAME,fadeIn=event.fadeInFrames*SAMPLES_PER_FRAME,fadeOut=event.fadeOutFrames*SAMPLES_PER_FRAME;
    let keyIndex=0;
    for (let sample=0;sample<sampleLength;sample++) {
      const position=sample/SAMPLES_PER_FRAME;
      while (keyIndex+1<keys.length-1&&position>=keys[keyIndex+1].frameOffset) keyIndex++;
      const a=keys[keyIndex],b=keys[keyIndex+1],delta=a.gainDb+(b.gainDb-a.gainDb)*(position-a.frameOffset)/(b.frameOffset-a.frameOffset);
      let amplitude=10**((event.gainDb+delta)/20);
      if (fadeIn) amplitude*=Math.min(1,sample/fadeIn);
      if (fadeOut) amplitude*=Math.min(1,(sampleLength-1-sample)/fadeOut);
      for (let channel=0;channel<2;channel++)
        samples[(timelineStart+sample)*2+channel]+=stored.samples[(sourceStart+sample)*2+channel]*amplitude;
    }
  }
  return samples;
}

export function assertAudioEnvironment() {
  if (process.versions.node!==environmentLock.nodeVersion || sha256File('/usr/bin/ffmpeg')!==environmentLock.ffmpeg.executableSha256
    || sha256File('/usr/bin/ffprobe')!==environmentLock.ffmpeg.ffprobeSha256) fail('AUDIO_TOOLCHAIN_MISMATCH');
}

const command=(file,args,options={})=>execFileSync(file,args,{timeout:60000,killSignal:'SIGKILL',maxBuffer:24*1024*1024,...options});

/** FFmpeg's input measurements, not the proposed loudnorm output, establish the actual file's level. */
export function measureAudioLoudness(path) {
  path=localAudioFile(path);
  const result=spawnSync('/usr/bin/ffmpeg',['-hide_banner','-nostdin','-i',path,'-map','0:a:0',
    '-af','loudnorm=I=-16:TP=-1:LRA=11:print_format=json','-f','null','-'],
    {encoding:'utf8',timeout:60000,killSignal:'SIGKILL',maxBuffer:2*1024*1024});
  if (result.error) throw result.error;
  if (result.status!==0) fail('AUDIO_MEASUREMENT_FAILED: '+result.stderr.slice(-2000));
  const matches=[...result.stderr.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)];
  if (matches.length!==1) fail('AUDIO_MEASUREMENT_INVALID');
  const measurement=parseCanonicalJson(matches[0][0]);
  const output={integratedLufs:Number(measurement.input_i),truePeakDbtp:Number(measurement.input_tp),
    loudnessRangeLu:Number(measurement.input_lra),thresholdLufs:Number(measurement.input_thresh)};
  if (!Object.values(output).every(finite)) fail('AUDIO_MEASUREMENT_INVALID');
  return output;
}

export function prepareFixtureAudio({outputDirectory,durationSeconds=30}) {
  assertAudioEnvironment();
  if (durationSeconds!==30 || typeof outputDirectory!=='string'||!outputDirectory.trim()) fail('AUDIO_FIXTURE_OPTIONS_INVALID');
  const licensePath='tests/fixtures/render/LICENSE.txt',generatorPath='tests/fixtures/render/audio-fixture.mjs';
  const licenseBytes=readFileSync(join(root,licensePath)),generatorBytes=readFileSync(join(root,generatorPath));
  if (!licenseBytes.toString('utf8').startsWith('CC0 1.0 Universal') || !/audio|waveform|score/i.test(licenseBytes.toString('utf8')))
    fail('AUDIO_FIXTURE_LICENSE_MISSING');
  const directory=join(resolve(outputDirectory),'audio');mkdirSync(directory,{recursive:true});
  const source=synthesizeFixtureAudio(durationSeconds),musicBytes=pcm16Wav(source.music),cueBytes=pcm16Wav(source.cue);
  const musicHash=sha256(musicBytes),cueHash=sha256(cueBytes),licenseRef='rights_m0a_procedural_audio_cc0';
  const license={license:'CC0-1.0',source:'original_procedural_score_and_waveforms',evidencePath:licensePath,
    evidenceSha256:sha256(licenseBytes),generatorPath,generatorSha256:sha256(generatorBytes),
    allowedUses:['process','mix','preview','export'],sourceHashes:[musicHash,cueHash]};
  const sources=new Map([[musicHash,musicBytes],[cueHash,cueBytes]]),licenses={[licenseRef]:license};
  const musicEvent={eventId:'music_bed',kind:'music',sourceHash:musicHash,licenseRef,frameStart:0,frameEndExclusive:900,
    sourceOffsetFrames:0,gainDb:0,fadeInFrames:15,fadeOutFrames:15,
    gainAutomation:[{frameOffset:0,gainDb:0},{frameOffset:25,gainDb:0},{frameOffset:30,gainDb:-4},{frameOffset:36,gainDb:-4},
      {frameOffset:45,gainDb:0},{frameOffset:295,gainDb:0},{frameOffset:300,gainDb:-4},{frameOffset:306,gainDb:-4},
      {frameOffset:315,gainDb:0},{frameOffset:595,gainDb:0},{frameOffset:600,gainDb:-4},{frameOffset:606,gainDb:-4},
      {frameOffset:615,gainDb:0},{frameOffset:900,gainDb:0}]};
  const audioEvents=[musicEvent,...fixtureAudioMarkers.map(marker=>({eventId:marker.audioEventId,kind:'sfx',sourceHash:cueHash,
    licenseRef,frameStart:marker.frame,frameEndExclusive:marker.frame+6,sourceOffsetFrames:0,gainDb:0,fadeInFrames:0,fadeOutFrames:2}))];
  const raw=mixPcmEvents({events:audioEvents,sources,licenses,frameCount:900});
  const rawPath=join(directory,'mix-before-level.wav');writeFileSync(rawPath,pcm16Wav(raw));
  const before=measureAudioLoudness(rawPath);
  // A constant post gain is frozen once, before preview/export, with enough AAC peak headroom.
  const normalizationGainDb=Math.min(-16-before.integratedLufs,-1.5-before.truePeakDbtp);
  const gain=10**(normalizationGainDb/20),normalized=Float64Array.from(raw,sample=>sample*gain);
  const mixedPath=join(directory,'mixed.wav'),mixedBytes=pcm16Wav(normalized);writeFileSync(mixedPath,mixedBytes);
  writeFileSync(join(directory,'music.wav'),musicBytes);writeFileSync(join(directory,'cue.wav'),cueBytes);
  const mixedHash=sha256(mixedBytes),measurement=measureAudioLoudness(mixedPath);
  if (Math.abs(measurement.integratedLufs+16)>0.5 || measurement.truePeakDbtp>-1) fail('AUDIO_LEVEL_INVALID');
  const mixedAudio={resourcePath:'audio/mixed.wav',sha256:mixedHash,sampleRate:48000,channels:2,mixerVersion:FIXTURE_MIXER_VERSION};
  const resources=[['audio/music.wav',musicBytes],['audio/cue.wav',cueBytes],['audio/mixed.wav',mixedBytes]].map(([path,bytes])=>
    ({path,sha256:sha256(bytes),byteLength:bytes.length,mediaType:'audio/wav',licenseRef}));
  license.sourceHashes.push(mixedHash);
  const audioMetadata=Object.fromEntries([[musicHash,musicBytes],[cueHash,cueBytes],[mixedHash,mixedBytes]].map(([hash,bytes])=>{
    const {sampleRate,channels,sampleFrames}=readPcm16Wav(bytes);return [hash,{sampleRate,channels,sampleFrames}];
  }));
  const manifest={audioEvents,mixedAudio,resources};
  const report={mixerVersion:FIXTURE_MIXER_VERSION,implementation:'fixture-pcm16-linear-db-v1',normalization:{kind:'constant_gain_before_freeze',gainDb:normalizationGainDb,
    targetIntegratedLufs:-16,maxTruePeakDbtp:-1,preMix:before},measurement,
    sourceHashes:[musicHash,cueHash],mixedAudioHash:mixedHash,audioHash:digest(audioIdentity(manifest)),
    sampleFrames:audioMetadata[mixedHash].sampleFrames,licenseRecords:licenses,
    limitations:['original engineering score; no subjective music-quality or human listening acceptance']};
  writeFileSync(join(directory,'manifest.json'),JSON.stringify({...manifest,audioMetadata,markers:fixtureAudioMarkers,report},null,2)+'\n');
  return {mixedPath,mixedAudio,resources,audioEvents,markers:fixtureAudioMarkers,audioMetadata,report};
}

/** The probe's effective packet interval excludes AAC pre-roll and signalled tail padding. */
export function effectiveAudioInterval(probe) {
  const stream=probe.streams?.find(item=>item.codec_type==='audio');
  if (!stream || stream.codec_name!=='aac'||Number(stream.sample_rate)!==48000||stream.channels!==2||stream.time_base!=='1/48000')
    fail('AUDIO_OUTPUT_FORMAT_INVALID');
  const packets=probe.packets?.filter(packet=>packet.stream_index===stream.index);
  if (!packets?.length) fail('AUDIO_PACKETS_MISSING');
  let start=Infinity,end=-Infinity,primingSamples=0,discardPaddingSamples=0,previousEnd=null;
  for (const packet of packets) {
    if (!Number.isSafeInteger(packet.pts)||!Number.isSafeInteger(packet.duration)||packet.duration<=0) fail('AUDIO_PACKET_TIME_INVALID');
    const skip=packet.side_data_list?.find(item=>item.side_data_type==='Skip Samples');
    const before=Number(skip?.skip_samples??0),after=Number(skip?.discard_padding??0);
    if (!integer(before)||!integer(after)||before+after>packet.duration) fail('AUDIO_PACKET_TRIM_INVALID');
    if (previousEnd!==null && packet.pts!==previousEnd) fail('AUDIO_PACKET_GAP');
    previousEnd=packet.pts+packet.duration;
    primingSamples+=before;discardPaddingSamples+=after;
    if (packet.duration>before+after) {start=Math.min(start,packet.pts+before);end=Math.max(end,packet.pts+packet.duration-after);}
  }
  if (!finite(start)||!finite(end)||end<=start) fail('AUDIO_PLAYBACK_INTERVAL_INVALID');
  return {startSample:start,endSample:end,effectiveSampleFrames:end-start,primingSamples,discardPaddingSamples,
    startSeconds:start/48000,endSeconds:end/48000};
}

/** Independently observe the engineering cue in decoded audio; declarations supply only a search window. */
export function observeFixtureCue(samples,{frame,frequency=fixtureCueFrequency}) {
  if (!integer(frame)||frame>899 || !(samples instanceof Float32Array || samples instanceof Float64Array)) fail('AUDIO_CUE_INPUT_INVALID');
  const window=96,step=48,expected=frame*SAMPLES_PER_FRAME,start=Math.max(0,expected-24000),
    end=Math.min(samples.length/2-window,expected+24000),powers=[];
  for (let position=start;position<=end;position+=step) {
    let real=0,imaginary=0;
    for (let index=0;index<window;index++) {
      const sample=(samples[(position+index)*2]+samples[(position+index)*2+1])/2;
      const weighted=sample*(0.5-0.5*Math.cos(2*Math.PI*index/(window-1))),phase=2*Math.PI*frequency*index/48000;
      real+=weighted*Math.cos(phase);imaginary+=weighted*Math.sin(phase);
    }
    powers.push({sample:position,power:(real*real+imaginary*imaginary)/(window*window)});
  }
  const peak=Math.max(...powers.map(item=>item.power));
  if (!finite(peak)||peak<1e-6) fail('AUDIO_CUE_MISSING');
  const first=powers.find(item=>item.power>=peak*0.35);
  return {sample:first.sample,seconds:first.sample/48000,frame:first.sample/SAMPLES_PER_FRAME,peakBandPower:peak,
    detector:'3600hz_hann_96_samples_hop_48_v1'};
}

export function validateEncodedAudio(videoPath,{mixedPath,mixedAudio,durationSeconds=30,frameCount=durationSeconds*30,
  markers=fixtureAudioMarkers,visualMarkerFrames,referenceStartSample=0}={}) {
  assertAudioEnvironment();
  videoPath=localAudioFile(videoPath);mixedPath=localAudioFile(mixedPath);
  const sourceBytes=readFileSync(mixedPath);
  if (sha256(sourceBytes)!==mixedAudio?.sha256) fail('AUDIO_MIX_HASH_MISMATCH');
  const source=readPcm16Wav(sourceBytes);
  if (!integer(frameCount)||frameCount<1||frameCount>900||durationSeconds!==frameCount/30||!integer(referenceStartSample)
    || referenceStartSample+frameCount*SAMPLES_PER_FRAME>source.sampleFrames) fail('AUDIO_MIX_LENGTH_INVALID');
  const reference=source.samples.subarray(referenceStartSample*2,(referenceStartSample+frameCount*SAMPLES_PER_FRAME)*2);
  const probe=parseCanonicalJson(command('/usr/bin/ffprobe',['-v','error','-select_streams','a:0','-show_streams','-show_packets',
    '-show_format','-of','json',videoPath]));
  const interval=effectiveAudioInterval(probe);
  const containerDuration=Number(probe.format?.duration);
  if (interval.startSample!==0 || Math.abs(interval.endSeconds-durationSeconds)>0.1
    || !finite(containerDuration)||Math.abs(containerDuration-durationSeconds)>2/30) fail('AUDIO_VIDEO_END_MISMATCH');
  const decoded=command('/usr/bin/ffmpeg',['-v','error','-nostdin','-i',videoPath,'-map','0:a:0','-c:a','pcm_f32le',
    '-ar','48000','-ac','2','-f','f32le','pipe:1']);
  if (decoded.length%8 || decoded.length/8<interval.effectiveSampleFrames || decoded.length/8>interval.effectiveSampleFrames+1024)
    fail('AUDIO_DECODE_LENGTH_INVALID');
  const samples=new Float32Array(decoded.length/4);
  for (let index=0;index<samples.length;index++) {samples[index]=decoded.readFloatLE(index*4);if (!finite(samples[index])) fail('AUDIO_DECODE_INVALID');}
  let dot=0,sourcePower=0,actualPower=0,errorPower=0;
  for (let index=0;index<reference.length;index++) {
    const expected=reference[index],actual=samples[index];
    dot+=expected*actual;sourcePower+=expected*expected;actualPower+=actual*actual;errorPower+=(expected-actual)**2;
  }
  const correlation=dot/Math.sqrt(sourcePower*actualPower),relativeRmsError=Math.sqrt(errorPower/sourcePower);
  if (!finite(correlation)||correlation<0.97||relativeRmsError>0.2) fail('AUDIO_MIX_NOT_CONSUMED');
  if (!Array.isArray(visualMarkerFrames)||visualMarkerFrames.length!==markers.length) fail('AUDIO_VISUAL_OBSERVATION_REQUIRED');
  const cueChecks=markers.map(marker=>{
    const visual=visualMarkerFrames.filter(item=>item.audioEventId===marker.audioEventId);
    if (visual.length!==1 || !integer(visual[0].frame)||visual[0].frame>=frameCount) fail('AUDIO_VISUAL_OBSERVATION_REQUIRED');
    const observed=observeFixtureCue(samples,marker),differenceFrames=observed.frame-visual[0].frame;
    if (Math.abs(differenceFrames)>1) fail('AUDIO_VISUAL_SYNC_MISMATCH');
    return {eventId:marker.audioEventId,visualFrame:visual[0].frame,observedAudioFrame:observed.frame,
      differenceFrames,observedAudioSeconds:observed.seconds,detector:observed.detector};
  });
  const measurement=measureAudioLoudness(videoPath);
  const fullProgram=referenceStartSample===0&&frameCount*SAMPLES_PER_FRAME===source.sampleFrames;
  if ((fullProgram&&Math.abs(measurement.integratedLufs+16)>0.6)||measurement.truePeakDbtp>-1) fail('AUDIO_LEVEL_INVALID');
  return {mixedAudioHash:mixedAudio.sha256,encodedFileHash:sha256File(videoPath),encodedBytes:statSync(videoPath).size,
    sampleRate:48000,channels:2,codec:'aac',profile:probe.streams[0].profile,interval,
    referenceRange:{startSample:referenceStartSample,endSampleExclusive:referenceStartSample+frameCount*SAMPLES_PER_FRAME},
    decodedSampleFrames:decoded.length/8,decoderTailPaddingFrames:decoded.length/8-interval.effectiveSampleFrames,
    mixedAudioComparison:{correlation,relativeRmsError},measurement,programLoudnessChecked:fullProgram,cueChecks,
    provenance:'decoded AAC compared with the frozen WAV; cue audio measured against observed visual frames'};
}
