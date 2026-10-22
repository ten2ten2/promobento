/** At most two frames in flight, ordered consumption and no unobserved rejections. */
export async function orderedCapture({count,workers,produce,consume}) {
  if(!Number.isInteger(count)||count<1||count>900||![1,2].includes(workers))throw Error('CAPTURE_CONCURRENCY_INVALID');
  const pending=new Map();
  const start=index=>pending.set(index,Promise.resolve().then(()=>produce(index,index%workers))
    .then(value=>({value}),error=>({error})));
  for(let i=0;i<Math.min(workers,count);i++)start(i);
  try {
    for(let i=0;i<count;i++) {
      const result=await pending.get(i);pending.delete(i);
      if(result.error)throw result.error;
      // Finish consuming before reusing the slot: memory remains bounded by workers.
      await consume(result.value,i);
      if(i+workers<count)start(i+workers);
    }
  } finally {await Promise.all(pending.values());}
}
