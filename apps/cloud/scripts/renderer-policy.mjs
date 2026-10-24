import {canonical} from '@promobento/contracts/canonical';

// Model catalog and model-only step policies are not imported by the renderer. Other fields stay protected.
export function assertRendererPolicyCompatible(previous,current){
 const before=structuredClone(previous),after=structuredClone(current);
 delete before.cost.catalogVersion;delete after.cost.catalogVersion;
 delete before.director.steps;delete after.director.steps;
 if(canonical(before)!==canonical(after))throw Error('RENDERER_POLICY_CHANGED');
}
