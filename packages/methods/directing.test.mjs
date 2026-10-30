import test from 'node:test';
import assert from 'node:assert/strict';
import {directingMethodPack,recallDirecting} from './directing.ts';
test('stage recall carries the shared story method and the right audience without unrelated stages',()=>{
  const software=recallDirecting(directingMethodPack,'spec','software');
  assert.equal(software.version,'1.12.0');assert.match(software.audience,/workflow/);
  assert.match(software.guidance.join(' '),/focusFrom\/focusTo/);
  assert.ok(!software.guidance.some(text=>text.includes('Offer different')));
  const course=recallDirecting(directingMethodPack,'coldReview','course');
  assert.match(course.audience,/worked step/);assert.match(course.audience,/do not invent learner progress/);
  assert.equal(recallDirecting(directingMethodPack,'assets','software'),null);
  assert.match(recallDirecting(directingMethodPack,'scenes','software').guidance.join(' '),/returns the actual text element.*parent does not override/);
  const frozen=structuredClone(directingMethodPack);frozen.version='fixture-older-version';
  assert.equal(recallDirecting(frozen,'review','software').version,'fixture-older-version');
});
