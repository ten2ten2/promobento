import test from 'node:test';
import assert from 'node:assert/strict';
import {editableValuesErrors,localPreviewValues} from '../index.mjs';

const context=()=>({editables:{
  title:{id:'title',type:'text',factId:'headline'},footer:{id:'footer',type:'text',factId:'headline'},
  tint:{id:'tint',type:'color'},size:{id:'size',type:'number',min:0,max:10,step:2},
  enabled:{id:'enabled',type:'boolean'},layout:{id:'layout',type:'enum',choices:['small','large']},
  rows:{id:'rows',type:'data'},art:{id:'art',type:'asset'},beat:{id:'beat',type:'number',affectsTiming:true}},
  sourceValues:{title:'Same',footer:'Same',tint:'#abcdef',size:3,enabled:true,layout:'small',rows:[],art:'art/photo.png',beat:90},
  resources:{'art/photo.png':{mediaType:'image/png'},'docs/evidence.pdf':{mediaType:'application/pdf'},'art/hidden.png':{mediaType:'image/png'}},
  drawableResourcePaths:['art/photo.png']});

test('browser and server share complete typed values, source limits, asset access and nonquantized numbers',()=>{
  const ctx=context();assert.deepEqual(editableValuesErrors(ctx.sourceValues,ctx),[]);
  const next=localPreviewValues({title:'Changed',tint:'#AABBCC',size:3.5,rows:[{text:'Cell',number:2,flag:false,empty:null}]},ctx);
  assert.equal(next.title,'Changed');assert.equal(next.footer,'Changed');assert.equal(next.tint,'#aabbcc');assert.equal(next.size,3.5);
  assert.equal(ctx.sourceValues.title,'Same','Local changes cannot mutate the frozen source');
  for(const overlay of [{unknown:1},{title:6000},{tint:'red'},{size:11},{enabled:1},{layout:'other'},
    {rows:[{nested:{value:1}}]},{art:'docs/evidence.pdf'},{art:'art/hidden.png'},{title:'\ud800'}])
    assert.throws(()=>localPreviewValues(overlay,ctx));
  assert.throws(()=>localPreviewValues({title:'x'.repeat(6001)},ctx),/EDITABLE_TEXT_INVALID/);
  const missing={...ctx.sourceValues};delete missing.rows;
  assert(editableValuesErrors(missing,ctx).includes('EDITABLE_VALUE_MISSING'));
});

test('bound text edits reject conflicts and indirect timing changes; an empty overlay restores frozen source',()=>{
  const ctx=context();
  assert.throws(()=>localPreviewValues({title:'A',footer:'B'},ctx),/EDITABLE_FACT_VALUE_CONFLICT/);
  assert.throws(()=>localPreviewValues({beat:90},ctx),/EDITABLE_REQUIRES_AI/);
  ctx.editables.footer.affectsTiming=true;
  assert.throws(()=>localPreviewValues({title:'New'},ctx),/EDITABLE_REQUIRES_AI/);
  assert.deepEqual(localPreviewValues({},ctx),ctx.sourceValues);
});

test('a structured values overlay cannot bypass canonical byte or JSON object constraints',()=>{
  const ctx={editables:{table:{id:'table',type:'data'}},sourceValues:{table:[]}};
  assert.throws(()=>localPreviewValues({table:Array.from({length:1000},()=>({text:'x'.repeat(6000)}))},ctx),/SOURCE_VALUES_TOO_LARGE/);
  const accessor={get table(){throw Error('Must not execute accessors');}};
  assert.throws(()=>localPreviewValues(accessor,ctx),/SOURCE_VALUES_INVALID/);
  const cyclic={table:[]};cyclic.table.push({self:cyclic});
  assert.throws(()=>localPreviewValues(cyclic,ctx),/SOURCE_VALUES_INVALID/);
});
