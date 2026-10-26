const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

/** One beat to arrive, two to read; all times are local source frames at 30 fps. */
export function journeyLandings(count: number, beatFrames: number): number[] {
  if (!Number.isInteger(count) || count < 2 || count > 4 || !Number.isInteger(beatFrames) || beatFrames < 6 || beatFrames > 60)
    throw Error('JOURNEY_TIMING_INVALID');
  return Array.from({length: count}, (_, index) => beatFrames * (1 + index * 3));
}

/** Stateless camera handoffs: a different composition, not a frozen entrance per screenshot. */
export function journeyPose(frame: number, index: number, count: number, beatFrames: number) {
  const landings = journeyLandings(count, beatFrames);
  const from = Math.max(0, Math.min(count - 1, Math.floor((frame - beatFrames) / (3 * beatFrames))));
  const to = Math.min(count - 1, from + 1);
  const progress = to === from ? 0 : ease((frame - landings[from]! - 2 * beatFrames) / beatFrames);
  const active = progress < .5 ? from : to;
  const arrive = ease(frame / beatFrames);
  const drift = clamp((frame - landings[from]!) / (2 * beatFrames));
  const turn = progress === 0 || progress === 1 ? 0 : Math.sin(Math.PI * progress);
  const textOpacity = index === from ? 1 - ease(progress * 4) : index === to ? ease((progress - .75) * 4) : 0;
  return {
    // A match cut at maximum camera travel changes the real state without ghosting two UIs.
    opacity: index === active ? 1 : 0,
    position: from + (to - from) * progress,
    zoom: progress ? 1 - .08 * progress - .12 * turn : .92 + .08 * drift - .22 * (1 - arrive),
    angle: turn * (from % 2 === 0 ? -8 : 8),
    textOpacity: textOpacity * arrive,
    textY: (1 - textOpacity * arrive) * 16
  };
}
