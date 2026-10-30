import test from 'node:test';
import assert from 'node:assert/strict';
import {directorBlockParamIssues} from '../src/director-block-feedback.ts';

test('repair feedback reports the chosen block parameter error, not other oneOf branches',()=>{
 for(const block of ['feature-grid@1','drawn-steps@1']){
  const issues=directorBlockParamIssues(block,{items:[{textSlot:'practice'}]},2);
  assert.deepEqual(issues,[{code:'BLOCK_PARAMS_MINITEMS',path:'/scenes/2/params/items',hint:'must NOT have fewer than 2 items'}]);
 }
 assert.deepEqual(directorBlockParamIssues('feature-grid@1',{items:[{textSlot:'one'},{textSlot:'two'}]},2),[]);
 assert.deepEqual(directorBlockParamIssues('feature-grid@1',{items:[{textSlot:'one'},{textSlot:'two'}],extra:true},1),
  [{code:'BLOCK_PARAMS_ADDITIONALPROPERTIES',path:'/scenes/1/params/extra',hint:'must NOT have additional properties'}]);
});
