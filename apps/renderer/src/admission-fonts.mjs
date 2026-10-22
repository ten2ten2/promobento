import {reviewedAdmissionFonts,defaultAdmissionFontIds,allAdmittedFontDeclarations} from './admission-font-catalog.mjs';
import {woffCommandMetrics} from './woff-metrics.mjs';
import {measureCommandText} from '../../../packages/composition-runtime/src/command-text.mjs';
export {woffCommandMetrics,allAdmittedFontDeclarations};

const cached=new Map();
/** Existing callers keep the two fixture families; new sources select exact IDs. */
function selectedMetrics(fontIds) {
  for(const id of fontIds)if(!cached.has(id)) {
    const reviewed=reviewedAdmissionFonts([id]);
    cached.set(id,reviewed.registry.fonts.map(font=>{
      const metrics=woffCommandMetrics(reviewed.routes.get('/media-fixture/'+font.sha256+'.woff').bytes);
      // Preserve the original two fixture IDs' Latin-only authoring contract.
      if(defaultAdmissionFontIds.includes(id))metrics.glyphs=Object.fromEntries(Object.entries(metrics.glyphs).filter(([cp])=>Number(cp)<=255));
      return {...font,...metrics};
    }));
  }
  return fontIds.flatMap(id=>cached.get(id));
}
export const prepareAdmissionFontMetrics=fontIds=>{selectedMetrics(fontIds);};
export const admittedFontMetrics=(fontIds=defaultAdmissionFontIds)=>structuredClone(selectedMetrics(fontIds));
export function admittedFontDeclarations(fontIds=defaultAdmissionFontIds) {
  const available=allAdmittedFontDeclarations();
  return fontIds.map(id=>{const font=available.find(font=>font.fontId===id);if(!font)throw Error('ADMISSION_FONT_UNAUTHORIZED');return font;});
}
export const admissionTextMeasurement=(declarations,fontId,text,fontSize,weight,layout)=>
  measureCommandText(selectedMetrics(declarations.fonts.map(font=>font.fontId)),declarations.fonts,fontId,text,fontSize,weight,layout);
