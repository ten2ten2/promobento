// Capture ICU entry points before any authored scene runs. Segmentation uses
// the frozen text language, never the website's language or browser default.
const apply=Reflect.apply,Segmenter=Intl.Segmenter,segment=Intl.Segmenter.prototype.segment,exec=RegExp.prototype.exec;
const sample=apply(segment,new Segmenter('en',{granularity:'grapheme'}),['a']);
const iterator=Object.getPrototypeOf(sample)[Symbol.iterator];
const next=Object.getPrototypeOf(apply(iterator,sample,[])).next;
const whitespace=/^\s+$/u,closing=/^[,.;:!?%…)\]}，。！？；：、）》」』】]+$/u;

export const isTextWhitespace=(text:string)=>apply(exec,whitespace,[text])!==null;
export const isClosingPunctuation=(text:string)=>apply(exec,closing,[text])!==null;

export function segmentText(text:string,language:string|undefined,granularity:'word'|'grapheme'){
 let parts:unknown;
 try{parts=apply(segment,new Segmenter(language??'en',{granularity}),[text]);}
 catch{throw Error('TEXT_SEGMENTATION_UNAVAILABLE');}
 const cursor=apply(iterator,parts,[]),result:string[]=[];
 for(;;){const item=apply(next,cursor,[]) as IteratorResult<{segment:string}>;if(item.done)break;result[result.length]=item.value.segment;}
 return result;
}
