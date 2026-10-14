const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const THREE = require('three');
const elements = new Map();
const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { hidden: true, handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; } });
    return elements.get(id);
} };
const context = vm.createContext({ THREE, document, Math, Number });
vm.runInContext(fs.readFileSync('js/chicxulub.js', 'utf8')
    .replace(/import .*?;\n/, '').replace(/export /g, ''), context);
const earth = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshBasicMaterial());
earth.userData.visualRadius = 2;
let starts = 0, ends = 0;
const replay = context.createChicxulub({ earth, onStart(dir) { starts++; assert(Math.abs(dir.length() - 1) < 1e-9); }, onEnd() { ends++; } });
const click = id => elements.get(id).handlers.click();
const root = earth.children[0];
assert.equal(root.visible, false);
click('impact-launch');
assert.equal(starts, 1);
assert.equal(root.visible, true);
assert.equal(root.scale.x, 2);
for (const time of [0, 8, 10, 20, 30, 40, 4]) {
    const slider = elements.get('impact-time');
    slider.value = time;
    slider.handlers.input();
    assert.equal(elements.get('impact-stage').textContent, context.impactStage(time));
    root.traverse(object => {
        const positions = object.geometry?.attributes.position?.array;
        if (positions) assert(Array.from(positions).every(Number.isFinite));
    });
    assert.equal(root.children[0].children[0].visible, time < 8);
}
click('impact-reset');
for (let i = 0; i < 410; i++) replay.update(0.1, true);
assert.equal(elements.get('impact-play').textContent, 'Replay');
click('impact-play');
assert.equal(Number(elements.get('impact-time').value), 0);
replay.update(0.1, false);
assert.equal(root.visible, false);
assert.equal(elements.get('impact-panel').hidden, true);
assert.equal(ends, 1);
click('impact-launch');
click('impact-close');
assert.equal(starts, 2);
assert.equal(ends, 2);
console.log('Chicxulub replay controls, geometry, completion and cleanup passed');
