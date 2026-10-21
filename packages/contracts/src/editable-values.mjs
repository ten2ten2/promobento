// Browser-safe value checks shared by the local runtime and Studio reference controller.
import {safePath,sourceValuesBytes} from './source-values.mjs';

const own=(object,key)=>object && Object.hasOwn(object,key)?object[key]:undefined;
const drawable=(path,context)=>context.production || context.drawableResourcePaths
  ? context.drawableResourcePaths?.includes(path)===true : true;

export function editableValueErrors(value,definition,context={}) {
  const errors=[],fail=(ok,code)=>{if(!ok)errors.push(code);};
  if(!definition)return ['EDITABLE_NOT_DECLARED'];
  switch(definition.type) {
    case 'text':fail(typeof value==='string' && [...value].length<=6000,'EDITABLE_TEXT_INVALID');break;
    case 'color':fail(typeof value==='string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(value),'EDITABLE_COLOR_INVALID');break;
    case 'number':fail(typeof value==='number' && Number.isFinite(value)
      && (definition.min===undefined || value>=definition.min) && (definition.max===undefined || value<=definition.max),
      'EDITABLE_NUMBER_OUT_OF_RANGE');break;
    case 'boolean':fail(typeof value==='boolean','EDITABLE_BOOLEAN_INVALID');break;
    case 'enum':fail(definition.choices?.includes(value),'EDITABLE_CHOICE_INVALID');break;
    case 'data':fail(Array.isArray(value) && value.length<=1000 && value.every(row=>row && typeof row==='object'
      && !Array.isArray(row) && Object.keys(row).length<=32 && Object.entries(row).every(([key,cell])=>
        [...key].length>0 && [...key].length<=64 && (cell===null || typeof cell==='boolean'
          || (typeof cell==='string' && [...cell].length<=6000) || (typeof cell==='number' && Number.isFinite(cell))))),
      'EDITABLE_DATA_INVALID');break;
    case 'asset': {
      const resource=own(context.resources,value);
      fail(typeof value==='string' && safePath(value) && !!resource && drawable(value,context)
        && resource.mediaType!=='application/pdf','EDITABLE_ASSET_UNAVAILABLE');break;
    }
    default:errors.push('EDITABLE_TYPE_INVALID');
  }
  return errors;
}

/** Expand every text field bound to the same fact without changing fact confirmation. */
export function boundValueUpdates(values,editables) {
  const updates=new Map(Object.entries(values)),facts=new Map();
  for(const [id,value] of updates) {
    const definition=own(editables,id);
    if(!definition?.factId)continue;
    if(facts.has(definition.factId) && facts.get(definition.factId)!==value)throw Error('EDITABLE_FACT_VALUE_CONFLICT');
    facts.set(definition.factId,value);
  }
  for(const definition of Object.values(editables??{}))
    if(facts.has(definition.factId))updates.set(definition.id,facts.get(definition.factId));
  return Object.fromEntries(updates);
}

/** The same canonical byte budget, complete value set and types apply in every execution mode. */
export function editableValuesErrors(values,context={}) {
  const errors=[],fail=(ok,code)=>{if(!ok)errors.push(code);};
  try {sourceValuesBytes(values);}catch(error){errors.push(error.message);}
  const definitions=context.editables;
  fail(!!definitions,'EDITABLE_DECLARATIONS_REQUIRED');
  if(definitions) {
    fail(Object.keys(definitions).length===Object.keys(values??{}).length,'EDITABLE_VALUES_INCOMPLETE');
    for(const [id,value] of Object.entries(values??{})) {
      const definition=own(definitions,id);
      errors.push(...editableValueErrors(value,definition,context));
      if(definition?.type==='color' && typeof value==='string')fail(value===value.toLowerCase(),'EDITABLE_COLOR_NOT_CANONICAL');
    }
    for(const id of Object.keys(definitions))fail(Object.hasOwn(values??{},id),'EDITABLE_VALUE_MISSING');
    if(context.requireFactBindings)for(const definition of Object.values(definitions))if(definition.factId) {
      const fact=own(context.facts,definition.factId);
      fail(definition.type==='text' && !!fact && values?.[definition.id]===fact.text,'EDITABLE_FACT_VALUE_MISMATCH');
    }
  }
  return errors;
}

export function checkedValueUpdates(values,context) {
  // Reject non-JSON overlays before reading entries, including accessors and isolated surrogates.
  sourceValuesBytes(values);
  const updates=boundValueUpdates(values,context.editables);
  for(const [id,value] of Object.entries(updates)) {
    const definition=own(context.editables,id),errors=editableValueErrors(value,definition,context);
    if(errors.length)throw Error(errors[0]);
    if(definition.affectsTiming===true)throw Error('EDITABLE_REQUIRES_AI');
    if(definition.type==='color')updates[id]=value.toLowerCase();
  }
  const errors=editableValuesErrors({...context.sourceValues,...updates},context);
  if(errors.length)throw Error(errors[0]);
  return updates;
}

/** No save, model call, fact confirmation or trusted QA is performed by a local overlay. */
export function localPreviewValues(valuesOverlay,context) {
  if(!context.editables || !context.sourceValues)throw Error('PREVIEW_VALUES_REQUIRED');
  const errors=editableValuesErrors(context.sourceValues,context);
  if(errors.length)throw Error(errors[0]);
  return {...structuredClone(context.sourceValues),...checkedValueUpdates(valuesOverlay,context)};
}
