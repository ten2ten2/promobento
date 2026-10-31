// Original MIT clip grammars, pinned to huashu-motion@52467f99. Each call
// creates its own closure: upstream's singleton grammar state cannot be shared
// by two independent film scenes. The storytime author likeness is excluded.
import {create as math} from './t1_3b1b.js';
import {create as keynote} from './t2_keynote_ui.js';
import {create as chart} from './t3_finance_chart.js';
import {create as kurzgesagt} from './y1_kurzgesagt.js';
import {create as vox} from './y2_vox.js';
import {create as whiteboard} from './y3_whiteboard.js';
import {create as kinetic} from './y5_kinetic_type.js';

const grammars=Object.freeze({t1_3b1b:math,t2_keynote_ui:keynote,t3_finance_chart:chart,
 y1_kurzgesagt:kurzgesagt,y2_vox:vox,y3_whiteboard:whiteboard,y5_kinetic_type:kinetic});
export const grammarNames=Object.freeze(Object.keys(grammars));

// Internal factory only. Mounting requires a separate, fact-bound adapter and
// actual-frame text verification; it is not exposed to custom scene authors.
export function createGrammar(name,clip){
 if(!Object.hasOwn(grammars,name))throw Error('CLIP_GRAMMAR_UNSUPPORTED');
 if(!clip||typeof clip!=='object')throw Error('CLIP_CONTEXT_REQUIRED');
 return grammars[name](clip);
}
