import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseCanonicalJson} from '@promobento/contracts';
import {reviewedFixtureFonts} from './media-assets.mjs';
import {repository} from './admission-image.mjs';
import {sha256} from './environment.mjs';
import {woffCommandMetrics} from './woff-metrics.mjs';

const registryPath='packages/composition-runtime/vendor/huashu-motion/fonts/registry.json';
const registry=()=>parseCanonicalJson(readFileSync(join(repository,registryPath)));
export const defaultAdmissionFontIds=Object.freeze(['geist-sans-fixture','geist-mono-fixture']);
export function admittedFontCatalog() {
  const entries=registry().fonts;
  return [...new Set(entries.map(font=>font.fontId))].map(id=>{
    const faces=entries.filter(font=>font.fontId===id),first=faces[0];
    return {id,mediaType:'font/woff',path:first.path,paths:faces.map(face=>face.path),licenseRef:first.licenseRef,
      family:first.family,style:first.style,description:first.family+' '+first.style+', weights '+faces.map(face=>face.weight).join('/')};
  });
}
export function allAdmittedFontDeclarations() {
  const extra=registry();
  const original=parseCanonicalJson(readFileSync(join(repository,'tests/fixtures/render/media.declarations.json'))).fonts;
  return [...original,...admittedFontCatalog().map(({id})=>{
    const faces=extra.fonts.filter(font=>font.fontId===id);
    return {registryVersion:extra.registryVersion,fontId:id,weights:faces.map(face=>face.weight).sort((a,b)=>a-b),fallbackFontIds:[],
      assets:faces.map(({weight,path,sha256})=>({weight,path,sha256})).sort((a,b)=>a.weight-b.weight)};
  })];
}
/** License and copyright checks precede reading/decoding each registered font.
 * No URL/path supplied by a composition participates in this lookup. */
export function reviewedAdmissionFonts(fontIds=defaultAdmissionFontIds) {
  if(!Array.isArray(fontIds)||new Set(fontIds).size!==fontIds.length||fontIds.some(id=>!allAdmittedFontDeclarations().some(font=>font.fontId===id)))throw Error('ADMISSION_FONT_UNAUTHORIZED');
  const extra=registry(),fixture=fontIds.some(id=>defaultAdmissionFontIds.includes(id))?reviewedFixtureFonts():null;
  const routes=new Map(),resources=[],fonts=[],records=[],sourcePaths=[registryPath];
  if(fixture) {
    for(const face of fixture.registry.fonts.filter(font=>fontIds.includes(font.fontId))) {
      const resource=fixture.resources.find(item=>item.path===face.path);resources.push(resource);routes.set(resource.url,fixture.routes.get(resource.url));
      fonts.push(fixture.fonts.find(item=>item.path===face.path));records.push(face);
    }
    sourcePaths.push(...fixture.sourcePaths);
  }
  for(const face of extra.fonts.filter(font=>fontIds.includes(font.fontId))) {
    const license=readFileSync(join(repository,face.licensePath)),copyright=readFileSync(join(repository,face.copyrightPath));
    if(face.license!=='OFL-1.1'||sha256(license)!==face.licenseSha256||sha256(copyright)!==face.copyrightSha256
      ||!license.toString('utf8').includes('SIL OPEN FONT LICENSE Version 1.1'))throw Error('FONT_LICENSE_UNVERIFIED');
    const bytes=readFileSync(join(repository,face.sourcePath));
    if(bytes.length!==face.byteLength||sha256(bytes)!==face.sha256)throw Error('FONT_HASH_MISMATCH');
    const metrics=woffCommandMetrics(bytes);
    if(face.variableDefaultOnly&&metrics.defaultWeight!==face.weight)throw Error('FONT_VARIABLE_INSTANCE_UNSUPPORTED');
    const url='/media-fixture/'+face.sha256+'.woff';
    routes.set(url,{bytes,contentType:'font/woff',path:face.path});
    resources.push({path:face.path,url,sha256:face.sha256,byteLength:face.byteLength,mediaType:'font/woff',licenseRef:face.licenseRef});
    fonts.push({fontId:face.fontId,registryVersion:extra.registryVersion,weight:face.weight,path:face.path,sha256:face.sha256,coverage:metrics.coverage});
    records.push(face);sourcePaths.push(face.sourcePath,face.licensePath,face.copyrightPath);
  }
  return {routes,resources,fonts,sourcePaths:[...new Set(sourcePaths)],registry:{registryVersion:'admission-fonts-v2',fonts:records}};
}
