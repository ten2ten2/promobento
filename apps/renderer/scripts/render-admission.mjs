import {renderAdmission} from '../src/admission-run.mjs';
const options={},seen=new Set(),flags=new Map([['--source','sourceDirectory'],['--output-directory','outputDirectory']]);
try {
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2) {
    const key=flags.get(args[i]),value=args[i+1];
    if(!key||seen.has(key)||!value||value.startsWith('--'))throw Error('Usage: render:admission --source DIRECTORY [--output-directory DIRECTORY]');
    options[key]=value;seen.add(key);
  }
  if(!options.sourceDirectory)throw Error('ADMISSION_SOURCE_REQUIRED');
  const controller=new AbortController(),cancel=()=>controller.abort();
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try {const {out,report}=await renderAdmission({...options,signal:controller.signal});console.log(JSON.stringify({out,status:report.status,qaInputHash:report.qaInputHash}));}
  finally {process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
} catch(error) {console.error(error.message);process.exitCode=1;}
