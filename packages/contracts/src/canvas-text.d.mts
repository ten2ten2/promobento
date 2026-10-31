export interface CanvasTextTrace {
  sceneId:string;slotId:string;text:string;fontId:string;weight:number;style:'normal';
  boxes:Array<{x:number;y:number;width:number;height:number}>;fontSize:number;alpha:number;
}
export function assertCanvasTextTrace(spec:Record<string,any>,frame:number,traces:unknown):CanvasTextTrace[];
export function assertCanvasTextFrameDigests(spec:Record<string,any>,shard:{start:number;end:number},quality:string,records:unknown):void;

export function isCanvasTextScene(scene:Record<string,any>):boolean;
export function canvasTextSlotAt(scene:Record<string,any>,frame:number):string|undefined;
