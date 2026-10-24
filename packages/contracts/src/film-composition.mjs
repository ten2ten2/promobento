import {canonical,parseCanonicalJson} from './canonical.mjs';
import {digest} from './digest.mjs';
import {filmSourceIdentity} from './film-source.mjs';
import {filmSpecErrors,filmTextBindings,blockReferences} from './film.mjs';
import {targets,variantIdentity,resourceContentIdentity,factContentIdentity,audioIdentity} from './identity.mjs';
import {validate} from '../generated/production.mjs';
import {validate as blockValid} from '../generated/block-params.mjs';
const sourceError=error=>/^[A-Z][A-Z0-9_]+$/.test(error?.message??'')?error.message:'FILM_SOURCE_INVALID';

/** Read actual canonical source bytes; this never evaluates an author's code. */
export function filmBuildReceipt(raw) {
  if(typeof raw==='string'?(raw.length>8*1048576||new TextEncoder().encode(raw).length>8*1048576):raw?.byteLength>8*1048576)throw Error('FILM_SOURCE_TOO_LARGE');
  let identity,film;
  try{identity=filmSourceIdentity(raw);film=parseCanonicalJson(raw);}catch(error){throw Error(sourceError(error));}
  const text=canonical(film);
  const actual=typeof raw==='string'?raw:new TextDecoder('utf-8',{fatal:true}).decode(raw);
  if(actual!==text)throw Error('FILM_SOURCE_NOT_CANONICAL');
  return {capabilityProfile:'film-v1',entrypoint:'film.json',sourceArchiveHash:digest(identity),files:identity.files,filmSource:text};
}

/** Structural/content checks only. License, fact confirmation, QA and membership remain separate gates. */
export function filmCompositionErrors(composition,context={}) {
  const errors=[],fail=(ok,code)=>{if(!ok)errors.push(code);};
  if(!validate(composition)||composition.kind!=='composition'||composition.identityVersion!==2||composition.capabilityProfile!=='film-v1')return ['FILM_COMPOSITION_INVALID'];
  const {presetConfig:rules,filmSource,resourceManifest,factManifest}=context;
  let build,film;
  try{build=filmBuildReceipt(filmSource);film=parseCanonicalJson(build.filmSource);}catch(error){return [sourceError(error)];}
  if(!rules||rules.rulesVersion!==composition.presetRulesVersion)return ['PRESET_VERSION_UNAVAILABLE'];
  fail(composition.sourceArchiveHash===build.sourceArchiveHash,'SOURCE_ARCHIVE_HASH_MISMATCH');
  fail(composition.durationSeconds===film.durationSeconds&&composition.totalFrames===film.totalFrames&&composition.fps===film.fps,'DURATION_FRAME_MISMATCH');
  fail(composition.layoutRulesHash===digest(rules.aspectLayouts),'LAYOUT_RULES_HASH_MISMATCH');
  errors.push(...filmSpecErrors(film).errors.map(error=>error.code));
  const allowed=new Map(targets(rules).map(target=>[target.targetId,target]));
  fail(new Set(composition.variants.map(v=>v.targetId)).size===composition.variants.length,'DUPLICATE_TARGET');
  for(const variant of composition.variants){
    const target=allowed.get(variant.targetId);
    fail(target&&target.presetId===variant.presetId&&target.aspectId===variant.aspectId&&target.version===variant.presetVersion,'INVALID_TARGET_PAIR');
    fail(variant.entrypoint==='film.json'&&variant.targetOverrideHash===null&&variant.sourceHash===build.sourceArchiveHash,'FILM_SOURCE_BINDING_MISMATCH');
    fail(variant.coverFrame<film.totalFrames,'COVER_OUT_OF_RANGE');
    if(target)fail(variant.variantHash===digest(variantIdentity(composition,variant,rules)),'VARIANT_HASH_MISMATCH');
    fail(variant.resourceManifestHash===composition.resourceManifestHash&&variant.resourceContentHash===composition.resourceContentHash,'FILM_SHARED_RESOURCES_MISMATCH');
  }
  const aspects=new Map();
  for(const variant of composition.variants){
    const key=canonical([variant.sourceHash,variant.resourceManifestHash,variant.resourceContentHash,variant.audioHash,variant.variantHash]);
    fail(!aspects.has(variant.aspectId)||aspects.get(variant.aspectId)===key,'FILM_ASPECT_DIVERGENCE');aspects.set(variant.aspectId,key);
  }
  for(const scene of film.scenes){
    fail(blockValid({block:scene.block,params:scene.params}),'BLOCK_PARAMS_INVALID');
    for(const key of blockReferences(scene.params).assets)fail(Object.hasOwn(film.assets,key),'ASSET_SLOT_UNKNOWN');
  }
  let bindings=[];try{bindings=filmTextBindings(film);}catch(error){errors.push(error.message);}
  if(!resourceManifest||!validate(resourceManifest)||resourceManifest.kind!=='resource_manifest')errors.push('RESOURCE_MANIFEST_REQUIRED');
  else{
    fail(new Set(resourceManifest.resources.map(resource=>resource.path)).size===resourceManifest.resources.length,'DUPLICATE_RESOURCE_PATH');
    fail(digest(resourceManifest)===composition.resourceManifestHash,'RESOURCE_MANIFEST_HASH_MISMATCH');
    fail(digest(resourceContentIdentity(resourceManifest))===composition.resourceContentHash,'RESOURCE_CONTENT_HASH_MISMATCH');
    for(const variant of composition.variants)fail(variant.audioHash===digest(audioIdentity(resourceManifest)),'AUDIO_MANIFEST_HASH_MISMATCH');
    for(const asset of Object.values(film.assets))fail(resourceManifest.resources.some(resource=>resource.path==='r/'+asset.resourceId
      &&(resource.mediaType.startsWith('image/')||resource.mediaType.startsWith('video/'))),'FILM_ASSET_RESOURCE_MISSING');
    if(film.audio.mute)fail(resourceManifest.audioEvents.length===0&&resourceManifest.mixedAudio===null,'MUTED_AUDIO_NOT_EMPTY');
  }
  if(!factManifest||!validate(factManifest)||factManifest.kind!=='fact_manifest')errors.push('FACT_MANIFEST_REQUIRED');
  else{
    fail(factManifest.projectId===composition.projectId,'PROJECT_MISMATCH');
    fail(digest(factContentIdentity(factManifest))===composition.factContentHash,'FACT_CONTENT_HASH_MISMATCH');
    const facts=new Map(factManifest.facts.map(fact=>[fact.factId,fact]));
    for(const slot of Object.values(film.texts))for(const id of slot.factIds)fail(facts.has(id),'UNKNOWN_FACT');
    for(const variant of composition.variants)for(const binding of bindings.filter(b=>b.factIds.length)){
      fail(binding.factIds.some(id=>facts.get(id)?.text===binding.text),'UNCONFIRMED_DISPLAY_TEXT');
      fail(factManifest.bindings.some(b=>b.targetId===variant.targetId&&b.expectedText===binding.text
        &&binding.factIds.every(id=>b.factIds.includes(id))&&b.frameStart<=binding.frameStart&&b.frameEndExclusive>=binding.frameEndExclusive),'FILM_FACT_BINDING_MISSING');
    }
    for(const binding of factManifest.bindings.filter(b=>composition.variants.some(v=>v.targetId===b.targetId)))
      fail(bindings.some(b=>b.text===binding.expectedText&&binding.factIds.every(id=>b.factIds.includes(id))
        &&binding.frameStart>=b.frameStart&&binding.frameEndExclusive<=b.frameEndExclusive),'FILM_FACT_BINDING_NOT_DRAWN');
  }
  return [...new Set(errors)];
}

/** New film-v1 writes use identityVersion 2; legacy v1 helpers retain their original byte identities. */
export function createFilmComposition({filmSource,resourceManifest,factManifest,dependencyManifest,presetConfig,...input}) {
  const build=filmBuildReceipt(filmSource),film=parseCanonicalJson(build.filmSource);
  const {targetIds=targets(presetConfig).map(target=>target.targetId),coverFrame=Math.floor(film.totalFrames*.55),...metadata}=input;
  if(!dependencyManifest||typeof dependencyManifest!=='object'||!Object.keys(dependencyManifest).length)throw Error('DEPENDENCY_MANIFEST_REQUIRED');
  if(!Array.isArray(targetIds)||new Set(targetIds).size!==targetIds.length||!targetIds.length)throw Error('INVALID_TARGET_PAIR');
  const selected=targets(presetConfig).filter(target=>targetIds.includes(target.targetId));
  if(selected.length!==targetIds.length)throw Error('INVALID_TARGET_PAIR');
  const composition={...metadata,schemaVersion:'3.0.0',kind:'composition',identityVersion:2,capabilityProfile:'film-v1',
    durationSeconds:film.durationSeconds,fps:30,totalFrames:film.totalFrames,sourceArchiveHash:build.sourceArchiveHash,
    dependencyManifestHash:digest(dependencyManifest),resourceManifestHash:digest(resourceManifest),resourceContentHash:digest(resourceContentIdentity(resourceManifest)),
    factContentHash:digest(factContentIdentity(factManifest)),layoutRulesHash:digest(presetConfig.aspectLayouts),presetRulesVersion:presetConfig.rulesVersion,variants:[]};
  composition.variants=selected.map(target=>{
    const variant={targetId:target.targetId,presetId:target.presetId,aspectId:target.aspectId,presetVersion:target.version,entrypoint:'film.json',
      sourceHash:build.sourceArchiveHash,targetOverrideHash:null,resourceManifestHash:composition.resourceManifestHash,
      resourceContentHash:composition.resourceContentHash,audioHash:digest(audioIdentity(resourceManifest)),coverFrame};
    return {...variant,variantHash:digest(variantIdentity(composition,variant,presetConfig))};
  });
  const errors=filmCompositionErrors(composition,{filmSource,resourceManifest,factManifest,presetConfig});
  if(errors.length)throw Error(errors.join(','));return composition;
}

/** Receipts and archive inventory are supplied by trusted storage/build observations. */
export function filmBuildErrors(composition,builds,archiveFiles){
  const errors=[];
  for(const variant of composition.variants){
    const build=builds&&Object.hasOwn(builds,variant.targetId)?builds[variant.targetId]:null;
    if(!build){errors.push('SOURCE_BUILD_REQUIRED');continue;}
    try{
      const actual=filmBuildReceipt(build.filmSource);
      if(build.capabilityProfile!=='film-v1'||build.entrypoint!=='film.json'||build.sourceArchiveHash!==composition.sourceArchiveHash)errors.push('SOURCE_BUILD_SCOPE_MISMATCH');
      if(actual.sourceArchiveHash!==variant.sourceHash||actual.sourceArchiveHash!==composition.sourceArchiveHash)errors.push('SOURCE_HASH_MISMATCH');
      if(canonical(build.files)!==canonical(actual.files))errors.push('SOURCE_BUILD_FILE_MISMATCH');
      if(!archiveFiles)errors.push('SOURCE_ARCHIVE_REQUIRED');
      else if(canonical(archiveFiles)!==canonical(actual.files))errors.push('SOURCE_ARCHIVE_HASH_MISMATCH');
    }catch(error){errors.push(sourceError(error));}
  }
  return [...new Set(errors)];
}
