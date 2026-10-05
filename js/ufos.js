// Easter egg: light up Mars's night side with the cursor sun and a little
// fleet of UFOs that was hiding there lifts off, streaks to Earth and attacks
// the visitor's "You" spot with lasers and rockets, then leaves. The camera
// rides home with them (main.js starts the trip home). Not in the README.
import * as THREE from 'three';

const FLEET = 6;
const RISE_S = 0.7;       // lift off Mars
const HOVER_S = 0.5;      // a startled pause
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

// Mars: the world surface point under the cursor on its night side, its centre
// and visual radius. attack: { earthMesh, cityDirLocal, camera, controls,
// takeCamera() (stop other camera moves), userBusy() (mouse held: let go),
// onArrive() (hand the view to the Earth close-up camera) }
export function launchUfos(scene, surfacePoint, center, radius, attack) {
    const now = performance.now();
    if (fleet || now - lastEnd < COOLDOWN_MS) return false;
    const normal = surfacePoint.clone().sub(center).normalize();
    const t1 = new THREE.Vector3(0, 1, 0).cross(normal);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0).cross(normal);
    t1.normalize();
    const t2 = new THREE.Vector3().crossVectors(normal, t1);

    const group = new THREE.Group();
    group.name = 'ufoFleet';
    const sizeMars = radius * 0.11;
    const ufos = [];
    for (let i = 0; i < FLEET; i++) {
        const ufo = noPick(buildUfo());
        const ang = i / FLEET * Math.PI * 2 + Math.random() * 0.6;
        const r = radius * (0.06 + 0.12 * Math.random());
        const u = ufo.userData;
        u.home = surfacePoint.clone().addScaledVector(t1, Math.cos(ang) * r).addScaledVector(t2, Math.sin(ang) * r);
        u.delay = Math.random() * 0.35;
        u.phase = Math.random() * 6.28;
        u.orbit0 = i / FLEET * Math.PI * 2;          // places round the city
        u.orbitKm = ORBIT_KM * (0.7 + 0.6 * Math.random());
        u.altKm = HOLD_ALT_KM * (0.8 + 0.4 * Math.random());
        u.nextLaser = 0.3 + Math.random() * 0.6;
        u.nextRocket = 0.8 + Math.random() * 1.0;
        ufo.scale.setScalar(sizeMars);
        ufo.quaternion.setFromUnitVectors(UP, normal);
        ufo.position.copy(u.home);
        group.add(ufo);
        ufos.push(ufo);
    }
    scene.add(group);
    fleet = { group, ufos, t0: now, normal, radius, sizeMars, attack, effects: [], tripStarted: false };
    return true;
}

// True while the fleet is over the city firing (main.js shakes the "You" label)
export function ufoAttackActive() {
    if (!fleet) return false;
    const t = (performance.now() - fleet.t0) / 1000 - RISE_S - HOVER_S - TRAVEL_S;
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

function chaseCamera(f, earth, k) {
    const { camera, controls } = fleet.attack;
    // Fleet centre, heading and current saucer size
    _c.set(0, 0, 0);
    fleet.ufos.forEach(u => _c.add(u.position));
    _c.divideScalar(fleet.ufos.length);
    const end = earth.localToWorld(cityPoint(f, 0, 0, HOLD_ALT_KM, _w));
    _dir.copy(end).sub(_c);
    if (_dir.lengthSq() < 1e-18) _dir.copy(f.n).applyQuaternion(_q).negate();
    _dir.normalize();
    const size = fleet.ufos[0].scale.x;
    // Behind and a little above the fleet (above = world up, made square to the heading)
    _upv.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
    if (_upv.lengthSq() < 1e-6) _upv.set(1, 0, 0);
    _upv.normalize();
    _cp.copy(_c).addScaledVector(_dir, -size * 16).addScaledVector(_upv, size * 5);
    _ct.copy(_c).addScaledVector(_dir, size * 6);
    // Final view: straight down on the city from 45 km, north up
    const cityN = _v.copy(f.n).applyQuaternion(_q);
    earth.getWorldPosition(_ft);
    _fp.copy(_ft).addScaledVector(cityN, f.R + CITY_VIEW_KM * f.km);
    const blend = THREE.MathUtils.smoothstep(k, 0.7, 1);
    // Blend round Earth, not through it: swing the direction from Earth's
    // centre (great circle) and ease the height geometrically, like the spot
    // flights. A straight line from the chase spot to the city view cut
    // through the planet (the camera ended up underground for a moment)
    const R = f.R, minAlt = 20 * f.km;
    const dirA = _cp.clone().sub(_ft), altA = Math.max(dirA.length() - R, minAlt);
    dirA.normalize();
    const dirB = cityN.clone(), altB = CITY_VIEW_KM * f.km;
    const axis = new THREE.Vector3().crossVectors(dirA, dirB);
    const angle = dirA.angleTo(dirB);
    const dir = axis.lengthSq() > 1e-12 ? dirA.applyAxisAngle(axis.normalize(), angle * blend) : dirB;
    const alt = Math.max(altA * Math.pow(altB / altA, blend), minAlt);
    camera.position.copy(_ft).addScaledVector(dir, R + alt);
    controls.target.lerpVectors(_ct, _ft, blend);
    camera.up.set(0, 1, 0).lerp(_upv.set(0, 1, 0).applyQuaternion(_q), blend).normalize();
    camera.lookAt(controls.target);
}
export function updateUfos() {
    if (!fleet) return;
    const now = performance.now();
    const t = (now - fleet.t0) / 1000;
    const { attack } = fleet;
    const earth = attack?.earthMesh;
    const f = earth ? cityFrame(attack) : null;
    const tTravel = RISE_S + HOVER_S, tAttack = tTravel + TRAVEL_S, tLeave = tAttack + ATTACK_S, tEnd = tLeave + LEAVE_S;

    if (f && t >= tTravel && !fleet.tripStarted) {
        fleet.tripStarted = true;
        fleet.chasing = !!attack.camera;
        if (fleet.chasing) attack.takeCamera?.();
        fleet.ufos.forEach(u => { u.userData.travelFrom = u.position.clone(); });
    }
    if (earth) { earth.updateWorldMatrix(true, false); earth.getWorldQuaternion(_q); }

    for (const ufo of fleet.ufos) {
        const u = ufo.userData;
        const lt = t - u.delay;
        if (!f || t < tTravel) {
            // Rise off Mars with a nervous wobble
            const rise = Math.min(Math.max(lt, 0) / RISE_S, 1);
            const eased = rise * rise * (3 - 2 * rise);
            ufo.position.copy(u.home).addScaledVector(fleet.normal, fleet.radius * (0.16 * eased + 0.006 * Math.sin(lt * 18 + u.phase)));
            ufo.rotateY(0.25);
        } else if (t < tAttack) {
            // Streak to the city, shrinking to the attack scale on the way
            const k = (t - tTravel) / TRAVEL_S;
            const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
            const end = earth.localToWorld(cityPoint(f, Math.cos(u.orbit0) * u.orbitKm, Math.sin(u.orbit0) * u.orbitKm, u.altKm, _w));
            ufo.position.lerpVectors(u.travelFrom, end, e);
            ufo.scale.setScalar(fleet.sizeMars * Math.pow(UFO_KM * f.km / fleet.sizeMars, e));
            ufo.quaternion.setFromUnitVectors(UP, _v.copy(f.n).applyQuaternion(_q));
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
        else if (t < tAttack) chaseCamera(f, earth, (t - tTravel) / TRAVEL_S);
        else { fleet.chasing = false; attack.onArrive?.(); }
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
        fleet = null;
        lastEnd = performance.now();
    }
}
