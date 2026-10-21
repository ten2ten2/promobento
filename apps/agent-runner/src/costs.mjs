import {appendFileSync,readFileSync,existsSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {production,validateProduction,assertConfig} from './schema.mjs';

export function usageCost(usage,prices) {
  const {inputTokens,outputTokens,cachedInputTokens=0}=usage;
  if(![inputTokens,outputTokens,cachedInputTokens].every(value=>Number.isSafeInteger(value)&&value>=0)||cachedInputTokens>inputTokens)throw Error('LOCAL_AGENT_USAGE_INVALID');
  const numerator=BigInt(inputTokens-cachedInputTokens)*BigInt(prices.inputMicrosPerMillion)+
    BigInt(cachedInputTokens)*BigInt(prices.cachedInputMicrosPerMillion)+BigInt(outputTokens)*BigInt(prices.outputMicrosPerMillion);
  const result=Number((numerator+999999n)/1000000n);
  if(!Number.isSafeInteger(result))throw Error('LOCAL_AGENT_COST_OVERFLOW');return result;
}
export function latestCosts(events) {
  const byId=new Map(),latest=new Map();
  for(const event of events) {
    if(validateProduction(event,production.$defs.costEvent).length||byId.has(event.eventId))throw Error('LOCAL_AGENT_LEDGER_INVALID');
    const prior=latest.get(event.chargeId);
    if(prior?(event.supersedesEventId!==prior.eventId||['workspaceId','projectId','actorUserId','operationId','attemptId','scope'].some(key=>event[key]!==prior[key])):event.supersedesEventId!==null)
      throw Error('LOCAL_AGENT_LEDGER_CHAIN_INVALID');
    byId.set(event.eventId,event);latest.set(event.chargeId,event);
  }
  return [...latest.values()];
}
export function createCostLedger(store,config,project,operationId,attemptId) {
  const path=join(store.root,'cost-events.jsonl');
  const read=()=>existsSync(path)?readFileSync(path,'utf8').split('\n').filter(Boolean).map(parseCanonicalJson):[];
  const append=event=>{
    const events=read();latestCosts([...events,event]);
    appendFileSync(path,canonical(event)+'\n',{mode:0o600});
    const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}return event;
  };
  const common={schemaVersion:'2.7.0',kind:'cost_event',environment:'local',scope:'project',workspaceId:project.workspaceId,
    projectId:project.id,actorUserId:project.actorUserId,trialOwnerUserId:null,operationId,attemptId,targetId:null,orderId:null,releaseId:null,
    purpose:'paid_creation',priceVersion:config.priceVersion,methodPackageVersion:'local-agent-v1',rendererImageDigest:null};
  return {
    events:()=>read().filter(event=>event.operationId===operationId),
    total:()=>latestCosts(read()).filter(event=>event.operationId===operationId).reduce((sum,event)=>sum+event.usdMicros,0),
    reserve({usdMicros,provider,model=null,targetId=null,purpose='paid_creation'}) {
      assertConfig(config);
      if(!Number.isSafeInteger(usdMicros)||usdMicros<0)throw Error('LOCAL_AGENT_COST_INVALID');
      const events=latestCosts(read());
      const sum=filter=>events.filter(filter).reduce((total,event)=>total+event.usdMicros,usdMicros);
      if(sum(()=>true)>config.budgets.totalMicros||sum(event=>event.projectId===project.id)>config.budgets.projectMicros||
        sum(event=>event.actorUserId===project.actorUserId)>config.budgets.userMicros||sum(event=>event.operationId===operationId)>config.budgets.operationMicros)
        throw Error('LOCAL_AGENT_BUDGET_EXHAUSTED');
      const eventId='cost-'+randomUUID(),chargeId='charge-'+randomUUID(),now=new Date().toISOString();
      return append({...common,eventId,chargeId,dedupKey:eventId,reservationId:'reservation-'+randomUUID(),provider,model,targetId,purpose,
        providerRequestId:null,usage:[{metric:'pending_charge',unit:'request',quantity:null}],usdMicros,status:'estimated',
        occurredAt:now,recordedAt:now,supersedesEventId:null,reason:null});
    },
    settle(reservation,{usdMicros,usage,providerRequestId=null,rendererImageDigest=null,reason='Actual provider usage received.',reconciled=false}) {
      const eventId='cost-'+randomUUID(),now=new Date().toISOString();
      return append({...reservation,eventId,dedupKey:eventId,usdMicros,usage,providerRequestId,rendererImageDigest,
        status:reconciled?'reconciled':'actual',occurredAt:now,recordedAt:now,supersedesEventId:reservation.eventId,reason});
    }
  };
}
