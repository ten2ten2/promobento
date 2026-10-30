import {blockCatalog} from '../../../packages/blocks/src/catalog.ts';
import {validate} from '@promobento/contracts/validators/block-params';

// The standalone validator uses oneOf in catalog order. Report only the branch for
// the chosen block; errors from other blocks would send the repair in the wrong direction.
export function directorBlockParamIssues(block: string, params: object, sceneIndex: number) {
  const index=blockCatalog.findIndex(entry=>block===entry.id+'@1');
  if(index<0 || validate({block,params}))return [];
  const branch=`#/oneOf/${index}/properties/params/`;
  return (validate.errors??[]).filter(error=>error.schemaPath.startsWith(branch)).slice(0,24).map(error=>({
    code:'BLOCK_PARAMS_'+error.keyword.toUpperCase(),
    path:`/scenes/${sceneIndex}${error.instancePath}`+(typeof error.params.additionalProperty==='string'?'/'+error.params.additionalProperty:''),
    hint:error.message??'Invalid block parameter.'
  }));
}
