import type {BlobRef} from './pipeline-types.ts';
export function pngRgba(width:number,height:number,pixels:Uint8Array):Uint8Array;
export function reviewContactSheet(input:{aspect:string;frames:BlobRef[];load:(blob:BlobRef)=>Promise<Uint8Array>;sampleKind?:'reading_holds'|'brand_relay_keyposes'|'beat_choreography_keyposes'}):Promise<{
 bytes:Uint8Array;width:number;height:number;columns:number;rows:number;padding:string;scope:string;
 tiles:Array<{frame:number;source:BlobRef;left:number;top:number;width:number;height:number}>;
}>;
