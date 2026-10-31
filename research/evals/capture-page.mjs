/** Limit page capture to explicitly requested viewports; this never authorizes any asset. */
export function capturePageOptions(args){
 if(!args.length)return{grab:false,maxShots:1};
 if(args[0]!=='--grab')throw Error('CAPTURE_MODE_INVALID');
 if(args.length===1)return{grab:true,maxShots:8};
 if(args.length!==3||args[1]!=='--shots'||!/^([1-9]|[1-3][0-9]|40)$/.test(args[2]))throw Error('CAPTURE_MODE_INVALID');
 return{grab:true,maxShots:Number(args[2])};
}

/** Re-check height after each scroll so late-loading approved pages are not silently truncated. */
export async function capturePageScreens(page,{maxShots,firstFile,save}){
 const screenshots=[{file:firstFile,y:0}];let lastY=0;
 const state=()=>page.evaluate(()=>({height:document.documentElement.scrollHeight,y:window.scrollY}));
 for(let index=1;index<maxShots;index++){
  const {height}=await state();
  const next=lastY+1000;if(next>=height)break;
  await page.evaluate(offset=>window.scrollTo(0,offset),next);await page.waitForTimeout(500);
  const {y}=await state();
  if(y<=lastY)break;
  const file=await save(index,y);screenshots.push({file,y});lastY=y;
 }
 const {height}=await state();
 return{screenshots,missingBelow:lastY+1000<height,height};
}
