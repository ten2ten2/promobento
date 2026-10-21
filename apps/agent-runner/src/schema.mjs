import {readFileSync} from 'node:fs';
import {createSchemaValidator,parseCanonicalJson,targets} from '../../../packages/contracts/index.mjs';

export const production=parseCanonicalJson(readFileSync(new URL('../../../contracts/production.schema.json',import.meta.url)));
export const validateProduction=createSchemaValidator(production);
export const presets=parseCanonicalJson(readFileSync(new URL('../../../config/platform-presets.json',import.meta.url)));
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'};
const text={type:'string',minLength:1,maxLength:16000};
const integer={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const positive={...integer,minimum:1};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const confirmation={evidenceRef:text,confirmedBy:id,confirmedAt:{type:'string',format:'date-time'}};
export const localSchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://promobento.com/local-agent/1',
  $defs:{
    project:object({id,caseId:id,audience:{enum:['software','course']},task:text,durationSeconds:{enum:[15,30]},
      targetIds:{type:'array',minItems:1,maxItems:7,uniqueItems:true,items:{enum:targets(presets).map(item=>item.targetId)}},
      seed:id,facts:{type:'array',minItems:1,maxItems:100,items:object({id,text,...confirmation})},
      rights:{type:'array',maxItems:32,items:object({resourceId:id,...confirmation})},audioMode:{enum:['silent','music']},
      direct:{type:'boolean'},actorUserId:id,workspaceId:id},['id','audience','task','durationSeconds','targetIds','seed','facts','rights','audioMode','direct','actorUserId','workspaceId']),
    config:object({version:{const:'local-agent-v1'},mode:{const:'local_research'},provider:{const:'openai'},model:text,
      reasoningEffort:{enum:['none','minimal','low','medium','high','xhigh']},priceVersion:text,
      prices:object({inputMicrosPerMillion:positive,cachedInputMicrosPerMillion:integer,outputMicrosPerMillion:positive,renderMicrosPerSecond:integer}),
      maxInputTokens:positive,maxOutputTokens:positive,requestTimeoutMs:{...positive,maximum:600000},
      budgets:object({operationMicros:positive,projectMicros:positive,userMicros:positive,totalMicros:positive}),
      authorization:object({approvedBy:id,approvedAt:{type:'string',format:'date-time'},expiresAt:{type:'string',format:'date-time'},purpose:{const:'m0a_research'},maxUsdMicros:positive})},
      ['version','mode','provider','model','priceVersion','prices','maxInputTokens','maxOutputTokens','requestTimeoutMs','budgets','authorization']),
    review:{...object({reviewerId:id,reviewedAt:{type:'string',format:'date-time'},subjectHash:{type:'string',pattern:'^[a-f0-9]{64}$'},
      decision:{enum:['allowed','withheld']},policyVersion:{const:'m0a-local-human-review-v1'},evidenceRef:text,
      checks:object({facts:{type:'boolean'},rights:{type:'boolean'},contentSafety:{type:'boolean'},normalSpeedAudiovisual:{type:'boolean'},silentReadability:{type:'boolean'}}),notes:text},
      ['reviewerId','reviewedAt','subjectHash','decision','policyVersion','evidenceRef','checks']),allOf:[
      {if:{properties:{decision:{const:'allowed'}},required:['decision']},then:{properties:{checks:{type:'object',properties:{facts:{const:true},rights:{const:true},contentSafety:{const:true},normalSpeedAudiovisual:{const:true},silentReadability:{const:true}}}}}},
      {if:{properties:{decision:{const:'withheld'}},required:['decision']},then:{properties:{notes:text},required:['notes']}}
    ]},
    source:object({code:{type:'string',minLength:1,maxLength:1048576},declarations:{type:'object'},values:{type:'object'},resources:{type:'object'}}),
  }
};
export const validateLocal=createSchemaValidator(localSchema);
export function assertSchema(value,kind) {
  const errors=validateLocal(value,localSchema.$defs[kind]);
  if(errors.length)throw Object.assign(Error('LOCAL_AGENT_'+kind.toUpperCase()+'_INVALID'),{details:errors});
  return value;
}
export function assertProject(project,now=Date.now()) {
  assertSchema(project,'project');
  if(new Set(project.facts.map(fact=>fact.id)).size!==project.facts.length||new Set(project.rights.map(right=>right.resourceId)).size!==project.rights.length)
    throw Error('LOCAL_AGENT_DUPLICATE_FACT_OR_RIGHT');
  if([...project.facts,...project.rights].some(item=>Date.parse(item.confirmedAt)>now))throw Error('LOCAL_AGENT_CONFIRMATION_IN_FUTURE');
  return project;
}
export function assertConfig(config,now=Date.now()) {
  assertSchema(config,'config');
  if(Date.parse(config.authorization.approvedAt)>now||Date.parse(config.authorization.expiresAt)<=now||
    config.budgets.totalMicros>config.authorization.maxUsdMicros||config.budgets.operationMicros>config.budgets.projectMicros||
    config.budgets.projectMicros>config.budgets.totalMicros||config.budgets.userMicros>config.budgets.totalMicros||
    config.prices.cachedInputMicrosPerMillion>config.prices.inputMicrosPerMillion)
    throw Error('LOCAL_AGENT_AUTHORIZATION_OR_BUDGET_INVALID');
  return config;
}
export function assertPlan(plan,totalFrames) {
  if(!plan||Object.keys(plan).some(key=>!['direction','treatment','audioPlan','source','agentInterpretation','impactSummary'].includes(key)))throw Error('LOCAL_AGENT_PLAN_INVALID');
  // candidateResult requires these exact production text fields when ready/accepted.
  for(const key of ['agentInterpretation','impactSummary'])
    if(validateProduction(plan[key],production.$defs.candidateResult.allOf[0].then.properties[key]).length)throw Error('LOCAL_AGENT_'+key.toUpperCase()+'_INVALID');
  for(const key of ['treatment','audioPlan']) {
    if(validateProduction(plan[key],production.$defs[key]).length||plan[key].totalFrames!==totalFrames)throw Error('LOCAL_AGENT_'+key.toUpperCase()+'_INVALID');
    for(const event of plan[key][key==='treatment'?'beats':'events'])
      if(event.frameStart>=event.frameEndExclusive||event.frameEndExclusive>totalFrames)throw Error('LOCAL_AGENT_PLAN_RANGE');
  }
  if(!plan.direction||typeof plan.direction.label!=='string'||typeof plan.direction.logline!=='string')throw Error('LOCAL_AGENT_DIRECTION_INVALID');
  // The renderer, never the model, supplies real keyframe identifiers.
  if(validateProduction({...plan.direction,keyframeIds:['render-poster']},production.$defs.direction).length)throw Error('LOCAL_AGENT_DIRECTION_INVALID');
  assertSchema(plan.source,'source');
  return plan;
}
