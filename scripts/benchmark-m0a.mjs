#!/usr/bin/env node
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
import {expectedCases,readJson,summarizeBenchmark,createBlindPack} from '../research/m0a/benchmark.mjs';
import {runM0aPair} from '../research/m0a/run-pair.mjs';
import {runHuashuBaseline} from '../research/m0a/baseline-runner.mjs';
import {benchmarkErrorCode} from '../research/m0a/errors.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function flags(args) {
  const result={};
  for(let i=0;i<args.length;i+=2) {
    if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--')||Object.hasOwn(result,args[i].slice(2)))throw Error('M0A_CLI_ARGUMENT');
    result[args[i].slice(2)]=args[i+1];
  }
  return result;
}
function only(options,names,required=names) {
  if(Object.keys(options).some(key=>!names.includes(key))||required.some(key=>!options[key]))throw Error('M0A_CLI_ARGUMENT');
}
export async function main(args=process.argv.slice(2)) {
  const [command='matrix',...rest]=args,options=flags(rest);
  if(command==='matrix') {
    only(options,['cases'],[]);
    const cases=readJson(options.cases??resolve(root,'research/m0a/cases.json'));
    console.log(JSON.stringify({kind:'m0a_required_matrix',caseSetVersion:cases.version,inputKind:cases.kind,cases:expectedCases(cases),
      modelSettingsMinimum:2,arms:['promobento','huashu-motion'],stages:['initial','patch'],actualModelCalls:0},null,2));return 0;
  }
  if(command==='run-pair') {
    only(options,['request']);const requestFile=resolve(options.request),request=readJson(requestFile);
    const allowed=['directory','projectFile','configFile','modelKey','upstreamDirectory','basePairDirectory','commentsFile'];
    if(!request||Object.keys(request).some(key=>!allowed.includes(key))||allowed.slice(0,5).some(key=>typeof request[key]!=='string'))throw Error('M0A_PAIR_REQUEST_INVALID');
    const path=value=>resolve(dirname(requestFile),value);
    const controller=new AbortController();const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try {
      const result=await runM0aPair({directory:path(request.directory),project:readJson(path(request.projectFile)),config:readJson(path(request.configFile)),
        modelKey:request.modelKey,upstreamDirectory:path(request.upstreamDirectory),signal:controller.signal,
        basePairDirectory:request.basePairDirectory?path(request.basePairDirectory):null,comments:request.commentsFile?readJson(path(request.commentsFile)):[]});
      console.log(JSON.stringify({pairDirectory:result.pairDirectory,records:result.records.map(({arm,file,result})=>({arm,file,status:result.status,error:result.error,
        operationIds:result.operationIds,requiresOwnerReview:true}))},null,2));
      return result.records.every(({result})=>result.status==='rendered')?0:2;
    } finally {process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  }
  if(command==='summarize') {
    only(options,['manifest','output'],['manifest']);const summary=summarizeBenchmark(resolve(options.manifest));
    const json=JSON.stringify(summary,null,2)+'\n';if(options.output)writeFileSync(resolve(options.output),json,{flag:'wx'});console.log(json.trim());
    return summary.benchmarkPassed?0:2;
  }
  if(command==='blind-pack') {
    only(options,['manifest','output']);console.log(JSON.stringify(createBlindPack(resolve(options.manifest),resolve(options.output)),null,2));return 0;
  }
  if(command==='baseline-smoke') {
    only(options,['upstream','output']);
    const controller=new AbortController();const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try {
      const report=await runHuashuBaseline({upstreamDirectory:resolve(options.upstream),projectDirectory:resolve(root,'research/m0a/smoke'),
        outputDirectory:resolve(options.output),durationSeconds:15,signal:controller.signal});
      console.log(JSON.stringify({kind:report.kind,frames:report.frames,determinism:report.determinism,output:resolve(options.output),productionEligible:false},null,2));return 0;
    } finally {process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  }
  throw Error('M0A_CLI_COMMAND: matrix | run-pair | summarize | blind-pack | baseline-smoke');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {process.exitCode=await main();}
  catch(error){console.error(JSON.stringify({error:benchmarkErrorCode(error)}));process.exitCode=1;}
}
