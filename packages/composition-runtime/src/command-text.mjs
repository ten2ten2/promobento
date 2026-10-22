/** Deterministic, unshaped Latin and CJK text. Each selected glyph is painted individually;
 * no browser kerning, ligatures, implicit fallback or measurement is involved.
 */
export function measureCommandText(faces,declarations,fontId,text,fontSize,weight,layout) {
  if(typeof text!=='string'||!text.isWellFormed()||text.length>4096||!Number.isFinite(fontSize)||fontSize<1||fontSize>512)
    throw Error('ADMISSION_TEXT_INVALID');
  const declaration=declarations.find(font=>font.fontId===fontId);
  if(!declaration||!declaration.weights.includes(weight))throw Error('FONT_WEIGHT_UNDECLARED');
  const visit=(id,seen=[])=>{
    if(seen.includes(id))throw Error('FONT_FALLBACK_CYCLE');
    const item=declarations.find(font=>font.fontId===id);if(!item)throw Error('FONT_FALLBACK_UNDECLARED');
    return [id,...item.fallbackFontIds.flatMap(next=>visit(next,[...seen,id]))];
  };
  const selected=visit(fontId).map(id=>{
    const allowed=declarations.find(font=>font.fontId===id).weights,available=faces.filter(face=>face.fontId===id&&allowed.includes(face.weight));
    const sorted=available.toSorted((a,b)=>a.weight-b.weight),below=sorted.filter(face=>face.weight<weight).reverse();
    return available.find(face=>face.weight===weight)??(weight<400?below[0]??sorted.find(face=>face.weight>weight):
      weight<=500?sorted.find(face=>face.weight>=weight&&face.weight<=500)??below[0]??sorted.find(face=>face.weight>500):
      sorted.find(face=>face.weight>=weight)??below[0]);
  });
  if(selected.some(face=>!face))throw Error('FONT_WEIGHT_UNAVAILABLE');
  if(layout!==undefined&&(!layout||typeof layout!=='object'||Array.isArray(layout)
    ||Object.keys(layout).some(key=>!['width','wrap','lineHeight','align','padding'].includes(key))
    ||!Number.isFinite(layout.width)||layout.width<=0||layout.width>16384
    ||(layout.padding!==undefined&&(!Number.isFinite(layout.padding)||layout.padding<0||layout.padding>128||layout.padding*2>=layout.width))
    ||!['none','word-cjk'].includes(layout.wrap??'none')||!['left','center','right'].includes(layout.align??'left')
    ||(layout.lineHeight!==undefined&&(!Number.isFinite(layout.lineHeight)||layout.lineHeight<1||layout.lineHeight>1024))))throw Error('ADMISSION_TEXT_LAYOUT_INVALID');
  let ascent=0,descent=0;const raw=[];
  for(const character of text) {
    if(character==='\n'&&layout){raw.push({character,newline:true});continue;}
    const point=character.codePointAt(0),face=selected.find(face=>Object.hasOwn(face.glyphs,point));
    if(!face)throw Error('FONT_GLYPH_MISSING: U+'+point.toString(16).toUpperCase());
    const scale=fontSize/face.unitsPerEm,advance=face.glyphs[point]*scale;
    raw.push({character,fontId:face.fontId,weight:face.weight,sha256:face.sha256,advance});
    ascent=Math.max(ascent,face.ascent*scale);descent=Math.max(descent,face.descent*scale);
  }
  const lineHeight=layout?.lineHeight??ascent+descent;
  if(lineHeight<ascent+descent)throw Error('ADMISSION_TEXT_LINE_HEIGHT_INVALID');
  const lines=[[]],widths=[0],wrap=layout?.wrap==='word-cjk',padding=layout?.padding??0,maxWidth=layout?layout.width-padding*2:Infinity;
  const next=()=>{if(lines.length>=128)throw Error('ADMISSION_TEXT_TOO_MANY_LINES');lines.push([]);widths.push(0);};
  const add=glyph=>{
    const i=lines.length-1;
    if(wrap&&widths[i]+glyph.advance>maxWidth+0.001&&lines[i].length)next();
    const j=lines.length-1;lines[j].push({...glyph,x:widths[j]});widths[j]+=glyph.advance;
  };
  for(let index=0;index<raw.length;) {
    if(raw[index].newline){next();index++;continue;}
    const token=[raw[index++]];
    // Latin words stay together if they fit; CJK breaks between ideographs.
    // Oversized words split explicitly instead of dropping or scaling glyphs.
    if(wrap&&/^[A-Za-z0-9À-ÿ]$/u.test(token[0].character))while(index<raw.length&&/^[A-Za-z0-9À-ÿ]$/u.test(raw[index].character))token.push(raw[index++]);
    const tokenWidth=token.reduce((sum,glyph)=>sum+glyph.advance,0),i=lines.length-1;
    if(wrap&&tokenWidth<=maxWidth&&widths[i]>0&&widths[i]+tokenWidth>maxWidth+0.001)next();
    for(const glyph of token)add(glyph);
  }
  const width=Math.max(0,...widths),glyphs=[];
  for(let line=0;line<lines.length;line++) {
    const offset=layout?.align==='center'?(maxWidth-widths[line])/2:layout?.align==='right'?maxWidth-widths[line]:0;
    for(const glyph of lines[line])glyphs.push({...glyph,x:glyph.x+offset+padding,y:line*lineHeight+padding,line});
  }
  return {width:width+padding*2,ascent,descent,glyphs,height:raw.length?(lines.length-1)*lineHeight+ascent+descent+padding*2:0,lineHeight,lineCount:lines.length,
    lines:lines.map((line,i)=>({text:line.map(glyph=>glyph.character).join(''),width:widths[i]}))};
}
