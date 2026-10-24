import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

/** D1-compatible async entry points, with a synchronous SQLite transaction for batch. */
export function sqliteD1(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync('apps/cloud/migrations/0001_s1_pipeline.sql','utf8'));
 const DB={prepare(sql){
  let args=[];
  return{bind(...values){args=values;return this;},
   async first(){return db.prepare(sql).get(...args)??null;},
   async all(){return{results:db.prepare(sql).all(...args)};},
   runSync(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};},
   async run(){return this.runSync();}};
 },async batch(statements){
  db.exec('BEGIN');
  try{const results=statements.map(statement=>statement.runSync());db.exec('COMMIT');return results;}
  catch(error){db.exec('ROLLBACK');throw error;}
 }};
 return{db,DB};
}
