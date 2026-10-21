/** Original, synthetic geometry for resource regressions; no external assets.
 * These are inert source strings. Only the isolated admission worker evaluates them.
 */
const rectangles=count=>`export default {
  apiVersion:'2.7.0',editables:[],markers:[],regions:[],videoUses:[],fonts:[],
  prepare() {
    return {
      draw(time) {
        const commands=[];
        for(let index=0;index<(${count});index++)
          commands.push({op:'rect',x:time.numerator,y:index,width:1,height:1,color:'#123456',opacity:1});
        return {commands,regions:[]};
      },
      dispose() {}
    };
  }
};`;

// Frame 1 is not in the repeated/unordered plan, so exactly one response reaches
// the 4096-command ceiling; the other 910 responses remain within the 64 MiB task cap.
export const admissionDenseSource=rectangles('time.numerator===1?4096:600');
export const admissionTransportLimitSource=rectangles('1000');

// A bounded, deterministic call rather than an infinite loop or forbidden clock.
// Several calls finish under the per-call cap before the small host deadline expires.
export const admissionSlowSource=`export default {
  apiVersion:'2.7.0',editables:[],markers:[],regions:[],videoUses:[],fonts:[],
  prepare() {
    return {
      draw(time) {
        let value=time.numerator;
        for(let index=0;index<500000;index++)value=(value+index)%997;
        return {commands:[{op:'rect',x:value,y:0,width:1,height:1,color:'#123456',opacity:1}],regions:[]};
      },
      dispose() {}
    };
  }
};`;
