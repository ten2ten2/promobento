// Inspired by huashu-motion cli/lib/learn.js, Copyright (c) 2026 Huashu, MIT.
// Local project-scoped records, not a shared home-directory archive or a production authorization service.
import {createSchemaValidator,digest,parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {withStore,checkedId} from './store.mjs';
import {assertProject} from './schema.mjs';
import {privateFile} from './edit-evidence.mjs';
import {methodTopics} from './method-library.mjs';
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'};
const text={type:'string',minLength:1,maxLength:2000};
const entrySchema={type:'object',additionalProperties:false,required:['id','kind','topics','text','evidence'],properties:{id,
  kind:{enum:['preference','observed','verified','superseded']},text,
  topics:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:{type:'string',pattern:'^[a-z0-9][a-z0-9-]{0,39}$'}},
  evidence:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['kind','ref'],properties:{kind:{enum:['user_quote','observation','measurement']},ref:text}}},
  replacement:text}};
const validate=createSchemaValidator({$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://promobento.com/local-agent/experience/1'});
const scope=project=>({projectId:project.id,actorUserId:project.actorUserId,workspaceId:project.workspaceId});
const path=project=>'projects/'+checkedId(project.id)+'.experience.json';
function read(store,project) {
  const expected=scope(project),state=store.exists(path(project))?parseCanonicalJson(privateFile(store.root,path(project),2*1024*1024).bytes):{version:'project-experience-v1',scope:expected,enabled:false,generation:0,entries:[]};
  if(state.version!=='project-experience-v1'||digest(state.scope)!==digest(expected)||typeof state.enabled!=='boolean'||!Number.isSafeInteger(state.generation)||state.generation<0||!Array.isArray(state.entries)||state.entries.length>64)
    throw Error('LOCAL_AGENT_EXPERIENCE_SCOPE');
  for(const entry of state.entries)assertEntry(entry);
  if(new Set(state.entries.map(entry=>entry.id)).size!==state.entries.length)throw Error('LOCAL_AGENT_EXPERIENCE_INVALID');
  return state;
}
function assertEntry(entry) {
  if(validate(entry,entrySchema).length||!entry.text.trim()||entry.evidence.some(item=>!item.ref.trim()))throw Error('LOCAL_AGENT_EXPERIENCE_INVALID');
  if(entry.kind==='preference'&&!entry.evidence.some(item=>item.kind==='user_quote'))throw Error('LOCAL_AGENT_EXPERIENCE_EVIDENCE');
  if(entry.kind==='verified'&&!entry.evidence.some(item=>item.kind==='measurement')&&new Set(entry.evidence.map(item=>item.ref)).size<2)throw Error('LOCAL_AGENT_EXPERIENCE_EVIDENCE');
  if(entry.kind==='superseded'&&!entry.replacement?.trim())throw Error('LOCAL_AGENT_EXPERIENCE_EVIDENCE');
}
export function recallProjectExperience(store,project,topics=[]) {
  const state=read(store,project),terms=methodTopics(...topics);
  const entries=state.enabled?state.entries.filter(entry=>entry.kind!=='superseded'&&(entry.kind==='preference'||entry.topics.some(topic=>terms.includes(topic)))):[];
  // Keep the whole bounded recall: do not silently discard a user's explicit preference.
  return {version:state.version,scope:state.scope,enabled:state.enabled,generation:state.generation,entries,contentHash:digest(entries)};
}
export async function manageExperience({directory,projectId,actorUserId,workspaceId,action='list',entry,entryId,expectedGeneration}) {
  checkedId(projectId);checkedId(actorUserId);checkedId(workspaceId);
  return withStore(directory,store=>{
    const project=assertProject(parseCanonicalJson(privateFile(store.root,'projects/'+projectId+'.json',2*1024*1024).bytes).input);
    if(project.actorUserId!==actorUserId||project.workspaceId!==workspaceId)throw Error('LOCAL_AGENT_EXPERIENCE_SCOPE');
    const state=read(store,project);
    if(action==='list')return state;
    if(!Number.isSafeInteger(expectedGeneration)||expectedGeneration!==state.generation)throw Error('LOCAL_AGENT_EXPERIENCE_CONFLICT');
    if(action==='enable'||action==='disable')state.enabled=action==='enable';
    else if(action==='put') {
      assertEntry(entry);const index=state.entries.findIndex(item=>item.id===entry.id);
      if(index<0) {if(state.entries.length>=64)throw Error('LOCAL_AGENT_EXPERIENCE_LIMIT');state.entries.push(entry);}
      else state.entries[index]=entry;
    } else if(action==='delete') {
      checkedId(entryId);const index=state.entries.findIndex(item=>item.id===entryId);
      if(index<0)throw Error('LOCAL_AGENT_EXPERIENCE_MISSING');state.entries.splice(index,1);
    } else throw Error('LOCAL_AGENT_EXPERIENCE_ACTION');
    state.generation++;store.write(path(project),state);return state;
  });
}
