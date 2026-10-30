import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {customFixture} from '../../../packages/film-runtime/test/custom-fixture.mjs';
import {filmFixture} from '../../../packages/film-runtime/test/fixture.mjs';
import {verifyRenderSource} from '../src/render-source.ts';

test('render admission binds custom source bytes without changing trusted-block admission',async()=>{
 const {film,sources}=customFixture(),path='scenes/product/index.js',bytes=new TextEncoder().encode(sources[path]);
 const blob={name:path,key:'evals/fixture/source.js',sha256:sha256Bytes(bytes),byteLength:bytes.length};
 const env={MEDIA:{async get(key){return key===blob.key?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;}}};
 const hash=filmSourceHash(canonical(film),sources);
 assert.deepEqual(await verifyRenderSource(env,film,[blob],hash),sources);
 await assert.rejects(verifyRenderSource(env,film,[],hash),/CUSTOM_SOURCE_MISSING/);
 await assert.rejects(verifyRenderSource(env,film,[{...blob,sha256:'0'.repeat(64)}],hash),/RENDER_OUTPUT_IDENTITY_MISMATCH/);
 await assert.rejects(verifyRenderSource(env,film,[blob],'0'.repeat(64)),/SOURCE_IDENTITY_MISMATCH/);
 await assert.rejects(verifyRenderSource(env,film,[{...blob,byteLength:65537}],hash),/CUSTOM_SOURCE_SIZE/);
 const trusted=filmFixture();assert.deepEqual(await verifyRenderSource(env,trusted,[],filmSourceHash(canonical(trusted))),{});
});
