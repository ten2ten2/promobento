import {digest} from '@promobento/contracts/digest';
export const directingMethodPack = {
  id: 'product-directing', version: '1.1.0',
  sources: [
    {ref:'https://github.com/alchaincyf/huashu-motion/blob/52467f99c602b76ba86d511d37acdfe93fa1e16e/skills/huashu-motion/SKILL.md',scope:'Director-led brief, treatment, hardest-shot-first build and actual-output review; adapted to our sandbox and delivery contract.'},
    {ref:'https://github.com/alchaincyf/huashu-motion/blob/52467f99c602b76ba86d511d37acdfe93fa1e16e/skills/huashu-motion/references/director.md',scope:'Message shape and visual language selection; no fixed story or timing template.'},
    {ref:'https://github.com/alchaincyf/huashu-motion/blob/52467f99c602b76ba86d511d37acdfe93fa1e16e/skills/huashu-motion/references/product-demo-continuity.md',scope:'Identity anchors, content versus framing, landing and reading windows; no imported product imagery.'},
    {ref: 'huashu-motion@4236053', scope: 'Existing directing-method baseline; no upstream executable code imported.'},
    {ref: 'https://github.com/alchaincyf/huashu-motion/blob/52467f99c602b76ba86d511d37acdfe93fa1e16e/README.md',
      scope: 'Owner-selected visual and prompt study: Claude Duet, Grok Bot and DeepSeek samples. Additional visual reference, not a dependency upgrade.'}
  ],
  common: [
    'Read the product and real material, then select the message shape: workflow, mechanism, evidence, transformation, character story or showcase. Choose motion that expresses that shape; do not force every product into a causal story, a screenshot tour or a fast-cut reel.',
    'When continuity is the chosen mechanism, choose a visual carrier whose role changes: a request opens into its result; a shared object connects different contexts; a focused detail becomes the payoff. Translating or tilting three screenshots is still a slideshow if nothing changes meaning.',
    'Use the supplied real assets as evidence, with original editorial staging around them. Distinguish a captured interface from an illustrated request or metaphor. Never invent an interaction, manufacture product proof, or morph an unrelated character into a brand mascot.',
    'Keep required copy, attribution and credits readable. A reference supplies a visual mechanism, not new claims, licensed imagery, or an obligation to reproduce its layout.'
  ],
  audiences: {
    software: 'Make an actual workflow or documented example the story: intent → visible product state → useful consequence. Show the real material at a legible scale; motion should explain that relationship.',
    course: 'Make the learning activity the story: question → worked step or real exercise → what is practiced next. Use confirmed course material; do not invent learner progress, scores or guaranteed outcomes.'
  },
  stages: {
    directions: [
      'Offer different story mechanisms, not three palettes of the same slide sequence. In the existing logline/skeleton fields name what carries the eye between moments and how its role changes.',
      'Prefer one strong opening action over a long title screen. Place the most distinctive product moment early enough to earn attention. Use trusted blocks where they fit and custom scenes for choreography they cannot express.'
    ],
    spec: [
      'Write the treatment before animation: message, route (continuous, montage or hybrid), energy contrast, readable windows, sound landings and a continuity chain. Every scene needs a visible verb. Choose shot count and timings from this brief and material, never from a sample film or host-prescribed slide schedule.',
      'Before assigning blocks, resolve the causal sequence and its visual carrier. Put the visible handoff in treatment.continuity and scene focusFrom/focusTo; notes alone do not implement it.',
      'Use purposeful changes in scale, composition, visual density and tempo. A quiet anticipation can make a payoff stronger. Do not mechanically fill every beat or replace all reading time with movement.',
      'For each boundary, the outgoing subject, location or shape must motivate the next view. Use a continuous trusted story block when it expresses this better than independent entrances and exits.',
      'Shorten generic copy before shrinking product evidence. Do not replace a missing visual idea with extra captions, numbered navigation, decorative ROI boxes or empty panels. If the catalog cannot express the chosen mechanism, specify a custom scene brief and its concrete actions; do not invent block parameters.'
    ],
    scenes: [
      'Build the hardest product-specific shot first using the actual material and fonts. Establish start/end composition, identity anchors, content actions versus camera actions, landing frames and reading windows before filling the rest.',
      'Use one paused GSAP timeline or ctx.OM.clock with a pure draw(t). Work in the scene root with relative target dimensions. Text comes only from ctx.text slots; images come only from ctx.asset. DOM, SVG shapes and Canvas2D are supported; imports, custom WebGL, network, timers, dynamic evaluation and raw text drawing are not.',
      'Implement the visible handoff, not just a written continuity note. Keep source captures truthful; original staging is film packaging, not fabricated product behavior. Check ordered movement poses and settled text separately.'
    ],
    review: [
      'Judge the rendered causal sequence, not just text fit. Does the opening earn attention? Does a shared visual element actually change role or reveal a consequence? Is there a clear payoff, a rhythm contrast and a concise brand ending?',
      'A sequence of correct screenshots with similar entrances may still be boring. Diagnose the missing visual connection and repair that relationship, rather than repeatedly adding/removing the same caption.',
      'Use ordered transition and landing frames to check the handoff. Reading-hold images and audio numbers cannot establish full-motion quality or listening quality.'
    ],
    coldReview: [
      'Independently inspect the actual visible story, including the supplied motion poses. Correct claims and legible typography are necessary but do not establish an engaging film.',
      'Give concrete source frames and a visible defect: unmotivated handoff, repetitive composition, buried payoff, false product behavior, or unreadable evidence. Distinguish these from a preference for another style; do not demand constant motion during an intentional reading hold.'
    ]
  }
} as const;

export interface DirectingMethodPack {id:string;version:string;sources:readonly {ref:string;scope:string}[];common:readonly string[];audiences:Record<'software'|'course',string>;stages:Record<string,readonly string[]>}
export const directingMethodRef=(pack:DirectingMethodPack)=>({id:pack.id,version:pack.version,contentHash:digest(pack)});
/** Bounded stage recall, with no customer material or unrelated methods in the cacheable prefix. */
export function recallDirecting(pack: DirectingMethodPack, stage: string, audience: 'software' | 'course') {
  if (!Object.hasOwn(pack.stages,stage)) return null;
  return {id: pack.id, version: pack.version, common: pack.common, audience: pack.audiences[audience],
    stage, guidance: pack.stages[stage]};
}
