import {parse} from 'acorn';

export const CUSTOM_SOURCE_MAX_BYTES = 65536;
const id = /^[a-z][a-z0-9-]{0,47}$/;
/** Declarative timing/slot contracts, independent of executing the scene factory. */
export function customScenePlan(scene,{validateVisibleTextSlots=false,validateAssetChecks=false}={}) {
  const p=scene.params, duration=scene.end-scene.start;
  if(!p||!Array.isArray(p.textSlots)||!Array.isArray(p.assetKeys)||!Array.isArray(p.events)||!Array.isArray(p.readingHolds)||!p.readingHolds.length)
    throw Error('CUSTOM_PLAN_REQUIRED');
  for(const keys of [p.textSlots,p.assetKeys])if(keys.length>100||new Set(keys).size!==keys.length||keys.some(key=>typeof key!=='string'||!id.test(key)))throw Error('CUSTOM_PLAN_INVALID');
  if(p.events.length>100||p.events.some(e=>!e||typeof e.name!=='string'||!id.test(e.name)||!Number.isInteger(e.frame)||e.frame<0||e.frame>=duration)||new Set(p.events.map(e=>e.name)).size!==p.events.length)throw Error('CUSTOM_EVENT_INVALID');
  if(p.readingHolds.length>60||p.readingHolds.some(h=>!h||!Number.isInteger(h.start)||!Number.isInteger(h.end)||h.start<0||h.end<=h.start||h.end>duration))throw Error('CUSTOM_READING_HOLD_INVALID');
  if(validateVisibleTextSlots&&p.readingHolds.some(h=>h.visibleTextSlots!==undefined&&(!Array.isArray(h.visibleTextSlots)||h.visibleTextSlots.length>p.textSlots.length||new Set(h.visibleTextSlots).size!==h.visibleTextSlots.length||h.visibleTextSlots.some(key=>typeof key!=='string'||!p.textSlots.includes(key)))))throw Error('CUSTOM_HOLD_TEXT_INVALID');
  if(validateAssetChecks){
    const checks=p.assetChecks??[];
    if(!Array.isArray(checks)||checks.length>24||checks.some(check=>!check||!Number.isInteger(check.frame)||check.frame<0||check.frame>=duration||
      !Array.isArray(check.assetKeys)||!check.assetKeys.length||new Set(check.assetKeys).size!==check.assetKeys.length||check.assetKeys.some(key=>typeof key!=='string'||!p.assetKeys.includes(key)))||
      new Set(checks.map(check=>check.frame)).size!==checks.length)throw Error('CUSTOM_ASSET_CHECK_INVALID');
  }
  if(new Set([0,duration-1,...p.events.map(e=>e.frame),...p.readingHolds.map(h=>Math.floor((h.start+h.end-1)/2)),
    ...(validateAssetChecks?(p.assetChecks??[]).map(check=>check.frame):[])]).size>24)throw Error('CUSTOM_FRAME_PLAN_BUDGET');
  return p;
}

const forbiddenNames=new Set(['eval','Function','AsyncFunction','GeneratorFunction','WebAssembly','Worker','SharedWorker','fetch','XMLHttpRequest','WebSocket','EventSource',
  'RTCPeerConnection','AudioContext','webkitAudioContext','Audio','localStorage','sessionStorage','indexedDB','caches','setTimeout','setInterval','requestAnimationFrame',
  'globalThis','window','self','parent','top','opener','location','navigator','process','require','Date']);
const forbiddenMembers=new Set(['constructor','prototype','__proto__','ownerDocument','defaultView','contentWindow','contentDocument','innerHTML','outerHTML','textContent','innerText',
  'insertAdjacentHTML','insertAdjacentText','createTextNode','write','writeln','fillText','strokeText','defineBlock','ticker','cssText','getRandomValues','randomUUID']);
const memberName=node=>node.computed?node.property.type==='Literal'?node.property.value:null:node.property.name;
const isFunction=node=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type);
const omCall=(node,ctx,name)=>node?.type==='CallExpression'&&node.callee?.type==='MemberExpression'&&memberName(node.callee)===name
  &&node.callee.object?.type==='MemberExpression'&&memberName(node.callee.object)==='OM'&&node.callee.object.object?.name===ctx;

/** Read bounded literal sound declarations as data; never execute author source. Times are scene-local seconds. */
export function extractCustomSfx(scene,source,spec){
  if(scene.params?.sourceSfx!==true)return [];
  let tree;try{tree=parse(source,{ecmaVersion:2024,sourceType:'module',locations:true});}catch{throw Error('CUSTOM_SOURCE_SYNTAX');}
  const call=tree.body.length===1&&tree.body[0].type==='ExpressionStatement'?tree.body[0].expression:null;
  const factory=call?.arguments?.[1],ctx=factory?.params?.[0]?.name;
  if(call?.type!=='CallExpression'||call.callee?.object?.name!=='PB'||memberName(call.callee)!=='scene'
    ||call.arguments[0]?.value!==scene.id||!ctx)throw Error('CUSTOM_REGISTRATION_INVALID');
  const number=node=>{
    if(node?.type==='Literal'&&typeof node.value==='number'&&Number.isFinite(node.value))return node.value;
    if(node?.type==='UnaryExpression'&&['+','-'].includes(node.operator)){const x=number(node.argument);return node.operator==='-'?-x:x;}
    if(node?.type==='BinaryExpression'&&['+','-','*','/'].includes(node.operator)){
      const a=number(node.left),b=number(node.right),v=node.operator==='+'?a+b:node.operator==='-'?a-b:node.operator==='*'?a*b:a/b;
      if(Number.isFinite(v))return v;
    }
    if(omCall(node,ctx,'beat')&&node.arguments.length>=1&&node.arguments.length<=2){
      const bpm=node.arguments[1]?number(node.arguments[1]):spec.audio?.music?.kind==='procedural'?spec.audio.music.bpm:undefined;
      if(Number.isFinite(bpm)&&bpm>0)return number(node.arguments[0])*60/bpm;
    }
    throw Error('CUSTOM_SFX_STATIC_TIME_REQUIRED');
  };
  const result=[];
  const walk=node=>{
    if(!node||typeof node!=='object')return;
    if(omCall(node,ctx,'sfx')){
      if(node.arguments.length<2||node.arguments.length>3||typeof node.arguments[0]?.value!=='string'||!id.test(node.arguments[0].value))throw Error('CUSTOM_SFX_INVALID');
      const seconds=number(node.arguments[1]),sample=Math.round(seconds*48000),frame=Math.floor(sample/1600);
      if(!Number.isFinite(seconds)||seconds<0||sample>=(scene.end-scene.start)*1600)throw Error('CUSTOM_SFX_TIME_INVALID');
      let gain=1;
      if(node.arguments[2]){
        const options=node.arguments[2];
        if(options.type!=='ObjectExpression'||options.properties.length>1)throw Error('CUSTOM_SFX_OPTIONS_UNSUPPORTED');
        if(options.properties.length){
          const property=options.properties[0];
          if(property.type!=='Property'||property.computed||property.kind!=='init'||(property.key.name??property.key.value)!=='gain')throw Error('CUSTOM_SFX_OPTIONS_UNSUPPORTED');
          try{gain=number(property.value);}catch{throw Error('CUSTOM_SFX_GAIN_INVALID');}
        }
      }
      if(!Number.isFinite(gain)||gain<.001||gain>10**(12/20))throw Error('CUSTOM_SFX_GAIN_INVALID');
      result.push({id:node.arguments[0].value,frame,seconds,gain,gainDb:20*Math.log10(gain),...(sample%1600?{sample}:{})});
      if(result.length>100)throw Error('CUSTOM_SFX_LIMIT');
    }
    for(const [key,value]of Object.entries(node))if(!['loc','start','end'].includes(key)){
      if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
    }
  };
  walk(factory.body);
  const seen=new Set();for(const sound of result){const key=sound.id+':'+(sound.sample??sound.frame*1600);if(seen.has(key))throw Error('CUSTOM_SFX_DUPLICATE');seen.add(key);}
  return result;
}
export function filmCustomSfx(spec,sources){
  return spec.scenes.filter(scene=>scene.kind==='custom'&&scene.params?.sourceSfx===true).flatMap(scene=>{
    const source=sources?.[scene.module];if(typeof source!=='string')throw Error('CUSTOM_SOURCE_MISSING');
    return extractCustomSfx(scene,source,spec).map(item=>({...item,sceneId:scene.id}));
  });
}
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
  if(scene.params?.sourceSfx===true)try{extractCustomSfx(scene,source,spec);}catch(error){fail(error.message,factory);}
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
