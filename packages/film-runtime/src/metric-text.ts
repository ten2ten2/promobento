// Capture the operations before author scripts run. A neighboring custom scene
// must not be able to redefine the counter or its independent DOM check.
const apply=Reflect.apply,exec=RegExp.prototype.exec,toFixed=Number.prototype.toFixed,
 toNumber=Number,finite=Number.isFinite,min=Math.min,max=Math.max;

/** The existing metric's deterministic intermediate text, independent of DOM state. */
export function parseMetricText(text:string){
 const match=apply(exec,/^(\D*?)([-+]?\d+(?:[.,]\d+)?)(\D*)$/,[text]) as RegExpExecArray|null;
 if(!match)throw Error('METRIC_NUMBER_INVALID');
 const digits=match[2]!;let normalized='',decimals=0,separator=false,comma=false;
 for(let index=0;index<digits.length;index++){
  const ch=digits[index]!;if(ch===','||ch==='.'){normalized+='.';separator=true;comma=ch===',';}
  else{normalized+=ch;if(separator)decimals++;}
 }
 const number=toNumber(normalized);if(!finite(number))throw Error('METRIC_NUMBER_INVALID');
 return{final:text,prefix:match[1]!,number,decimals,comma,suffix:match[3]!};
}
export function metricTextAt(metric:ReturnType<typeof parseMetricText>,seconds:number){
 const progress=1-(1-min(1,max(0,seconds/1.2)))**3;
 if(progress===1)return{progress,text:metric.final};
 const value=apply(toFixed,metric.number*progress,[metric.decimals]) as string;
 let formatted='';for(let index=0;index<value.length;index++)formatted+=value[index]==='.'&&metric.comma?',':value[index];
 return{progress,text:metric.prefix+formatted+metric.suffix};
}
