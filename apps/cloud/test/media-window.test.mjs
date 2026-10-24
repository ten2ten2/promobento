import test from 'node:test';
import assert from 'node:assert/strict';
import {videoArgs} from '../../render-container/src/media.mjs';
test('only the correction encode constrains its reservoir for the one-second peak window',()=>{
 const config={width:960,height:540,threads:2,encoding:{videoCodec:'h264',profile:'high',pixelFormat:'yuv420p',fps:15,gopFrames:15,targetVideoBitrate:2000000,maxVideoBitrate:2500000}};
 const ordinary=videoArgs(config),strict=videoArgs({...config,strictWindow:true}),value=(args,key)=>Number(args[args.indexOf(key)+1]);
 assert.equal(value(ordinary,'-maxrate'),2500000);assert.equal(value(ordinary,'-bufsize'),5000000);assert.equal(value(ordinary,'-b:v'),2000000);
 assert.equal(value(strict,'-maxrate'),1750000);assert.equal(value(strict,'-bufsize'),500000);assert.equal(value(strict,'-b:v'),1750000);
 assert.ok(value(strict,'-maxrate')+value(strict,'-bufsize')<config.encoding.maxVideoBitrate);
 for(const key of ['-r','-g','-pix_fmt','-profile:v','-color_primaries'])assert.equal(strict[strict.indexOf(key)+1],ordinary[ordinary.indexOf(key)+1]);
});
