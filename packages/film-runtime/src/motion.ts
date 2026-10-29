import type { FilmScene } from '../../../contracts/film-runtime.d.ts';

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export const easeOut = (value: number): number => 1 - (1 - clamp01(value)) ** 3;

/** Half-open scene coverage; subframes are allowed here, integer nominal frames at the bridge. */
export function frameLayers(scenes: readonly FilmScene[], frame: number): Array<{
  id: string; seconds: number; opacity: number; x: number; blur: number;
}> {
  const active = scenes.filter(scene => scene.start <= frame && frame < scene.end).sort((a, b) => a.start - b.start);
  const incoming = active[1];
  const kind = incoming?.transitionIn?.type ?? 'cut';
  const transitionFrames = incoming?.transitionIn?.frames || 1;
  const position = incoming ? frame - incoming.start : transitionFrames;
  const progress = clamp01(position / transitionFrames);
  // Put the zero-opacity handoff between nominal frames: old copy exits before CTA enters,
  // without inserting a fully blank frame into an otherwise continuous transition.
  const pivot = Math.max(.5, Math.floor(transitionFrames / 2) - .5);
  return active.map((scene, index) => ({
    id: scene.id, seconds: (frame - scene.start) / 30,
    opacity: incoming && kind === 'fade-through' ? index === 0 ? clamp01(1 - position / pivot) : clamp01((position - pivot) / (transitionFrames - pivot))
      : incoming && kind === 'crossfade' && index === 1 ? progress : 1,
    x: incoming && (kind === 'push' || kind === 'whip') ? index === 0 ? -easeOut(progress) : 1 - easeOut(progress) : 0,
    blur: incoming && kind === 'whip' ? Math.sin(progress * Math.PI) * 18 : 0
  }));
}
