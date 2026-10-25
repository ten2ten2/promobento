export interface RelayPoint {x: number; y: number}
export function featureLandings(count: number, beatFrames: number): number[] {
  if (!Number.isInteger(count) || count < 2 || count > 4 || !Number.isInteger(beatFrames) || beatFrames < 6 || beatFrames > 60)
    throw Error('RELAY_TIMING_INVALID');
  return Array.from({length: count}, (_, index) => 15 + index * beatFrames);
}

/** One brand mark travels between settled roles. Its pose depends only on the requested frame. */
export function brandRelayPose(frame: number, beatFrames: number, points: RelayPoint[]) {
  featureLandings(points.length, beatFrames);
  const position = Math.max(0, Math.min(points.length - 1, (frame - 15) / beatFrames));
  const from = Math.min(points.length - 2, Math.floor(position)), progress = position - from;
  const a = points[from]!, b = points[from + 1]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
  const hop = progress === 0 || progress === 1 ? 0 : Math.sin(Math.PI * progress), arc = -12 * hop;
  return {x: a.x + dx * progress - dy / length * arc, y: a.y + dy * progress + dx / length * arc,
    scale: 1 + .08 * hop, rotation: hop ? -4 * Math.sin(2 * Math.PI * progress) : 0, moving: hop !== 0};
}
