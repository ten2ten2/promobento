import huashuSource from './huashu-motion/source.mjs';
import hypitSource from './hypit-source.mjs';
import {digest} from '@promobento/contracts/digest';

/** Frozen method evidence; the complete upstream references and original templates remain available. */
export const directingMethodPack = {
  id: 'native-product-directing', version: '2.0.1', huashuSource, hypitSource,
  sources: [
    {ref: `https://github.com/alchaincyf/huashu-motion/tree/${huashuSource.revision}`, scope: 'Native HTML, GSAP, Canvas, SVG and Three.js authoring, original templates, preview, editing and whole-film rendering.'},
    {ref: `https://github.com/hypit-ai/hypit/tree/${hypitSource.revision}`, scope: 'Brief versus Treatment, source-backed material selection, semantic events and actual-media timing. No second execution runtime.'}
  ],
  common: [
    'The authored film is a native huashu-motion project: index.html plus local JS/CSS/assets. JSON carries production context and immutable file manifests, never a second film language. Use native GSAP, Canvas, SVG or Three.js freely inside the isolated browser.',
    'Use only confirmed product facts and actual supplied material. Preserve requested language, exact names, required wording and CTA. Captured interfaces are evidence; original staging is packaging. Do not invent an interaction, result, metric or testimonial.',
    'The Brief records the user’s goal, audience, facts, replacements, references and fixed delivery/budget constraints. The Treatment records your complete creative answer: hook, reveal, payoff, visual relationships, rhythm and sound. An implementation repair changes source; change Treatment only when the design changes, and Brief only when user truth changes.',
    'Choose a message shape that fits the material: workflow, mechanism, evidence, transformation, character or showcase. Motion must express that shape. Keep the product legible and give the hook, important evidence and ending distinct compositions.',
    'PromoBento delivery is exactly 15 or 30 seconds at 30 fps, one supported platform aspect per project. Set matching data-duration, data-fps, data-width and data-height on the composition. Author a complete timeline of that duration. Recompose for each aspect; never stretch a finished frame.',
    'Use only supplied local asset paths and the fixed bundled vendor/font paths. No external URLs, downloads, package installs or secrets. The trusted host never evaluates authored code; all visual work runs in the isolated native browser.',
    'Keep content and meaningful named time values together in source. Real narration can drive a reveal only through supplied alignment evidence tied to that same audio hash. Estimated delivery rates and reference-video seconds are not target word timestamps. For silent graphics use authored times; for supplied media use measured duration and source times.',
    'Keep fixed delivery length by shortening the intended wording or changing the cut when actual speech is too long. Do not accelerate speech, fabricate alignment or silently change the movie duration. Reuse the exact accepted asset/revision hashes and completed model receipts instead of re-buying equivalent work.',
    'A source file is only a proposal until the native preview has run. Review the returned pixels and errors, then the exported movie evidence. Stills do not prove full motion or listening quality; record those limits instead of asserting an unseen pass.'
  ],
  audiences: {
    software: 'Stage an actual workflow, mechanism or documented result: intent, visible product state and useful consequence. Keep the real interface readable, with enough surrounding context to understand it.',
    course: 'Stage a real question, worked step or supplied exercise and what the learner practices next. Preserve the actual teaching content; do not invent progress, scores or learning outcomes.'
  },
  stages: {
    facts: ['Organize the supplied confirmed facts without adding or changing them. The Brief preserves user authority; creative choices belong in Treatment.'],
    assets: ['Describe only what the supplied pixels or timed evidence establish. Record readable content, useful regions, identity anchors and limitations. A poster frame cannot establish later video action.'],
    directions: [
      'Propose Fit, Amplify and Unexpected using the same actual content. Make them differ in visual language, material or story construction. Include a depth option unless the Brief explicitly excludes it; do not assume depth is the preferred answer.',
      'Each chosen visual hypothesis is built as native source and rendered to a real key frame before the user chooses. Source-backed palette and truthful material matter more than decorative variation.'
    ],
    treatment: [
      'Write the selected direction as a complete creative design, with a beat map and the hook, hero, densest and ending review frames. Name the hardest shot and the continuity relationship that must survive each handoff.',
      'Select material by its role in the story. Separate observed source-media times from intended authored events. Use supplied alignment evidence for spoken Moments and Selections; pure animation needs no pretend transcript.',
      'Choose music and effects to support the direction. Default to an authored native OM score or supported procedural sound unless the user requested silence; supplied voice/music remain actual local files. Linux TTS is not assumed.'
    ],
    author: [
      'Write complete native index.html, using a single paused timeline in window.__timelines[compositionId]. Keep all text and drawing in the original HTML/JS representation. Use the selected original template directly when it fits; replace its demonstration content with this project’s facts and assets.',
      'Build and preview the hardest product-specific shot before completing the film. Use stable data-om-id elements or OM.region for canvas objects, composition variables for editable values, and scene:<id> timeline labels. Everything visible must be a function of absolute time.',
      'Use the real assets at meaningful scale. Preserve their pixels and context; camera movement does not establish a product action. Anchor sound hits to the actual motion event and use real narration cues only when evidence exists.',
      'For revisions read the existing source and its baseRevision, then apply exact scoped edits. Keep unrelated source and stable element IDs. Never change duration, facts, approved direction or aspect merely to hide a layout problem.',
      'Template instructions describe upstream native capabilities; only the supplied host tool schema is callable. Do not emit shell commands or assume access to the host filesystem.'
    ],
    review: [
      'Inspect actual native preview frames against the Brief, selected direction and Treatment. Identify concrete frame/element defects in hierarchy, factual fidelity, cropping, continuity, readability, opening or ending. A preference for another style is not a defect.',
      'Treat native runtime errors as failures. Do not approve placeholder images, missing real material, empty frames or a treatment that was never implemented. Ask for a scoped source repair with evidence; do not change transport manifests or budget controls.',
      'Sampled frames establish only those frames. Do not infer full-motion or listening quality from stills; retain owner normal-speed review as pending.'
    ],
    coldReview: ['Independently inspect the final encoded-output evidence against the original Brief. State concrete source frames and visible defects; do not treat a prior director note as proof.']
  }
} as const;

type SourcePack = {revision:string;references:Record<string,string>;templateSources?:Record<string,string>};
export interface DirectingMethodPack {
  id:string;version:string;huashuSource:SourcePack;hypitSource:SourcePack;
  sources:readonly {ref:string;scope:string}[];common:readonly string[];
  audiences:Record<'software'|'course',string>;stages:Record<string,readonly string[]>;
}
export const directingMethodRef=(pack:DirectingMethodPack)=>({id:pack.id,version:pack.version,contentHash:digest(pack)});

/** Stage-bounded recall; source/template bodies are the original native material, never adapted shims. */
export function recallDirecting(pack:DirectingMethodPack,stage:string,audience:'software'|'course',language='') {
  if(pack.id!=='native-product-directing'||!['2.0.0',directingMethodPack.version].includes(pack.version)||!Object.hasOwn(directingMethodPack.stages,stage)||!Object.hasOwn(pack.stages,stage))throw Error('DIRECTING_METHOD_UNSUPPORTED');
  const refs:Record<string,string[]>={
    directions:['references/director.md','references/visual-direction.md','references/library/formats.md'],
    treatment:['references/director.md','references/rhythm.md','references/product-demo-continuity.md','references/music.md'],
    author:['references/contract.md','references/craft.md','references/product-demo-continuity.md','references/sound.md'],
    review:['references/verification.md','references/product-demo-continuity.md'],
    coldReview:['references/verification.md']
  };
  const templates:Record<string,string>={'cursor-demo':'ui-space','continuous-morph':'ui-space','kinetic-type':'kinetic-type','hand-drawn':'whiteboard','3d-object':'object-3d','data-story':'finance-chart','editorial-collage':'vox-collage','flat-world':'kurzgesagt','system-diagram':'math-3b1b','modular-grid':'keynote-ui','card-montage':'keynote-ui','talking-head':'talking-head'};
  const selected=templates[language], paths=[...(refs[stage]??[])];
  if(language&&pack.huashuSource.references['references/library/languages/'+language+'.md'])paths.push('references/library/languages/'+language+'.md');
  if(stage==='directions')paths.push(...Object.keys(pack.huashuSource.references).filter(p=>p.startsWith('references/library/languages/')).sort());
  const templatePath=(selected??'blank')+'/index.html';
  const hypitPaths=stage==='treatment'||stage==='author'?['references/creation/brief.md','references/creation/script-and-time.md']:['references/creation/brief.md'];
  return {id:pack.id,version:pack.version,common:pack.common,audience:pack.audiences[audience],stage,guidance:pack.stages[stage],
    huashu:{revision:pack.huashuSource.revision,references:paths.map(path=>({path,content:pack.huashuSource.references[path]})),
      ...(stage==='author'?{template:{path:templatePath,content:pack.huashuSource.templateSources?.[templatePath],usage:'Native starting source. Keep its original APIs and author this project’s exact content, duration and local assets.'}}:{})},
    hypit:{revision:pack.hypitSource.revision,references:hypitPaths.map(path=>({path,content:pack.hypitSource.references[path]}))}};
}
