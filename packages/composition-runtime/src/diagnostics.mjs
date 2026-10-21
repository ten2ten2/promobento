/** Diagnostic wall time only; never an admission, billing or safety receipt. */
export function resourceWaitWithinDraw(spans,start,end) {
  const intervals=spans.map(([from,to])=>[Math.max(start,from),Math.min(end,to??end)])
    .filter(([from,to])=>to>from).sort((a,b)=>a[0]-b[0]);
  let total=0,until=start;
  for(const [from,to] of intervals) {
    total+=Math.max(0,to-Math.max(until,from));
    until=Math.max(until,to);
  }
  return total;
}
