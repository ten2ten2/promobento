import {canonical} from '@promobento/contracts/canonical';

// Model catalog updates do not change rendering. All other policy fields remain image inputs.
export function assertRendererPolicyCompatible(previous,current){
 const before=structuredClone(previous),after=structuredClone(current);
 delete before.cost.catalogVersion;delete after.cost.catalogVersion;
 if(canonical(before)!==canonical(after))throw Error('RENDERER_POLICY_CHANGED');
}
