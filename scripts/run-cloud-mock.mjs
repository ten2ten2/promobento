// Runs the real director orchestration with SQLite/R2 fixtures and provider SSE replay. No network or Docker.
import {build} from 'esbuild';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseCanonicalJson} from '../packages/contracts/src/canonical.mjs';
import {buildValidators} from '../packages/contracts/scripts/build-validators.mjs';
const directory=mkdtempSync(join(tmpdir(),'promobento-cloud-mock-'));
try{
 buildValidators();
 await build({entryPoints:['apps/cloud/test/director.mock.ts'],outfile:join(directory,'director.test.mjs'),bundle:true,platform:'node',format:'esm',target:'node26',logLevel:'warning',plugins:[{
  name:'offline-cloud-fixtures',setup(build){
   build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare:workers',namespace:'fixture'}));
   build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class WorkflowEntrypoint { constructor(ctx, env) { this.ctx=ctx; this.env=env; } }',loader:'js'}));
   build.onLoad({filter:/[/\\]config[/\\]model-providers\.json$/},args=>{
    const config=parseCanonicalJson(readFileSync(args.path));
    // Only this offline bundle admits synthetic official responses. The deployed catalog stays unverified.
    for(const model of Object.values(config.models))model.capabilities.verified=true;
    return{contents:JSON.stringify(config),loader:'json'};
   });
  }
 }]});
 const result=spawnSync(process.execPath,['--test',...process.argv.slice(2),join(directory,'director.test.mjs')],{stdio:'inherit'});
 if(result.error)throw result.error;process.exitCode=result.status??1;
}finally{rmSync(directory,{recursive:true,force:true});}
