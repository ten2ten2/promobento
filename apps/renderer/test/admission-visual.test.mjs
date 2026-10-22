import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical} from '@promobento/contracts';
import {randomAt} from '@promobento/composition-runtime';
import {createMotionTools} from '../../../packages/composition-runtime/src/motion-tools.mjs';
import {transformPoint,transformedBox,clipContainsBox} from '../../../packages/composition-runtime/src/command-geometry.mjs';
import {texturePixels} from '../../../packages/composition-runtime/src/command-painter.mjs';
import {admittedFontCatalog,reviewedAdmissionFonts,allAdmittedFontDeclarations} from '../src/admission-font-catalog.mjs';
import {admittedFontDeclarations,admittedFontMetrics,admissionTextMeasurement,woffCommandMetrics} from '../src/admission-fonts.mjs';
import {validateAdmissionDraw} from '../src/admission-commands.mjs';
import {readAdmissionSource} from '../src/admission-source.mjs';
import {visualCandidate,writeVisualCandidate,fontGalleryCandidate,writeCandidate} from './admission-visual.cases.mjs';

const declarations={regions:[],fonts:admittedFontDeclarations(['geist-sans-fixture','geist-mono-fixture','hm-noto-sans-sc','hm-lxgw-wenkai','hm-poppins'])};
const context={width:1080,height:1080,randomAt:key=>randomAt('visual-test',key),measureText:(...args)=>admissionTextMeasurement(declarations,...args)};
const tools=createMotionTools(context);
const options={width:1080,height:1080,targetId:'instagram_feed:square',profile:'canvas-media-v1',declarations,resourceRequest:{resourceIds:['screen-still']}};
const check=commands=>validateAdmissionDraw({commands},options);

test('all 42 fonts retain license and copyright evidence; 27 families include real CJK coverage',()=>{
  const catalog=admittedFontCatalog(),reviewed=reviewedAdmissionFonts(catalog.map(font=>font.id));
  assert.equal(new Set(catalog.map(font=>font.family)).size,27);assert.equal(reviewed.fonts.length,42);assert.equal(reviewed.resources.length,42);
  assert.equal(catalog.filter(font=>font.style==='italic').length,6);
  assert.deepEqual(admittedFontDeclarations().map(font=>font.fontId),['geist-sans-fixture','geist-mono-fixture']);
  assert(admittedFontMetrics().every(font=>Object.keys(font.glyphs).length===191));
  for(const fontId of ['hm-noto-sans-sc','hm-lxgw-wenkai']) {
    const m=admissionTextMeasurement(declarations,fontId,'从想法到画面',32,fontId==='hm-noto-sans-sc'?700:500);
    assert.equal(m.glyphs.length,6);assert(m.width>150);assert(m.glyphs.every(g=>g.fontId===fontId));
  }
  for(const font of reviewed.registry.fonts.filter(font=>font.variableDefaultOnly))assert.equal(font.weight,400);
});
test('WOFF parser rejects corrupt boundaries before decoding, never substitutes a system face',()=>{
  for(const bytes of [Buffer.alloc(0),Buffer.alloc(44),Buffer.from('wOFF')])assert.throws(()=>woffCommandMetrics(bytes),/FONT_WOFF_INVALID/);
  const reviewed=reviewedAdmissionFonts(['hm-noto-sans-sc']),bytes=Buffer.from(reviewed.routes.values().next().value.bytes);bytes.writeUInt16BE(65535,12);
  assert.throws(()=>woffCommandMetrics(bytes),/FONT_WOFF_INVALID/);
  assert.throws(()=>reviewedAdmissionFonts(['unreviewed']),/FONT_UNAUTHORIZED/);
  assert.throws(()=>admissionTextMeasurement(declarations,'hm-noto-sans-sc','😀',30,700),/FONT_GLYPH_MISSING/);
  assert.throws(()=>admissionTextMeasurement(declarations,'hm-noto-sans-sc','e\u0301',30,700),/FONT_GLYPH_MISSING/);
});
test('explicit multiline layout retains original characters, selected faces and stable absolute metrics',()=>{
  const text='从想法到画面\nClear ideas move.',m=admissionTextMeasurement(declarations,'hm-noto-sans-sc',text,32,700,{width:160,wrap:'word-cjk',padding:4});
  assert(m.lineCount>=3);assert(m.width<=160);assert.equal(m.glyphs.map(g=>g.character).join(''),text.replaceAll('\n',''));
  assert(m.height>=m.lineHeight*2);assert(m.glyphs.some(g=>g.y>0));
  assert.throws(()=>admissionTextMeasurement(declarations,'geist-sans-fixture','a\nb',20,600),/GLYPH_MISSING/);
  assert.throws(()=>admissionTextMeasurement(declarations,'hm-noto-sans-sc','文本',32,700,{width:100,wrap:'word-cjk',lineHeight:1}),/LINE_HEIGHT_INVALID/);
  const command=tools.paint.text('text',text,200,200,380,{fontId:'hm-noto-sans-sc',weight:700,fontSize:32});
  assert.equal(check([command]).commands[0].text,text);
});
test('camera transforms, picking bounds and logarithmic zoom use absolute time',()=>{
  const cam={x:600,y:400,z:1.6,r:0.2},p=tools.camera.toScreen(cam,90,180),roundtrip=tools.camera.toWorld(cam,p.x,p.y);
  assert(Math.abs(roundtrip.x-90)<1e-10);assert(Math.abs(roundtrip.y-180)<1e-10);assert.equal(tools.camera.zlerp(1,4,0.5),2);
  const keys=[{t:0,x:540,y:540,z:1},{t:1,x:580,y:550,z:2}],first=tools.camera.at(keys,0.7);
  tools.camera.at(keys,0.1);assert.deepEqual(first,tools.camera.at(keys,0.7));
  assert.deepEqual(transformPoint([1,0,0,1,20,30],4,5),{x:24,y:35});
  assert.deepEqual(transformedBox([0,1,-1,0,100,0],{x:0,y:0,width:20,height:10}),{x:90,y:0,width:10,height:20});
  assert.deepEqual(tools.camera.region({id:'box',x:200,y:200,width:200,height:200},{x:540,y:540,z:1}),{id:'box',x:200,y:200,width:200,height:200});
});
test('finite curves, stroke, crop, clipping and gradients are data-only bounded operations',()=>{
  const rect={...tools.paint.rect(100,100,250,140,'#123456'),transform:[1,0.05,0,1,5,5],clip:{x:100,y:100,width:250,height:140},stroke:{color:'#ffffff',width:3,dash:[3,5]},gradient:{kind:'linear',x0:100,y0:100,x1:350,y1:240,stops:[{offset:0,color:'#123456'},{offset:1,color:'#abcdef'}]}};
  const curve={op:'path',segments:[{kind:'move',x:100,y:100},{kind:'quadratic',cx:200,cy:130,x:300,y:200},{kind:'cubic',cx1:310,cy1:220,cx2:280,cy2:300,x:400,y:300}],color:'#123456',opacity:1,fill:false,stroke:{color:'#654321',width:3}};
  assert.equal(check([rect,curve,{op:'image',resourceId:'screen-still',x:200,y:200,width:300,height:200,crop:{x:0.1,y:0.2,width:0.8,height:0.5},effect:{style:'mosaic',cell:6,seed:1},opacity:1}]).commands.length,3);
  for(const patch of [{transform:[0,0,0,0,0,0]},{transform:[65,0,0,1,0,0]},{stroke:{color:'#ffffff',width:2,dash:[0,0]}},{gradient:{...rect.gradient,x1:100,y1:100}},{clip:{x:0,y:0,width:10,height:10,radius:9}},{filter:'blur(2px)'}])assert.throws(()=>check([{...rect,...patch}]));
  assert.throws(()=>check([{...curve,segments:[{kind:'line',x:0,y:0},{kind:'line',x:100,y:100}]}]),/PATH_INVALID/);
  assert.throws(()=>check([{op:'image',resourceId:'screen-still',x:100,y:100,width:100,height:100,opacity:1,crop:{x:0.9,y:0,width:0.2,height:1}}]),/CROP_INVALID/);
});
test('transforms and clips cannot hide out-of-safe-area text or truncate the observed original',()=>{
  const text=tools.paint.text('safe','Visible text',200,200,400,{fontSize:32});check([text]);
  assert.throws(()=>check([{...text,transform:[1,0,0,1,-150,0]}]),/OUTSIDE_SAFE_AREA/);
  assert.throws(()=>check([{...text,clip:{x:200,y:200,width:20,height:100}}]),/TEXT_CLIPPED/);
  assert(!clipContainsBox({x:0,y:0,width:100,height:100,radius:40},{x:0,y:0,width:10,height:10}));
});
test('all seven visual components emit substantive bounded commands at repeated unordered times',()=>{
  for(const name of ['ui','mechanism','chart','flatWorld','collage','whiteboard','kineticType']) {
    const base={x:150,y:300,width:760,height:480,id:name},samples=new Map();
    for(const progress of [0,0.2,1,0.6,0.2]) {
      const commands=tools.components[name]({...base,progress,time:progress,words:['MAKE','IT','MOVE'],fontSize:70});
      assert(commands.length>=2,name);assert(commands.length<128,name);check(commands);
      if(samples.has(progress))assert.equal(canonical(commands),samples.get(progress));else samples.set(progress,canonical(commands));
    }
  }
});
test('texture synthesis is fixed-size, seeded, history-independent and costs are bounded',()=>{
  for(const style of ['paper','grain','halftone','mosaic','brush']) {
    const options={style,color:'#f5f1e8',accent:'#24352b',seed:28},first=texturePixels(options);
    texturePixels({...options,seed:29});assert.deepEqual(texturePixels(options),first);
    assert.equal(first.pixels.length,128*128*4);assert(first.pixels.some((v,i)=>i%4!==3&&v!==245));
    check([tools.paint.texture(style,100,100,600,600)]);
  }
  assert.throws(()=>check(Array.from({length:17},()=>tools.paint.texture('paper',100,100,100,100))),/TEXTURE_BUDGET/);
});
test('15/30-second visual sample and every-face gallery are inert valid source packages',()=>{
  const dir=mkdtempSync(join(tmpdir(),'visual-cases-'));
  try {
    for(const durationSeconds of [15,30]){const path=join(dir,String(durationSeconds));writeVisualCandidate(path,{durationSeconds});assert.equal(readAdmissionSource(path).input.totalFrames,durationSeconds*30);}
    const gallery=fontGalleryCandidate();assert.equal(gallery.declarations.fonts.flatMap(font=>font.assets).length,42);
    writeCandidate(join(dir,'fonts'),gallery);assert.equal(readAdmissionSource(join(dir,'fonts')).resourceRequest.resourceIds.length,32);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('path resampling and ribbons keep bounded topology, seeded handwriting and exact endpoints',()=>{
  const points=[{x:100,y:100},{x:300,y:150},{x:500,y:110}];
  const dense=tools.path.densify(points,8),equal=tools.path.resample(dense,32);
  assert.equal(dense.length,17);assert.equal(equal.length,32);assert.deepEqual(equal[0],points[0]);assert.deepEqual(equal.at(-1),points.at(-1));
  const ribbon=tools.path.ribbon(equal,p=>2+12*Math.sin(p*Math.PI),'#123456');assert.equal(ribbon.segments.length,65);check([ribbon]);
  assert.throws(()=>tools.path.densify(points,1000),/PATH_POINTS_INVALID/);
  assert.throws(()=>tools.path.resample(points,1000),/PATH_POINTS_INVALID/);
  assert.equal(tools.motion.formatNumber(-12345.6,2),'-12,345.60');assert.equal(tools.motion.count(2,0,1,10,100),100);
});

test('trusted browser dispatch observes transformed multiline ink and restores per-command state',async t=>{
  const {paintAdmissionMedia}=await import('../src/admission-media-browser.mjs');
  const originalDocument=globalThis.document,originalMedia=globalThis.admissionMedia,calls=[];let depth=0;
  t.after(()=>{if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;if(originalMedia===undefined)delete globalThis.admissionMedia;else globalThis.admissionMedia=originalMedia;});
  const painter={save(){depth++;},restore(){depth--;},transform(...args){calls.push(['transform',args]);},fillRect(){},beginPath(){},rect(){},clip(){},
    fillText(...args){calls.push(['text',args]);},measureText(){return {actualBoundingBoxLeft:0,actualBoundingBoxRight:10,actualBoundingBoxAscent:16,actualBoundingBoxDescent:3};}};
  globalThis.document={getElementById:()=>({getContext:()=>painter})};
  globalThis.admissionMedia={images:new Map(),imageKeys:new Map(),controller:{fonts:{assertText(){},family:()=> 'Test'}},
    measure:command=>admissionTextMeasurement(declarations,command.fontId,command.text,command.fontSize,command.weight,{...command.layout,width:command.width})};
  const command={...tools.paint.text('two-lines','Hi\n世界',200,200,400,{fontId:'hm-noto-sans-sc',weight:700,fontSize:28,padding:6}),transform:[1,0,0,1,20,30]};
  const observed=await paintAdmissionMedia({commands:[command],width:1080,height:1080,frame:0});
  assert.equal(depth,0);assert.equal(observed.texts[0].text,'Hi\n世界');assert.equal(observed.texts[0].layout.lineCount,2);
  assert.equal(observed.texts[0].ink.left,226);assert.equal(observed.texts[0].bounds.x,220);
  assert.equal(calls.filter(call=>call[0]==='text').length,4);assert.equal(calls.filter(call=>call[0]==='transform').length,1);
});
