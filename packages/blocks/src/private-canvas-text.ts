// The shim hands this primitive to the fixed trusted-block bundle once.
// It is never exposed through ctx or to authored scene modules.
import '../../film-runtime/src/types.ts';
const candidate=window.__pbTakeCanvasText?.();
if(typeof candidate!=='function')throw Error('RUNTIME_TEXT_HANDOFF_MISSING');
const fill:Function=candidate;
export function fillBoundCanvasText(context:CanvasRenderingContext2D,text:string,x:number,y:number,maxWidth?:number):void{
 if(maxWidth===undefined)Reflect.apply(fill,context,[text,x,y]);
 else Reflect.apply(fill,context,[text,x,y,maxWidth]);
}
