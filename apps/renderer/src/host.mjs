import definition from '/composition.mjs';
import {createCompositionRuntime} from '/packages/composition-runtime/src/index.mjs';
import {createMediaController} from '/runtime-media.mjs';

let runtime,media,pending=Promise.resolve();
const serial=operation=>{
  const next=pending.then(operation);pending=next.catch(()=>{});return next;
};
const session=()=>{if(!runtime)throw Error('INVALID_SESSION');return runtime;};
const dispose=async()=>{
  const previous=runtime,previousMedia=media;runtime=undefined;media=undefined;
  try {await previous?.dispose();}finally {previousMedia?.dispose();}
};
// Loopback reviewed-fixture harness. The authenticated cross-origin wire bridge is separate work.
window.fixtureHost = {
  init(input) {
    return serial(async()=>{
      await dispose();
      try {
        if(input.mediaManifest)media=await createMediaController({definition,manifest:input.mediaManifest});
        runtime=await createCompositionRuntime({...input,definition,media,root:document.querySelector('#composition')});
      } catch(error){await dispose();throw error;}
    });
  },
  seek(frameIndex,options) {return serial(()=>session().seek(frameIndex,options));},
  async setValues(input) {
    const command=structuredClone(input);
    return serial(()=>session().setValues(command));
  },
  inspect({frameIndex,x01,y01,previewEpoch}) {
    return serial(()=>session().inspect(frameIndex,x01,y01,previewEpoch===undefined?undefined:{previewEpoch}));
  },
  snapshot() {return serial(()=>session().snapshot());},
  mediaReport() {return serial(()=>{session();return media?.report()??null;});},
  dispose() {return serial(dispose);}
};
