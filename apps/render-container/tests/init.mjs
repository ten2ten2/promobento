// CI only. Root creates two unprivileged processes; the page never shares the controller uid/environment.
import {spawn} from 'node:child_process';
if(process.getuid()!==0)throw Error('CI_INIT_REQUIRES_UID_0');
const env={PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',FONTCONFIG_FILE:'/app/apps/render-container/tests/fontconfig.conf'};
const drop=uid=>['--reuid',String(uid),'--regid',String(uid),'--clear-groups','--inh-caps=-all','--bounding-set=-all'];
const chrome=spawn('setpriv',[...drop(10002),'/opt/chrome-headless-shell-linux64/chrome-headless-shell',
  '--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions',
  '--disable-sync','--disable-default-apps','--hide-scrollbars','--mute-audio','--force-color-profile=srgb',
  '--font-render-hinting=none','--disable-lcd-text','--disable-skia-runtime-opts','--disable-partial-raster',
  '--disable-dev-shm-usage',
  '--use-angle=swiftshader','--enable-unsafe-swiftshader','--js-flags=--max-old-space-size=2048',
  '--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--user-data-dir=/chrome/profile','about:blank'],
  {env:{...env,HOME:'/chrome'},stdio:['ignore','ignore','pipe']});
let controller,started=false;
chrome.stderr.on('data',chunk=>{
  process.stderr.write(chunk);
  if(!started&&String(chunk).includes('DevTools listening on')){
    started=true;
    controller=spawn('setpriv',[...drop(10001),'node',process.env.PROMOBENTO_RUNTIME_CASE?.startsWith('custom')?'apps/render-container/tests/custom.render.test.mjs':process.env.PROMOBENTO_MEDIA_ONLY==='1'?'apps/render-container/tests/media.render.test.mjs':'apps/render-container/tests/browser.render.test.mjs'],
      {env:{...env,HOME:'/work',PROMOBENTO_BROWSER_TEST_CONTAINER:'1',PROMOBENTO_RUNTIME_ONLY:process.env.PROMOBENTO_RUNTIME_ONLY??'0',PROMOBENTO_JOURNEY_ONLY:process.env.PROMOBENTO_JOURNEY_ONLY??'0',PROMOBENTO_RUNTIME_CASE:process.env.PROMOBENTO_RUNTIME_CASE??'all',PROMOBENTO_TEST_IMAGE_DIGEST:process.env.PROMOBENTO_TEST_IMAGE_DIGEST??''},stdio:'inherit'});
    controller.on('exit',code=>{chrome.kill('SIGTERM');process.exitCode=code??1;});
  }
});
const timer=setTimeout(()=>{if(!started){chrome.kill('SIGKILL');process.exitCode=1;}},60000);timer.unref();
chrome.on('exit',code=>{clearTimeout(timer);if(!started){console.error('Chromium startup failed:',code);process.exitCode=1;}
  else if(controller?.exitCode===null){const grace=setTimeout(()=>{if(controller.exitCode===null){controller.kill('SIGTERM');process.exitCode=1;}},2000);grace.unref();}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{controller?.kill(signal);chrome.kill(signal);process.exitCode=1;});
