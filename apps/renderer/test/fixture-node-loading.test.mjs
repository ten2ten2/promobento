import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

// Keep this loader test in its own process/file with no eager renderer imports,
// so a cached indirect dependency cannot hide accidental composition execution.
test('renderer metadata never executes composition modules in the Node controller',async()=>{
  const hook=registerHooks({load(url,context,nextLoad) {
    if(/\/tests\/fixtures\/render\/(square|inplace|media|media-spec)\.mjs$/.test(new URL(url).pathname))
      throw Error('COMPOSITION_EXECUTED_IN_NODE');
    return nextLoad(url,context);
  }});
  try {
    const {fixtureConfiguration}=await import('../src/render-sample.mjs');
    const {readFixtureDeclarations}=await import('../src/fixture-declarations.mjs');
    for(const fixture of ['square','inplace','media']) {
      assert.equal(fixtureConfiguration(fixture).frameCount,fixture==='square'?450:900);
      assert.equal(readFixtureDeclarations(fixture).kind,'runtime_declarations');
    }
  } finally {hook.deregister();}
});
