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
  const progress = incoming ? clamp01((frame - incoming.start) / (incoming.transitionIn?.frames || 1)) : 1;
  return active.map((scene, index) => ({
    id: scene.id, seconds: (frame - scene.start) / 30,
    opacity: incoming && kind === 'crossfade' && index === 1 ? progress : 1,
    x: incoming && (kind === 'push' || kind === 'whip') ? index === 0 ? -easeOut(progress) : 1 - easeOut(progress) : 0,
    blur: incoming && kind === 'whip' ? Math.sin(progress * Math.PI) * 18 : 0
  }));
}
