// Trusted analysis only: this module never imports or executes GSAP/QuickJS.
const orders={
  'unshimmed-load':[0],
  'absolute-values-timeline-position':[0,0.5,1.2,0.3,1.2,1.3],
  'relative-property-forward':[0,0.5,1,1.5,2],
  'relative-property-late-first-seek':[2,1.5,1,0.5,0],
  'onupdate-suppressed-by-seek':[0,0.5,1],
  'onupdate-not-suppressed':[0,0.5,1]
};
const same=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);

/** Missing/failed/malformed cases cannot yield an equality or absence-of-dependence claim. */
export function summarizeProbe(results) {
  if(!Array.isArray(results)||results.length!==Object.keys(orders).length)throw Error('GSAP_PROBE_CASES_INVALID');
  const cases=new Map();
  for(const item of results) {
    if(!item||!Object.hasOwn(orders,item.name)||cases.has(item.name))throw Error('GSAP_PROBE_CASES_INVALID');
    const order=orders[item.name];
    if(!Array.isArray(item.order)||!same(item.order,order)||item.shimmed!==(item.name!=='unshimmed-load'))throw Error('GSAP_PROBE_CASE_INVALID: '+item.name);
    if(item.status==='error') {
      if(item.name!=='unshimmed-load'||item.error!=="cannot read property 'now' of undefined")throw Error('GSAP_PROBE_CASE_FAILED: '+item.name);
    } else if(item.status==='ok') {
      if(!Array.isArray(item.samples)||item.samples.length!==order.length||item.samples.some((sample,index)=>
        !Array.isArray(sample)||sample.length!==5||sample.some(value=>typeof value!=='number'||!Number.isFinite(value))
        ||sample[0]!==order[index]||!Number.isSafeInteger(sample[4])||sample[4]<0))throw Error('GSAP_PROBE_SAMPLES_INVALID: '+item.name);
    } else throw Error('GSAP_PROBE_STATUS_INVALID: '+item.name);
    cases.set(item.name,item);
  }
  const samples=name=>cases.get(name).samples;
  const repeated=samples('absolute-values-timeline-position').filter(sample=>sample[0]===1.2);
  const reverse=new Map(samples('relative-property-late-first-seek').map(sample=>[sample[0],sample]));
  const updates=samples('onupdate-not-suppressed').map(sample=>sample[4]);
  return {
    unshimmedLoadFails:cases.get('unshimmed-load').status==='error',
    absoluteRepeatEqual:same(repeated[0],repeated[1]),
    relativePropertyOrderDependent:samples('relative-property-forward').some(sample=>!same(sample,reverse.get(sample[0]))),
    seekSuppressesOnUpdate:samples('onupdate-suppressed-by-seek').every(sample=>sample[4]===0),
    unsuppressedOnUpdateAccumulates:updates[0]===0&&updates.every((value,index)=>index===0||value>updates[index-1])
  };
}
