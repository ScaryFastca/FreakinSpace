// Run with: node tests/custom-orbits.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const THREE = require('three');
const source = fs.readFileSync('js/main.js', 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const listeners = {};
let captured = false, clicks = 0, saved = null;
const canvas = {
    style: {}, addEventListener(type, handler) { listeners[type] = handler; },
    setPointerCapture() { captured = true; }, hasPointerCapture() { return captured; },
    releasePointerCapture() { captured = false; }
};
const scene = new THREE.Scene();
const group = new THREE.Group(); scene.add(group);
const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial()); group.add(mesh);
const body = { mesh, orbitRadius: 5, data: { name: 'Earth', type: 'planet', orbitalPeriod: 365.25 }, orbitGroup: group };
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(0, 12, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
const elements = new Map();
const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); } };
const context = vm.createContext({
    THREE, Math, Number, console, scene, camera, document,
    window: { innerWidth: 800, innerHeight: 800, addEventListener() {} },
    renderer: { domElement: canvas }, controls: { enabled: true },
    celestialBodies: new Map([['Earth', body]]),
    customOrbitAngles: { Earth: 0 }, customOrbitDrag: null,
    orbitalMode: 'custom', viewMode: 'map', activeTapPointerId: null,
    currentFocusedBody: 'Earth', flyToAnimation: {}, focusRetarget: {}, earthSpotFlight: {},
    isCameraLocked: true, cameraAngleLock: true,
    MOUSE_BODY_HIT_RADIUS_PX: 10, TOUCH_BODY_HIT_RADIUS_PX: 24, TOUCH_TAP_MOVE_TOLERANCE_PX: 10,
    isCoarsePointerEvent: e => e.pointerType === 'touch',
    findTinyBodyInFront: () => 'Earth', getBodyNameFromIntersection: () => 'Earth', findNearestBodyOnScreen: () => 'Earth',
    hideTooltip() {}, onClick() { clicks++; }, saveCustomOrbits() { saved = { ...context.customOrbitAngles }; },
    orbitOffset(a, r, out) { return out.set(Math.cos(a) * r, 0, -Math.sin(a) * r); },
    ECLIPTIC_MOONS: new Set(['Moon']), MOON_TIDAL_OFFSET: {}, _moonQ: new THREE.Quaternion(), _moonYawQ: new THREE.Quaternion(), _yAxis: new THREE.Vector3(0, 1, 0),
    poleFrame: () => false, bodySpinAngle: () => 0,
    simDate: new Date(), alignedStartDate: new Date(), MS_PER_DAY: 86400000,
});
vm.runInContext(section('function placeMoon(', '// Returns the Moon'), context);
vm.runInContext(section('function calculateAlignedOrbitAngle(', 'function findParentBodyData('), context);
vm.runInContext(section('function customOrbitFrame(', 'function toggleOrbitalMode('), context);
context.setupCustomOrbitDrag(canvas);
function event(x, y, extra = {}) { return { clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, stopImmediatePropagation() {}, preventDefault() {}, ...extra }; }
function screen(angle) {
    const p = new THREE.Vector3(Math.cos(angle) * body.orbitRadius, 0, -Math.sin(angle) * body.orbitRadius).project(camera);
    return [(p.x + 1) * 400, (1 - p.y) * 400];
}
function drag(angle, end = 'pointerup', extra = {}) {
    listeners.pointerdown(event(...screen(context.customOrbitAngles.Earth), extra));
    listeners.pointermove(event(...screen(angle), extra));
    listeners[end](event(...screen(angle), extra));
}
mesh.position.set(5, 0, 0); scene.updateMatrixWorld(true);
const originalPosition = mesh.position.clone(), originalQuaternion = mesh.quaternion.clone();
const frame = context.customOrbitFrame(body);
assert(frame.center.length() < 1e-10);
assert(Math.abs(frame.x.length() - 5) < 1e-10);
assert(mesh.position.equals(originalPosition)); assert(mesh.quaternion.equals(originalQuaternion));
drag(Math.PI / 2);
assert(Math.abs(context.customOrbitAngles.Earth - Math.PI / 2) < 0.002);
assert.equal(context.controls.enabled, true); assert.equal(captured, false); assert.equal(clicks, 0);
assert.equal(context.currentFocusedBody, null); assert.equal(saved.Earth, context.customOrbitAngles.Earth);
const angle = context.customOrbitAngles.Earth;
drag(Math.PI, 'pointercancel'); assert.equal(context.customOrbitAngles.Earth, angle);
listeners.pointerdown(event(...screen(angle))); listeners.pointerup(event(...screen(angle))); assert.equal(clicks, 1);
body.orbitRadius = 3;
drag(-Math.PI / 3, 'pointerup', { pointerType: 'touch' });
assert(Math.abs(context.customOrbitAngles.Earth + Math.PI / 3) < 0.002);
const fixed = context.calculateAlignedOrbitAngle(body.data);
context.simDate = new Date(0); assert.equal(context.calculateAlignedOrbitAngle(body.data), fixed);
context.orbitalMode = 'realistic'; listeners.pointerdown(event(100, 100)); assert.equal(context.customOrbitDrag, null);
context.orbitalMode = 'custom'; context.viewMode = 'sizeCompare'; listeners.pointerdown(event(100, 100)); assert.equal(context.customOrbitDrag, null);
// A moon's sampled circle must follow the tilted and translated parent frame.
const parent = new THREE.Group(); parent.userData.name = 'Saturn'; parent.position.set(8, 2, -1); parent.rotation.z = 0.5; scene.add(parent);
const moonMesh = new THREE.Object3D(); parent.add(moonMesh);
const moon = { mesh: moonMesh, parent, data: { name: 'Titan' }, orbitRadius: 2 };
scene.updateMatrixWorld(true);
const moonFrame = context.customOrbitFrame(moon);
for (const a of [0, 0.7, Math.PI, 5]) {
    context.placeMoon(moon, a, 2);
    const actual = parent.localToWorld(moonMesh.position.clone());
    const sampled = moonFrame.center.clone().addScaledVector(moonFrame.x, Math.cos(a)).addScaledVector(moonFrame.y, Math.sin(a));
    assert(actual.distanceTo(sampled) < 1e-10);
}
console.log('Custom orbit checks passed: drag, touch, cancel, tap, scale, fixed positions, mode gating, tilted moons.');
// Check the actual mode switch preserves edits and initializes missing bodies.
Object.assign(context, {
    viewMode: 'map', orbitalMode: 'aligned', solarSystem: { children: [body.data] },
    J2000: new Date('2000-01-01T12:00:00Z'), DEFAULT_SIM_SPS: 1,
    capitalize: s => s[0].toUpperCase() + s.slice(1),
    setSimRateSps() {}, syncTimelineUI() {}, updateRealisticPositions() {}, focusOnBody() {},
});
vm.runInContext(section('function toggleOrbitalMode(', 'function showTimelinePanel('), context);
const storedAngle = context.customOrbitAngles.Earth;
context.toggleOrbitalMode(); assert.equal(context.orbitalMode, 'realistic');
context.toggleOrbitalMode(); assert.equal(context.orbitalMode, 'custom');
assert.equal(context.customOrbitAngles.Earth, storedAngle); assert.equal(context.simPaused, true);
context.toggleOrbitalMode(); assert.equal(context.orbitalMode, 'aligned');
context.toggleOrbitalMode(); context.toggleOrbitalMode();
assert.equal(context.customOrbitAngles.Earth, storedAngle);
console.log('Mode cycle preserves saved arrangements.');
