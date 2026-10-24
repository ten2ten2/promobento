// Trusted review packaging: compose actual checked PNG pixels, never execute author code or omit an aspect.
import {pngPixels,pngRgba} from '@promobento/contracts/seams';

export {pngRgba} from '@promobento/contracts/seams';

export async function reviewContactSheet({aspect,frames,load}){
 if(!['landscape','portrait','feed','square'].includes(aspect)||!Array.isArray(frames)||!frames.length||frames.length>120)throw Error('REVIEW_FRAME_COVERAGE_MISSING');
 const sequence=frames.map(blob=>{
  const match=/\/observation-frames\/(\d+)\.png$/.exec(blob.key);if(!match)throw Error('REVIEW_FRAME_REFERENCE_INVALID');
  return{blob,frame:Number(match[1])};
 }).sort((a,b)=>a.frame-b.frame);
 if(sequence.some((entry,index)=>entry.frame>899||index&&entry.frame===sequence[index-1].frame))throw Error('REVIEW_FRAME_REFERENCE_INVALID');
 const columns=Math.min(4,Math.ceil(Math.sqrt(sequence.length))),rows=Math.ceil(sequence.length/columns);
 let pixels,width,height,tileWidth,tileHeight,sourceWidth,sourceHeight;
 const tiles=[];
 for(const [index,{blob,frame}]of sequence.entries()){
  const source=pngPixels(await load(blob));
  if(index===0){
   sourceWidth=source.width;sourceHeight=source.height;
   const scale=Math.min(320/sourceWidth,320/sourceHeight,960/(columns*sourceWidth),1920/(rows*sourceHeight));
   tileWidth=Math.max(1,Math.floor(sourceWidth*scale));tileHeight=Math.max(1,Math.floor(sourceHeight*scale));width=columns*tileWidth;height=rows*tileHeight;
   pixels=new Uint8Array(width*height*4);for(let at=3;at<pixels.length;at+=4)pixels[at]=255;
  }
  if(source.width!==sourceWidth||source.height!==sourceHeight)throw Error('REVIEW_FRAME_DIMENSIONS_MIXED');
  const left=index%columns*tileWidth,top=Math.floor(index/columns)*tileHeight;
  for(let y=0;y<tileHeight;y++)for(let x=0;x<tileWidth;x++){
   const input=(Math.floor(y*source.height/tileHeight)*source.width+Math.floor(x*source.width/tileWidth))*4,output=((top+y)*width+left+x)*4;
   pixels.set(source.pixels.subarray(input,input+4),output);
  }
  tiles.push({frame,source:blob,left,top,width:tileWidth,height:tileHeight});
 }
 const bytes=pngRgba(width,height,pixels);
 if(bytes.length>1<<20)throw Error('MODEL_IMAGE_TOO_LARGE');
 return{bytes,width,height,tiles,columns,rows,padding:'unlisted_grid_cells_are_not_film_frames',scope:'all_actual_reading_hold_frames_not_per_second_or_full_Q2'};
}
