import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {operation,reserve,settle} from '../src/store.ts';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sqliteD1} from './fixtures/sqlite.mjs';

// Match Wrangler's bundled JSON import, rather than Node's native JSON-module syntax.
const {outputFiles}=await build({entryPoints:['apps/cloud/src/render-task.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'node26'});
const {runRenderTask}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));

async function fixture({errors=['RENDER_CAPACITY_UNAVAILABLE'],cleanup='confirmed',onSleep,remainingMs=180000}={}){
 const {db,DB}=sqliteD1(),now=Date.now(),calls=[],sleeps=[],cache=new Map(),stops=[];
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('op','workspace','project',0,'calibration','active','fixture',1000,now,null,null);
 db.prepare('INSERT INTO pipeline_renders VALUES(?,?,?,?,?,?,?,?,?)').run('render','op',0,'fixture','evals/input.json','sharding',now,null,null);
 const env={DB,SHARDS:{getByName(id){return{
  async execute(text){const payload=parseCanonicalJson(text);calls.push(payload);
   await reserve(env,await operation(env,'op'),id,'compute','render',100,payload,'fixture',1000,1000);
   const error=errors[calls.length-1];if(error)throw Error(error);
   await settle(env,id,11,{fixture:id});return canonical({status:'succeeded',outputs:[],report:{fixture:true}});
  },
  async isStopped(){return cleanup!=='running';},
  async stopAndSettle(){stops.push(id);if(cleanup==='throws')throw Error('fixture_cleanup');
   if(cleanup!=='unsettled')await settle(env,id,7,{fixture:id});
  }
 };}}};
 const context={renderId:'render',op:await operation(env,'op'),job:{resources:[]},imageDigest:'fixture',deadlineAt:now+remainingMs};
 const task={name:'shard-0',mode:'shard',instance:'standard-3',additions:{shard:{index:0}}};
 const step={async do(name,configOrFn,callback){if(cache.has(name))return cache.get(name);
  if(callback)assert.equal(configOrFn.retries.limit,0,'no native step retry is layered over the application scheduler');
  const value=await(callback??configOrFn)();cache.set(name,value);return value;
 },async sleep(name,duration){if(!cache.has(name)){sleeps.push(duration);await onSleep?.(db);cache.set(name,true);}}};
 return{db,context,task,calls,stops,sleeps,cache,run:()=>runRenderTask(env,step,context,task)};
}

test('one durable retry owner preserves old checkpoints, stops and settles before a new attempt, and keeps all fences',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.run()).status,'succeeded');assert.equal(f.calls.length,2);assert.deepEqual(f.sleeps,['15 seconds']);
  assert.notEqual(f.calls[0].taskId,f.calls[1].taskId);assert.equal(f.calls[0].deadlineAt,f.calls[1].deadlineAt);
  assert.equal(f.calls[0].generation,f.calls[1].generation);assert.equal(f.stops.length,1);
  assert.equal(f.db.prepare('SELECT SUM(actual_micros) AS total FROM cost_settlements').get().total,18);
  assert.equal(f.db.prepare('SELECT max_micros FROM pipeline_operations').get().max_micros,1000);
  const failed=f.db.prepare("SELECT result_json,stopped_at FROM pipeline_attempts WHERE status='failed'").get();
  assert.ok(failed.stopped_at);assert.equal(parseCanonicalJson(failed.result_json).code,'RENDER_CAPACITY_UNAVAILABLE');
  assert.equal((await f.run()).status,'succeeded');assert.equal(f.calls.length,2);assert.equal(f.stops.length,1);
 }finally{f.db.close();}
 const legacy=await fixture();
 try{legacy.cache.set('shard-0-id','historical-id');legacy.cache.set('shard-0',canonical({status:'succeeded',legacy:true}));
  assert.equal((await legacy.run()).legacy,true);assert.equal(legacy.calls.length,0);assert.equal(legacy.sleeps.length,0);
 }finally{legacy.db.close();}
 const exhausted=await fixture({errors:Array(4).fill('RENDER_CAPACITY_UNAVAILABLE')});
 try{await assert.rejects(exhausted.run(),/RENDER_CAPACITY_UNAVAILABLE/);assert.equal(exhausted.calls.length,3);assert.deepEqual(exhausted.sleeps,['15 seconds','60 seconds']);}
 finally{exhausted.db.close();}
 for(const cleanup of ['throws','running','unsettled']){
  const unknown=await fixture({cleanup});try{await assert.rejects(unknown.run(),/RENDER_CAPACITY_UNAVAILABLE/);assert.equal(unknown.calls.length,1);assert.equal(unknown.sleeps.length,0);}
  finally{unknown.db.close();}
 }
 for(const code of ['RENDER_SEAM_BLOCK','RUNTIME_NETWORK_FORBIDDEN','COST_BUDGET_EXHAUSTED','ASSET_RIGHTS_PENDING','RENDER_DEADLINE']){
  const fixed=await fixture({errors:[code]});try{await assert.rejects(fixed.run(),error=>error.message===code);assert.equal(fixed.calls.length,1);assert.equal(fixed.sleeps.length,0);}
  finally{fixed.db.close();}
 }
 const cancelled=await fixture({onSleep:db=>db.prepare("UPDATE pipeline_operations SET generation=1,status='cancelled'").run()});
 try{await assert.rejects(cancelled.run(),/OPERATION_FENCED/);assert.equal(cancelled.calls.length,1);}
 finally{cancelled.db.close();}
 const deadline=await fixture({remainingMs:10000});
 try{await assert.rejects(deadline.run(),/RENDER_DEADLINE/);assert.equal(deadline.calls.length,1);assert.equal(deadline.sleeps.length,0);}
 finally{deadline.db.close();}
 const budget=await fixture();budget.db.prepare('UPDATE pipeline_operations SET max_micros=100').run();
 try{await assert.rejects(budget.run(),/COST_BUDGET_EXHAUSTED/);
  assert.equal(budget.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,1);
  assert.equal(budget.db.prepare('SELECT SUM(actual_micros) AS total FROM cost_settlements').get().total,7);
 }finally{budget.db.close();}
 const transport=await fixture({errors:['Network connection lost.']});
 try{assert.equal((await transport.run()).status,'succeeded');assert.equal(transport.calls.length,2);}
 finally{transport.db.close();}
});
