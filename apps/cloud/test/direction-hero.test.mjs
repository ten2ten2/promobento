import test from 'node:test';
import assert from 'node:assert/strict';
import {directionHero,supportsVoxClip} from '../src/direction-hero.ts';
import {generateFilmPage} from '../../../packages/film-runtime/src/page.ts';
import {pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';

const context={product:'Original Workbench',audience:'software',fonts:[{fontId:'geist-sans',weight:600,style:'normal'}],
 facts:[{id:'modes',text:'An intentionally long source paragraph about a product capability, not on-screen promotional copy.'}],
 resources:[{resourceId:'res_fixture_dashboard'},{resourceId:'res_fixture_logo'}]};
const card={key:'fit',usesDepth:false,language:'en',palette:[{role:'bg',color:'#101712',source:'fixture'},{role:'ink',color:'#f4f8ee',source:'fixture'},{role:'accent',color:'#d9fa73',source:'fixture'}],
 feel:{eventsPerBar:2},logline:'One real product image and a readable identity.',skeleton:[{approach:'block:feature-grid'},{approach:'block:ui-showcase'},{approach:'block:cta-endcard'}]};

test('compact direction heroes prefer the proposed product shot over a paragraph grid and keep the real primary image',()=>{
 for(const [index,depth]of [[0,false],[1,true],[2,false]]){
  const film=directionHero({...card,usesDepth:depth,skeleton:depth?[{approach:'block:feature-grid'},{approach:'block:device-3d'}]:card.skeleton},context,index);
  assert.equal(film.scenes[0].block,depth?'device-3d@1':'ui-showcase@1');
  assert.equal(film.assets.hero.resourceId,'res_fixture_dashboard');
  assert.equal(film.texts.headline.text,context.product);assert.deepEqual(film.texts.headline.factIds,['modes']);
  const options=pageOptions('landscape',{width:1920,height:1080,safeInsets:{top:.05,right:.05,bottom:.05,left:.05}});options.confirmedFactIds=['modes'];
  assert.doesNotThrow(()=>generateFilmPage(JSON.stringify(film),options));
 }
 // Older internal contexts without a product/name field retain their source-caption contract.
 const legacy={...context};delete legacy.product;
 assert.equal(directionHero(card,legacy,0).texts.headline.text,legacy.facts[0].text);
});

test('new trusted blocks can actually be selected for a direction hero',()=>{
 const options=pageOptions('landscape',{width:1920,height:1080,safeInsets:{top:.05,right:.05,bottom:.05,left:.05}});options.confirmedFactIds=['modes'];
 for(const id of ['continuous-focus','kinetic-title','drawn-steps']){
  const film=directionHero({...card,skeleton:[{approach:'block:'+id}]},context,0);
  assert.equal(film.scenes[0].block,id+'@1');assert.doesNotThrow(()=>generateFilmPage(JSON.stringify(film),options));
 }
});


test('a direction explicitly choosing original studio receives a real 3D hero with the cleared primary image',()=>{
 const options=pageOptions('landscape',{width:1920,height:1080,safeInsets:{top:.05,right:.05,bottom:.05,left:.05}});options.confirmedFactIds=['modes'];
 const film=directionHero({...card,usesDepth:true,skeleton:[{approach:'block:object-studio'}]},context,0);
 assert.equal(film.scenes[0].block,'object-studio@1');assert.equal(film.assets.hero.resourceId,'res_fixture_dashboard');
 assert.equal(generateFilmPage(JSON.stringify(film),options).plan.usesWebgl,true);
});

test('the original Vox direction preview repeats only the same cleared primary image',()=>{
 const ctx={...context,resources:context.resources.map(item=>({...item,kind:'image'}))};
 const film=directionHero({...card,skeleton:[{approach:'block:vox-clip'}]},ctx,0);
 assert.equal(film.scenes[0].block,'vox-clip@1');assert.deepEqual(film.scenes[0].params.items,[{assetKey:'hero'},{assetKey:'hero'}]);
 assert.deepEqual(Object.keys(film.assets),['hero']);assert.equal(film.assets.hero.resourceId,'res_fixture_dashboard');
 const options=pageOptions('landscape',{width:1920,height:1080,safeInsets:{top:.05,right:.05,bottom:.05,left:.05}});options.confirmedFactIds=['modes'];
 assert.doesNotThrow(()=>generateFilmPage(JSON.stringify(film),options));
 assert.throws(()=>directionHero({...card,skeleton:[{approach:'block:vox-clip'}]},{...ctx,resources:[{...ctx.resources[0],kind:'video'}]},0),/VOX_CLIP_IMAGE_REQUIRED/);
});

test('original Vox capability does not change frozen methods or video-led directions',()=>{
 const resources=[{kind:'image'},{kind:'svg'}],method=version=>({id:'product-directing',version});
 assert.equal(supportsVoxClip(method('1.30.0'),resources),false);
 assert.equal(supportsVoxClip(method('1.31.0'),resources),true);
 assert.equal(supportsVoxClip(method('1.31.0'),resources.slice(0,1)),false);
 assert.equal(supportsVoxClip(method('1.31.0'),[{kind:'video'},...resources]),false);
 assert.equal(supportsVoxClip(null,resources),false);
});
