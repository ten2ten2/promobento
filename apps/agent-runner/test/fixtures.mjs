import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {sha256} from '../../renderer/src/environment.mjs';
import {readAdmissionSource} from '../../renderer/src/admission-source.mjs';
import {editEvidencePlan} from '../../renderer/src/edit-evidence.mjs';
const {PNG}=createRequire(new URL('../../renderer/package.json',import.meta.url))('pngjs');
import {canonical} from '../../../packages/contracts/index.mjs';

export const project=()=>({id:'project-test',caseId:'unit-mock',audience:'software',task:'A fictional test project, not a real model acceptance.',durationSeconds:15,
  targetIds:['tiktok:portrait','instagram_feed:square'],seed:'unit-test',facts:[{id:'test-name',text:'Test fixture',evidenceRef:'mock-only',confirmedBy:'unit-test',confirmedAt:'2026-01-01T00:00:00Z'}],
  rights:[],audioMode:'silent',direct:true,actorUserId:'test-actor',workspaceId:'test-workspace'});
export const config=()=>({version:'local-agent-v1',mode:'local_research',provider:'openai',model:'mock-model',priceVersion:'unit-test-not-real-prices',
  prices:{inputMicrosPerMillion:1000000,cachedInputMicrosPerMillion:500000,outputMicrosPerMillion:2000000,renderMicrosPerSecond:0},
  maxInputTokens:10000,maxOutputTokens:2000,requestTimeoutMs:10000,budgets:{operationMicros:100000,projectMicros:1000000,userMicros:1000000,totalMicros:2000000},
  authorization:{approvedBy:'unit-test',approvedAt:'2020-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',purpose:'m0a_research',maxUsdMicros:2000000}});
export const source=()=>({code:`export default {apiVersion:'2.7.0',editables:[],markers:[],regions:[],videoUses:[],fonts:[],prepare(){return {draw(){return {commands:[]};},dispose(){}};}}`,
  declarations:{schemaVersion:'2.7.0',kind:'runtime_declarations',editables:[],markers:[],regions:[],videoUses:[],fonts:[]},values:{},
  resources:{schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:[],audioEvents:[]}});
export const plan=()=>({direction:{id:'fit',label:'Fit',logline:'An offline mock fixture.'},treatment:{totalFrames:450,beats:[{frameStart:0,frameEndExclusive:450,event:'Hold'}]},
  audioPlan:{totalFrames:450,events:[]},source:source(),agentInterpretation:'Mock patch',impactSummary:'Mock source only'});
export const provider=(value={plans:[plan()]})=>({id:'mock',generate:async()=>({status:'completed',text:canonical(value),providerRequestId:'mock-response',model:'mock-model',
  usage:{inputTokens:100,outputTokens:20,cachedInputTokens:40}})});
export const mockMethod=async()=>({mock:true});
export const mockRender=async({sourceDirectory,outputDirectory}={})=>{
  const media=Buffer.from('UNIT MOCK MEDIA — NOT A PLAYABLE VIDEO'),identity=sourceDirectory?readAdmissionSource(sourceDirectory):null;
  const report={status:'passed',sourceHash:identity?.sourceHash,sourceArchiveHash:identity?.sourceArchiveHash,
    qaInputHash:'a'.repeat(64),image:{imageId:'sha256:'+'b'.repeat(64)},
    capture:{video:{sha256:sha256(media)},keyframes:[{frameIndex:0,roles:['opening'],file:'keyframe-000000.png',sha256:'c'.repeat(64),byteLength:100,pixelSha256:'d'.repeat(64)}]}};
  if(outputDirectory){mkdirSync(outputDirectory,{recursive:true});writeFileSync(join(outputDirectory,'report.json'),canonical(report));writeFileSync(join(outputDirectory,'sample.mp4'),media);}
  return {report};
};
export const mockCapture=async({outputDirectory,...input})=>{
  const plan=editEvidencePlan(input);mkdirSync(outputDirectory,{recursive:true});
  const image=(name,width,height)=>{const bytes=PNG.sync.write(new PNG({width,height})),path=join(outputDirectory,name);writeFileSync(path,bytes);return {path,sha256:sha256(bytes),width,height};};
  return {...plan,full:image('full.png',plan.width,plan.height),detail:plan.detail?{...image('detail.png',plan.detail.crop.width*2,plan.detail.crop.height*2),...plan.detail}:null};
};
