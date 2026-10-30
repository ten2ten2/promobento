import {inflateSync,deflateSync} from 'node:zlib';
import {Buffer} from 'node:buffer';

// Parse and inflate once, including per-row filter validation, without allocating a second
// full RGBA image when both trusted PNGs are byte-identical.
function pngData(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 45 || buffer.length > 12 * 1024 * 1024 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw Error('SEAM_PNG_INVALID');
  let width, height, channels, ended = false;
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    if (offset + 12 > buffer.length) throw Error('SEAM_PNG_INVALID');
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8), start = offset + 8;
    if (start + length + 4 > buffer.length) throw Error('SEAM_PNG_INVALID');
    if (type === 'IHDR') {
      if (width || length !== 13 || buffer[start + 8] !== 8 || ![2, 6].includes(buffer[start + 9])
        || buffer[start + 10] || buffer[start + 11] || buffer[start + 12]) throw Error('SEAM_PNG_UNSUPPORTED');
      width = buffer.readUInt32BE(start); height = buffer.readUInt32BE(start + 4); channels = buffer[start + 9] === 2 ? 3 : 4;
      if (!width || !height || width * height > 4096 * 2160) throw Error('SEAM_PNG_LIMIT');
    } else if (type === 'IDAT') { if (!width) throw Error('SEAM_PNG_INVALID'); chunks.push(buffer.subarray(start, start + length)); }
    else if (type === 'IEND') { if (length || start + 4 !== buffer.length) throw Error('SEAM_PNG_INVALID'); ended = true; break; }
    offset = start + length + 4;
  }
  if (!ended || !chunks.length) throw Error('SEAM_PNG_INVALID');
  const stride = width * channels, expected = (stride + 1) * height;
  const raw = inflateSync(Buffer.concat(chunks), {maxOutputLength: expected});
  if (raw.length !== expected) throw Error('SEAM_PNG_INVALID');
  for(let y=0;y<height;y++)if(raw[y*(stride+1)]>4)throw Error('SEAM_PNG_UNSUPPORTED');
  return {width,height,channels,stride,raw};
}

/** Bounded decoder for trusted CDP RGB/RGBA PNGs (8 bit, non-interlaced), shared by Worker and container. */
export function pngPixels(bytes) {
  const {width,height,channels,stride,raw}=pngData(bytes);
  const pixels = Buffer.alloc(width * height * 4), previous = Buffer.alloc(stride), row = Buffer.alloc(stride);
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1), filter = raw[offset];
    row.set(raw.subarray(offset + 1, offset + 1 + stride));
    // Select once per row: the old array expression calculated every predictor, including
    // Paeth, for every byte even when the PNG row used no filter at all.
    if (filter === 1) for (let x = channels; x < stride; x++) row[x] = (row[x] + row[x - channels]) & 255;
    else if (filter === 2) for (let x = 0; x < stride; x++) row[x] = (row[x] + previous[x]) & 255;
    else if (filter === 3) for (let x = 0; x < stride; x++) row[x] = (row[x] + Math.floor(((x >= channels ? row[x - channels] : 0) + previous[x]) / 2)) & 255;
    else if (filter === 4) for (let x = 0; x < stride; x++) {
      row[x] = (row[x] + paeth(x >= channels ? row[x - channels] : 0, previous[x], x >= channels ? previous[x - channels] : 0)) & 255;
    }
    if (channels === 4) pixels.set(row, y * stride);
    else for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, source = x * channels;
      pixels[at] = row[source]; pixels[at + 1] = row[source + 1]; pixels[at + 2] = row[source + 2]; pixels[at + 3] = channels === 4 ? row[source + 3] : 255;
    }
    row.copy(previous);
  }
  return {width, height, pixels};
}

export function compareSeam(expected, actual) {
  // Byte identity proves equal pixels, but never bypass PNG structure/inflate/filter checks.
  if (Buffer.from(expected).equals(Buffer.from(actual))) {pngData(expected);return {identical:true,maxChannelDiff:0,diffPixelPct:0,verdict:'pass'};}
  const a = pngPixels(expected);
  const b = pngPixels(actual);
  if (a.width !== b.width || a.height !== b.height) throw Error('SEAM_DIMENSIONS_MISMATCH');
  let maxChannelDiff = 0, changed = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(a.pixels[i + channel] - b.pixels[i + channel]));
    maxChannelDiff = Math.max(maxChannelDiff, delta); if (delta) changed++;
  }
  const diffPixelPct = changed / (a.width * a.height) * 100, identical = changed === 0;
  return {identical, maxChannelDiff, diffPixelPct, verdict: identical ? 'pass'
    : maxChannelDiff <= 2 && diffPixelPct <= .1 ? 'pass_within_tolerance' : 'RENDER_SEAM_BLOCK'};
}

export function pngRgba(width,height,pixels){
 const chunk=(type,data)=>{
  const body=Buffer.concat([Buffer.from(type),data]),out=Buffer.alloc(body.length+8);out.writeUInt32BE(data.length);body.copy(out,4);
  let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
 };
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>960*1920||pixels.length!==width*height*4)throw Error('REVIEW_SHEET_DIMENSIONS_INVALID');
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const stride=width*4,raw=Buffer.alloc((stride+1)*height);
 for(let y=0;y<height;y++)raw.set(pixels.subarray(y*stride,(y+1)*stride),y*(stride+1)+1);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
