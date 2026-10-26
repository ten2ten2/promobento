import {canonical} from '@promobento/contracts/canonical';

// These fields are consumed only by the Worker. The review wall-clock deadline is enforced
// by RenderWorkflow/ShardDO; the container retains its own stage timeouts and receives no override.
export function assertRendererPolicyCompatible(previous,current){
 const before=structuredClone(previous),after=structuredClone(current);
 delete before.cost.catalogVersion;delete after.cost.catalogVersion;
 delete before.director.steps;delete after.director.steps;
 delete before.render.totalMs.review;delete after.render.totalMs.review;
 if(canonical(before)!==canonical(after))throw Error('RENDERER_POLICY_CHANGED');
}
