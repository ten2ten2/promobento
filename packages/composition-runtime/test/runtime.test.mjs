import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompositionRuntime,frameTime,randomAt,checkedRegions,inspectRegions} from '../src/index.mjs';

test('frame addressing preserves exact time and rejects a missing or fractional frame',()=>{
  assert.deepEqual(frameTime(449,450),{numerator:449,denominator:30});
  assert.deepEqual(frameTime(899,900),{numerator:899,denominator:30});
  for(const frame of [-1,450,0.5,NaN,Infinity]) assert.throws(()=>frameTime(frame,450),/FRAME_OUT_OF_RANGE/);
});

test('random-at-v1 matches fixed UTF-8, empty and NUL-delimited input vectors',()=>{
  // Independently generated with explicit uint32 arithmetic and UTF-8 byte prefixes.
  const vectors=[
    ['', '', 3138444313],['scene','particle-2',3679477312],
    ['m0a-fixture-1','x0',3629678312],['m0a-fixture-1','x999',1367980691],
    ['a\0b','c',3156979867],['a','b\0c',530430226],
    ['中文🌈','粒子-1',2317926606],['e\u0301','é',1587370327]
  ];
  for (const [seed,key,uint32] of vectors) assert.equal(randomAt(seed,key),uint32/4294967296);
  assert.notEqual(randomAt('a\0b','c'),randomAt('a','b\0c'));
  for (const invalid of [null,1,{},undefined]) assert.throws(()=>randomAt(invalid,'key'),/RANDOM_KEY_INVALID/);
  for (const invalid of ['\ud800','\udfff','seed\udc00']) {
    assert.throws(()=>randomAt(invalid,'key'),/RANDOM_KEY_INVALID/);
    assert.throws(()=>randomAt('seed',invalid),/RANDOM_KEY_INVALID/);
  }
});

test('a fixed sequential-key corpus has neither the old clustering nor adjacent correlation',()=>{
  const values=Array.from({length:1000},(_,index)=>randomAt('m0a-fixture-1','x'+index));
  const buckets=Array(10).fill(0);
  for (const value of values) { assert(value>=0&&value<1);buckets[Math.floor(value*10)]++; }
  const chi2=buckets.reduce((sum,count)=>sum+(count-100)**2/100,0);
  const a=values.slice(0,-1),b=values.slice(1),mean=items=>items.reduce((sum,item)=>sum+item,0)/items.length;
  const ma=mean(a),mb=mean(b);
  const correlation=a.reduce((sum,item,index)=>sum+(item-ma)*(b[index]-mb),0)
    /Math.sqrt(a.reduce((sum,item)=>sum+(item-ma)**2,0)*b.reduce((sum,item)=>sum+(item-mb)**2,0));
  assert(chi2<30,'The fixed corpus must be reasonably spread across ten buckets');
  assert(Math.abs(correlation)<0.1,'Adjacent particle keys must not form the previous visible pattern');
});

test('keyed random values do not depend on call order',()=>{
  const before=randomAt('scene','particle-2');
  for(let index=0;index<10;index++) randomAt('scene','particle-'+index);
  assert.equal(randomAt('scene','particle-2'),before);
  assert.notEqual(randomAt('other-scene','particle-2'),before);
  assert(before>=0&&before<1);
});

test('native animation created during prepare is rejected before a usable runtime or first draw',async()=>{
  let animations=[],draws=0;
  const inner={style:{},getAnimations:()=>animations,remove(){}};
  const root={style:{},replaceChildren(){},append(){},ownerDocument:{createElement:()=>inner}};
  const definition={apiVersion:'2.7.0',editables:[],markers:[],regions:[],videoUses:[],fonts:[],
    prepare() {
      animations=[{playState:'paused'}];
      return {draw(){draws++;},dispose(){}};
    }};
  await assert.rejects(createCompositionRuntime({definition,root,targetId:'instagram_feed:square',width:1080,height:1080,
    durationSeconds:15,seed:'fixture',values:{}}),/NATIVE_ANIMATION_UNSUPPORTED/);
  assert.equal(draws,0);
});

test('inspection uses declared precedence, logical coordinates and half-open bounds',()=>{
  const declarations=[{id:'background',sourcePath:'src/main.mjs',line:1},{id:'headline',sourcePath:'src/main.mjs',line:20}];
  // Deliberately reverse returned bounds: draw order cannot rewrite source inspection precedence.
  const regions=checkedRegions([{id:'headline',x:20,y:10,width:50,height:20},{id:'background',x:0,y:0,width:200,height:100}],
    declarations,200,100);
  assert.deepEqual(inspectRegions(regions,declarations,200,100,0.1,0.1),
    {regionId:'headline',sourcePath:'src/main.mjs',line:20,bounds:{x:20,y:10,width:50,height:20}});
  assert.equal(inspectRegions(regions,declarations,200,100,0.35,0.2).regionId,'background');
  assert.equal(inspectRegions(regions,declarations,200,100,1,0.5),null);
  assert.equal(inspectRegions(regions,declarations,200,100,0.5,1),null);
  for(const point of [[-1,0],[0,1.1],[NaN,0],[0,Infinity]])
    assert.throws(()=>inspectRegions(regions,declarations,200,100,...point),/INSPECT_COORDINATES_INVALID/);
});

test('a completed draw cannot invent source paths, duplicate regions or report out-of-bounds geometry',()=>{
  const declarations=[{id:'title',sourcePath:'src/main.mjs',line:20},{id:'panel'}];
  const valid={id:'title',x:0,y:0,width:100,height:30};
  for(const regions of [[{...valid,id:'injected'}],[{...valid,sourcePath:'private.mjs'}],[valid,valid]])
    assert.throws(()=>checkedRegions(regions,declarations,100,100),/REGION_UNDECLARED/);
  for(const mutation of [{x:-1},{y:80},{width:101}])
    assert.throws(()=>checkedRegions([{...valid,...mutation}],declarations,100,100),/REGION_OUT_OF_BOUNDS/);
  for(const mutation of [{x:NaN},{height:-1},{width:Infinity}])
    assert.throws(()=>checkedRegions([{...valid,...mutation}],declarations,100,100),/REGION_BOUNDS_INVALID/);
  assert.deepEqual(checkedRegions([],declarations,100,100),[],'An absent region has no inferred source location');
});
