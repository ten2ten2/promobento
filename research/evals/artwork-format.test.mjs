import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStaticArtwork} from './artwork-format.mjs';

test('GIF intake recognizes one complete frame and rejects animation or malformed blocks',()=>{
 const gif=Buffer.from('R0lGODlhAQABAPAAAP8AAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==','base64');
 assert.doesNotThrow(()=>assertStaticArtwork(gif,'image/gif'));
 const start=gif.lastIndexOf(0x2c),second=Buffer.concat([gif.subarray(0,-1),gif.subarray(start,-1),Buffer.from([0x3b])]);
 assert.throws(()=>assertStaticArtwork(second,'image/gif'),/ARTWORK_ANIMATION_UNSUPPORTED/);
 for(const bad of [gif.subarray(0,-1),Buffer.concat([gif,Buffer.from([0])]),Buffer.from('not gif')])
  assert.throws(()=>assertStaticArtwork(bad,'image/gif'),/ARTWORK_FORMAT_INVALID/);
});

test('AVIF intake accepts a still image container but rejects sequence brands and tracks',()=>{
 const box=(name,data)=>{const out=Buffer.alloc(8+data.length);out.writeUInt32BE(out.length);out.write(name,4);data.copy(out,8);return out;};
 const header=brand=>box('ftyp',Buffer.concat([Buffer.from(brand),Buffer.alloc(4),Buffer.from('mif1')]));
 const meta=box('meta',Buffer.alloc(4)),data=box('mdat',Buffer.from([1]));
 assert.doesNotThrow(()=>assertStaticArtwork(Buffer.concat([header('avif'),meta,data]),'image/avif'));
 assert.throws(()=>assertStaticArtwork(Buffer.concat([header('avis'),meta,data]),'image/avif'),/ARTWORK_ANIMATION_UNSUPPORTED/);
 assert.throws(()=>assertStaticArtwork(Buffer.concat([header('avif'),meta,box('moov',Buffer.alloc(0)),data]),'image/avif'),/ARTWORK_ANIMATION_UNSUPPORTED/);
 assert.throws(()=>assertStaticArtwork(Buffer.concat([header('mif1'),meta,data]),'image/avif'),/ARTWORK_FORMAT_INVALID/);
 assert.throws(()=>assertStaticArtwork(Buffer.concat([header('avif'),meta,data]).subarray(0,-1),'image/avif'),/ARTWORK_FORMAT_INVALID/);
});
