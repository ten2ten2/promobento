import upstream from '../upstream.lock.json' with {type: 'json'};

/** The files the native adapter copies into every render snapshot. */
export const builtinSources = [
  ['templates/blank/vendor/gsap.min.js', 'vendor/gsap.min.js'],
  ['templates/blank/vendor/GSAP-LICENSE.txt', 'vendor/GSAP-LICENSE.txt'],
  ['templates/blank/vendor/GSAP-LICENSE.html', 'vendor/GSAP-LICENSE.html'],
  ['runtime/om.js', 'vendor/om.js'],
  ['runtime/camera-rig.js', 'vendor/camera-rig.js'],
  ['runtime/three/three.min.js', 'vendor/three.min.js'],
  ['runtime/three/om-three.js', 'vendor/om-three.js'],
  ['runtime/three/LICENSE', 'vendor/THREE-LICENSE'],
  ['runtime/clip', 'vendor/clip'],
  ['fonts/NotoSansSC-500.woff', 'assets/fonts/NotoSansSC-500.woff'],
  ['fonts/NotoSansSC-900.woff', 'assets/fonts/NotoSansSC-900.woff'],
  ['fonts/Inter-var.woff', 'assets/fonts/Inter-var.woff'],
  ['fonts/OFL.txt', 'assets/fonts/OFL.txt'],
  ['fonts/LICENSES.md', 'assets/fonts/LICENSES.md'],
];

/** Calculate destination bytes from the same pinned manifest that validates upstream. */
export const pinnedBuiltinFiles = (() => {
  const files = [];
  const destinations = new Set();
  for (const [source, destination] of builtinSources) {
    const matched = upstream.files.filter(file => file.path === source || file.path.startsWith(source + '/'));
    if (!matched.length || (matched.length > 1 && matched.some(file => file.path === source)))
      throw Error('NATIVE_BUILTIN_MANIFEST_INVALID');
    for (const file of matched) {
      const path = destination + file.path.slice(source.length);
      if (destinations.has(path)) throw Error('NATIVE_BUILTIN_MANIFEST_INVALID');
      destinations.add(path);
      files.push({path, byteLength: file.size});
    }
  }
  return files;
})();
