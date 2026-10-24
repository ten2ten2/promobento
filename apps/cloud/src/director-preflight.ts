import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import platform from '../../../config/platform-presets.json';
import {operation,rights,immutableJson} from './store.ts';
import type {PipelineEnv,Operation,Json} from './pipeline-types.ts';

const cacheMs=10*60000;
/** Probe the actual image, Chromium sandbox and broker/R2 before a paid model request. */
export async function directorEnvironment(env:PipelineEnv,op:Operation,context:Json,resources:Json[],deadlineAt:number){
 await operation(env,op.id,op.generation);await rights(env,op,resources);
 const release=await env.DB.prepare("SELECT * FROM renderer_releases WHERE id=? AND status='active'").bind(context.rendererRelease).first<Json>();
 if(!release||release.runtime_version!==context.runtimeVersion||release.image_digest!==await env.SHARDS.getByName('release-metadata').imageDigest())throw Error('RENDER_ENVIRONMENT_MISMATCH');
 const coordinator=env.COORDINATOR.getByName('global-v1'),cacheKey=digest({release:release.id,image:release.image_digest,runtime:release.runtime_version,environment:release.environment_key});
 const cached=parseCanonicalJson(await coordinator.rendererHealth(cacheKey)) as Json|null;
 if(cached&&cached.checkedAt<=Date.now()&&Date.now()-cached.checkedAt<cacheMs)return;
 if(Date.now()>=deadlineAt)throw Error('OPERATION_DEADLINE');
 const font=context.fonts?.[0];if(!font)throw Error('DIRECTOR_INPUT_INVALID');
 const film={schemaVersion:'3.0.0',specVersion:'film-v1',audience:context.audience,durationSeconds:15,fps:30,totalFrames:450,
  style:{palette:{roles:{bg:'#101712',ink:'#f4f8ee',accent:'#d9fa73'},sources:{bg:'preflight',ink:'preflight',accent:'preflight'}},
   type:{display:{fontId:font.fontId,weight:font.weight},text:{fontId:font.fontId,weight:font.weight},scale:'regular'},
   motion:{language:'continuous-take',energy:1,easing:'expo-out',transitions:'tight'}},
  audio:{music:{kind:'none'},sfx:[],captions:'off',mute:true},assets:{},texts:{headline:{text:'Render health check',role:'headline',factIds:[]}},
  scenes:[{id:'health',start:0,end:450,kind:'block',block:'hook-title@1',params:{textSlot:'headline'},purpose:'Private renderer health probe.'}],
  treatment:{message:'Private renderer health probe.',hook:'Readiness only.',energyCurve:[{frame:0,level:1},{frame:449,level:1}],continuity:'Single trusted block.'}};
 const taskId='health-'+crypto.randomUUID(),source=await immutableJson(env,`operations/${op.id}/health/${taskId}/film.json`,film);
 const aspect='landscape',layout=platform.aspectLayouts.landscape;
 const task={schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance:'standard-3',taskId,generation:op.generation,
  deadlineAt:Math.min(deadlineAt,Date.now()+90000),imageDigest:release.image_digest,
  job:{schemaVersion:'3.0.0',kind:'render_job',renderId:taskId,operationId:op.id,candidateId:taskId,sourceHash:filmSourceHash(canonical(film)),
   runtimeVersion:context.runtimeVersion,rendererRelease:release.id,aspectId:aspect,durationSeconds:15,totalFrames:450,quality:'still',frames:[45],
   renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources},
  options:{target:{aspect,width:layout.width,height:layout.height,safeInsets:layout.safeInsets,fps:30,totalFrames:450},seed:context.seed,
   fonts:context.fonts,resources:[],confirmedFactIds:[],initTimeoutMs:30000,frameTimeoutMs:5000},inputs:[{...source,name:'film'}]};
 const owner=env.OPERATIONS.getByName(op.id);
 let failed=false;
 try{
  const ready=parseCanonicalJson(await owner.studio(op.id,canonical(task))) as Json;
  if(ready.status!=='ready')throw Error('RENDER_PREFLIGHT_FAILED');
  const frame=await owner.frame(op.id,45);if(!frame.ok)throw Error('RENDER_PREFLIGHT_FAILED');
  const bytes=new Uint8Array(await frame.arrayBuffer());
  if(bytes.length<8||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))throw Error('RENDER_PREFLIGHT_FAILED');
  await operation(env,op.id,op.generation);
 }catch(error){failed=true;throw error;}
 finally{try{await owner.closeStudio();}catch(error){if(!failed)throw error;}}
 // A stop failure cannot create a healthy cache entry; it retains the lease for cleanup.
 await coordinator.rememberRendererHealth(cacheKey,canonical({checkedAt:Date.now(),release:release.id,imageDigest:release.image_digest,taskId}));
}
