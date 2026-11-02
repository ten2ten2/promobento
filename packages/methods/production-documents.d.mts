export function assertReferenceAnalysis(analysis:any,evidence:any):any;
export function assertNativeScript(script:any,context:any):any;
export function assertScriptProjection(files:Array<{path:string;content:string}>,script:any):boolean;
export function assertMaterialSelection(plan:any,treatment:any,materials:any[]):any;
export function assertLockedMaterialSelection(selection:any,resources:any[]):any;
export function scriptChangeImpact(before:any,after:any,aspects:string[],lockedMaterials:any):any;
export function applyScriptTextEdits(script:any,edits:any[]):any;
