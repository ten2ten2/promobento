import {parse} from 'acorn';

export const CUSTOM_SOURCE_MAX_BYTES = 65536;
const id = /^[a-z][a-z0-9-]{0,47}$/;
/** Declarative timing/slot contracts, independent of executing the scene factory. */
export function customScenePlan(scene) {
  const p=scene.params, duration=scene.end-scene.start;
  if(!p||!Array.isArray(p.textSlots)||!Array.isArray(p.assetKeys)||!Array.isArray(p.events)||!Array.isArray(p.readingHolds)||!p.readingHolds.length)
    throw Error('CUSTOM_PLAN_REQUIRED');
  for(const keys of [p.textSlots,p.assetKeys])if(keys.length>100||new Set(keys).size!==keys.length||keys.some(key=>typeof key!=='string'||!id.test(key)))throw Error('CUSTOM_PLAN_INVALID');
  if(p.events.length>100||p.events.some(e=>!e||typeof e.name!=='string'||!id.test(e.name)||!Number.isInteger(e.frame)||e.frame<0||e.frame>=duration)||new Set(p.events.map(e=>e.name)).size!==p.events.length)throw Error('CUSTOM_EVENT_INVALID');
  if(p.readingHolds.length>60||p.readingHolds.some(h=>!h||!Number.isInteger(h.start)||!Number.isInteger(h.end)||h.start<0||h.end<=h.start||h.end>duration))throw Error('CUSTOM_READING_HOLD_INVALID');
  if(new Set([0,duration-1,...p.events.map(e=>e.frame),...p.readingHolds.map(h=>Math.floor((h.start+h.end-1)/2))]).size>24)throw Error('CUSTOM_FRAME_PLAN_BUDGET');
  return p;
}

const forbiddenNames=new Set(['eval','Function','AsyncFunction','GeneratorFunction','WebAssembly','Worker','SharedWorker','fetch','XMLHttpRequest','WebSocket','EventSource',
  'RTCPeerConnection','AudioContext','webkitAudioContext','Audio','localStorage','sessionStorage','indexedDB','caches','setTimeout','setInterval','requestAnimationFrame',
  'globalThis','window','self','parent','top','opener','location','navigator','process','require','Date']);
const forbiddenMembers=new Set(['constructor','prototype','__proto__','ownerDocument','defaultView','contentWindow','contentDocument','innerHTML','outerHTML','textContent','innerText',
  'insertAdjacentHTML','insertAdjacentText','createTextNode','write','writeln','fillText','strokeText','defineBlock','ticker','cssText','getRandomValues','randomUUID']);
const memberName=node=>node.computed?node.property.type==='Literal'?node.property.value:null:node.property.name;
const isFunction=node=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type);
function bindPattern(node,names){
  if(!node)return;
  if(node.type==='Identifier')names.add(node.name);
  else if(node.type==='RestElement')bindPattern(node.argument,names);
  else if(node.type==='AssignmentPattern')bindPattern(node.left,names);
  else if(node.type==='ArrayPattern')node.elements.forEach(item=>bindPattern(item,names));
  else if(node.type==='ObjectPattern')node.properties.forEach(item=>bindPattern(item.type==='RestElement'?item.argument:item.value,names));
}
function scopeBindings(node){
  const names=new Set();
  if(isFunction(node)){
    bindPattern(node.id,names);node.params.forEach(param=>bindPattern(param,names));
    const hoisted=value=>{
      if(!value||typeof value!=='object'||isFunction(value))return;
      if(value.type==='VariableDeclaration'&&value.kind==='var')value.declarations.forEach(item=>bindPattern(item.id,names));
      for(const [key,child]of Object.entries(value))if(!['loc','start','end'].includes(key)){
        if(Array.isArray(child))child.forEach(hoisted);else hoisted(child);
      }
    };hoisted(node.body);
  }else if(node.type==='BlockStatement'){
    for(const statement of node.body){
      if(statement.type==='VariableDeclaration')statement.declarations.forEach(item=>bindPattern(item.id,names));
      else if(['FunctionDeclaration','ClassDeclaration'].includes(statement.type))bindPattern(statement.id,names);
    }
  }else if(node.type==='CatchClause')bindPattern(node.param,names);
  else if(['ForStatement','ForInStatement','ForOfStatement'].includes(node.type)){
    const declaration=node.init??node.left;if(declaration?.type==='VariableDeclaration')declaration.declarations.forEach(item=>bindPattern(item.id,names));
  }
  return names;
}
/** Q0 only: parses bounded source data. The Chromium sandbox, CSP and host deadlines enforce isolation. */
export function customSourceErrors(scene,source,spec) {
  const errors=[],fail=(code,node)=>{if(errors.length<24)errors.push({code,line:node?.loc?.start.line??1});};
  if(typeof source!=='string'||!source.length||new TextEncoder().encode(source).length>CUSTOM_SOURCE_MAX_BYTES)return[{code:'CUSTOM_SOURCE_SIZE',line:1}];
  let tree;try{tree=parse(source,{ecmaVersion:2024,sourceType:'module',locations:true});}catch{return[{code:'CUSTOM_SOURCE_SYNTAX',line:1}];}
  const call=tree.body.length===1&&tree.body[0].type==='ExpressionStatement'?tree.body[0].expression:null;
  const factory=call?.arguments?.[1],ctx=factory?.params?.[0]?.name;
  if(call?.type!=='CallExpression'||call.callee.type!=='MemberExpression'||call.callee.object.name!=='PB'||memberName(call.callee)!=='scene'
    ||call.arguments.length!==2||call.arguments[0].value!==scene.id||!['ArrowFunctionExpression','FunctionExpression'].includes(factory?.type)
    ||factory.async||factory.generator||factory.params.length!==1||factory.params[0].type!=='Identifier')return[{code:'CUSTOM_REGISTRATION_INVALID',line:1}];
  let plan;try{plan=customScenePlan(scene);}catch(error){return[{code:error.message,line:1}];}
  const used={text:new Set(),asset:new Set()},scopes=[];
  function walk(node,parent){
    if(!node||typeof node!=='object')return;
    const scoped=isFunction(node)||['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement'].includes(node.type);
    if(scoped)scopes.push(scopeBindings(node));
    const property=parent&&(parent.type==='MemberExpression'&&parent.property===node&&!parent.computed||parent.type==='Property'&&parent.key===node&&!parent.computed&&!parent.shorthand);
    if(node.type==='Identifier'&&!property&&forbiddenNames.has(node.name)&&!scopes.some(scope=>scope.has(node.name)))fail('CUSTOM_FORBIDDEN_API',node);
    if(['ImportDeclaration','ImportExpression','ExportNamedDeclaration','ExportDefaultDeclaration','ExportAllDeclaration','WithStatement','ThisExpression','MetaProperty'].includes(node.type))fail('CUSTOM_FORBIDDEN_SYNTAX',node);
    if(node.type==='MemberExpression'){
      const key=memberName(node);
      if(forbiddenMembers.has(key)||node.object.name==='Math'&&key==='random')fail('CUSTOM_FORBIDDEN_API',node);
      if(node.object.name==='document'&&!['createElement','createElementNS'].includes(key))fail('CUSTOM_DOCUMENT_SCOPE',node);
      if(node.object.name==='PB')fail('CUSTOM_REGISTRATION_SCOPE',node);
    }
    if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'){
      const key=memberName(node.callee),args=node.arguments;
      if(node.callee.object.name===ctx&&['text','asset'].includes(key)){
        const name=args[0]?.value,allowed=key==='text'?plan.textSlots:plan.assetKeys;
        if(typeof name!=='string'||!allowed.includes(name)||!Object.hasOwn(key==='text'?spec.texts:spec.assets,name))fail('CUSTOM_SLOT_UNDECLARED',node);
        else used[key].add(name);
      }
      if(key==='createElement'&&(!['div','span','img','canvas','section'].includes(args[0]?.value)))fail('CUSTOM_ELEMENT_FORBIDDEN',node);
      if(key==='createElementNS'&&(args[0]?.value!=='http://www.w3.org/2000/svg'||!['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','clipPath','mask','linearGradient','stop'].includes(args[1]?.value)))fail('CUSTOM_ELEMENT_FORBIDDEN',node);
      if(key==='getContext'&&args[0]?.value!=='2d')fail('CUSTOM_CONTEXT_UNSUPPORTED',node);
      if(['setAttribute','setProperty'].includes(key)&&(['content','srcdoc'].includes(args[0]?.value)||/^on/i.test(args[0]?.value??'')))fail('CUSTOM_FORBIDDEN_API',node);
    }
    for(const [key,value]of Object.entries(node))if(!['loc','start','end'].includes(key)){
      if(Array.isArray(value))value.forEach(child=>walk(child,node));else if(value&&typeof value==='object')walk(value,node);
    }
    if(scoped)scopes.pop();
  }
  walk(factory);
  if(plan.textSlots.some(key=>!used.text.has(key))||plan.assetKeys.some(key=>!used.asset.has(key)))fail('CUSTOM_DECLARATION_UNUSED',factory);
  return errors;
}

/** An editor changes only its own module, with exact/unique replacement semantics. */
export function applyCustomEdit(previous,input,path){
  if(input.path!==path)throw Error('CUSTOM_EDIT_SCOPE');
  if(input.command==='create'){
    if(previous!==undefined)throw Error('CUSTOM_EDIT_EXISTS');return input.fileText;
  }
  if(previous===undefined)throw Error('CUSTOM_SOURCE_MISSING');
  if(input.command==='str_replace'){
    const at=previous.indexOf(input.oldStr);
    if(at<0||previous.indexOf(input.oldStr,at+1)>=0)throw Error('CUSTOM_EDIT_AMBIGUOUS');
    return previous.slice(0,at)+input.newStr+previous.slice(at+input.oldStr.length);
  }
  if(input.command==='insert'){
    const lines=previous.split('\n');if(input.insertLine>lines.length)throw Error('CUSTOM_EDIT_LINE');
    lines.splice(input.insertLine,0,input.newStr);return lines.join('\n');
  }
  throw Error('CUSTOM_EDIT_COMMAND');
}
export function assertCustomSources(spec,sources={}) {
  const scenes=spec.scenes.filter(scene=>scene.kind==='custom'),paths=scenes.map(scene=>scene.module);
  if(Object.keys(sources).some(path=>!paths.includes(path)))throw Error('CUSTOM_SOURCE_UNDECLARED');
  if(Object.values(sources).reduce((sum,text)=>sum+new TextEncoder().encode(text).length,0)>512*1024)throw Error('CUSTOM_SOURCE_BUDGET');
  for(const scene of scenes){
    if(scene.module!==`scenes/${scene.id}/index.js`)throw Error('SCENE_MODULE_ID_MISMATCH');
    if(!Object.hasOwn(sources,scene.module))throw Error('CUSTOM_SOURCE_MISSING');
    const errors=customSourceErrors(scene,sources[scene.module],spec);
    if(errors.length)throw Error(errors[0].code+':'+scene.id+':'+errors[0].line);
  }
}
