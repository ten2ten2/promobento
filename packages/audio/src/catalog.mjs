/** Portable declarations: safe for Workers; DSP and sample file I/O stay in the audio container. */
export const AUDIO_STYLES = Object.freeze(['mallet','pulse','lofi','funk','trap','chiptune','ambient','piano','cinematic','pizzicato','acoustic','guofeng','synthwave']);
export const SFX_IDS = Object.freeze(['pop','tick','click','whoosh','whip','thud','impact','paper','stamp','ding','chime','sparkle','count','riser','draw','type','boing','slide','hit','subdrop','reverse','glitch','shutter']);
/** Default source lengths and anchor offsets, in exact 48 kHz samples; no DSP import in Workers. */
export const SFX_LEAD_TIMING=Object.freeze({
 whoosh:Object.freeze({synthesisSamples:24000,durationSamples:24000,leadSamples:14400}),
 whip:Object.freeze({synthesisSamples:11520,durationSamples:11520,leadSamples:6336}),
 // The existing DSP mix adds one zero-offset sample; preserve its bytes, and freeze the actual source length.
 riser:Object.freeze({synthesisSamples:38400,durationSamples:38401,leadSamples:38400}),
 reverse:Object.freeze({synthesisSamples:57600,durationSamples:57601,leadSamples:57600})
});
