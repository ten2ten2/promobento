import {readFileSync,lstatSync,mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {parseCanonicalJson,canonical} from '@promobento/contracts';
import {paletteDiagnostics} from '../src/creative-diagnostics.mjs';

try {
  const [command,...args]=process.argv.slice(2),options={};
  if(command!=='palette')throw Error('Usage: creative:tools palette --input FILE --output-directory EMPTY_DIRECTORY');
  for(let i=0;i<args.length;i+=2) {
    const key=args[i],value=args[i+1];
    if(!['--input','--output-directory'].includes(key)||options[key]||!value||value.startsWith('--'))throw Error('CREATIVE_TOOLS_ARGUMENTS');
    options[key]=value;
  }
  if(!options['--input']||!options['--output-directory'])throw Error('CREATIVE_TOOLS_ARGUMENTS');
  const stat=lstatSync(options['--input']);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('PALETTE_FILE_INVALID');
  const report=paletteDiagnostics(parseCanonicalJson(readFileSync(options['--input']))),out=resolve(options['--output-directory']);
  mkdirSync(out,{recursive:true});if(readdirSync(out).length)throw Error('CREATIVE_TOOLS_OUTPUT_NOT_EMPTY');
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const rows=report.palettes.map((palette,index)=>{
    const y=40+index*100,w=720/palette.colors.length,chars=Array.from(palette.id);
    const label=chars.length>36?chars.slice(0,35).join('')+'…':palette.id;
    return `<text x="24" y="${y}" font-size="18"><title>${escape(palette.id)}</title>${escape(label)}</text>`+palette.colors.map((color,i)=>
      `<rect x="${24+i*w}" y="${y+12}" width="${w}" height="36" fill="${color.hex}"/><text x="${28+i*w}" y="${y+68}" font-size="14">${color.hex}</text>`).join('');
  }).join('');
  writeFileSync(join(out,'swatches.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="768" height="${report.palettes.length*100+24}" role="img" aria-label="Palette comparison"><rect width="100%" height="100%" fill="#f5f5f5"/><g fill="#151515" font-family="sans-serif">${rows}</g></svg>\n`,{flag:'wx'});
  writeFileSync(join(out,'diagnostics.json'),canonical(report)+'\n',{flag:'wx'});
  console.log(canonical({out,findings:report.findings}));
} catch(error) {console.error(error.message);process.exitCode=1;}
