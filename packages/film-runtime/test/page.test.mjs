import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateFilmPage} from '../src/page.ts';
import {frameLayers} from '../src/motion.ts';
import {blockCatalog} from '../../blocks/src/catalog.ts';
import {createSchemaValidator,parseCanonicalJson} from '../../contracts/index.mjs';
import {filmFixture,pageOptions} from './fixture.mjs';
import {customFixture} from './custom-fixture.mjs';

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
  delete custom.scenes[0].block;delete custom.scenes[0].params;assert.throws(()=>make(custom),/CUSTOM_SOURCE_MISSING/);
  const layout=filmFixture();layout.scenes[0].layout={portrait:{x:1}};assert.throws(()=>make(layout),/LAYOUT_OVERRIDES_NOT_IMPLEMENTED/);
});
test('original Vox template accepts only cleared stills and preserves a final reading hold',()=>{
 const film=filmFixture();film.scenes=[{id:'vox',start:0,end:450,kind:'block',block:'vox-clip@1',
  params:{intervalFrames:90,items:[{assetKey:'dashboard'},{assetKey:'dashboard'}]},purpose:'Two real source states.'}];
 assert.doesNotThrow(()=>make(film));
 film.scenes[0].params.intervalFrames=120;film.scenes[0].params.items[0].focus='roi:0';assert.doesNotThrow(()=>make(film));
 film.scenes[0].params.items[0].focus='roi:7';assert.throws(()=>make(film),/VOX_CLIP_ROI_INVALID/);
 film.scenes[0].params.items[0].focus='roi:0';film.scenes[0].params.intervalFrames=90;assert.throws(()=>make(film),/VOX_CLIP_HIGHLIGHT_HOLD_MISSING/);
 delete film.scenes[0].params.items[0].focus;film.scenes[0].params.intervalFrames=90;
 const video=options();video.resources[0].kind='video';assert.throws(()=>make(film,video),/VOX_CLIP_IMAGE_REQUIRED/);
 film.scenes[0].params.items[1].assetKey='missing';assert.throws(()=>make(film),/ASSET_SLOT_UNKNOWN|ASSET_UNKNOWN/);
});
test('audited Canvas title accepts a bounded headline and refuses unproved scripts and mixed custom code',()=>{
 const film=filmFixture();film.assets={};film.texts={headline:{text:'HELLO',role:'headline',factIds:[]}};
 film.scenes=[{id:'title',start:0,end:450,kind:'block',block:'canvas-title@1',params:{textSlot:'headline'},purpose:'Synthetic Canvas headline.'}];
 const opts=options();opts.resources=[];const page=make(film,opts);assert.match(page.html,/PBC-geist-sans-600/);
 for(const text of ['a\u0301','مرحبا','A\nB','😀🏽']){const candidate=structuredClone(film);candidate.texts.headline.text=text;assert.throws(()=>make(candidate,opts),/CANVAS_TITLE_TEXT_UNSUPPORTED/);}
 const wrongRole=structuredClone(film);wrongRole.texts.headline.role='body';assert.throws(()=>make(wrongRole,opts),/CANVAS_TITLE_TEXT_UNSUPPORTED/);
 const mixed=customFixture();mixed.film.scenes[0].start=225;mixed.film.scenes[0].end=450;
 mixed.film.scenes[0].params.events=[];mixed.film.scenes[0].params.readingHolds=[{start:0,end:225}];
 mixed.film.scenes.unshift({...film.scenes[0],end:225});mixed.film.assets={};
 const mixedOpts=options();mixedOpts.resources=[];mixedOpts.customSources=mixed.sources;
 assert.throws(()=>make(mixed.film,mixedOpts),/CANVAS_TITLE_CUSTOM_MIX_UNSUPPORTED/);
});
test('the original Canvas counter requires a confirmed bounded number and complete digit coverage',()=>{
 const film=filmFixture();film.assets={};film.texts={number:{text:'123',role:'number',factIds:['fixture-cta']}};
 film.scenes=[{id:'count',start:0,end:450,kind:'block',block:'canvas-number@1',params:{textSlot:'number'},purpose:'Count an exact confirmed value.'}];
 const opts=options();opts.resources=[];opts.fonts[0].codePoints=[...Array(10)].map((_,i)=>48+i);
 assert.doesNotThrow(()=>make(film,opts));
 const invalid=structuredClone(film);invalid.texts.number.text='1234';assert.throws(()=>make(invalid,opts),/CANVAS_NUMBER_TEXT_UNSUPPORTED/);
 const missing=structuredClone(opts);missing.fonts[0].codePoints=[49,50,51];assert.throws(()=>make(film,missing),/CANVAS_NUMBER_DIGIT_COVERAGE_REQUIRED/);
 const short=structuredClone(film);short.scenes[0].end=80;short.scenes.push({id:'rest',start:80,end:450,kind:'block',block:'hook-title@1',params:{textSlot:'number'},purpose:'Fill the remaining timeline.'});
 assert.throws(()=>make(short,opts),/CANVAS_NUMBER_READING_HOLD_MISSING/);
 const mixed=customFixture();mixed.film.scenes[0].start=225;mixed.film.scenes[0].end=450;mixed.film.scenes[0].params.events=[];mixed.film.scenes[0].params.readingHolds=[{start:0,end:225}];
 mixed.film.texts.number=film.texts.number;mixed.film.scenes.unshift({...film.scenes[0],end:225});mixed.film.assets={};
 const mixedOpts=options();mixedOpts.resources=[];mixedOpts.customSources=mixed.sources;
 assert.throws(()=>make(mixed.film,mixedOpts),/CANVAS_TITLE_CUSTOM_MIX_UNSUPPORTED/);
});
test('an original Canvas title and subtitle have separate confirmed slots and font faces',()=>{
 const film=filmFixture();film.assets={};film.texts={title:{text:'HELLO',role:'headline',factIds:['fixture-cta']},sub:{text:'Real product',role:'body',factIds:['fixture-cta']}};
 film.style.type.text={fontId:'body-fixture',weight:400};film.scenes=[{id:'intro',start:0,end:450,kind:'block',block:'canvas-subtitle@1',params:{textSlot:'title',subtitleSlot:'sub'},purpose:'Two confirmed text slots.'}];
 const opts=options();opts.resources=[];opts.fonts.push({fontId:'body-fixture',weight:400,style:'normal',licenseRef:'fixture-body',rightsCleared:true});
 const page=make(film,opts);assert.match(page.html,/PBC-geist-sans-600/);assert.match(page.html,/PBC-body-fixture-400/);
 const same=structuredClone(film);same.scenes[0].params.subtitleSlot='title';assert.throws(()=>make(same,opts),/CANVAS_SUBTITLE_SLOTS_INVALID/);
 const role=structuredClone(film);role.texts.sub.role='headline';assert.throws(()=>make(role,opts),/CANVAS_SUBTITLE_TEXT_UNSUPPORTED/);
 const unbound=structuredClone(film);unbound.texts.sub.factIds=[];assert.throws(()=>make(unbound,opts),/CANVAS_SUBTITLE_FACT_REQUIRED/);
});
test('each Canvas sequence page requires a distinct confirmed title and supporting slot',()=>{
 const film=filmFixture();film.assets={};film.texts={title:{text:'HELLO',role:'headline',factIds:['fixture-cta']},sub:{text:'Real product',role:'body',factIds:['fixture-cta']},title2:{text:'WORLD',role:'headline',factIds:['fixture-cta']},sub2:{text:'Next step',role:'body',factIds:['fixture-cta']}};
 film.scenes=[{id:'intro',start:0,end:450,kind:'block',block:'canvas-subtitle-sequence@1',params:{items:[{textSlot:'title',subtitleSlot:'sub',startFrame:0},{textSlot:'title2',subtitleSlot:'sub2',startFrame:120}]},purpose:'Two exact pages.'}];
 const opts=options();opts.resources=[];assert.doesNotThrow(()=>make(film,opts));
 const same=structuredClone(film);same.scenes[0].params.items[1].subtitleSlot='title2';assert.throws(()=>make(same,opts),/CANVAS_SUBTITLE_SLOTS_INVALID/);
 const role=structuredClone(film);role.texts.sub2.role='headline';assert.throws(()=>make(role,opts),/CANVAS_SUBTITLE_TEXT_UNSUPPORTED/);
 const unbound=structuredClone(film);unbound.texts.sub2.factIds=[];assert.throws(()=>make(unbound,opts),/CANVAS_SUBTITLE_FACT_REQUIRED/);
 const short=structuredClone(film);short.scenes[0].params.items[1].startFrame=90;assert.throws(()=>make(short,opts),/CANVAS_SEQUENCE_READING_HOLD_MISSING/);
});
test('frame layers are history-free, half-open and carry scene-local time and transition state',()=>{
  const spec=filmFixture();assert.deepEqual(frameLayers(spec.scenes,0).map(x=>x.id),['hook']);
  assert.deepEqual(frameLayers(spec.scenes,120).map(x=>x.id),['hook','product']);
  assert.deepEqual(frameLayers(spec.scenes,126).map(x=>x.id),['product']);
  assert.equal(frameLayers(spec.scenes,120)[1].seconds,0);assert.equal(frameLayers(spec.scenes,126)[0].seconds,.2);
  const once=frameLayers(spec.scenes,333);frameLayers(spec.scenes,449);assert.deepEqual(frameLayers(spec.scenes,333),once);
  assert.equal(once[0].opacity,1);assert.equal(once[1].opacity,.5);
  spec.scenes[2].transitionIn.type='fade-through';
  for(let frame=330;frame<336;frame++){
    const [outgoing,incoming]=frameLayers(spec.scenes,frame);
    assert.ok(outgoing.opacity===0||incoming.opacity===0,`text layers overlap at frame ${frame}`);
    assert.ok(outgoing.opacity>0||incoming.opacity>0,`both layers disappear at frame ${frame}`);
  }
  assert.ok(frameLayers(spec.scenes,333)[1].opacity>0);
  assert.deepEqual(frameLayers(spec.scenes,336).map(layer=>layer.opacity),[1]);
  for(const type of ['push','whip']){spec.scenes[1].transitionIn.type=type;const layers=frameLayers(spec.scenes,123);
    assert.equal(layers[1].x-layers[0].x,1);assert.equal(layers[0].blur>0,type==='whip');}
  assert.deepEqual(frameLayers(spec.scenes,450),[]);
});

test('Canvas sequence requires confirmed facts and a reading hold for each page',()=>{
 const film=filmFixture();film.assets={};film.texts={a:{text:'HELLO',role:'headline',factIds:['a']},b:{text:'WORLD',role:'headline',factIds:['b']}};
 film.scenes=[{id:'title',start:0,end:450,kind:'block',block:'canvas-sequence@1',params:{items:[{textSlot:'a',startFrame:0},{textSlot:'b',startFrame:120}]},purpose:'Two bound titles.'}];
 const opts=options();opts.resources=[];opts.confirmedFactIds=['a','b'];assert.doesNotThrow(()=>make(film,opts));
 const noFact=structuredClone(film);noFact.texts.b.factIds=[];assert.throws(()=>make(noFact,opts),/CANVAS_SEQUENCE_FACT_REQUIRED/);
 const short=structuredClone(film);short.scenes[0].params.items[1].startFrame=119;assert.throws(()=>make(short,opts),/CANVAS_SEQUENCE_READING_HOLD_MISSING/);
 const missing=structuredClone(film);missing.scenes[0].params.items[1].textSlot='missing';assert.throws(()=>make(missing,opts),/TEXT_SLOT_UNKNOWN/);
});

test('original whiteboard image reveal requires a cleared still and a settled reading window',()=>{
 const film=filmFixture();film.scenes=[{id:'board',start:0,end:450,kind:'block',block:'whiteboard-clip@1',params:{assetKey:'dashboard',textSlot:'product'},purpose:'Reveal the real source image.'}];
 assert.doesNotThrow(()=>make(film));
 const video=options();video.resources[0].kind='video';assert.throws(()=>make(film,video),/WHITEBOARD_IMAGE_REQUIRED/);
 const short=structuredClone(film);short.scenes[0].end=120;short.scenes.push({...filmFixture().scenes[2],start:120,transitionIn:{type:'cut',frames:0}});
 assert.throws(()=>make(short),/WHITEBOARD_READING_HOLD_MISSING/);
});

test('original y3 icon motifs are accepted by drawn steps and unknown marks are rejected',()=>{
 const film=filmFixture();film.scenes=[{id:'drawn',start:0,end:450,kind:'block',block:'drawn-steps@1',params:{items:[{textSlot:'headline',icon:'person'},{textSlot:'product',icon:'cat'}]},purpose:'Confirmed steps.'}];
 for(const icon of ['person','cat','network','bulb','cross','stack','gear','clock','chart']){film.scenes[0].params.items[0].icon=icon;assert.doesNotThrow(()=>make(film));}
 film.scenes[0].params.items[0].icon='bean-huashu';assert.throws(()=>make(film),/BLOCK_PARAMS_INVALID/);
});

test('original keynote image sequence requires cleared stills and full per-screen reading windows',()=>{
 const film=filmFixture();film.assets.other={resourceId:'res_fixture_other'};
 film.scenes=[{id:'keynote',start:0,end:450,kind:'block',block:'keynote-clip@1',params:{items:[{assetKey:'dashboard'},{assetKey:'other'}],intervalFrames:120},purpose:'Real source screens.'}];
 const opts=options();opts.resources.push({...opts.resources[0],resourceId:'res_fixture_other'});assert.doesNotThrow(()=>make(film,opts));
 const video=structuredClone(opts);video.resources[1].kind='video';assert.throws(()=>make(film,video),/KEYNOTE_IMAGE_REQUIRED/);
 const bad=structuredClone(film);bad.scenes[0].params.items[1].assetKey='missing';assert.throws(()=>make(bad,opts),/ASSET_SLOT_UNKNOWN/);
 const short=structuredClone(film);short.scenes[0].end=225;short.scenes.push({...filmFixture().scenes[2],start:225,transitionIn:{type:'cut',frames:0}});
 assert.throws(()=>make(short,opts),/KEYNOTE_READING_HOLD_MISSING/);
});

test('keynote emphasis uses a complete ROI on the same admitted image',()=>{
 const film=filmFixture();film.assets.other={resourceId:'res_fixture_other'};
 film.scenes=[{id:'keynote',start:0,end:450,kind:'block',block:'keynote-clip@1',params:{items:[{assetKey:'dashboard',focus:'roi:0'},{assetKey:'other'}],intervalFrames:120},purpose:'Highlight one real page.'}];
 const opts=options();opts.resources.push({...opts.resources[0],resourceId:'res_fixture_other'});assert.doesNotThrow(()=>make(film,opts));
 const wrong=structuredClone(film);wrong.scenes[0].params.items[1].focus='roi:0';assert.throws(()=>make(wrong,opts),/KEYNOTE_CLIP_ROI_INVALID/);
 const outside=structuredClone(film);outside.assets.dashboard.roi[0].x=.9;assert.throws(()=>make(outside,opts),/KEYNOTE_CLIP_ROI_INVALID/);
});

test('v4 studio accepts only a real in-bounds ROI on its declared panel',()=>{
 const {film,sources}=customFixture(),scene=film.scenes[0];scene.runtime3D='om3-studio-v4';
 film.assets.dashboard={resourceId:'res_fixture_dashboard'};film.assets.panel={resourceId:'res_fixture_dashboard',roi:[{x:.1,y:.2,width:.3,height:.4}]};scene.params.assetKeys=['dashboard','panel'];scene.params.panelFocus={panel:'roi:0'};
 sources[scene.module]=sources[scene.module].replace('const timeline=',"const studio=ctx.OM3.studio('dashboard',['panel']);const timeline=");
 const opts=options();opts.customSources=sources;assert.equal(make(film,opts).plan.usesWebgl,true);
 film.assets.panel.roi=[];assert.throws(()=>make(film,opts),/CUSTOM_3D_PANEL_ROI_INVALID/);
 film.assets.panel.roi=[{x:.9,y:.2,width:.3,height:.4}];assert.throws(()=>make(film,opts),/CUSTOM_3D_PANEL_ROI_INVALID/);
});

test('the grapheme runtime is explicit on a custom scene and rejects unknown versions',()=>{
 const {film,sources}=customFixture(),scene=film.scenes[0];scene.runtimeText='grapheme-v1';
 sources[scene.module]=sources[scene.module].replace("ctx.text('headline').mount(heading,{maxLines:3})", "ctx.text('headline').mount(heading,{maxLines:3,split:'graphemes'})");
 const opts=options();opts.customSources=sources;assert.equal(make(film,opts).plan.spec.scenes[0].runtimeText,'grapheme-v1');
 scene.runtimeText='unknown';assert.throws(()=>make(film,opts),/FILM_SCHEMA_INVALID/);
});
