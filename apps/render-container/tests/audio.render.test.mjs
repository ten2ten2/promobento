import {mkdirSync,writeFileSync} from 'node:fs';
import {canonical} from '@promobento/contracts/canonical';
import {audioSamples} from './audio-samples.mjs';
if(process.platform!=='linux'||process.getuid()!==10001)throw Error('RENDER_CONTAINER_REQUIRED');
const directory='/work/film-runtime',report={scope:'guofeng_synthwave_audio_repair_only',status:'running'};
mkdirSync(directory,{recursive:true});
try{report.samples=await audioSamples(directory+'/audio-samples',{styles:['guofeng','synthwave']});report.status='passed';}
catch(error){report.status='failed';report.failure=String(error.stack??error);throw error;}
finally{writeFileSync(directory+'/report.json',canonical(report));console.log(canonical(report));}
