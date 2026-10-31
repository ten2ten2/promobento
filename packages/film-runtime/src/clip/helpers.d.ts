import type {ClipHelpers} from '../../../../contracts/film-runtime.d.ts';

/** Private helper instances; an explicit window preserves authored-scene globals. */
export function createClipHelpers(env?: object): ClipHelpers;
