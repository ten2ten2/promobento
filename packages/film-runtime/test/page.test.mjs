import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateFilmPage} from '../src/page.ts';
import {frameLayers} from '../src/motion.ts';
import {blockCatalog} from '../../blocks/src/catalog.ts';
import {createSchemaValidator,parseCanonicalJson} from '../../contracts/index.mjs';
import {filmFixture,pageOptions} from './fixture.mjs';

const rules=parseCanonicalJson(readFileSync(new URL('../../../config/platform-presets.json',import.meta.url)));
const options=()=>pageOptions('landscape',rules.aspectLayouts.landscape);
const make=(spec=filmFixture(),opts=options())=>generateFilmPage(JSON.stringify(spec),opts);

test('the three original block manifests pass the shared manifest Schema',()=>{
  const validate=createSchemaValidator(parseCanonicalJson(readFileSync(new URL('../../../contracts/block.schema.json',import.meta.url))));
  for(const block of blockCatalog)assert.deepEqual(validate(block),[]);
});
test('the page is aspect-level, ordered, offline and free from author HTML injection',()=>{
  for(const [aspect,layout]of Object.entries(rules.aspectLayouts)){
    const x=make(filmFixture(),pageOptions(aspect,layout));
    assert.equal(x.plan.target.aspect,aspect);assert.equal(Object.hasOwn(x.plan.target,'targetId'),false);
    const positions=['shim','engine','blocks','boot'].map(name=>x.html.indexOf('/runtime/'+name+'.js'));
    assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
    assert.match(x.csp,/connect-src 'none'/);assert.match(x.csp,/frame-src 'none'/);
    assert.match(x.html,/data-om-signature="off"/);
  }
  const spec=filmFixture();spec.texts.headline.text='</script><script src="https://evil.example/x.js">';
  const {html}=make(spec);assert.ok(!html.includes(spec.texts.headline.text));assert.ok(html.includes('\\u003c/script>'));
  const dirty=options();dirty.target.targetId='youtube:landscape';dirty.target.websiteTheme='light';
  assert.equal(Object.hasOwn(make(filmFixture(),dirty).plan.target,'targetId'),false);
  assert.equal(Object.hasOwn(make(filmFixture(),dirty).plan.target,'websiteTheme'),false);
  const long=filmFixture(),longOptions=options();long.durationSeconds=30;long.totalFrames=900;long.scenes.at(-1).end=900;longOptions.target.totalFrames=900;
  assert.equal(make(long,longOptions).plan.spec.totalFrames,900);
});
test('raw JSON must pass canonical parsing and complete Ajv before page generation',()=>{
  assert.throws(()=>generateFilmPage('{"fps":30,"fps":60}',options()),/DUPLICATE_JSON_KEY/);
  const spec=filmFixture();spec.durationSeconds=45;assert.throws(()=>make(spec),/FILM_SCHEMA_INVALID/);
  const extra=filmFixture();extra.unexpected=true;assert.throws(()=>make(extra),/FILM_SCHEMA_INVALID/);
  assert.throws(()=>generateFilmPage(' '.repeat(8*1024*1024+1),options()),/FILM_SOURCE_TOO_LARGE/);
});
test('first processing requires the trusted fact and rights context, including exact font faces',()=>{
  const opts=options();opts.confirmedFactIds=[];assert.throws(()=>make(filmFixture(),opts),/FACT_UNCONFIRMED/);
  opts.confirmedFactIds=['fixture-cta'];opts.resources[0].rightsCleared=false;assert.throws(()=>make(filmFixture(),opts),/ASSET_RIGHTS_PENDING/);
  opts.resources[0].rightsCleared=true;opts.fonts[0].rightsCleared=false;assert.throws(()=>make(filmFixture(),opts),/FONT_RIGHTS_OR_FACE_MISSING/);
  opts.fonts[0].rightsCleared=true;opts.fonts[0].weight=400;assert.throws(()=>make(filmFixture(),opts),/FONT_RIGHTS_OR_FACE_MISSING/);
  assert.throws(()=>make(filmFixture(),{}),/FILM_TRUSTED_CONTEXT_REQUIRED/);
});
test('parameters and referenced text/assets are checked, and unfinished capabilities fail explicitly',()=>{
  const spec=filmFixture();spec.scenes[0].params.inject='x';assert.throws(()=>make(spec),/BLOCK_PARAMS_INVALID/);
  delete spec.scenes[0].params.inject;spec.scenes[0].params.textSlot='missing';assert.throws(()=>make(spec),/TEXT_SLOT_UNKNOWN/);
  const custom=filmFixture();custom.scenes[0]={...custom.scenes[0],kind:'custom',module:'scenes/hook/index.js',brief:'test'};
  delete custom.scenes[0].block;delete custom.scenes[0].params;assert.throws(()=>make(custom),/CUSTOM_SCENES_NOT_IMPLEMENTED/);
  const layout=filmFixture();layout.scenes[0].layout={portrait:{x:1}};assert.throws(()=>make(layout),/LAYOUT_OVERRIDES_NOT_IMPLEMENTED/);
});
test('frame layers are history-free, half-open and carry scene-local time and transition state',()=>{
  const spec=filmFixture();assert.deepEqual(frameLayers(spec.scenes,0).map(x=>x.id),['hook']);
  assert.deepEqual(frameLayers(spec.scenes,120).map(x=>x.id),['hook','product']);
  assert.deepEqual(frameLayers(spec.scenes,126).map(x=>x.id),['product']);
  assert.equal(frameLayers(spec.scenes,120)[1].seconds,0);assert.equal(frameLayers(spec.scenes,126)[0].seconds,.2);
  const once=frameLayers(spec.scenes,333);frameLayers(spec.scenes,449);assert.deepEqual(frameLayers(spec.scenes,333),once);
  assert.equal(once[0].opacity,1);assert.equal(once[1].opacity,.5);
  for(const type of ['push','whip']){spec.scenes[1].transitionIn.type=type;const layers=frameLayers(spec.scenes,123);
    assert.equal(layers[1].x-layers[0].x,1);assert.equal(layers[0].blur>0,type==='whip');}
  assert.deepEqual(frameLayers(spec.scenes,450),[]);
});
