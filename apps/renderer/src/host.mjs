import definition from '/composition.mjs';
import {createCompositionRuntime} from '/runtime.mjs';

let runtime;
// This development harness is served only by the fixture runner on loopback.
window.fixtureHost = {
  async init(input) {
    await runtime?.dispose();
    runtime = await createCompositionRuntime({...input,definition,root:document.querySelector('#composition')});
  },
  seek(frameIndex) { if (!runtime) throw new Error('INVALID_SESSION'); return runtime.seek(frameIndex); },
  dispose() { return runtime?.dispose(); }
};
