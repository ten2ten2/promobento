import {readFileSync} from 'node:fs';
import {generateReference} from './build-agent-reference.mjs';
import {load,targets} from './contract-validation.mjs';
const ui=load('config/ui-tokens.json'),html=readFileSync(new URL('../'+ui.reference.output,import.meta.url),'utf8'),failures=[];
if(html!==generateReference())failures.push('Reference output differs from current sources');
for(const s of ['Offline design reference.','STATIC DESIGN SAMPLE — NOT A VIDEO FRAME','no generated video','no external network requests','value="15"','value="30"','max="899"','Prepare platform layouts']){
 if(!html.includes(s))failures.push('Missing reference boundary/control: '+s);
}
for(const t of targets())if(!html.includes('value="'+t.targetId+'"'))failures.push('Missing legal target '+t.targetId);
if(/\b(?:src|href)\s*=\s*["']https?:/i.test(html)||/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/.test(html))failures.push('Offline reference makes an external request');
if(/@@[A-Z_]+@@/.test(html))failures.push('Unresolved template token');
if(!html.includes('--rail:'+ui.layout.editorSceneWidth+'px')||!html.includes('--inspector:'+ui.layout.editorInspectorWidth+'px'))failures.push('Reference dimensions differ from tokens');
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Current Studio reference passed source, target, token and offline-boundary checks. Browser rendering is a separate test.');
