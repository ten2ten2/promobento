import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {canonical} from '../../../packages/contracts/src/canonical.mjs';

const built=await build({
 stdin:{contents:'export {normalizeNativeVideo} from "./apps/render-container/src/media.mjs";',resolveDir:process.cwd()},
 bundle:true,write:false,platform:'node',format:'esm',target:'node26',
 plugins:[{name:'media-process-fixture',setup(b){
  b.onResolve({filter:/\/process\.mjs$/},()=>({path:'process',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const run=(...args)=>globalThis.__mediaPrecheckRun(...args);',loader:'js'}));
 }}]
});
const {normalizeNativeVideo}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('a native stream with known B frames skips full decoded-frame validation and takes the fallback',async t=>{
 let decoded=0,encoded=0;
 globalThis.__mediaPrecheckRun=async(command,args)=>{
  if(command==='ffprobe'){
   if(args.includes('-show_frames')){decoded++;throw Error('UNEXPECTED_FULL_DECODE');}
   return{stdout:canonical({streams:[{codec_type:'video',codec_name:'h264',profile:'High',has_b_frames:2,
    width:320,height:180,duration:'1',pix_fmt:'yuv420p',r_frame_rate:'30/1',avg_frame_rate:'30/1',field_order:'progressive',
    color_space:'bt709',color_transfer:'bt709',color_primaries:'bt709'}],format:{duration:'1'}})};
  }
  if(command==='ffmpeg'){encoded++;throw Error('FALLBACK_STARTED');}
  throw Error('UNEXPECTED_MEDIA_TOOL');
 };
 t.after(()=>delete globalThis.__mediaPrecheckRun);
 await assert.rejects(normalizeNativeVideo('native.mp4','film.mp4',{width:320,height:180,durationSeconds:1,fps:30}),/FALLBACK_STARTED/);
 assert.equal(decoded,0,'metadata-proven B frames must not trigger an extra full-film frame scan');
 assert.equal(encoded,1,'the trusted fallback encoder is still launched');
});
