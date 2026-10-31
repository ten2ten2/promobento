export interface VideoFrameManifest {
 schemaVersion:'3.0.0';kind:'video_frame_manifest';source:{sha256:string;byteLength:number;mediaType:'video/mp4'|'video/quicktime'|'video/webm'|'image/gif'};
 browserVersion:string;width:number;height:number;poster:{sha256:string;byteLength:number};
 packs:Array<{sha256:string;byteLength:number}>;
 frames:Array<{index:number;pts:number;duration:number;pack:number;offset:number;byteLength:number}>;
}
export function parseVideoFrameManifest(raw:string|Uint8Array,expectedSha:string):VideoFrameManifest;
export function videoFrameBytes(manifest:VideoFrameManifest,index:number,pack:Uint8Array):Uint8Array;
export function openVideoFramePack(manifest:VideoFrameManifest,packIndex:number,pack:Uint8Array):{frame(index:number):Uint8Array};
