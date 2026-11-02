export interface ReferenceFrameEvidence {
 resourceId:string;sourceSha256:string;sourceFrameCount:number;sampledFrames:number[];
 audioStatus:'not_analyzed';
 frames:Array<{index:number;timeSeconds:number;bytes:Uint8Array;mediaType:'image/webp'}>;
}
export function referenceFrameEvidence(input:{
 resourceId:string;manifestBytes:Uint8Array;manifestSha256:string;
 source:{sha256:string;byteLength:number;mediaType:string};
 framePacks:Array<{key:string;sha256:string;byteLength:number}>;
 readPack:(blob:{key:string;sha256:string;byteLength:number})=>Promise<Uint8Array>;
 maxSamples?:number;
}):Promise<ReferenceFrameEvidence>;
