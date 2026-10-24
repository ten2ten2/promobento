import {filmFixture} from './fixture.mjs';

/** Full-3D calibration input, deliberately beyond the creative default's 30% WebGL budget. Original material only. */
export function webglFixture(){
 const film=filmFixture();
 film.scenes=[{id:'device',start:0,end:450,kind:'block',block:'device-3d@1',params:{assetKey:'dashboard',textSlot:'product'},
  purpose:'G1 3D-only calibration, not a customer creative; inspect real product texture and deterministic camera motion.'}];
 return film;
}
