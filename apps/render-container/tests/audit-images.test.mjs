import test from 'node:test';
import assert from 'node:assert/strict';
import {selectAuditWindows,changingDetail} from '../src/audit-images.mjs';

test('inspection windows identify real adjacent preview frames and report unexamined cues',()=>{
 const audit={status:'measured',fps:15,frames:225,firstFrame:{empty:true},pops:[{at:3}],dead:[{from:5,to:8,seconds:3},{from:9,to:11,seconds:2}]};
 const result=selectAuditWindows(audit);
 assert.deepEqual(result.windows[0].frames,[0,2,4,6,8,10]);
 assert.deepEqual(result.windows[1].frames,[86,88,90,92,94,96]);assert.equal(result.omitted,2);
 assert.deepEqual(selectAuditWindows({status:'unavailable'}),{windows:[],omitted:0});
});
test('detail is a bounded difference crop, not a claim to have tracked a pointer',()=>{
 const size=320*180,bytes=Buffer.alloc(size*2);bytes[size+150*320+280]=255;
 assert.deepEqual(changingDetail(bytes,2),{x:.5,y:.5,width:.5,height:.5,selection:'largest_difference_on_320x180_grid_not_pointer_tracking'});
 assert.equal(changingDetail(Buffer.alloc(size*2),2),null);
 assert.throws(()=>changingDetail(Buffer.alloc(1),2),/AUDIT_IMAGE_FRAME_COUNT_MISMATCH/);
});
test('prioritizes substantive holds over a longer intentional end card',()=>{
 const audit={status:'measured',fps:30,frames:450,firstFrame:{empty:false},pops:[],dead:[
  {from:2.43,to:4.1,seconds:1.67},{from:4.3,to:5.87,seconds:1.57},{from:12,to:14.97,seconds:2.97}]};
 const result=selectAuditWindows(audit);
 assert.equal(result.omitted,1);assert.ok(result.windows[0].frames[0]<120);
 assert.ok(result.windows[1].frames[0]>=160&&result.windows[1].frames.at(-1)<=170);
});
