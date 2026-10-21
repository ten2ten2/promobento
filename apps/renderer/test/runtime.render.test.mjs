import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import {sourceValuesBytes,parseSourceValues} from '@promobento/contracts';
import {prepareBrowserBundle} from '../src/browser-bundle.mjs';
import {environmentLock,inspectEnvironment,sha256} from '../src/environment.mjs';
import {launchFixtureBrowser,withDeadline} from '../src/frame-capture.mjs';

async function harness(operation) {
  const bundle=prepareBrowserBundle(environmentLock.browser);
  let handle,server;
  try {
    inspectEnvironment(bundle);
    const paths=['packages/composition-runtime/src/index.mjs','packages/contracts/src/canonical.mjs',
      'packages/contracts/src/source-values.mjs','packages/contracts/src/editable-values.mjs'];
    const files=new Map(paths.map(path=>['/'+path,readFileSync(new URL('../../../'+path,import.meta.url))]));
    files.set('/host.mjs',readFileSync(new URL('../src/host.mjs',import.meta.url)));
    files.set('/runtime-media.mjs',readFileSync(new URL('../../../packages/composition-runtime/src/media.mjs',import.meta.url)));
    files.set('/composition.mjs',Buffer.from('export default window.definition;'));
    files.set('/',Buffer.from('<!doctype html><style>body{margin:0}</style><main id="root"></main><script type="module">'
      +'import {createCompositionRuntime} from "/packages/composition-runtime/src/index.mjs";window.runtimeFactory=createCompositionRuntime;</script>'));
    server=createServer((request,response)=>{
      const bytes=files.get(request.url);
      response.writeHead(bytes?200:404,{'Content-Type':request.url==='/'?'text/html':'text/javascript','Cache-Control':'no-store'});
      response.end(bytes);
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    handle=await launchFixtureBrowser(bundle);
    const origin='http://127.0.0.1:'+server.address().port;
    const context=await handle.browser.newContext({viewport:{width:200,height:120},deviceScaleFactor:1,serviceWorkers:'block'});
    await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort('blockedbyclient'));
    const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runtimeFactory);
    const evaluate=(fn,arg)=>withDeadline(()=>page.evaluate(fn,arg),{timeoutMs:10000,code:'RUNTIME_TEST_TIMEOUT',terminate:()=>handle.stop()});
    await evaluate(()=>{
      window.values={color:'#ff0000',size:80,fail:false,beat:90,rows:[]};
      window.definition={apiVersion:'2.7.0',markers:[],videoUses:[],fonts:[],
        editables:[{id:'color',label:'Color',type:'color'},{id:'size',label:'Size',type:'number',min:20,max:120},
          {id:'fail',label:'Prepare failure probe',type:'boolean'},{id:'beat',label:'Beat',type:'number',affectsTiming:true},
          {id:'rows',label:'Rows',type:'data'}],
        regions:[{id:'panel',label:'Panel',sourcePath:'src/test.mjs',line:10},{id:'tile',label:'Tile',sourcePath:'src/test.mjs',line:20}],
        prepare({surface,width,height,values}) {
          const background=document.createElement('div');
          Object.assign(background.style,{position:'absolute',inset:'0',background:values.color});surface.root.append(background);
          if(values.fail)throw Error('FIXTURE_PREPARE_FAILED');
          const canvas=surface.createCanvas();Object.assign(canvas.style,{position:'absolute',inset:'0'});
          const ctx=canvas.getContext('2d');
          return {
            async draw({numerator}) {
              if(window.blockDraw)await window.blockDraw;
              if(window.failDraw)throw Error('FIXTURE_DRAW_FAILED');
              const x=20+2*(numerator%10);
              ctx.reset();ctx.scale(surface.pixelScale,surface.pixelScale);ctx.fillStyle='#0000ff';ctx.fillRect(x,20,values.size,50);
              const tile={id:'tile',x,y:20,width:values.size,height:50};
              if(window.badRegion==='bounds')tile.width=width+1;
              if(window.badRegion==='source')tile.sourcePath='private/secret.mjs';
              if(window.badRegion==='undeclared')tile.id='invented';
              return {regions:[tile,{id:'panel',x:0,y:0,width,height}]};
            },
            dispose(){background.remove();canvas.remove();}
          };
        }};
      window.initRuntime=async({values=window.values,mode='local_preview',...extra}={})=>{
        await window.runtime?.dispose();
        window.runtime=await window.runtimeFactory({definition:window.definition,root:document.querySelector('#root'),
          targetId:'fixture:square',width:200,height:120,durationSeconds:30,seed:'editables-test',values,mode,...extra});
      };
    });
    await operation({page,evaluate});
    await context.close();
  } finally {
    await handle?.stop();
    if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    bundle.cleanup();
  }
}

const imageHash=bytes=>sha256(PNG.sync.read(bytes).data);
const previewImage=page=>page.screenshot({type:'png',clip:{x:0,y:0,width:100,height:60}});

test('real local edits commit after ready, roll back failures, and freeze to the same frame',{timeout:60000},async()=>{
  await harness(async({page,evaluate})=>{
    await evaluate(()=>window.initRuntime());
    await evaluate(()=>window.runtime.seek(93,{previewEpoch:0}));
    assert.deepEqual(await evaluate(()=>{
      const canvas=document.querySelector('canvas');return {width:canvas.width,height:canvas.height,
        logicalWidth:canvas.style.width,logicalHeight:canvas.style.height};
    }),{width:100,height:60,logicalWidth:'200px',logicalHeight:'120px'});
    const before=await previewImage(page);
    const receipt=await evaluate(()=>window.runtime.setValues({requestedEpoch:1,valuesOverlay:{color:'#00FF00',size:100}}));
    assert.deepEqual(receipt,{event:'values-applied',requestedEpoch:1,appliedEpoch:1});
    const edited=await previewImage(page);
    assert.notEqual(imageHash(edited),imageHash(before),'ACK includes an actually changed, composited current frame');
    const state=await evaluate(()=>window.runtime.snapshot());
    assert.equal(state.frameIndex,93);assert.equal(state.values.color,'#00ff00');assert.equal(state.sourceValues.color,'#ff0000');
    await assert.rejects(evaluate(()=>window.runtime.seek(93,{previewEpoch:0})),/PREVIEW_EPOCH_STALE/);
    const failed=await evaluate(()=>window.runtime.setValues({requestedEpoch:2,valuesOverlay:{fail:true}}));
    assert.equal(failed.event,'values-rejected');assert.equal(failed.code,'PREPARE_FAILED');assert.equal(failed.appliedEpoch,1);
    assert.equal(imageHash(await previewImage(page)),imageHash(edited),'A failed staged preparation cannot replace the displayed frame');
    assert.equal(await evaluate(()=>window.runtime.snapshot().appliedEpoch),1);
    const stale=await evaluate(()=>window.runtime.setValues({requestedEpoch:1,valuesOverlay:{color:'#000000'}}));
    assert.equal(stale.code,'EPOCH_STALE');
    const timing=await evaluate(()=>window.runtime.setValues({requestedEpoch:2,valuesOverlay:{beat:60}}));
    assert.equal(timing.code,'VALUES_INVALID');assert.equal(timing.reason,'EDITABLE_REQUIRES_AI');
    // Saving uses the real canonical source file helper, then a fresh session reads those bytes.
    const frozenValues=parseSourceValues(sourceValuesBytes(state.values)).values;
    await evaluate(values=>window.initRuntime({values}),frozenValues);
    await evaluate(()=>window.runtime.seek(93,{previewEpoch:0}));
    assert.equal(imageHash(await previewImage(page)),imageHash(edited),'A saved frozen session must reproduce the edited frame');
    await evaluate(values=>window.initRuntime({values,mode:'trusted_render'}),frozenValues);
    await evaluate(()=>window.runtime.seek(93));
    const trustedImage=await page.screenshot({type:'png'}),trusted=PNG.sync.read(trustedImage),preview=PNG.sync.read(edited);
    // Low-resolution Canvas is resampled by Chromium. Verify stable interiors across scales;
    // exact whole-frame equality is required between the two frozen sessions at the same scale.
    for(const [x,y] of [[5,5],[25,20],[80,50]])
      assert.deepEqual(trusted.data.subarray(((y*2)*200+x*2)*4,((y*2)*200+x*2)*4+4),
        preview.data.subarray((y*100+x)*4,(y*100+x)*4+4));
    await evaluate(values=>window.initRuntime({values,mode:'trusted_render'}),frozenValues);
    await evaluate(()=>window.runtime.seek(93));
    assert.equal(imageHash(await page.screenshot({type:'png'})),imageHash(trustedImage));
    await assert.rejects(evaluate(()=>window.runtime.setValues({requestedEpoch:1,valuesOverlay:{}})),/TRUSTED_RENDER_OVERLAY_FORBIDDEN/);
    await assert.rejects(evaluate(()=>window.initRuntime({mode:'trusted_render',valuesOverlay:{}})),/TRUSTED_RENDER_OVERLAY_FORBIDDEN/);
  });
});

test('real inspection is frame-bound and rejects bad geometry, stale epochs and failed draws',{timeout:60000},async()=>{
  await harness(async({evaluate})=>{
    await evaluate(()=>window.initRuntime());
    const hit=await evaluate(()=>window.runtime.inspect(90,0.1,0.2,{previewEpoch:0}));
    assert.equal(hit.frameIndex,90);assert.equal(hit.hit.regionId,'tile');assert.equal(hit.hit.sourcePath,'src/test.mjs');
    assert.equal(hit.hit.line,20);
    assert.equal((await evaluate(()=>window.runtime.inspect(90,0.5,0.2,{previewEpoch:0}))).hit.regionId,'panel');
    assert.equal((await evaluate(()=>window.runtime.inspect(90,1,0.2,{previewEpoch:0}))).hit,null);
    for(const [probe,code] of [['bounds','REGION_OUT_OF_BOUNDS'],['source','REGION_UNDECLARED'],['undeclared','REGION_UNDECLARED']]) {
      await evaluate(probe=>{window.badRegion=probe;},probe);
      await assert.rejects(evaluate(()=>window.runtime.inspect(91,0.1,0.2,{previewEpoch:0})),new RegExp(code));
      assert.equal(await evaluate(()=>window.runtime.snapshot().frameIndex),null,'No old frame remains ready after failed drawing');
    }
    await evaluate(()=>{window.badRegion=null;window.failDraw=true;});
    await assert.rejects(evaluate(()=>window.runtime.seek(92,{previewEpoch:0})),/FIXTURE_DRAW_FAILED/);
    await evaluate(()=>{window.failDraw=false;});
    assert.equal((await evaluate(()=>window.runtime.seek(93,{previewEpoch:0}))).frameIndex,93);
    await evaluate(()=>window.runtime.dispose());
    await assert.rejects(evaluate(()=>window.runtime.inspect(93,0.1,0.2,{previewEpoch:0})),/INVALID_SESSION/);
  });
});

test('a pending real draw serializes edits, and a rejected epoch may be corrected without skipping it',{timeout:60000},async()=>{
  await harness(async({evaluate})=>{
    await evaluate(()=>window.initRuntime());
    await evaluate(()=>{
      window.blockDraw=new Promise(resolve=>{window.releaseDraw=resolve;});
      window.events=[];
      window.drawing=window.runtime.seek(44,{previewEpoch:0}).then(result=>{window.events.push('draw');return result;});
      const overlay={color:'#00ff00',rows:[{label:'submitted'}]};
      window.applying=window.runtime.setValues({requestedEpoch:1,valuesOverlay:overlay})
        .then(result=>{window.events.push('edit');return result;});
      overlay.color='#000000';overlay.rows[0].label='changed after submit';
    });
    assert.equal(await evaluate(()=>window.runtime.snapshot().appliedEpoch),0);
    await evaluate(()=>{window.blockDraw=null;window.releaseDraw();});
    const result=await evaluate(async()=>({draw:await window.drawing,edit:await window.applying,events:window.events,state:window.runtime.snapshot()}));
    assert.deepEqual(result.events,['draw','edit']);assert.equal(result.draw.previewEpoch,0);assert.equal(result.edit.appliedEpoch,1);
    assert.equal(result.state.frameIndex,44);
    assert.equal(result.state.values.color,'#00ff00');assert.equal(result.state.values.rows[0].label,'submitted');
    const rejected=await evaluate(()=>window.runtime.setValues({requestedEpoch:2,valuesOverlay:{size:500}}));
    assert.equal(rejected.appliedEpoch,1);assert.equal(rejected.code,'VALUES_INVALID');
    const retry=await evaluate(()=>window.runtime.setValues({requestedEpoch:2,valuesOverlay:{}}));
    assert.equal(retry.appliedEpoch,2);
    assert.equal(await evaluate(()=>window.runtime.snapshot().values.color),'#ff0000','Empty overlay restores the frozen source');
  });
});

test('runtime asset values require typed controller resources and an explicit drawable grant',{timeout:60000},async()=>{
  await harness(async({evaluate})=>{
    await evaluate(()=>{
      window.definition.editables.push({id:'art',label:'Art',type:'asset'});
      window.values.art='media/allowed.mp4';
      window.media={
        assets:{'media/allowed.mp4':{path:'media/allowed.mp4',sha256:'1'.repeat(64),url:'/allowed'},
          'fonts/fixture.woff2':{path:'fonts/fixture.woff2',sha256:'2'.repeat(64),url:'/font'},
          'media/hidden.mp4':{path:'media/hidden.mp4',sha256:'3'.repeat(64),url:'/hidden'}},
        resources:{'media/allowed.mp4':{mediaType:'video/mp4'},'fonts/fixture.woff2':{mediaType:'font/woff2'},
          'media/hidden.mp4':{mediaType:'video/mp4'}},drawableResourcePaths:['media/allowed.mp4']};
    });
    await evaluate(()=>window.initRuntime({media:window.media}));
    for(const path of ['fonts/fixture.woff2','media/hidden.mp4']) {
      const rejected=await evaluate(path=>window.runtime.setValues({requestedEpoch:1,valuesOverlay:{art:path}}),path);
      assert.equal(rejected.code,'VALUES_INVALID');assert.equal(rejected.reason,'EDITABLE_ASSET_UNAVAILABLE');assert.equal(rejected.appliedEpoch,0);
    }
    assert.equal((await evaluate(()=>window.runtime.setValues({requestedEpoch:1,valuesOverlay:{art:'media/allowed.mp4'}}))).event,'values-applied');
    await assert.rejects(evaluate(()=>window.initRuntime({media:{assets:window.media.assets}})),/EDITABLE_ASSET_UNAVAILABLE/);
  });
});

test('the loopback host snapshots an edit before its own serialized queue',{timeout:60000},async()=>{
  await harness(async({evaluate})=>{
    await evaluate(async()=>{
      document.querySelector('#root').id='composition';
      await import('/host.mjs');
      await window.fixtureHost.init({targetId:'fixture:square',width:200,height:120,durationSeconds:30,seed:'host-test',
        values:window.values,mode:'local_preview'});
      window.blockDraw=new Promise(resolve=>{window.releaseDraw=resolve;});
      window.hostDrawing=window.fixtureHost.seek(12,{previewEpoch:0});
      const command={requestedEpoch:1,valuesOverlay:{color:'#00ff00',rows:[{label:'host-submitted'}]}};
      window.hostApplying=window.fixtureHost.setValues(command);
      command.valuesOverlay.color='#000000';command.valuesOverlay.rows[0].label='mutated';command.requestedEpoch=99;
    });
    await evaluate(()=>{window.blockDraw=null;window.releaseDraw();});
    const result=await evaluate(async()=>({draw:await window.hostDrawing,edit:await window.hostApplying,state:await window.fixtureHost.snapshot()}));
    assert.equal(result.draw.frameIndex,12);assert.equal(result.edit.appliedEpoch,1);
    assert.equal(result.state.values.color,'#00ff00');assert.equal(result.state.values.rows[0].label,'host-submitted');
    await evaluate(()=>window.fixtureHost.dispose());
  });
});
