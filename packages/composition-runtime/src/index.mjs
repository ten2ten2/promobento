/** Browser runtime for M0a's reviewed, self-contained standard-profile fixtures.
 * This is not the security boundary for customer code. Cloud admission is M0b.
 */
export function frameTime(frameIndex, totalFrames) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames)
    throw new RangeError('FRAME_OUT_OF_RANGE');
  return Object.freeze({numerator: frameIndex, denominator: 30});
}

/** FNV-1a over UTF-8(seed + NUL + key), scaled to [0, 1). No mutable PRNG state. */
export function randomAt(seed, key) {
  if (typeof seed !== 'string' || typeof key !== 'string') throw new TypeError('RANDOM_KEY_INVALID');
  let value = 2166136261;
  for (const byte of new TextEncoder().encode(seed + '\0' + key)) value = Math.imul(value ^ byte, 16777619) >>> 0;
  return value / 4294967296;
}

export const clamp01 = value => Math.min(1, Math.max(0, value));
export const easeOutCubic = value => 1 - (1 - clamp01(value)) ** 3;

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
        const result = await prepared.draw(time);
        // Reviewed M0a fixtures use synchronous DOM/SVG. This barrier is followed by
        // Chromium's screenshot compositor barrier; it is not a general media barrier.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
