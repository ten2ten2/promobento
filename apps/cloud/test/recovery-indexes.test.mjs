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
  assert.ok(!names.has('pipeline_workflow_pending'),'replace the superseded index, avoiding duplicate write costs');
  for(const name of ['pipeline_workflow_native_pending','pipeline_attempt_unstopped',
   'pipeline_render_unpassed','pipeline_cost_operation_order','pipeline_outbox_unsent',
   'pipeline_operation_active_recovery','pipeline_render_queued_recovery'])assert.ok(names.has(name),name);
  const uses=(sql,index,args=[])=>{
   const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>String(row.detail));
   assert.ok(plan.some(detail=>detail.includes(index)),`${index}: ${JSON.stringify(plan)}`);
  };
  uses('SELECT id FROM pipeline_attempts WHERE operation_id=? AND stopped_at IS NULL',
   'pipeline_attempt_unstopped',['test-operation']);
  uses("SELECT id,status FROM pipeline_renders WHERE operation_id=? AND status<>'passed'",
   'pipeline_render_unpassed',['test-operation']);
  uses('SELECT * FROM pipeline_outbox WHERE delivered_at IS NULL ORDER BY rowid LIMIT 100',
   'pipeline_outbox_unsent');
  uses('SELECT r.id,r.kind FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.operation_id=? ORDER BY r.id',
   'pipeline_cost_operation_order',['test-operation']);
  uses(`SELECT * FROM (SELECT w.*, ROW_NUMBER() OVER (
    PARTITION BY CASE WHEN o.status IN ('failed','cancelled') THEN 'terminal:'||w.operation_id
      ELSE 'workflow:'||w.kind||':'||w.id END
    ORDER BY COALESCE(w.last_checked_at,0),w.registered_at,w.kind,w.id) AS sweep_rank
    FROM pipeline_workflows w JOIN pipeline_operations o ON o.id=w.operation_id
    WHERE w.engine='huashu' AND w.reconciled_at IS NULL)
    WHERE sweep_rank=1 ORDER BY COALESCE(last_checked_at,0),registered_at LIMIT 20`,
   'pipeline_workflow_native_pending');
  uses(`SELECT b.id FROM pipeline_operations o CROSS JOIN pipeline_outbox b
    WHERE o.status IN ('active','awaiting_user') AND b.id='creative-'||o.id AND b.kind='creative'
      AND b.delivered_at<=?`, 'pipeline_operation_active_recovery',[1]);
  uses(`SELECT b.id FROM pipeline_renders r CROSS JOIN pipeline_operations o CROSS JOIN pipeline_outbox b
    WHERE r.status='queued' AND o.id=r.operation_id AND o.status='active'
      AND b.id='render-'||r.id AND b.kind='render' AND b.delivered_at<=?`,
   'pipeline_render_queued_recovery',[1]);
 }finally{db.close();}
});
