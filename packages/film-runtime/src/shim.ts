import { randomSequence } from '@promobento/contracts/random';
import type { PrivateClock } from './types.ts';

function installShim(): void {
// Captured before any page code, retained only by the engine after the one-time handoff.
const nativeRaf = window.requestAnimationFrame.bind(window);
const nativeTimeout = window.setTimeout.bind(window);
const nativeClear = window.clearTimeout.bind(window);
const nativeInterval = window.setInterval.bind(window);
const nativeClearInterval = window.clearInterval.bind(window);
const nativeCancelRaf = window.cancelAnimationFrame.bind(window);
const loadingTimers = new Set<number>(), loadingIntervals = new Set<number>(), loadingRafs = new Set<number>();
const NativeDate = Date;
let seconds = 0, rendering = false;
let random = randomSequence('loading');
let nextRafId = 1;
const callbacks = new Map<number, FrameRequestCallback>();
const deny = (code: string) => function(): never { throw Error(code); };
const replace = (object: object, key: PropertyKey, value: unknown): void => {
  Object.defineProperty(object, key, {value, configurable: false, writable: false});
};
// CDP-driven calls may inherit debugger CSP exemptions. Seal the actual constructors,
// including indirect/async/generator access, before either libraries or author scripts load.
const noEval=deny('RUNTIME_EVAL_FORBIDDEN');
for(const factory of [function(){},async function(){},function*(){},async function*(){}])
  replace(Object.getPrototypeOf(factory),'constructor',noEval);
replace(window,'Function',noEval);
replace(window,'eval',noEval);

function VirtualDate(this: unknown, ...args: unknown[]): Date | string {
  if (!new.target) return new NativeDate(seconds * 1000).toString();
  return args.length ? Reflect.construct(NativeDate, args) as Date : new NativeDate(seconds * 1000);
}
VirtualDate.prototype = NativeDate.prototype;
Object.defineProperty(NativeDate.prototype, 'constructor', {value: VirtualDate});
Object.defineProperty(VirtualDate, 'parse', {value: NativeDate.parse.bind(NativeDate)});
Object.defineProperty(VirtualDate, 'UTC', {value: NativeDate.UTC.bind(NativeDate)});
Object.defineProperty(VirtualDate, 'now', {value: () => seconds * 1000});
replace(window, 'Date', VirtualDate);
replace(performance, 'now', () => seconds * 1000);
replace(performance, 'timeOrigin', 0);
replace(Math, 'random', () => random.next());

for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'open'])
  replace(window, key, deny('RUNTIME_NETWORK_FORBIDDEN'));
replace(navigator, 'sendBeacon', deny('RUNTIME_NETWORK_FORBIDDEN'));
for (const key of ['Worker', 'SharedWorker']) replace(window, key, deny('RUNTIME_WORKER_FORBIDDEN'));
replace(navigator, 'serviceWorker', undefined);
replace(window, 'WebAssembly', undefined);
replace(crypto, 'getRandomValues', deny('RUNTIME_RANDOM_FORBIDDEN'));
replace(crypto, 'randomUUID', deny('RUNTIME_RANDOM_FORBIDDEN'));
for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'caches'])
  Object.defineProperty(window, key, {get: deny('RUNTIME_STORAGE_FORBIDDEN'), configurable: false});
Object.defineProperty(document, 'cookie', {get: deny('RUNTIME_STORAGE_FORBIDDEN'), set: deny('RUNTIME_STORAGE_FORBIDDEN')});
for (const key of ['AudioContext', 'webkitAudioContext', 'Audio']) replace(window, key, deny('RUNTIME_AUDIO_FORBIDDEN'));
// Canvas pixels do not carry a fact-bound text slot. This also covers text drawn
// indirectly by the original CLIP helpers and by detached/offscreen canvases.
for (const context of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D]) {
  if (!context) continue;
  for (const key of ['fillText', 'strokeText']) replace(context.prototype, key, deny('RUNTIME_TEXT_FORBIDDEN'));
}
// Only the bundled trusted 3D implementation may create a WebGL context.
// This closes indirect getContext aliases as well as direct author calls.
const nativeCanvasContext=HTMLCanvasElement.prototype.getContext,webglContexts=new Map<HTMLCanvasElement,WebGL2RenderingContext>();
replace(HTMLCanvasElement.prototype,'getContext',function(this:HTMLCanvasElement,type:string,...args:unknown[]){
  if(type!=='2d')throw Error('RUNTIME_WEBGL_FORBIDDEN');
  return Reflect.apply(nativeCanvasContext,this,[type,...args]);
});
if(window.OffscreenCanvas){
  const nativeOffscreenContext=OffscreenCanvas.prototype.getContext;
  replace(OffscreenCanvas.prototype,'getContext',function(this:OffscreenCanvas,type:string,...args:unknown[]){
    if(type!=='2d')throw Error('RUNTIME_WEBGL_FORBIDDEN');
    return Reflect.apply(nativeOffscreenContext,this,[type,...args]);
  });
}
const webglFactory=Object.freeze({
  create(canvas:HTMLCanvasElement){
    if(webglContexts.has(canvas))throw Error('WEBGL_CONTEXT_DUPLICATE');
    const gl=Reflect.apply(nativeCanvasContext,canvas,['webgl2',{alpha:true,depth:true,stencil:false,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'default',failIfMajorPerformanceCaveat:false}]) as WebGL2RenderingContext|null;
    if(!gl)throw Error('WEBGL_CONTEXT_UNAVAILABLE');webglContexts.set(canvas,gl);return gl;
  },
  release(canvas:HTMLCanvasElement){webglContexts.delete(canvas);}
});
Object.defineProperty(window,'__pbTakeWebGLFactory',{configurable:true,value:()=>{delete window.__pbTakeWebGLFactory;return webglFactory;}});
Object.defineProperty(window,'__pbTakeWebGLInspector',{configurable:true,value:()=>{
  delete window.__pbTakeWebGLInspector;
  return ()=>[...webglContexts].filter(([canvas])=>canvas.isConnected).map(([,gl])=>{
    if(gl.isContextLost())throw Error('WEBGL_CONTEXT_UNAVAILABLE');const extension=gl.getExtension('WEBGL_debug_renderer_info');
    return{renderer:gl.getParameter(extension?extension.UNMASKED_RENDERER_WEBGL:gl.RENDERER),vendor:gl.getParameter(extension?extension.UNMASKED_VENDOR_WEBGL:gl.VENDOR),version:gl.getParameter(gl.VERSION)};
  });
}});
const createElement = document.createElement.bind(document);
document.createElement = ((tag: string, options?: ElementCreationOptions) => {
  if (['iframe', 'frame', 'object', 'embed'].includes(tag.toLowerCase())) throw Error('RUNTIME_IFRAME_FORBIDDEN');
  if (['video', 'audio'].includes(tag.toLowerCase())) throw Error('RUNTIME_VIDEO_FORBIDDEN');
  return createElement(tag, options);
}) as typeof document.createElement;

replace(window, 'setTimeout', (...args: Parameters<typeof window.setTimeout>) => {
  if (rendering) throw Error('RUNTIME_TIMER_FORBIDDEN');
  const [handler, delay, ...values] = args;
  if (typeof handler !== 'function') throw Error('RUNTIME_EVAL_FORBIDDEN');
  const id = nativeTimeout(() => { loadingTimers.delete(id); handler(...values); }, delay);
  loadingTimers.add(id); return id;
});
replace(window, 'setInterval', (...args: Parameters<typeof window.setInterval>) => {
  if (rendering) throw Error('RUNTIME_TIMER_FORBIDDEN');
  if (typeof args[0] !== 'function') throw Error('RUNTIME_EVAL_FORBIDDEN');
  const id = nativeInterval(...args); loadingIntervals.add(id); return id;
});
replace(window, 'clearTimeout', (id?: number): void => { if (id !== undefined) { loadingTimers.delete(id); nativeClear(id); } });
replace(window, 'clearInterval', (id?: number): void => { if (id !== undefined) { loadingIntervals.delete(id); nativeClearInterval(id); } });
replace(window, 'requestAnimationFrame', (callback: FrameRequestCallback): number => {
  if (!rendering) { const id = nativeRaf(time => { loadingRafs.delete(id); callback(time); }); loadingRafs.add(id); return id; }
  const id = nextRafId++; callbacks.set(id, callback); return id;
});
replace(window, 'cancelAnimationFrame', (id: number): void => {
  callbacks.delete(id); loadingRafs.delete(id); nativeCancelRaf(id);
});
document.addEventListener('transitionrun', () => {
  if (rendering) window.__omBootFailed = 'RUNTIME_CSS_TRANSITION_FORBIDDEN';
});

const clock: PrivateClock = Object.freeze({
  begin(seed: string) {
    for (const id of loadingTimers) nativeClear(id);
    for (const id of loadingIntervals) nativeClearInterval(id);
    for (const id of loadingRafs) nativeCancelRaf(id);
    loadingTimers.clear(); loadingIntervals.clear(); loadingRafs.clear();
    random = randomSequence(seed); seconds = 0; rendering = true;
  },
  seek(time: number) {
    seconds = time; random.reset();
    for (let round = 0; round < 2; round++) {
      const pending = [...callbacks.values()]; callbacks.clear();
      for (const callback of pending) callback(time * 1000);
    }
  },
  paint(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = nativeTimeout(() => reject(Error('FRAME_TIMEOUT')), timeoutMs);
      nativeRaf(() => nativeRaf(() => { nativeClear(timer); resolve(); }));
    });
  },
  wait<T>(work: Promise<T>, timeoutMs: number, code: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = nativeTimeout(() => reject(Error(code)), timeoutMs);
      work.then(value => { nativeClear(timer); resolve(value); }, error => { nativeClear(timer); reject(error); });
    });
  }
});
Object.defineProperty(window, '__pbTakeClock', {configurable: true, value: () => {
  delete window.__pbTakeClock;
  return clock;
}});
}
// The controller injects this before document scripts; the generated page also loads it for preview use.
if (!window.__pbTakeClock && !window.__omEngine) installShim();
