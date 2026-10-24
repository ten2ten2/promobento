import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {completedReviewFilm} from '../../research/evals/probe-review-render.mjs';

test('native review accepts the original paid tool contract and the actual completed C JSON, never partial output',()=>{
  const receipt=parseCanonicalJson(readFileSync(new URL('../../docs/evidence/2026-10-24-s1-director/minimax-seventh-attempt/spec-response.json',import.meta.url)));
  const actual=completedReviewFilm(receipt);
  assert.equal(actual.sourceKind,'completed_film_json');assert.equal(actual.film.specVersion,'film-v1');
  assert.equal(actual.film.style.palette.roles.bg,'#2f8cff');
  const original={kind:'metered_model_response',result:{toolCalls:[{name:'write_spec',input:{film:actual.film}}]}};
  assert.deepEqual(completedReviewFilm(original),{film:actual.film,sourceKind:'completed_write_spec'});
  assert.throws(()=>completedReviewFilm({...receipt,result:{...receipt.result,failure:'MODEL_OUTPUT_TRUNCATED'}}),/COMPLETED_FILM_RECEIPT_REQUIRED/);
  assert.throws(()=>completedReviewFilm({...original,result:{toolCalls:[{name:'write_spec',input:{film:actual.film,note:'extra'}}]}}),/COMPLETED_FILM_RECEIPT_REQUIRED/);
  assert.throws(()=>completedReviewFilm({...receipt,result:{...receipt.result,text:'{"kind":"fact_analysis"}'}}),/COMPLETED_FILM_RECEIPT_REQUIRED/);
});
