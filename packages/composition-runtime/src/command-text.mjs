/** Deterministic, unshaped Latin text. Each selected glyph is painted individually;
 * no browser kerning, ligatures, implicit fallback or measurement is involved.
 */
export function measureCommandText(faces,declarations,fontId,text,fontSize,weight) {
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
  let width=0,ascent=0,descent=0;const glyphs=[];
  for(const character of text) {
    const point=character.codePointAt(0),face=selected.find(face=>Object.hasOwn(face.glyphs,point));
    if(!face)throw Error('FONT_GLYPH_MISSING: U+'+point.toString(16).toUpperCase());
    const scale=fontSize/face.unitsPerEm,advance=face.glyphs[point]*scale;
    glyphs.push({character,fontId:face.fontId,weight:face.weight,sha256:face.sha256,x:width,advance});
    width+=advance;ascent=Math.max(ascent,face.ascent*scale);descent=Math.max(descent,face.descent*scale);
  }
  return {width,ascent,descent,glyphs};
}
