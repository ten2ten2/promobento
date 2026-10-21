import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {environmentLock} from './environment.mjs';

/** The deadline runs in Node, outside the renderer's event loop and serialized draw queue. */
export async function withDeadline(operation,{timeoutMs,code,terminate}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs<=0) throw new RangeError('DEADLINE_INVALID');
  let timer,timeoutError,termination;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      timeoutError=new Error(code);
      termination=Promise.resolve().then(terminate);
      // Attach a handler immediately; the catch below still awaits the actual cleanup.
      termination.catch(()=>{});
      reject(timeoutError);
    },timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(operation),deadline]); }
  catch(error) {
    if (timeoutError) {
      try { await termination; }
      catch(cause) { timeoutError.cause=cause; }
      throw timeoutError;
    }
    throw error;
  } finally { clearTimeout(timer); }
}

export async function launchFixtureBrowser(bundle) {
  const server=await chromium.launchServer({executablePath:bundle.executablePath,headless:true,chromiumSandbox:false,
    env:{...process.env,...bundle.fontEnvironment},args:environmentLock.launchArgs,timeout:environmentLock.prepareTimeoutMs});
  let stopping;
  // BrowserServer.kill terminates the process group without using the blocked page.
  const stop=()=>stopping??=(server.kill());
  try {
    const browser=await chromium.connect(server.wsEndpoint(),{timeout:environmentLock.prepareTimeoutMs});
    assert.equal(browser.version(),environmentLock.browser.version);
    return {browser,process:server.process(),stop};
  } catch(error) { await stop();throw error; }
}

export function captureFrame(page,frameIndex,{terminate,timeoutMs=environmentLock.frameTimeoutMs}) {
  return withDeadline(async()=>{
    const receipt=await page.evaluate(index=>window.fixtureHost.seek(index),frameIndex);
    assert.equal(receipt.frameIndex,frameIndex);
    return page.screenshot({type:'png',animations:'allow',caret:'hide',timeout:timeoutMs});
  },{timeoutMs,code:'FRAME_TIMEOUT: '+frameIndex,terminate});
}
