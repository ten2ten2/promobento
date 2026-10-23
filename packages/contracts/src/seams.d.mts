export function pngPixels(bytes: Uint8Array): {width: number; height: number; pixels: Uint8Array};
export function compareSeam(expected: Uint8Array, actual: Uint8Array): {identical: boolean; maxChannelDiff: number; diffPixelPct: number; verdict: 'pass' | 'pass_within_tolerance' | 'RENDER_SEAM_BLOCK'};
