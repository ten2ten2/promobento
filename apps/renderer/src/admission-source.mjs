import {readFileSync,readSync,lstatSync,readdirSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {isUtf8} from 'node:buffer';
import {join,resolve} from 'node:path';
import {parseCanonicalJson,parseSourceValues,sourceFileDigests,sourceArchiveIdentity,targetSourceIdentity,
  digest,createSchemaValidator,editableValuesErrors,targets,qaInputIdentity,resourceContentIdentity,audioIdentity,factContentIdentity} from '@promobento/contracts';
import {admissionPolicy,repository} from './admission-image.mjs';
import {validateAdmissionResources} from './admission-media.mjs';

const manifestSchema=parseCanonicalJson(readFileSync(new URL('../../../contracts/admission-source.schema.json',import.meta.url)));
const productionSchema=parseCanonicalJson(readFileSync(new URL('../../../contracts/production.schema.json',import.meta.url)));
const validateManifest=createSchemaValidator(manifestSchema),validate=createSchemaValidator(productionSchema);
export const admissionPresets=parseCanonicalJson(readFileSync(join(repository,'config/platform-presets.json')));
const required=['candidate.json','composition.mjs','declarations.json','values.json'];

function boundedFile(path,limit) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const info=fstatSync(fd);
    if(!info.isFile()||info.size>limit)throw Error('ADMISSION_INPUT_SIZE_OR_TYPE');
    const buffer=Buffer.alloc(limit+1);let offset=0,length;
    while(offset<buffer.length&&(length=readSync(fd,buffer,offset,buffer.length-offset,null))>0)offset+=length;
    const bytes=buffer.subarray(0,offset);
    if(bytes.length>limit||!isUtf8(bytes))throw Error('ADMISSION_INPUT_SIZE_OR_ENCODING');
    return bytes;
  } finally {closeSync(fd);}
}

/** Static data and raw UTF-8 only: never import, bundle, install or execute the source here. */
export function readAdmissionSource(directory) {
  directory=resolve(directory);
  const stat=lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('ADMISSION_SOURCE_DIRECTORY');
  const names=readdirSync(directory);
  if(required.some(path=>!names.includes(path))||names.some(path=>![...required,'LICENSE.txt','resources.json'].includes(path)))
    throw Error('ADMISSION_SOURCE_INVENTORY');
  const files=names.map(path=>({path,bytes:boundedFile(join(directory,path),path==='composition.mjs'?admissionPolicy.sourceMaxBytes:
    path==='values.json'?1048576:['declarations.json','resources.json'].includes(path)?admissionPolicy.declarationsMaxBytes:4096)}));
  const bytes=path=>files.find(file=>file.path===path).bytes;
  const manifest=parseCanonicalJson(bytes('candidate.json'));
  if(validateManifest(manifest).length)throw Error('ADMISSION_MANIFEST_INVALID');
  const declarations=parseCanonicalJson(bytes('declarations.json'));
  if(validate(declarations,productionSchema.$defs.runtimeDeclarations).length)throw Error('ADMISSION_DECLARATIONS_INVALID');
  for(const key of ['editables','markers','regions'])
    if(new Set(declarations[key].map(item=>item.id)).size!==declarations[key].length)throw Error('ADMISSION_DECLARATIONS_INVALID');
  const media=manifest.capabilityProfile==='canvas-media-v1';
  if(media!==names.includes('resources.json'))throw Error('ADMISSION_SOURCE_INVENTORY');
  const resourceRequest=media?parseCanonicalJson(bytes('resources.json')):null;
  const admitted=media?validateAdmissionResources(resourceRequest,{declarations,totalFrames:manifest.durationSeconds*30}):[];
  if((!media&&(declarations.fonts.length||declarations.videoUses.length||declarations.editables.some(item=>item.type==='asset')))
    ||declarations.editables.some(item=>item.factId))
    throw Error('ADMISSION_CAPABILITY_UNAVAILABLE');
  const values=parseSourceValues(bytes('values.json')).values;
  if(editableValuesErrors(values,{editables:Object.fromEntries(declarations.editables.map(item=>[item.id,item])),
    sourceValues:values,resources:Object.fromEntries(admitted.map(item=>[item.id,{mediaType:item.mediaType}])),
    drawableResourcePaths:admitted.filter(item=>item.mediaType==='image/png').map(item=>item.id)}).length)throw Error('ADMISSION_VALUES_INVALID');
  if(declarations.markers.some(item=>item.frame>=manifest.durationSeconds*30||(!media&&item.audioEventId))
    ||new Set(declarations.regions.map(item=>item.id)).size!==declarations.regions.length)
    throw Error('ADMISSION_DECLARATIONS_INVALID');
  const target=targets(admissionPresets).find(target=>target.targetId===manifest.targetId);
  if(!target)throw Error('ADMISSION_TARGET_INVALID');
  const input={targetId:manifest.targetId,width:target.layout.width,height:target.layout.height,
    durationSeconds:manifest.durationSeconds,fps:30,totalFrames:manifest.durationSeconds*30,seed:manifest.seed,values};
  const fileDigests=sourceFileDigests(files);
  const targetFiles=fileDigests.filter(file=>['composition.mjs','declarations.json','values.json','resources.json'].includes(file.path));
  return {manifest,input,declarations,resourceRequest,encoding:target.encoding,source:bytes('composition.mjs').toString('utf8'),
    files:fileDigests,targetFiles,sourceArchiveHash:digest(sourceArchiveIdentity(fileDigests)),
    sourceHash:digest(targetSourceIdentity({entrypoint:'composition.mjs',files:targetFiles}))};
}

/** Technical Q0 input identity only; no production quality association or content-safety grant. */
export function admissionQaIdentity(candidate,image,verification,resourceManifest={resources:[],audioEvents:[],mixedAudio:null}) {
  const resourceContentHash=digest(resourceContentIdentity(resourceManifest));
  const target=targets(admissionPresets).find(target=>target.targetId===candidate.input.targetId);
  const c={...candidate.input,runtimeVersion:candidate.manifest.capabilityProfile,
    layoutRulesHash:digest(target.layout),dependencyManifestHash:digest({imageId:image.imageId,sourceTreeHash:image.sourceTreeHash}),
    factContentHash:digest(factContentIdentity({facts:[],bindings:[]})),rendererImageDigest:image.imageId,
    presetRulesVersion:admissionPresets.rulesVersion,renderProfile:'standard'};
  const v={targetId:c.targetId,sourceHash:candidate.sourceHash,targetOverrideHash:digest({}),resourceContentHash,
    audioHash:digest(audioIdentity(resourceManifest)),resourceManifestHash:digest(resourceManifest),coverFrame:Math.floor(c.totalFrames/2)};
  const qaProfileVersion=verification.version+':'+digest({policy:admissionPolicy,verification});
  const identity=qaInputIdentity(c,v,qaProfileVersion,admissionPresets);
  return {qaProfileVersion,qaInputHash:digest(identity),identity};
}
