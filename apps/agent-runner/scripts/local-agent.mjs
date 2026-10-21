import {publicErrorCode} from '../src/errors.mjs';
import {parseArgs} from 'node:util';
import {readFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {initializeProject,createWork,recordReview,selectCandidate,acceptCandidate,prepareTargets,getOperation,reconcileCharge} from '../src/runner.mjs';

const {values,positionals}=parseArgs({allowPositionals:true,options:{directory:{type:'string'},project:{type:'string'},config:{type:'string'},
  'project-id':{type:'string'},'operation-id':{type:'string'},'candidate-id':{type:'string'},'expected-revision':{type:'string'},
  'charge-id':{type:'string'},comments:{type:'string'},receipt:{type:'string'},help:{type:'boolean'}}});
const command=positionals[0];
if(values.help||!command) {
  process.stdout.write(`Local M0a research controller (no production activation)\n\n`+
    `node apps/agent-runner/scripts/local-agent.mjs COMMAND --directory PRIVATE_DIRECTORY [options]\n\n`+
    `init     --project FILE\nplan     --project-id ID --config FILE [--operation-id ID]\n`+
    `patch    --project-id ID --config FILE --comments FILE [--operation-id ID]\n`+
    `prepare  --project-id ID --config FILE [--operation-id ID]\n`+
    `review   --operation-id ID --receipt FILE\nselect   --operation-id ID --candidate-id ID\n`+
    `accept   --operation-id ID --expected-revision ID_OR_null\nstatus   --operation-id ID\n`+
    `reconcile --project-id ID --operation-id ID --charge-id ID --config FILE --receipt FILE\n\n`+
    `plan/patch require an explicitly authorized local config and OPENAI_API_KEY. Never pass a key as a CLI argument.\n`);
  process.exit(0);
}
const json=key=>{if(!values[key])throw Error('LOCAL_AGENT_ARGUMENT_REQUIRED: --'+key);return parseCanonicalJson(readFileSync(values[key]));};
const required=key=>{if(!values[key])throw Error('LOCAL_AGENT_ARGUMENT_REQUIRED: --'+key);return values[key];};
const controller=new AbortController();
const interrupt=()=>controller.abort(Error('LOCAL_AGENT_CANCELLED'));
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
try {
  const directory=required('directory'),operationId=values['operation-id'];let result;
  if(command==='init')result=await initializeProject({directory,project:json('project')});
  else if(command==='plan'||command==='patch')result=await createWork({directory,projectId:required('project-id'),config:json('config'),
    operationId,kind:command==='patch'?'agent_patch':'creative_generate',comments:command==='patch'?json('comments'):[],signal:controller.signal});
  else if(command==='prepare')result=await prepareTargets({directory,projectId:required('project-id'),config:json('config'),operationId,signal:controller.signal});
  else if(command==='review')result=await recordReview({directory,operationId:required('operation-id'),receipt:json('receipt')});
  else if(command==='select')result=await selectCandidate({directory,operationId:required('operation-id'),candidateId:required('candidate-id')});
  else if(command==='accept')result=await acceptCandidate({directory,operationId:required('operation-id'),expectedRevisionId:required('expected-revision')==='null'?null:values['expected-revision']});
  else if(command==='status')result=await getOperation({directory,operationId:required('operation-id')});
  else if(command==='reconcile')result=await reconcileCharge({directory,projectId:required('project-id'),operationId:required('operation-id'),chargeId:required('charge-id'),config:json('config'),receipt:json('receipt')});
  else throw Error('LOCAL_AGENT_COMMAND_UNKNOWN');
  process.stdout.write(canonical(result)+'\n');
} catch(error) {
  process.stderr.write(canonical({error:publicErrorCode(error)})+'\n');process.exitCode=controller.signal.aborted?130:1;
} finally {process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
