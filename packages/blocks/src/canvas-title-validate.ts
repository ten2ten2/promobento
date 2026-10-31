import {parseCanvasNumber} from '@promobento/contracts/canvas-text';

/** Restriction for the first audited original y5 text path, not for other text. */
export function assertCanvasTitle(text:string,role:string,style?:string):void{
 const simple=/^[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}]+$/u;
 if(role!=='headline'||!text.trim()||[...text].length>80||!simple.test(text)
  ||/[\p{M}\p{Cf}\p{Cc}\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff\u{1f1e6}-\u{1f1ff}\u{1f3fb}-\u{1f3ff}]/u.test(text))throw Error('CANVAS_TITLE_TEXT_UNSUPPORTED');
 if((style??'normal')!=='normal')throw Error('CANVAS_TITLE_FONT_UNSUPPORTED');
}

/** A count can only animate one confirmed, exactly formatted value. */
export function assertCanvasNumber(text:string,role:string,style?:string):void{
 try{if(role!=='number')throw Error('role');parseCanvasNumber(text);}catch{throw Error('CANVAS_NUMBER_TEXT_UNSUPPORTED');}
 if((style??'normal')!=='normal')throw Error('CANVAS_TITLE_FONT_UNSUPPORTED');
}
