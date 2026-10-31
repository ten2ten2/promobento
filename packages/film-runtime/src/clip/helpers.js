// Each call installs the original helper namespaces and their caches into one
// environment. Trusted clips use a private environment; legacy authored code
// keeps the original window-backed namespaces.
import {install as util} from './util.js';
import {install as motion} from './motion.js';
import {install as camera} from './camera.js';
import {install as paint} from './paint.js';
import {install as kit} from './kit.js';
import {install as diagram} from './diagram.js';
import {install as typo} from './typo.js';
import {install as chart} from './chart.js';
import {install as ui} from './ui.js';
import {install as collage} from './collage.js';
import {install as toon} from './toon.js';
import * as cues from './cues.js';

export function createClipHelpers(env={}){
 for(const install of [util,motion,camera,paint,kit,diagram,typo,chart,ui,collage,toon])install(env);
 const {U,MO,CAM,PAINT,KIT,DG,TY,CH,UI,CL,TOON}=env;
 return Object.freeze({U,MO,CAM,PAINT,KIT,DG,TY,CH,UI,CL,TOON,cues:Object.freeze({findWord:cues.findWord,prepare:cues.prepare})});
}
