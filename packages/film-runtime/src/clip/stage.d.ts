export interface ClipCue {kind:string;at:number;image?:string;text?:string;sub?:string;data?:Record<string,unknown>}
export interface ClipStage {
  scenes(): Array<{id:string;at:number}>;
  regions(): Array<{id:string;label?:string}>;
  draw(context:CanvasRenderingContext2D,time:number):void;
  /** Approximate template geometry, not proof of content or visibility. */
  hit(id:string):[number,number,number,number]|null;
}
export function createClipStage(spec:{grammar:string;duration:number;fps?:number;data:Record<string,unknown>;cues:ClipCue[];
  safe?:Partial<{top:number;bottom:number;left:number;right:number;fill:string}>;alpha?:boolean;theme?:Record<string,unknown>},
  options:{width:number;height:number;images?:Record<string,CanvasImageSource>;fontFamily?:string;subtitleFontFamily?:string;textPart?:(part:'title'|'subtitle',draw:()=>void)=>void}):ClipStage;
