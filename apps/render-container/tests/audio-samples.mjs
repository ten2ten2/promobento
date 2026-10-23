import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonical} from '@promobento/contracts/canonical';
import {AUDIO_STYLES} from '../../../packages/audio/src/catalog.mjs';
import {GENERATED_LICENSE,audioPlanHash} from '../../../packages/audio/src/plan.mjs';
import {renderAudio} from '../src/audio.mjs';
export async function audioSamples(destination){
  mkdirSync(destination,{recursive:true});const samples=[];
  for(const style of AUDIO_STYLES){
    const plan={schemaVersion:'3.0.0',kind:'audio_plan',totalFrames:900,sampleRate:48000,channels:2,loudnessTarget:-14,truePeakMax:-1,
      music:{kind:'procedural',style,sourceId:'music'},events:[{eventId:'music:bed',kind:'music',sourceId:'music',frameStart:0,frameEndExclusive:900,gainDb:0,fadeOutFrames:15}],
      sources:[{sourceId:'music',origin:'procedural',licenseRef:GENERATED_LICENSE}]};
    const directory=join(destination,style);mkdirSync(directory);
    const result=await renderAudio({plan,inputs:{seed:'s1-style-listening-'+style,clearedSources:new Map([['music',{licenseRef:GENERATED_LICENSE,rightsCleared:true}]])},directory});
    writeFileSync(join(directory,'audio-plan.json'),canonical(plan));samples.push({style,audioPlanHash:audioPlanHash(plan,{seed:'s1-style-listening-'+style}),file:style+'/mixed.wav',...result});
  }
  writeFileSync(join(destination,'index.json'),canonical({normalSpeedOwnerReview:'pending',samples}));return samples.length;
}
