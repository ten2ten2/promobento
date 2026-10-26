/** Only trusted host functions use this debugger bridge. Author code never gets a CDP handle.
 * Unlike Playwright's UtilityScript, it does not need the page's eval/Function constructors. */
export function pageCaller(cdp){
 let global;
 return async(fn,value)=>{
  global??=(await cdp.send('Runtime.evaluate',{expression:'globalThis'})).result.objectId;
  const result=await cdp.send('Runtime.callFunctionOn',{objectId:global,functionDeclaration:`function(input){return (${fn.toString()})(input);}`,
   arguments:[{value:value??null}],awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description?.slice(0,2000)??result.exceptionDetails.text);
  return result.result.value;
 };
}
