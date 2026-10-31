// The shim hands this capability to the trusted 3D bundle exactly once, before author scripts run.
import '../../film-runtime/src/types.ts';
const factory=window.__pbTakeWebGLFactory?.();
if(!factory)throw Error('RUNTIME_WEBGL_HANDOFF_MISSING');
export const createTrustedWebGL=(canvas:HTMLCanvasElement)=>factory.create(canvas) as WebGL2RenderingContext;
export const releaseTrustedWebGL=(canvas:HTMLCanvasElement)=>factory.release(canvas);
