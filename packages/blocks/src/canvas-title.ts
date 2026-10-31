import {fillBoundCanvasText} from './private-canvas-text.ts';

export interface GlyphBox {x:number;y:number;width:number;height:number}
export interface CanvasTitleTrace {boxes:GlyphBox[];fontSize:number;alpha:number;draws:number;font:string;letterSpacing:string}

/** Only fixed original y5 text paths receive this proxy. */
export function boundCanvasTitle(context:CanvasRenderingContext2D,expected:string,trace:CanvasTitleTrace|null){
 let remaining=expected,draws=0;
 const canvas=new Proxy(context,{
  get(target,key){
   if(key==='fillText')return (text:string,x:number,y:number,maxWidth?:number)=>{
    // A line break may replace whitespace at the wrap boundary, but may not
    // change, reorder or omit any of the original non-whitespace characters.
    if(draws)remaining=remaining.replace(/^\s+/u,'');
    if(typeof text!=='string'||!text||maxWidth!==undefined||++draws>2||!remaining.startsWith(text))throw Error('CANVAS_TEXT_BINDING_MISMATCH');
    remaining=remaining.slice(text.length);
    if(trace){
     trace.draws=draws;
     if(!['left','start'].includes(target.textAlign)||!['alphabetic'].includes(target.textBaseline))throw Error('CANVAS_TEXT_LAYOUT_UNSUPPORTED');
     const size=/([\d.]+)px/.exec(target.font);if(!size)throw Error('CANVAS_TEXT_FONT_INVALID');
     const m=target.getTransform(),fontSize=Number(size[1])*Math.min(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d));
     if(draws>1&&(trace.font!==target.font||trace.letterSpacing!==target.letterSpacing||Math.abs(trace.fontSize-fontSize)>1e-6||Math.abs(trace.alpha-target.globalAlpha)>1e-6))throw Error('CANVAS_TEXT_LAYOUT_UNSUPPORTED');
     trace.fontSize=fontSize;trace.alpha=target.globalAlpha;
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
 return{canvas,finish(){if(!draws||remaining.trim())throw Error('CANVAS_TEXT_BINDING_MISMATCH');}};
}

/** Routes fixed grammar text calls to their own declared slot; all other drawing stays shared. */
export function boundCanvasPair(context:CanvasRenderingContext2D,expected:{title:string;subtitle:string},traces:{title:CanvasTitleTrace|null;subtitle:CanvasTitleTrace|null}){
 const parts={title:boundCanvasTitle(context,expected.title,traces.title),subtitle:boundCanvasTitle(context,expected.subtitle,traces.subtitle)};
 let current:'title'|'subtitle'|undefined;
 const canvas=new Proxy(context,{
  get(target,key){
   if(key==='fillText')return (...args:Parameters<CanvasRenderingContext2D['fillText']>)=>{
    if(!current)throw Error('CANVAS_TEXT_BINDING_MISMATCH');return parts[current].canvas.fillText(...args);
   };
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  },
  set(target,key,value){return Reflect.set(target,key,value,target);}
 });
 return{canvas,tag(part:'title'|'subtitle',draw:()=>void){if(current||!Object.hasOwn(parts,part))throw Error('CANVAS_TEXT_BINDING_MISMATCH');current=part;try{draw();}finally{current=undefined;}},
  finish(){parts.title.finish();parts.subtitle.finish();}};
}
