import { parseCanonicalJson } from '@promobento/contracts/canonical';
import type { PagePlan } from './types.ts';

const element = document.getElementById('pb-plan');
if (!element) throw Error('FILM_PLAN_MISSING');
void window.__omEngine.prepare(parseCanonicalJson(element.textContent ?? '') as PagePlan).catch((error: unknown) => {
  window.__omBootFailed = error instanceof Error ? error.message : 'PREPARE_FAILED';
});
