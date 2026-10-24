import {pngPixels,pngRgba} from '@promobento/contracts/seams';

/** Exact 2:1 CPU reduction of the same full-size pixels used for encoding. */
export function reviewPng(bytes){
  const source=pngPixels(bytes);
  if(source.width%2||source.height%2)throw Error('REVIEW_PNG_DIMENSIONS_INVALID');
  const width=source.width/2,height=source.height/2,pixels=new Uint8Array(width*height*4),input=source.pixels;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const a=(y*2*source.width+x*2)*4,b=a+4,c=a+source.width*4,d=c+4,out=(y*width+x)*4;
    const alpha=input[a+3]+input[b+3]+input[c+3]+input[d+3];pixels[out+3]=Math.floor((alpha+2)/4);
    if(alpha)for(let channel=0;channel<3;channel++)pixels[out+channel]=Math.floor((
      input[a+channel]*input[a+3]+input[b+channel]*input[b+3]+input[c+channel]*input[c+3]+input[d+channel]*input[d+3]+alpha/2)/alpha);
  }
  return pngRgba(width,height,pixels);
}
