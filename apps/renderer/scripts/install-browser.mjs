import {environmentLock} from '../src/environment.mjs';
import {installBrowserArchive,prepareBrowserBundle} from '../src/browser-bundle.mjs';

if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('RENDERER_UNSUPPORTED_PLATFORM: trusted rendering requires Linux x64; use its CI job');
installBrowserArchive(environmentLock.browser);
const bundle=prepareBrowserBundle(environmentLock.browser);
bundle.cleanup();
console.log('Pinned browser archive and executable verified; each render will extract its own private bundle.');
