/** Browser runtime for M0a's reviewed, self-contained standard-profile fixtures.
 * This is not the security boundary for customer code. Cloud admission is M0b.
 */
export function frameTime(frameIndex, totalFrames) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames)
    throw new RangeError('FRAME_OUT_OF_RANGE');
  return Object.freeze({numerator: frameIndex, denominator: 30});
}

/**
 * random-at-v1: UTF-8 byte lengths (uint32 little-endian) followed by each value,
 * FNV-1a, then MurmurHash3's fmix32. Unsigned output / 2^32 is in [0, 1).
 * This is keyed visual noise, not a source of credentials or cryptographic entropy.
 */
export function randomAt(seed, key) {
  if (typeof seed !== 'string' || typeof key !== 'string' || !seed.isWellFormed() || !key.isWellFormed())
    throw new TypeError('RANDOM_KEY_INVALID');
  let value = 2166136261;
  const add = byte => { value = Math.imul(value ^ byte, 16777619) >>> 0; };
  for (const input of [seed, key]) {
    const bytes = new TextEncoder().encode(input);
    if (bytes.length > 0xffffffff) throw new RangeError('RANDOM_KEY_TOO_LONG');
    for (let shift = 0; shift < 32; shift += 8) add((bytes.length >>> shift) & 255);
    for (const byte of bytes) add(byte);
  }
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  return value / 4294967296;
}

function assertSupportedDrawing(root) {
  // Display invalidation below is only valid for direct absolute-time drawing.
  // It would cancel/restart native animations, including manually paused ones.
  if (root.getAnimations({subtree:true}).length)
    throw new Error('NATIVE_ANIMATION_UNSUPPORTED: use absolute-time DOM/SVG attributes or Canvas 2D drawing');
}

async function settleDirectDrawing(root) {
  assertSupportedDrawing(root);
  const display = root.style.getPropertyValue('display');
  const priority = root.style.getPropertyPriority('display');
  try {
    root.style.setProperty('display', 'none', 'important');
    root.getBoundingClientRect();
  } finally {
    if (display) root.style.setProperty('display', display, priority);
    else root.style.removeProperty('display');
  }
  // This invalidates retained SVG raster layers for the supported drawing path.
  // The screenshot supplies the compositor/readback barrier. It is not a media
  // or WebGL barrier, and cannot make stateful customer code deterministic.
  root.getBoundingClientRect();
  assertSupportedDrawing(root);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  assertSupportedDrawing(root);
}

export async function createCompositionRuntime({definition, root, targetId, width, height, durationSeconds, seed, values}) {
  if (!root || definition?.apiVersion !== '2.7.0' || typeof definition.prepare !== 'function')
    throw new TypeError('COMPOSITION_INVALID');
  if (![15, 30].includes(durationSeconds) || ![width, height].every(value => Number.isSafeInteger(value) && value > 0))
    throw new TypeError('DIMENSIONS_INVALID');
  for (const field of ['editables', 'markers', 'regions', 'videoUses', 'fonts'])
    if (!Array.isArray(definition[field])) throw new TypeError('COMPOSITION_DECLARATIONS_REQUIRED');
  if (definition.videoUses.length || definition.fonts.length)
    throw new Error('CAPABILITY_UNAVAILABLE: media and font registries are not implemented in M0a step 1');
  if (definition.editables.length || Object.keys(values ?? {}).length)
    throw new Error('CAPABILITY_UNAVAILABLE: editable values are implemented with local preview in M0a step 2');

  root.replaceChildren();
  Object.assign(root.style, {width: width + 'px', height: height + 'px', position: 'relative', overflow: 'hidden'});
  const context = Object.freeze({
    targetId, width, height, fps: 30, totalFrames: durationSeconds * 30, seed,
    values: Object.freeze({...values}), assets: Object.freeze({}),
    surface: Object.freeze({
      mode: 'trusted_render', pixelScale: 1, root,
      createCanvas() {
        const canvas = root.ownerDocument.createElement('canvas');
        canvas.width = width; canvas.height = height;
        Object.assign(canvas.style, {width: width + 'px', height: height + 'px'});
        root.append(canvas);
        return canvas;
      }
    }),
    videoFrames: Object.freeze({get: async () => { throw new Error('CAPABILITY_UNAVAILABLE'); }}),
    fonts: Object.freeze({ready: Promise.resolve(), family: () => { throw new Error('CAPABILITY_UNAVAILABLE'); }}),
    randomAt: key => randomAt(seed, key)
  });
  const prepared = await definition.prepare(context);
  if (!prepared || typeof prepared.draw !== 'function' || typeof prepared.dispose !== 'function')
    throw new TypeError('PREPARED_COMPOSITION_INVALID');
  let disposed = false, pending = Promise.resolve();
  const serial = operation => {
    const next = pending.then(operation);
    pending = next.catch(() => {});
    return next;
  };
  return Object.freeze({
    seek(frameIndex) {
      return serial(async () => {
        if (disposed) throw new Error('INVALID_SESSION');
        const time = frameTime(frameIndex, context.totalFrames);
        assertSupportedDrawing(root);
        const result = await prepared.draw(time);
        await settleDirectDrawing(root);
        return {frameIndex, time, regions: result?.regions ?? []};
      });
    },
    dispose() {
      return serial(async () => {
        if (disposed) return;
        disposed = true;
        await prepared.dispose();
        root.replaceChildren();
      });
    }
  });
}
