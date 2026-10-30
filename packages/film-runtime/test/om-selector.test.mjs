import assert from 'node:assert/strict';
import test from 'node:test';
import {createOM} from '../src/om.js';

// The browser supplies real DOMMatrix and layout; this fixture isolates selector ownership.
test('OM cameras prefer the scene with duplicate template IDs and preserve document fallback', () => {
  const previous = {document: globalThis.document, getComputedStyle: globalThis.getComputedStyle,
    DOMMatrix: globalThis.DOMMatrix, DOMPoint: globalThis.DOMPoint, window: globalThis.window, gsap: globalThis.gsap};
  class Matrix {
    constructor() { this.x = 0; this.y = 0; }
    translate(x, y) { this.x += x; this.y += y; return this; }
    multiply(other) { this.x += other.x; this.y += other.y; return this; }
    transformPoint(point) { return {x: point.x + this.x, y: point.y + this.y, z: 0}; }
  }
  class Point { constructor(x, y, z) { Object.assign(this, {x, y, z}); } }
  const makeWorld = () => ({style: {}, parentElement: {style: {}}, offsetWidth: 1000,
    getBoundingClientRect: () => ({left: 0, top: 0, width: 1000, height: 500}),
    querySelector: () => null});
  const local = makeWorld(), remote = makeWorld();
  const localTarget = {offsetLeft: 20, offsetTop: 30, offsetWidth: 100, offsetHeight: 80,
    offsetParent: local, getBoundingClientRect: () => ({left: 20, top: 30, width: 100, height: 80})};
  const remoteTarget = {offsetLeft: 400, offsetTop: 200, offsetWidth: 100, offsetHeight: 80,
    offsetParent: remote, getBoundingClientRect: () => ({left: 400, top: 200, width: 100, height: 80})};
  const root = {querySelector: selector => ({'#world': local, '#panel': localTarget})[selector] ?? null};
  globalThis.document = {querySelector: selector => ({'#world': remote, '#panel': remoteTarget, '#legacy': remote})[selector] ?? null};
  globalThis.getComputedStyle = () => ({position: 'absolute', transform: 'none'});
  globalThis.DOMMatrix = Matrix; globalThis.DOMPoint = Point;
  globalThis.window = {gsap: {parseEase: () => x => x}}; globalThis.gsap = globalThis.window.gsap;
  try {
    const om = createOM({root, target: {width: 1000, height: 500}}, []);
    const camera = om.camera('#world').set({fit: '#panel', pad: 10});
    assert.equal(camera.zoom(), 5);
    assert.match(local.style.transform, /^translate\(150px, -100px\) scale\(5\)$/);
    assert.equal(remote.style.transform, undefined);
    const space = om.space('#world').set({target: '#panel'});
    assert.deepEqual(space.pose(0).target, [70, 70, 0]);
    assert.match(local.style.transform, /^matrix3d\(/);
    assert.equal(remote.style.transform, undefined);
    const other = {}, timeline = {children: [other], killed: false,
      fromTo(target, from, to) { this.children.push({target, from, to}); return this; },
      killTweensOf(target) { this.children = this.children.filter(item => item.target !== target); },
      kill() { this.killed = true; }};
    space.to(timeline, 0, {yaw: 15, duration: 1}).to(timeline, 1, {yaw: -15, duration: 1});
    assert.equal(timeline.killed, false);
    assert.equal(timeline.children.length, 2);
    assert.equal(timeline.children[0], other);
    assert.equal(timeline.children[1].to.duration, 2);
    assert.equal(space.pose(.5).yaw, 7.5);
    assert.equal(space.pose(1.5).yaw, 0);
    om.camera('#legacy');
    assert.match(remote.style.transform, /^translate\(/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
