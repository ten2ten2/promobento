import {createOM} from './om.js';
import {createClipHelpers} from './clip/helpers.js';
if (!window.gsap) throw Error('GSAP_UNAVAILABLE');
window.gsap.ticker.lagSmoothing(0);
window.gsap.ticker.remove(window.gsap.updateRoot);
window.gsap.ticker.sleep();
Object.defineProperty(window, '__pbCreateOM', {value: createOM, writable: false, configurable: false});
Object.defineProperty(window, 'CLIP', {value: createClipHelpers(window), writable: false, configurable: false});
