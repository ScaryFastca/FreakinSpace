// Easter egg: keep Mars's night side lit with the cursor sun for a while and
// a round hatch in the ground slides open on a hidden alien base; a little
// fleet of UFOs rises out of the shaft, streaks to Earth and attacks the
// visitor's "You" spot with lasers and rockets, then leaves. The camera rides
// home with them (main.js starts the trip home). Not in the README.
import * as THREE from 'three';
import { makePath, pathPoint, pathTangent, createShipCamera, steerShipCamera, swingVec, orbitBlend, turnToward } from './flight.js?v=344';

const FLEET = 6;
// The base: a hatch (two curved halves) slides open, then the saucers rise
// out of the shaft one after another and gather above it
const HOLE = 0.19;        // hatch radius, in Mars radii
const SHAFT = 0.34;       // shaft depth, in Mars radii
const DOOR_S = 2.4;       // hatch sliding open
const EMERGE_GAP = 0.45;  // between saucers leaving the shaft
const EMERGE_S = 1.4;     // each saucer's climb out to its place above
const GATHER_S = 0.7;     // all out, a pause before they go
const LAUNCH_S = DOOR_S * 0.8 + (FLEET - 1) * EMERGE_GAP + EMERGE_S + GATHER_S;
const CLOSE_S = 1.6;      // the hatch closing again behind them
const TRAVEL_S = 5.6;     // Mars to the city (the camera's trip home takes ~6 s)
const ATTACK_S = 7.5;     // circling and firing
const LEAVE_S = 1.8;      // straight up and gone
const COOLDOWN_MS = 25000;

// Attack geometry in km above the city (the trip home ends 45 km up)
const HOLD_ALT_KM = 17;
const ORBIT_KM = 9;
const UFO_KM = 2.3;            // saucer radius over the city
const TARGET_SPREAD_KM = 5;    // impacts land around the "You" point
const LASER_KM = 0.12;         // beam thickness
const BLAST_KM = 1.6;          // explosion size

let fleet = null;
let lastEnd = -Infinity;

const LIGHT_COLORS = [0x66ffcc, 0xff66cc, 0xffee55, 0x66aaff];
const UP = new THREE.Vector3(0, 1, 0);

function buildUfo() {
    const ufo = new THREE.Group();
    const hull = new THREE.Mesh(
        new THREE.SphereGeometry(1, 28, 12),
        // (a faint glow so they read even on the unlit side)
        new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.35, emissive: 0x334455, emissiveIntensity: 0.6 })
    );
    hull.scale.set(1, 0.24, 1);
    ufo.add(hull);
    const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x88ffee, emissive: 0x2aa88f, emissiveIntensity: 0.9,
            transparent: true, opacity: 0.85, metalness: 0.1, roughness: 0.1 })
    );
    dome.position.y = 0.12;
    ufo.add(dome);
    // Ring of lights round the rim, blinking in a chase
    const lights = [];
    for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        const light = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 8, 6),
            new THREE.MeshBasicMaterial({ color: LIGHT_COLORS[i % LIGHT_COLORS.length], transparent: true })
        );
        light.position.set(Math.cos(a) * 0.97, -0.02, Math.sin(a) * 0.97);
        ufo.add(light);
        lights.push(light);
    }
    ufo.userData.lights = lights;
    return ufo;
}

// Shared geometry for weapons and blasts (never disposed)
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0); // base at origin, length 1 along +Y
const rocketGeo = new THREE.ConeGeometry(0.5, 2.4, 8).translate(0, 1.2, 0);
const flameGeo = new THREE.ConeGeometry(0.45, 2.2, 8).rotateX(Math.PI).translate(0, -1.1, 0);
const blastGeo = new THREE.SphereGeometry(1, 16, 10);
const SHARED_GEO = [beamGeo, rocketGeo, flameGeo, blastGeo];

function noPick(o) { o.traverse(c => { c.raycast = () => {}; }); return o; }

// The hidden base, built round Mars's centre with Mars's radius as 1 and +Y
// up through the hatch. The shaft is inside the planet, so it can't simply be
// drawn: an invisible cap over the hole marks where the hole shows (stencil),
// and the shaft and anything in it are drawn only there, over Mars
const STENCIL = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp };
function inShaft(material) {
    Object.assign(material, STENCIL, { depthTest: false, depthWrite: false });
    return material;
}
function buildBase() {
    const cap = Math.asin(HOLE);                 // the hatch's angular radius
    const rimY = Math.cos(cap);
    const base = new THREE.Group();
    base.name = 'ufoBase';
    // Marks the hole (where it's in view) in the stencil buffer
    const mark = new THREE.Mesh(new THREE.SphereGeometry(1.0015, 48, 6, 0, Math.PI * 2, 0, cap),
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1,
            stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp }));
    mark.renderOrder = 10;
    base.add(mark);
    // Shaft: glowing pad at the bottom, dark walls with rings of light
    const floorY = rimY - SHAFT;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(HOLE, 40).rotateX(-Math.PI / 2),
        inShaft(new THREE.MeshBasicMaterial({ color: 0x0f8f7a })));
    pad.position.y = floorY;
    pad.renderOrder = 10.5;
    base.add(pad);
    const padRing = new THREE.Mesh(new THREE.RingGeometry(HOLE * 0.55, HOLE * 0.62, 40).rotateX(-Math.PI / 2),
        inShaft(new THREE.MeshBasicMaterial({ color: 0x8dffe9 })));
    padRing.position.y = floorY + 0.002;
    padRing.renderOrder = 10.6;
    base.add(padRing);
    const walls = new THREE.Mesh(new THREE.CylinderGeometry(HOLE, HOLE, SHAFT, 40, 1, true),
        inShaft(new THREE.MeshBasicMaterial({ color: 0x1b2730, side: THREE.BackSide })));
    walls.position.y = rimY - SHAFT / 2;
    walls.renderOrder = 11;
    base.add(walls);
    const rings = [];
    for (let k = 1; k <= 3; k++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(HOLE * 0.995, 0.004, 6, 48).rotateX(Math.PI / 2),
            inShaft(new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true })));
        ring.position.y = rimY - SHAFT * k / 4;
        ring.renderOrder = 11.2;
        base.add(ring);
        rings.push(ring);
    }
    // The hatch: two halves of a cap on the surface, each turning away
    // about Mars's centre so it slides off along the ground
    // (a faint glow of its own: it's on the night side)
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b6158, metalness: 0.7, roughness: 0.45,
        emissive: 0x2c241c, emissiveIntensity: 1 });
    const seamMat = new THREE.MeshBasicMaterial({ color: 0xffb340 });
    const halves = [0, Math.PI].map((phi, k) => {
        const half = new THREE.Mesh(new THREE.SphereGeometry(1.003, 32, 8, phi, Math.PI, 0, cap * 1.02), doorMat);
        half.renderOrder = 12;
        // Glowing strip along its straight edge, where the two halves meet
        const seam = new THREE.Mesh(new THREE.TorusGeometry(1.0045, 0.004, 4, 24, cap * 2), seamMat);
        seam.rotation.z = Math.PI / 2 - cap;
        seam.position.z = (k ? -1 : 1) * 0.004;
        half.add(seam);
        base.add(half);
        return half;
    });
    // Seam and rim lights, blinking while it moves
    const rimLights = [];
    for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4),
            new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff5544 : 0xffcc33, transparent: true }));
        const r = Math.sin(cap * 1.06), y = Math.cos(cap * 1.06) * 1.004;
        light.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
        base.add(light);
        rimLights.push(light);
    }
    base.userData = { cap, rimY, floorY, halves, rings, rimLights, shaftParts: [pad, padRing, walls, ...rings] };
    noPick(base);
    return base;
}

// Open (k 0 → 1) or close the hatch
function setHatch(base, k) {
    const { cap, halves } = base.userData;
    const e = k * k * (3 - 2 * k);
    const slide = cap * 2.1 * e;
    // (a little lift first, so it reads as a lid coming loose)
    const lift = 1 + 0.004 * Math.sin(Math.min(k * 3, 1) * Math.PI);
    halves[0].rotation.set(slide, 0, 0);
    halves[1].rotation.set(-slide, 0, 0);
    halves.forEach(h => h.scale.setScalar(lift));
}

// Saucers still in the shaft are drawn through the hole too; once out,
// normally
function setInShaft(ufo, inside) {
    if (ufo.userData.inShaft === inside) return;
    ufo.userData.inShaft = inside;
    ufo.traverse(o => {
        if (!o.isMesh) return;
        o.renderOrder = inside ? 11.5 : 0;
        const m = o.material;
        m.userData.depthTest ??= m.depthTest;
        m.userData.depthWrite ??= m.depthWrite;
        if (inside) inShaft(m);
        else Object.assign(m, { stencilWrite: false, depthTest: m.userData.depthTest, depthWrite: m.userData.depthWrite });
    });
}

// Mars: the world surface point under the cursor on its night side, its centre
// and visual radius. attack: { earthMesh, cityDirLocal, camera, controls,
// takeCamera() (stop other camera moves), userBusy() (mouse held: let go),
// onArrive() (hand the view to the Earth close-up camera) }
export function launchUfos(scene, surfacePoint, center, radius, attack) {
    const now = performance.now();
    if (fleet || now - lastEnd < COOLDOWN_MS) return false;
    const normal = surfacePoint.clone().sub(center).normalize();
    // The base turns with Mars (attack.marsMesh), so it's built in Mars's
    // own frame: centre at Mars's centre, +Y up through the hatch, Mars's
    // radius as 1
    const mars = attack.marsMesh;
    const base = buildBase();
    if (mars) {
        mars.updateWorldMatrix(true, false);
        const ws = mars.getWorldScale(new THREE.Vector3()).x || 1;
        const localUp = mars.worldToLocal(surfacePoint.clone()).normalize();
        base.quaternion.setFromUnitVectors(UP, localUp);
        base.scale.setScalar(radius / ws);
        mars.add(base);
    } else {
        base.position.copy(center);
        base.quaternion.setFromUnitVectors(UP, normal);
        base.scale.setScalar(radius);
        scene.add(base);
    }
    setHatch(base, 0);

    const group = new THREE.Group();
    group.name = 'ufoFleet';
    const sizeMars = radius * 0.11;
    const ufos = [];
    for (let i = 0; i < FLEET; i++) {
        const ufo = noPick(buildUfo());
        const u = ufo.userData;
        // In the base's frame: waiting on the pad, then a place above the
        // hatch once out (a loose ring, a little higher for the later ones)
        const ang = i / FLEET * Math.PI * 2 + Math.random() * 0.5;
        const r = 0.12 + 0.1 * Math.random();
        u.homeLocal = new THREE.Vector3(Math.cos(ang) * r, base.userData.rimY + 0.14 + 0.03 * Math.random(), Math.sin(ang) * r);
        u.padLocal = new THREE.Vector3(0, base.userData.floorY + 0.05, 0);
        u.delay = DOOR_S * 0.8 + i * EMERGE_GAP;
        u.phase = Math.random() * 6.28;
        u.orbit0 = i / FLEET * Math.PI * 2;          // places round the city
        u.orbitKm = ORBIT_KM * (0.7 + 0.6 * Math.random());
        u.altKm = HOLD_ALT_KM * (0.8 + 0.4 * Math.random());
        u.nextLaser = 0.3 + Math.random() * 0.6;
        u.nextRocket = 0.8 + Math.random() * 1.0;
        ufo.scale.setScalar(sizeMars);
        ufo.visible = false;                     // (until the hatch is open)
        setInShaft(ufo, true);
        group.add(ufo);
        ufos.push(ufo);
    }
    scene.add(group);
    fleet = { group, ufos, base, t0: now, normal: normal.clone(), radius, center: center.clone(), sizeMars, attack,
        effects: [], tripStarted: false, lastNow: now };
    return true;
}

// Where the base is this frame (Mars turns and moves): updates fleet.center
// and fleet.normal, and the base's local → world matrix
const _bq = new THREE.Quaternion();
function placeBase() {
    const b = fleet.base;
    b.updateWorldMatrix(true, false);
    b.getWorldPosition(fleet.center);
    fleet.normal.copy(UP).applyQuaternion(b.getWorldQuaternion(_bq)).normalize();
}

// True while the fleet is over the city firing (main.js shakes the "You" label)
export function ufoAttackActive() {
    if (!fleet) return false;
    const t = (performance.now() - fleet.t0) / 1000 - LAUNCH_S - TRAVEL_S;
    return t > 0 && t < ATTACK_S;
}

// City frame in Earth's local space (Earth's mesh is sized to its visual radius)
function cityFrame(attack) {
    const R = attack.earthMesh.userData.visualRadius || 1;
    const n = attack.cityDirLocal.clone().normalize();
    const a = new THREE.Vector3(0, 1, 0).cross(n);
    if (a.lengthSq() < 1e-6) a.set(1, 0, 0).cross(n);
    a.normalize();
    const b = new THREE.Vector3().crossVectors(n, a);
    return { R, km: R / 6371, n, a, b };
}
// Earth-local point `altKm` above the ground, (xKm, yKm) from the city
function cityPoint(f, xKm, yKm, altKm, out = new THREE.Vector3()) {
    return out.copy(f.n).multiplyScalar(f.R + altKm * f.km)
        .addScaledVector(f.a, xKm * f.km).addScaledVector(f.b, yKm * f.km);
}
function groundTarget(f) {
    const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * TARGET_SPREAD_KM;
    return cityPoint(f, Math.cos(ang) * r, Math.sin(ang) * r, 0.2);
}

// Short-lived effects; update(mesh, k) with k going 0 → 1 over `life` seconds
function addEffect(mesh, life, update, onEnd) {
    fleet.group.add(noPick(mesh));
    fleet.effects.push({ mesh, born: performance.now(), life, update, onEnd });
}

function blast(f, earth, localPoint, size, life, color) {
    const m = new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    addEffect(m, life, (mesh, k) => {
        mesh.position.copy(earth.localToWorld(localPoint.clone()));
        mesh.scale.setScalar(Math.max(BLAST_KM * size * f.km * Math.sqrt(k), 1e-9));
        mesh.material.opacity = (1 - k) * 0.95;
        mesh.material.color.setHex(k < 0.3 ? 0xffffcc : color);
    });
}

function fireLaser(f, earth, fromWorld) {
    const target = groundTarget(f);
    const fromLocal = earth.worldToLocal(fromWorld.clone());
    const color = Math.random() < 0.5 ? 0xff3344 : 0x44ff66;
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    addEffect(beam, 0.22, (m, k) => {
        const a = earth.localToWorld(fromLocal.clone()), b = earth.localToWorld(target.clone());
        const len = a.distanceTo(b);
        m.position.copy(a);
        m.quaternion.setFromUnitVectors(UP, b.sub(a).normalize());
        const w = LASER_KM * f.km * (1 - k * 0.5);
        m.scale.set(w, len, w);
        m.material.opacity = 1 - k;
    });
    blast(f, earth, target, 0.45, 0.35, color); // scorch where it lands
}

function fireRocket(f, earth, fromWorld) {
    const target = groundTarget(f);
    const fromLocal = earth.worldToLocal(fromWorld.clone());
    const rocket = new THREE.Group();
    rocket.add(new THREE.Mesh(rocketGeo, new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0x442200, metalness: 0.4, roughness: 0.4 })));
    rocket.add(new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })));
    rocket.scale.setScalar(0.35 * f.km);
    addEffect(rocket, 0.8, (m, k) => {
        const a = earth.localToWorld(fromLocal.clone()), b = earth.localToWorld(target.clone());
        m.position.lerpVectors(a, b, k * k); // accelerating
        m.quaternion.setFromUnitVectors(UP, b.sub(a).normalize());
    }, () => blast(f, earth, target, 1, 0.7, 0xff8833));
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const _c = new THREE.Vector3(), _dir = new THREE.Vector3(), _upv = new THREE.Vector3(),
    _cp = new THREE.Vector3(), _ct = new THREE.Vector3(), _fp = new THREE.Vector3(), _ft = new THREE.Vector3();
const CITY_VIEW_KM = 45; // matches the trip home's landing height

function travelEase(k) {
    k = Math.min(Math.max(k, 0), 1);
    return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

// The fleet centre's path, planned once when the trip starts, in world space.
// Earth moves (orbit and spin) during the trip, so the drift of the landing
// point since then is blended in, reaching all of it on arrival.
function startTravel(f, earth) {
    fleet.tripStarted = true;
    const fromC = new THREE.Vector3(), endC = new THREE.Vector3();
    fleet.ufos.forEach(u => fromC.add(u.position));
    fromC.divideScalar(fleet.ufos.length);
    earth.localToWorld(cityPoint(f, 0, 0, HOLD_ALT_KM, endC));
    const cityUp = f.n.clone().applyQuaternion(_q);
    const earthPos = earth.getWorldPosition(new THREE.Vector3());
    fleet.path = makePath(fromC, endC, {
        // Up off Mars a few of its radii, then for Earth; down onto the city
        // from a bounded height (a share of the whole trip flew the fleet far
        // off the wrong way first when it launched from Mars's far side)
        leaveDir: fleet.normal, arriveDir: cityUp,
        leaveDist: fleet.radius * 4, arriveDist: Math.min(fromC.distanceTo(endC) * 0.15, f.R * 30),
        avoid: [{ center: fleet.center, radius: fleet.radius }, { center: earthPos, radius: f.R }]
    });
    fleet.centreEnd0 = endC.clone();
    fleet.centreEndNow = endC.clone();
    fleet.ufos.forEach(u => { u.userData.offFrom = u.position.clone().sub(fromC); });
    fleet.chasing = !!fleet.attack.camera;
    if (fleet.chasing) {
        fleet.attack.takeCamera?.();
        fleet.ship = createShipCamera(fleet.attack.camera, fleet.attack.controls.target);
        // Where the user was looking from, relative to the fleet: the chase
        // eases in from there instead of snapping to its spot behind the fleet
        fleet.startOffset = fleet.attack.camera.position.clone().sub(fromC);
        fleet.startAim = fleet.attack.controls.target.clone();
        // A steady frame for the whole trip: "behind" and "up" come from the
        // overall Mars → Earth direction, not the curving path (following the
        // path's heading swung the camera round the fleet and upside down)
        fleet.tripDir = endC.clone().sub(fromC).normalize();
        const camUp = fleet.attack.camera.up.clone();
        fleet.tripUp = camUp.addScaledVector(fleet.tripDir, -camUp.dot(fleet.tripDir));
        if (fleet.tripUp.lengthSq() < 1e-8) fleet.tripUp.set(0, 1, 0).addScaledVector(fleet.tripDir, -fleet.tripDir.y);
        fleet.tripUp.normalize();
        // Drone heading: the fleet's direction of travel, allowed to swing
        // round only gradually (it starts up off Mars, may loop back)
        fleet.heading = pathTangent(fleet.path, 0, new THREE.Vector3());
        fleet.prevCentre = fromC.clone();
    }
}

function fleetPathPoint(f, earth, e, out) {
    earth.localToWorld(cityPoint(f, 0, 0, HOLD_ALT_KM, fleet.centreEndNow));
    pathPoint(fleet.path, e, out);
    return out.add(_v.copy(fleet.centreEndNow).sub(fleet.centreEnd0).multiplyScalar(e));
}

// Ship camera behind and a little above the fleet along its heading; over the
// last stretch it settles into the view straight down on the city, north up
const _sub = new THREE.Vector3(), _tan = new THREE.Vector3(), _off = new THREE.Vector3(),
    _aim = new THREE.Vector3(), _earthC = new THREE.Vector3(), _north = new THREE.Vector3();
function chaseCamera(f, earth, k, dt) {
    const { camera, controls } = fleet.attack;
    _sub.set(0, 0, 0);
    fleet.ufos.forEach(u => _sub.add(u.position));
    _sub.divideScalar(fleet.ufos.length);
    const size = fleet.ufos[0].scale.x;
    // Chase like a drone: aim at the fleet, trailing behind its direction of
    // travel; that direction swings round at most 50°/s, so when the fleet
    // curves or loops back the camera glides round it instead of losing it
    const vel = _tan.copy(_sub).sub(fleet.prevCentre);
    fleet.prevCentre.copy(_sub);
    if (vel.lengthSq() > 1e-30) turnToward(fleet.heading, vel.normalize(), THREE.MathUtils.degToRad(35) * dt);
    // Trail mostly level (vertical part flattened): when the fleet climbs
    // steeply, sitting right under it meant looking straight up, where the
    // horizon spins as you pass the vertical
    const trail = _north.copy(fleet.heading);
    trail.y *= 0.35;
    if (trail.lengthSq() < 1e-8) trail.copy(fleet.heading);
    trail.normalize();
    _off.copy(trail).multiplyScalar(-size * 16).addScaledVector(_v.set(0, 1, 0), size * 5);
    _aim.copy(_sub).addScaledVector(fleet.heading, size * 3);
    // Join from the user's own view, swinging round the fleet like a turntable
    // (round the side, never through it or over the top)
    const join = THREE.MathUtils.smoothstep(k, 0, 0.3);
    if (join < 1) {
        orbitBlend(fleet.startOffset, _off.clone(), join, _w.set(0, 1, 0), _off);
        _aim.lerpVectors(fleet.startAim, _aim, join);
    }
    earth.getWorldPosition(_earthC);
    const cityN = _v.copy(f.n).applyQuaternion(_q);
    _north.set(0, 1, 0).applyQuaternion(_q);
    // Arrive: swing round the FLEET (not Earth) from the chase spot to straight
    // above the city, staying as close as the chase was. (Swinging round
    // Earth's centre left the camera thousands of km up while the fleet
    // dropped onto the city: it shrank out of sight, then the camera plunged.)
    // The fleet comes down along the city's up, so the chase spot behind it
    // is above the city already and the swing is short
    const settle = THREE.MathUtils.smoothstep(k, 0.7, 1);
    if (settle > 0) {
        const finalOff = _w.copy(cityN).multiplyScalar((CITY_VIEW_KM - HOLD_ALT_KM) * f.km);
        swingVec(_off.clone(), finalOff, settle, _off);
        // Keep watching the fleet as it drops onto the city; only at the very
        // end look straight down (the fleet is between the camera and the
        // ground by then, so it stays in view)
        _aim.lerp(_earthC, settle * settle * settle);
    }
    steerShipCamera(fleet.ship, camera, controls, {
        subject: _sub, desiredOffset: _off, aimAt: _aim,
        // Horizon level with the scene's up (ecliptic north) while chasing, so
        // long swings can't leave the view upside down; the city's north at
        // the end (looking straight down on it)
        levelUp: settle > 0.5 ? _north : _w.set(0, 1, 0), maxRollDeg: 60,
        bodies: [
            { center: fleet.center, radius: fleet.radius * 1.12 },
            { center: _earthC, radius: f.R * (1 + 20 / 6371) }
        ],
        // Tight springs while arcing in, so the camera stays on the arc
        // The aim is smooth relative to the fleet already, so while simply
        // tracking it the view may turn faster; easing in from the user's view
        // and settling over the city keep the gentle 70°/s
        dt, offsetTime: 0.6 - 0.48 * settle, aimTime: 0.5 - 0.35 * settle,
        // (ramped: switching straight to the faster limit at the end of the
        // ease-in spent the built-up lag in one quick swing)
        maxTurnDeg: 60 + 60 * THREE.MathUtils.smoothstep(k, 0.25, 0.5) * (1 - settle)
    });
}

export function updateUfos() {
    if (!fleet) return;
    const now = performance.now();
    const t = (now - fleet.t0) / 1000;
    const { attack } = fleet;
    const earth = attack?.earthMesh;
    const f = earth ? cityFrame(attack) : null;
    const tTravel = LAUNCH_S, tAttack = tTravel + TRAVEL_S, tLeave = tAttack + ATTACK_S, tEnd = tLeave + LEAVE_S;

    if (earth) { earth.updateWorldMatrix(true, false); earth.getWorldQuaternion(_q); }
    // The base: hatch open, shaft lights, then closed again behind them
    placeBase();
    const bd = fleet.base.userData;
    const open = Math.min(t / DOOR_S, 1);
    const close = Math.min(Math.max((t - tTravel - 0.8) / CLOSE_S, 0), 1);
    setHatch(fleet.base, open * (1 - close));
    const blink = 0.5 + 0.5 * Math.sin(t * 9);
    bd.rimLights.forEach((l, j) => { l.material.opacity = (open < 1 || close > 0) && close < 1 ? (j % 2 ? blink : 1 - blink) : 0.15; });
    bd.rings.forEach((ring, k) => { ring.material.opacity = Math.min(open * 1.5, 1) * (0.55 + 0.45 * Math.sin(t * 4 - k * 1.3)); });
    const dt = Math.min((now - fleet.lastNow) / 1000, 0.1);
    fleet.lastNow = now;
    if (f && t >= tTravel && !fleet.tripStarted) startTravel(f, earth);

    for (const ufo of fleet.ufos) {
        const u = ufo.userData;
        const lt = t - u.delay;
        if (!f || t < tTravel) {
            // Up out of the shaft and over to its place above the hatch,
            // with a nervous wobble once there
            const k = Math.min(Math.max(lt / EMERGE_S, 0), 1);
            ufo.visible = open > 0.35;
            const up = THREE.MathUtils.smoothstep(k, 0, 0.6);            // climb the shaft first
            const out = THREE.MathUtils.smoothstep(k, 0.45, 1);           // then drift to its place
            _v.copy(u.padLocal).lerp(_w.set(0, u.homeLocal.y, 0), up);
            _v.x = u.homeLocal.x * out; _v.z = u.homeLocal.z * out;
            _v.y += 0.004 * Math.sin(t * 18 + u.phase) * out;
            setInShaft(ufo, _v.y < bd.rimY + 0.02);
            ufo.position.copy(_v).applyMatrix4(fleet.base.matrixWorld);
            ufo.quaternion.setFromUnitVectors(UP, fleet.normal);
            ufo.rotateY(lt * 4);
        } else if (t < tAttack) {
            setInShaft(ufo, false);
            ufo.visible = true;
            // Along the fleet's curved path (off Mars, round anything in the
            // way, down onto the city), keeping formation, shrinking to the
            // attack scale on the way, tipping from Mars-flat to city-flat
            const e = travelEase((t - tTravel) / TRAVEL_S);
            const end = earth.localToWorld(cityPoint(f, Math.cos(u.orbit0) * u.orbitKm, Math.sin(u.orbit0) * u.orbitKm, u.altKm, _w));
            fleetPathPoint(f, earth, e, ufo.position);
            ufo.position.addScaledVector(u.offFrom, 1 - e).add(_v.copy(end).sub(fleet.centreEndNow).multiplyScalar(e));
            ufo.scale.setScalar(fleet.sizeMars * Math.pow(UFO_KM * f.km / fleet.sizeMars, e));
            ufo.quaternion.setFromUnitVectors(UP, _v.copy(fleet.normal).lerp(_w.copy(f.n).applyQuaternion(_q), e).normalize());
            ufo.rotateY(lt * 6);
        } else if (t < tLeave) {
            // Circle over the city and open fire
            const at = t - tAttack;
            const ang = u.orbit0 + at * 0.55;
            const bob = Math.sin(at * 3 + u.phase) * 0.6;
            ufo.position.copy(earth.localToWorld(cityPoint(f, Math.cos(ang) * u.orbitKm, Math.sin(ang) * u.orbitKm, u.altKm + bob, _w)));
            ufo.scale.setScalar(UFO_KM * f.km);
            ufo.quaternion.setFromUnitVectors(UP, _v.copy(f.n).applyQuaternion(_q));
            ufo.rotateY(at * 5);
            if (at > u.nextLaser) { fireLaser(f, earth, ufo.position); u.nextLaser = at + 0.35 + Math.random() * 0.6; }
            if (at > u.nextRocket && at < ATTACK_S - 1) { fireRocket(f, earth, ufo.position); u.nextRocket = at + 1.1 + Math.random() * 1.2; }
        } else {
            // Straight up and away, shrinking
            const k = Math.min((t - tLeave) / LEAVE_S, 1);
            const ang = u.orbit0 + ATTACK_S * 0.55;
            ufo.position.copy(earth.localToWorld(cityPoint(f, Math.cos(ang) * u.orbitKm, Math.sin(ang) * u.orbitKm, u.altKm + 600 * k * k, _w)));
            ufo.scale.setScalar(Math.max(UFO_KM * f.km * (1 - k), 1e-9));
            ufo.rotateY(0.3);
        }
        u.lights.forEach((l, j) => { l.material.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 14 - j * 0.9)); });
    }

    // Chase camera on the way to Earth: just behind and above the fleet, closing
    // in as the saucers shrink; over the last stretch it settles into the view
    // straight down on the city (where the trip home would end), then hands over
    if (fleet.chasing && f && t >= tTravel) {
        if (attack.userBusy?.()) fleet.chasing = false; // the user grabbed the camera
        else if (t < tAttack) chaseCamera(f, earth, (t - tTravel) / TRAVEL_S, dt);
        else {
            // Hold the city view (still rate-limited) until the camera has
            // actually come round to it, then hand over: handing over while
            // it was still turning made the Earth camera snap the rest
            chaseCamera(f, earth, 1, dt);
            const ship = fleet.ship;
            const toEarth = earth.getWorldPosition(_v).sub(attack.camera.position).normalize();
            const northUp = _w.set(0, 1, 0).applyQuaternion(_q);
            const settled = ship.fwd.angleTo(toEarth) < 0.04 && ship.up.angleTo(northUp.addScaledVector(ship.fwd, -northUp.dot(ship.fwd)).normalize()) < 0.18;
            if (settled || t > tAttack + 3) { fleet.chasing = false; attack.onArrive?.(); }
        }
    }

    // Lasers, rockets, blasts
    for (let i = fleet.effects.length - 1; i >= 0; i--) {
        const fx = fleet.effects[i];
        const k = Math.min((now - fx.born) / 1000 / fx.life, 1);
        fx.update(fx.mesh, k);
        if (k >= 1) {
            fleet.effects.splice(i, 1);
            fx.mesh.traverse(o => o.material?.dispose());
            fx.mesh.removeFromParent();
            fx.onEnd?.();
        }
    }

    if (t > tEnd && !fleet.effects.length) {
        fleet.group.traverse(o => { if (o.geometry && !SHARED_GEO.includes(o.geometry)) o.geometry.dispose(); o.material?.dispose(); });
        fleet.group.removeFromParent();
        fleet.base.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
        fleet.base.removeFromParent();
        fleet = null;
        lastEnd = performance.now();
    }
}
