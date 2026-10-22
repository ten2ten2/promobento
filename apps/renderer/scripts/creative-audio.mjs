import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,chmodSync,rmSync,statSync,readdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseCanonicalJson} from '@promobento/contracts';
import {verifiedAdmissionImage} from '../src/admission-image.mjs';
import {runAdmissionSandbox} from '../src/admission-sandbox.mjs';
import {generatedAudioCatalog} from '../src/creative-audio/index.mjs';

const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--catalog') {console.log(JSON.stringify(generatedAudioCatalog(),null,2));}
else {
  const options={};
  for(let i=0;i<args.length;i+=2) {if(!['--generate','--analyze','--captions','--rights','--output'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Usage: creative:audio --generate request.json | --analyze audio.wav | --captions request.json [--rights rights.json] --output directory');options[args[i]]=args[i+1];}
  const modes=['--generate','--analyze','--captions'].filter(k=>options[k]);
  if(modes.length!==1||!options['--output'])throw Error('AUDIO_TOOL_ARGUMENTS_INVALID');
  const json=path=>{if(!statSync(path).isFile()||statSync(path).size>65536)throw Error('AUDIO_TOOL_JSON_LIMIT');return parseCanonicalJson(readFileSync(path));};
  const mode=modes[0],out=resolve(options['--output']);
  if(existsSync(out)&&readdirSync(out).length)throw Error('AUDIO_TOOL_OUTPUT_NOT_EMPTY');
  const temporary=mkdtempSync(join(tmpdir(),'promobento-audio-')),controller=new AbortController(),cancel=()=>controller.abort();
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  mkdirSync(out,{recursive:true});chmodSync(out,0o777);chmodSync(temporary,0o755);
  try {
    let job;
    if(mode==='--generate') {
      const request=json(options[mode]);
      if(!request||Object.keys(request).some(k=>!['source','totalFrames'].includes(k)))throw Error('AUDIO_TOOL_GENERATE_REQUEST_INVALID');
      job={...request,operation:'generate',audioRights:options['--rights']?json(options['--rights']):null};
    }
    else if(mode==='--captions') {if(options['--rights'])throw Error('AUDIO_TOOL_UNUSED_RIGHTS');job={operation:'captions',request:json(options[mode])};}
    else {
      const file=options[mode];if(!options['--rights']||!statSync(file).isFile()||statSync(file).size>5760044)throw Error('AUDIO_TOOL_INPUT_OR_RIGHTS_REQUIRED');
      copyFileSync(file,join(temporary,'audio.wav'));job={operation:'analyze',rights:json(options['--rights'])};
    }
    let complete=false;
    const sandbox=await runAdmissionSandbox({image:verifiedAdmissionImage(),mode:'audio-tools',kind:'capture',input:job,signal:controller.signal,
      mounts:[{source:temporary,target:'/input'},{source:out,target:'/output',readonly:false}],
      onLine(message){if(message.kind!=='audio-tools-complete'||complete)throw Error('AUDIO_TOOL_RECEIPT_INVALID');complete=true;}});
    if(!complete)throw Error('AUDIO_TOOL_RECEIPT_MISSING');
    writeFileSync(join(out,'execution.json'),JSON.stringify({kind:'creative_audio_execution',operation:job.operation,sandbox},null,2)+'\n');
    console.log(JSON.stringify({status:'passed',out}));
  } finally {process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);rmSync(temporary,{recursive:true,force:true});}
}
