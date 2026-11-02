import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

test('recovery indexes preserve unknown costs and support pending-attempt lookup',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const name of ['0001_s1_pipeline','0002_workflow_recovery','0003_directing_method',
   '0004_native_projects','0005_render_admissions','0006_workflow_stop_checkpoints'])
   db.exec(readFileSync(`apps/cloud/migrations/${name}.sql`,'utf8'));
  db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
   .run('test-operation','workspace','project',0,'evaluation','failed','hash',1000,1,2,null);
  db.prepare('INSERT INTO cost_reservations VALUES(?,?,?,?,?,?,?,?)')
   .run('unknown-fee','test-operation','hash','model','stage',900,'catalog',1);
  const migration=readFileSync('apps/cloud/migrations/0007_recovery_query_indexes.sql','utf8');
  db.exec(migration);db.exec(migration);
  assert.equal(db.prepare('SELECT reserved_micros FROM cost_reservations WHERE id=?').get('unknown-fee').reserved_micros,900);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
  const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row=>row.name));
  for(const name of ['pipeline_workflow_native_pending','pipeline_attempt_unstopped',
   'pipeline_render_unpassed','pipeline_cost_unsettled_join','pipeline_outbox_unsent'])assert.ok(names.has(name),name);
  const plan=db.prepare('EXPLAIN QUERY PLAN SELECT id FROM pipeline_attempts WHERE operation_id=? AND stopped_at IS NULL').all('test-operation');
  assert.ok(plan.some(row=>String(row.detail).includes('pipeline_attempt_unstopped')),JSON.stringify(plan));
 }finally{db.close();}
});
