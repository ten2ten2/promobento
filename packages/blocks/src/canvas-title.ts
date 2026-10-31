import {fillBoundCanvasText} from './private-canvas-text.ts';

export interface GlyphBox {x:number;y:number;width:number;height:number}
export interface CanvasTitleTrace {boxes:GlyphBox[];fontSize:number;alpha:number;draws:number;font:string;letterSpacing:string}

/** Only the fixed original y5 title path receives this proxy; it is never given to authored code. */
export function boundCanvasTitle(context:CanvasRenderingContext2D,expected:string,trace:CanvasTitleTrace|null):CanvasRenderingContext2D{
 return new Proxy(context,{
  get(target,key){
   if(key==='fillText')return (text:string,x:number,y:number,maxWidth?:number)=>{
    if(text!==expected||maxWidth!==undefined)throw Error('CANVAS_TEXT_BINDING_MISMATCH');
    if(trace){
     if(++trace.draws!==1)throw Error('CANVAS_TEXT_MULTILINE_UNSUPPORTED');
     if(!['left','start'].includes(target.textAlign)||!['alphabetic'].includes(target.textBaseline))throw Error('CANVAS_TEXT_LAYOUT_UNSUPPORTED');
     const size=/([\d.]+)px/.exec(target.font);if(!size)throw Error('CANVAS_TEXT_FONT_INVALID');
     const m=target.getTransform();trace.fontSize=Number(size[1])*Math.min(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d));trace.alpha=target.globalAlpha;
     trace.font=target.font;trace.letterSpacing=target.letterSpacing;
     const segments=new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text);let prefix='';
     for(const {segment}of segments){
      const advance=target.measureText(prefix).width,metrics=target.measureText(segment);prefix+=segment;
      if(!segment.trim())continue;
      if(!(metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight>0&&metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent>0))throw Error('CANVAS_TEXT_GLYPH_UNAVAILABLE');
      const left=x+advance-metrics.actualBoundingBoxLeft-2,right=x+advance+metrics.actualBoundingBoxRight+2,
       top=y-metrics.actualBoundingBoxAscent-2,bottom=y+metrics.actualBoundingBoxDescent+2;
      if(!(right>left&&bottom>top))throw Error('CANVAS_TEXT_GLYPH_UNAVAILABLE');
      const xs:number[]=[],ys:number[]=[];
      for(const [px,py]of [[left,top],[right,top],[left,bottom],[right,bottom]]){xs.push(m.a*px!+m.c*py!+m.e);ys.push(m.b*px!+m.d*py!+m.f);}
      const x0=Math.min(...xs),y0=Math.min(...ys),x1=Math.max(...xs),y1=Math.max(...ys);trace.boxes.push({x:x0,y:y0,width:x1-x0,height:y1-y0});
     }
    }
    if(trace)fillBoundCanvasText(target,text,x,y);
   };
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  },
  set(target,key,value){return Reflect.set(target,key,value,target);}
 });
}
