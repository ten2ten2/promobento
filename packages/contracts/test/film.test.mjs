import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSchemaValidator, parseCanonicalJson, filmSpecErrors } from '../index.mjs';

const read = path => parseCanonicalJson(readFileSync(new URL('../../../' + path, import.meta.url)));
const schema = read('contracts/film.schema.json');
const validate = createSchemaValidator(schema);
const example = () => read('contracts/film.example.json');
const codes = result => result.errors.map(error => error.code);

test('the FilmSpec example satisfies the Schema and the cross-field rules', () => {
  assert.deepEqual(validate(example()), []);
  assert.deepEqual(filmSpecErrors(example()), {errors: [], reviews: []});
});

test('the Schema ties duration to frame count and fixes 30 fps', () => {
  const spec = example(); spec.totalFrames = 900;
  assert.ok(validate(spec).some(error => error.includes('/totalFrames')));
  const fast = example(); fast.fps = 60;
  assert.ok(validate(fast).some(error => error.includes('/fps')));
});

test('custom scene modules stay inside scenes/<id>/index.js', () => {
  const spec = example(); spec.scenes[2].module = '../escape.js';
  assert.ok(validate(spec).length > 0);
});

test('scenes must cover the whole film, overlapping only by their transition', () => {
  const gap = example(); gap.scenes[1].start = 100;
  assert.deepEqual(codes(filmSpecErrors(gap)), ['COVERAGE_GAP']);
  const short = example(); short.scenes[3].end = 440;
  assert.deepEqual(codes(filmSpecErrors(short)), ['COVERAGE_SHORT']);
  const overlap = example(); overlap.scenes[2].start = 320;
  assert.ok(codes(filmSpecErrors(overlap)).includes('OVERLAP_WITHOUT_TRANSITION'));
  const late = example(); late.scenes[0].start = 5;
  assert.ok(codes(filmSpecErrors(late)).includes('COVERAGE_GAP'));
});

test('commercial claims in text slots need confirmed facts', () => {
  const unbound = example(); unbound.texts.price = {text: 'Only $9 a month', role: 'body', factIds: []};
  assert.deepEqual(codes(filmSpecErrors(unbound)), ['CLAIM_UNBOUND']);
  const cta = example(); cta.texts.cta.factIds = [];
  assert.deepEqual(codes(filmSpecErrors(cta)), ['CLAIM_UNBOUND']);
  const unconfirmed = filmSpecErrors(example(), {confirmedFactIds: new Set(['fact_value'])});
  assert.deepEqual(codes(unconfirmed), ['FACT_UNCONFIRMED']);
});

test('assets, blocks and fonts must exist and be cleared', () => {
  const context = {
    resources: new Map([['res_dashboard_png', {rightsCleared: true, kind: 'screenshot'}], ['res_logo_svg', {rightsCleared: false, kind: 'logo'}]]),
    blocks: new Map([['hook-title', {major: 1}], ['ui-showcase', {major: 1, validateParams: params => params.assetKey ? [] : ['/assetKey']}], ['cta-endcard', {major: 2}]]),
    fontIds: new Set(['hm-inter'])
  };
  assert.deepEqual(codes(filmSpecErrors(example(), context)), ['ASSET_RIGHTS_PENDING', 'BLOCK_UNKNOWN', 'FONT_UNKNOWN']);
  const logoOnly = filmSpecErrors(example(), {resources: new Map([['res_dashboard_png', {rightsCleared: true, kind: 'logo'}], ['res_logo_svg', {rightsCleared: true, kind: 'logo'}]])});
  assert.deepEqual(logoOnly.reviews.map(review => review.code), ['only-logo']);
});
