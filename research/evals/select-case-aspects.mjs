// A portrait-only evaluation is explicitly requested; all existing callers keep both targets.
export function selectCaseAspects(aspects,mode){
 return mode==='--portrait'?['portrait']:[...aspects];
}
