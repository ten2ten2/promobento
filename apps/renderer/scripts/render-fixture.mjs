import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {renderOptions,renderSample} from '../src/render-sample.mjs';

export const usage='Render an already reviewed repository fixture only.\n'
  +'Usage: render:fixture [--fixture square|inplace|media] [--mode output|regression] [--output-directory DIRECTORY]\n'
  +'Defaults: --fixture media --mode output. This is not an arbitrary-source or production-service entrypoint.';

export function parseRenderArguments(args) {
  if (args.length===1 && args[0]==='--help') return {help:true};
  const flags=new Map([['--fixture','fixture'],['--mode','mode'],['--output-directory','outputDirectory']]);
  const options={fixture:'media',mode:'output'},seen=new Set();
  for (let index=0;index<args.length;index+=2) {
    const key=flags.get(args[index]),value=args[index+1];
    if (!key || seen.has(key) || typeof value!=='string' || !value || value.startsWith('--'))
      throw new Error('RENDER_ARGUMENT_INVALID: '+args[index]);
    seen.add(key);options[key]=value;
  }
  return renderOptions(options);
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const options=parseRenderArguments(process.argv.slice(2));
    if (options.help) console.log(usage);
    else {
      const {report}=await renderSample(options);
      console.log(JSON.stringify({mode:report.mode,fixture:report.fixture,verification:report.verification.version,timings:report.timings}));
    }
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
