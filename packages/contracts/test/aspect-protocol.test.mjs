import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson,digest} from '../index.mjs';
import {validateSchema,semanticErrors,matchesFrameReady,matchesSampleReady,matchesProtocolFailure} from '../../../scripts/contract-validation.mjs';
import {filmContractFixture} from '../../../tests/contracts/film-fixture.mjs';

test('aspect envelopes match the pinned frame/session and retain unmixed legacy replay',()=>{
 const legacy=parseCanonicalJson(readFileSync(new URL('../../../tests/contracts/protocol-fixtures.json',import.meta.url))).valid;
 const x=filmContractFixture(),hash=digest(x.composition);
 const aspect=value=>{const{targetId,...rest}=value;return{...rest,revisionId:x.composition.revisionId,aspectId:'landscape'};};
 for(const value of Object.values(legacy).filter(value=>value.protocolVersion))assert.deepEqual(validateSchema(aspect(value)),[]);
 const init={...aspect(legacy.render_init),manifestHash:hash,frameCount:450,width:1920,height:1080,seed:x.composition.seed,renderProfile:x.composition.renderProfile};
 assert.deepEqual(semanticErrors(init,{composition:x.composition}),[]);
 assert.ok(semanticErrors({...init,width:1080},{composition:x.composition}).includes('RENDER_SIZE_NOT_FROM_PRESET'));
 const seek=aspect(legacy.render_seek),ready={...aspect(legacy.render_ready),manifestHash:hash};
 assert.equal(matchesFrameReady(seek,ready,hash),true);
 assert.equal(matchesFrameReady(seek,{...ready,aspectId:'portrait'},hash),false);
 assert.equal(matchesFrameReady(seek,{...ready,targetId:'x:landscape'},hash),false);
 assert.equal(matchesFrameReady(legacy.render_seek,legacy.render_ready,legacy.render_init.manifestHash),true);
 const sample={...aspect(legacy.render_sample),sampleIndex:0},sampleReady={...aspect(legacy.render_sample_ready),manifestHash:hash,sampleIndex:0};
 assert.equal(matchesSampleReady(sample,sampleReady,hash,{composition:x.composition,rendererSession:true}),true);
 const failure={...seek,event:'error',code:'FRAME_TIMEOUT'};delete failure.command;delete failure.frameIndex;
 assert.equal(matchesProtocolFailure(seek,failure),true);
 assert.equal(matchesProtocolFailure(seek,{...failure,aspectId:'portrait'}),false);
});
