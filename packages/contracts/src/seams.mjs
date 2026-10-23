import {inflateSync} from 'node:zlib';

/** Bounded decoder for trusted CDP RGB/RGBA PNGs (8 bit, non-interlaced), shared by Worker and container. */
export function pngPixels(bytes) {
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
  const pixels = Buffer.alloc(width * height * 4), previous = Buffer.alloc(stride), row = Buffer.alloc(stride);
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1), filter = raw[offset];
    if (filter > 4) throw Error('SEAM_PNG_UNSUPPORTED');
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0, up = previous[x], corner = x >= channels ? previous[x - channels] : 0;
      row[x] = (raw[offset + 1 + x] + [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter]) & 255;
    }
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, source = x * channels;
      pixels[at] = row[source]; pixels[at + 1] = row[source + 1]; pixels[at + 2] = row[source + 2]; pixels[at + 3] = channels === 4 ? row[source + 3] : 255;
    }
    row.copy(previous);
  }
  return {width, height, pixels};
}

export function compareSeam(expected, actual) {
  const a = pngPixels(expected), b = pngPixels(actual);
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
