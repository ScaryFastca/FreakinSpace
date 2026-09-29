// International Space Station: real position from its current TLE (two-line
// element set), propagated with SGP4 via satellite.js to the simulation date.
// Propagating (rather than polling a lat/lon feed) keeps it correct while the
// timeline is scrubbed; TLEs stay accurate to ~km for a few days either side.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const TLE_URL = 'https://api.wheretheiss.at/v1/satellites/25544/tles';
const SATELLITE_JS_URL = 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm';
const TLE_REFRESH_MS = 6 * 3600 * 1000;
const EARTH_RADIUS_KM = 6371;
const TRAIL_MINUTES = 45; // about half an orbit behind the station
const TRAIL_POINTS = 90;
// NASA's public-domain ISS model (nasa/NASA-3D-Resources, "ISS (B)")
const MODEL_URL = 'models/iss.glb';
// The .glb is Draco-compressed; decoder comes from the same three.js release
const DRACO_DECODER_PATH = 'https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/';
const MODEL_SPAN = 0.044; // scene units across the truss, same as the fallback

let sat = null;       // satellite.js module
let satrec = null;
let issGroup = null;
let trailLine = null;
let lastTrailUpdate = 0;
export let issState = null; // { lat, lon, altKm, speedKms } for UI/debug

// Body data for the object list / info card. `distance` is kept at the live
// altitude above Earth's surface so the list's distance column shows it.
export const ISS_DATA = {
    name: 'ISS',
    type: 'satellite',
    radius: 0.055, // km: ~109 m truss span
    color: 0xdddddd, // used by the info card's scale-comparison legend
    distance: 420,
    orbitalPeriod: 0.0645, // days (~92.9 min)
    mass: '~420,000 kg',
    description: 'International Space Station, crewed since November 2000. ' +
        'Position is live, computed from its latest published orbit (TLE).'
};

// The model exists from startup so it can be registered as a body before the
// TLE arrives; it stays hidden until the first position is computed.
export function getISSGroup() {
    if (!issGroup) {
        issGroup = buildModel();
        issGroup.visible = false;
        issGroup.userData.visualRadius = 0.022;
        issGroup.userData.name = 'ISS'; // so clicks on the model resolve to the ISS, not Earth
    }
    return issGroup;
}

function latLonToLocal(latDeg, lonDeg, r, out) {
    // Same convention as updateUserMarker() in main.js
    const lat = THREE.MathUtils.degToRad(latDeg);
    const lon = THREE.MathUtils.degToRad(lonDeg);
    return out.set(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
}

function geodeticAt(date) {
    const pv = sat.propagate(satrec, date);
    if (!pv.position) return null;
    const g = sat.eciToGeodetic(pv.position, sat.gstime(date));
    const v = pv.velocity;
    return {
        lat: sat.degreesLat(g.latitude),
        lon: sat.degreesLong(g.longitude),
        altKm: g.height,
        speedKms: v ? Math.hypot(v.x, v.y, v.z) : 0
    };
}

function buildModel() {
    // Tiny stylised ISS: truss, pressurised modules and four solar wings.
    // Exaggerated ~1000× so it's visible next to a 1.27-unit Earth.
    const group = new THREE.Group();
    group.name = 'ISS';
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5, metalness: 0.4 });
    const panel = new THREE.MeshStandardMaterial({ color: 0xb07a2a, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });

    const fallback = new THREE.Group();
    group.add(fallback);
    loadNasaModel(group, fallback);

    const s = 0.004;
    const truss = new THREE.Mesh(new THREE.BoxGeometry(11 * s, 0.4 * s, 0.4 * s), metal);
    const modules = new THREE.Mesh(new THREE.BoxGeometry(0.8 * s, 0.8 * s, 6 * s), metal);
    fallback.add(truss, modules);
    const wingGeo = new THREE.PlaneGeometry(1.2 * s, 7 * s);
    for (const x of [-4.8, -3.4, 3.4, 4.8]) {
        const wing = new THREE.Mesh(wingGeo, panel);
        wing.position.x = x * s;
        wing.rotation.x = Math.PI / 2; // lie flat in the truss plane
        fallback.add(wing);
    }

    // Always-visible point so it can be found from far away
    const dot = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
        new THREE.PointsMaterial({ color: 0x66ddff, size: 5, sizeAttenuation: false, depthWrite: false })
    );
    dot.raycast = () => {}; // 1-unit Points hit radius would dwarf the station; the model meshes stay clickable
    group.add(dot);
    return group;
}

// Swap the box model for NASA's once it loads. In the .glb the truss runs
// along Z, modules and solar wings along Y, and X is "up"; remap to this
// group's frame (truss X, modules along travel Z, radial up Y).
function loadNasaModel(group, fallback) {
    const loader = new GLTFLoader();
    loader.setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH));
    loader.load(MODEL_URL, gltf => {
        const model = gltf.scene;
        // The file includes a few loose spare-part meshes floating ~20 m away
        const strays = [];
        model.traverse(o => { if (o.isMesh && /^(bendedtru|pCylinder)/.test(o.name)) strays.push(o); });
        strays.forEach(o => o.removeFromParent());

        const holder = new THREE.Group();
        holder.add(model);
        // Rows map model axes to ours: X←Z, Y←X, Z←Y
        model.applyMatrix4(new THREE.Matrix4().set(
            0, 0, 1, 0,
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 0, 1
        ));
        const box = new THREE.Box3().setFromObject(holder);
        const size = box.getSize(new THREE.Vector3());
        const scale = MODEL_SPAN / size.x;
        holder.scale.setScalar(scale);
        holder.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
        holder.traverse(o => {
            if (o.isMesh) o.frustumCulled = false;
            // GLTFLoader copies part names ("polySurfa2"…) into userData.name, which
            // main.js reads as a body name; clear them so picks resolve to 'ISS'
            delete o.userData.name;
        });

        group.remove(fallback);
        group.add(holder);
    }, undefined, err => console.warn('NASA ISS model failed to load; using fallback:', err));
}

async function loadTle() {
    const res = await fetch(TLE_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const tle = await res.json();
    satrec = sat.twoline2satrec(tle.line1, tle.line2);
}

export async function initISS() {
    try {
        sat = await import(SATELLITE_JS_URL);
        await loadTle();
        setInterval(() => loadTle().catch(err => console.warn('ISS TLE refresh failed:', err)), TLE_REFRESH_MS);
    } catch (err) {
        console.warn('ISS tracking unavailable:', err);
        sat = null;
    }
}

const _pos = new THREE.Vector3();
const _ahead = new THREE.Vector3();
const _up = new THREE.Vector3();

// Call each frame after Earth's rotation is set. Children of the Earth mesh
// inherit its day-spin, so a lat/lon placement lands over the right ground point.
export function updateISS(earthMesh, simDate, visible = true) {
    if (!sat || !satrec || !earthMesh) return;
    getISSGroup();
    if (!trailLine) {
        trailLine = new THREE.Line(
            new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3)),
            new THREE.LineBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.5, depthWrite: false })
        );
        trailLine.name = 'ISS trail';
        trailLine.raycast = () => {}; // decoration only; Lines hit-test within 1 unit
        trailLine.layers.set(1); // main.js ORBIT_LAYER: hidden with the Q key
    }
    if (issGroup.parent !== earthMesh) {
        earthMesh.add(issGroup);
        earthMesh.add(trailLine);
    }
    issGroup.visible = trailLine.visible = visible;
    if (!visible) return;

    const now = geodeticAt(simDate);
    if (!now) return;
    issState = now;
    ISS_DATA.distance = now.altKm;
    const earthR = earthMesh.userData.visualRadius || 1;
    const kmToUnits = earthR / EARTH_RADIUS_KM;
    latLonToLocal(now.lat, now.lon, earthR + now.altKm * kmToUnits, _pos);
    issGroup.position.copy(_pos);

    // Orient: truss across-track, modules along the direction of travel, belly to Earth
    const ahead = geodeticAt(new Date(simDate.getTime() + 10000));
    if (ahead) {
        latLonToLocal(ahead.lat, ahead.lon, earthR + ahead.altKm * kmToUnits, _ahead);
        // lookAt works in world space, so radial "up" must be too
        issGroup.up.copy(_pos).applyMatrix4(earthMesh.matrixWorld)
            .sub(earthMesh.getWorldPosition(_up)).normalize();
        issGroup.lookAt(_ahead.applyMatrix4(earthMesh.matrixWorld));
    }

    // Trail is expensive-ish (90 SGP4 calls); refresh at most every 30 s of sim time
    const t = simDate.getTime();
    if (Math.abs(t - lastTrailUpdate) > 30000) {
        lastTrailUpdate = t;
        const arr = trailLine.geometry.attributes.position.array;
        for (let i = 0; i < TRAIL_POINTS; i++) {
            const g = geodeticAt(new Date(t - (TRAIL_MINUTES * 60000 * i) / (TRAIL_POINTS - 1)));
            if (!g) continue;
            latLonToLocal(g.lat, g.lon, earthR + g.altKm * kmToUnits, _pos);
            arr[i * 3] = _pos.x; arr[i * 3 + 1] = _pos.y; arr[i * 3 + 2] = _pos.z;
        }
        trailLine.geometry.attributes.position.needsUpdate = true;
        trailLine.geometry.computeBoundingSphere();
    }
}
