import test from 'node:test';
import assert from 'node:assert/strict';
import {directingMethodPack,recallDirecting} from './directing.ts';
import source from './huashu-motion/source.mjs';

test('native stage recall preserves upstream references and the selected original template',()=>{
 const treatment=recallDirecting(directingMethodPack,'treatment','software');
 assert.equal(treatment.version,'2.1.0');assert.match(treatment.audience,/workflow/);
 assert.ok(treatment.hypit.references.some(ref=>ref.path==='references/creation/script-and-time.md'&&ref.content.length>0));
 const author=recallDirecting(directingMethodPack,'author','software','cursor-demo');
 assert.equal(author.huashu.revision,'52467f99c602b76ba86d511d37acdfe93fa1e16e');
 assert.equal(author.huashu.template.path,'ui-space/index.html');
 assert.equal(author.huashu.template.content,source.templateSources['ui-space/index.html']);
 for(const ref of author.huashu.references){assert.equal(typeof ref.content,'string');assert.equal(ref.content,source.references[ref.path]);}
 assert.equal(directingMethodPack.huashuSource,source,'the complete original source pack remains available');
 assert.match(recallDirecting(directingMethodPack,'coldReview','course').audience,/worked step/);
 assert.ok(recallDirecting(directingMethodPack,'directions','software').huashu.references.some(ref=>ref.path==='references/library/languages/cursor-demo.md'));
});

test('only the current native method and stages are callable',()=>{
 const frozen={...directingMethodPack,version:'2.0.0',stages:{...directingMethodPack.stages,triage:['Historical triage guidance']}};
 assert.throws(()=>recallDirecting(frozen,'treatment','software'),/DIRECTING_METHOD_UNSUPPORTED/);
 assert.throws(()=>recallDirecting(frozen,'triage','software'),/DIRECTING_METHOD_UNSUPPORTED/);
 assert.throws(()=>recallDirecting({...directingMethodPack,version:'1.58.0'},'author','software'),/DIRECTING_METHOD_UNSUPPORTED/);
 assert.throws(()=>recallDirecting(directingMethodPack,'scenes','software'),/DIRECTING_METHOD_UNSUPPORTED/);
 assert.throws(()=>recallDirecting(directingMethodPack,'spec','software'),/DIRECTING_METHOD_UNSUPPORTED/);
});
