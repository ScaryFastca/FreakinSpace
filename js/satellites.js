// Artificial satellites from CelesTrak's public GP (TLE) catalogue, propagated
// with SGP4 (satellite.js) to the simulation date and drawn as one point cloud
// per group, parented to the Earth mesh so positions are Earth-fixed.
import * as THREE from 'three';

const SATELLITE_JS_URL = 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm';
const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=';
// CelesTrak updates every ~2 h and asks clients not to re-download more often
const CACHE_TTL_MS = 2 * 3600 * 1000;
const EARTH_RADIUS_KM = 6371;
// SGP4 budget per frame; big groups (Starlink ~10k) refresh over several frames
const PROPAGATIONS_PER_FRAME = 1500; // ~6 ms
const ISS_NORAD_ID = '25544'; // drawn separately by iss.js

const GROUPS = [
    { key: 'stations', label: 'Space stations', color: 0xffffff, size: 4 },
    { key: 'gps-ops', label: 'GPS', color: 0x66ff88, size: 3 },
    { key: 'geo', label: 'Geostationary', color: 0xffaa33, size: 2.5 },
    { key: 'starlink', label: 'Starlink', color: 0x88aaff, size: 1.5, optional: true }
];

export const SATELLITE_MODES = ['On', 'On + Starlink', 'Off'];

let sat = null;
const groups = new Map(); // key → { cfg, satrecs, points, cursor, loading }
let root = null;
let mode = 'On';

let statusListener = null;
// fn(problems): called with a list of human-readable problems ([] when all OK)
export function setSatelliteStatusListener(fn) { statusListener = fn; }
const problems = new Map(); // group label → message
function reportProblem(label, message) {
    if (message) problems.set(label, message); else problems.delete(label);
    statusListener?.([...problems.values()]);
}

async function fetchTle(key) {
    const cacheKey = 'tle:' + key;
    let cached = null;
    try {
        cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (cached && Date.now() - cached.t < CACHE_TTL_MS) return cached.text;
    } catch { /* corrupt cache: refetch */ }
    try {
        const res = await fetch(CELESTRAK + key);
        // 403 = CelesTrak's limit: same group fetched <2 h ago from this IP
        // (e.g. a second browser on the same network)
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), text })); } catch { /* quota */ }
        return text;
    } catch (err) {
        // A stale copy (positions drift slowly; TLEs stay usable for days) beats nothing
        if (cached?.text) {
            console.warn(`CelesTrak refused ${key} (${err.message}); using saved copy from ${new Date(cached.t).toLocaleString()}`);
            return cached.text;
        }
        throw err;
    }
}

function parseTle(text) {
    const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
    const out = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
        const [name, l1, l2] = [lines[i].trim(), lines[i + 1], lines[i + 2]];
        if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
        if (l1.substring(2, 7).trim() === ISS_NORAD_ID) continue;
        const rec = sat.twoline2satrec(l1, l2);
        rec.name = name;
        out.push(rec);
    }
    return out;
}

async function loadGroup(cfg) {
    const g = { cfg, satrecs: [], points: null, cursor: 0, loading: true };
    groups.set(cfg.key, g);
    try {
        if (!sat) sat = await import(SATELLITE_JS_URL);
        g.satrecs = parseTle(await fetchTle(cfg.key));
        reportProblem(cfg.label, null);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(g.satrecs.length * 3), 3));
        g.points = new THREE.Points(geo, new THREE.PointsMaterial({
            color: cfg.color, size: cfg.size, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false
        }));
        g.points.name = 'satellites:' + cfg.key;
        g.points.frustumCulled = false; // bounds change as positions stream in
        // Not clickable: Points hit-test within 1 scene unit, so the clouds
        // (GEO ring ~8 units out) would steal hovers/clicks meant for the Moon etc.
        g.points.raycast = () => {};
        g.points.visible = false; // until first full pass fills the buffer
        g.fullPass = false;
        root?.add(g.points);
    } catch (err) {
        console.warn(`Satellites (${cfg.label}) unavailable:`, err);
        reportProblem(cfg.label, /403/.test(err.message)
            ? `${cfg.label}: CelesTrak's download limit was hit (once per 2 hours per network; another browser or device may have just fetched it). Try again later.`
            : `${cfg.label}: couldn't download satellite data (${err.message}). Toggle to retry.`);
        groups.delete(cfg.key); // allow a retry on the next toggle
    }
    g.loading = false;
}

export function setSatelliteMode(next) {
    mode = next;
    for (const cfg of GROUPS) {
        const wanted = mode !== 'Off' && (!cfg.optional || mode === 'On + Starlink');
        if (wanted && !groups.has(cfg.key)) loadGroup(cfg);
    }
}

export function satelliteCounts() {
    return Object.fromEntries([...groups].map(([k, g]) => [k, g.satrecs.length]));
}

// Earth-local coordinates match updateUserMarker(): (lat, lon) →
// (cos·cos, sin lat, −cos·sin lon), i.e. ECEF (x, y, z) → (x, z, −y).
export function updateSatellites(earthMesh, simDate, visible = true) {
    if (!earthMesh) return;
    if (!root) {
        root = new THREE.Group();
        root.name = 'satellites';
        groups.forEach(g => g.points && root.add(g.points));
    }
    if (root.parent !== earthMesh) earthMesh.add(root);
    root.visible = visible && mode !== 'Off';
    if (!root.visible || !sat) return;

    const k = (earthMesh.userData.visualRadius || 1) / EARTH_RADIUS_KM;
    const gmst = sat.gstime(simDate);
    let budget = PROPAGATIONS_PER_FRAME;

    for (const g of groups.values()) {
        if (!g.points) continue;
        const wanted = !g.cfg.optional || mode === 'On + Starlink';
        g.points.visible = wanted && g.fullPass;
        if (!wanted || budget <= 0) continue;

        const arr = g.points.geometry.attributes.position.array;
        const n = g.satrecs.length;
        const count = Math.min(n, budget);
        budget -= count;
        for (let j = 0; j < count; j++) {
            const i = g.cursor;
            g.cursor = (g.cursor + 1) % n;
            if (g.cursor === 0) g.fullPass = true;
            const pv = sat.propagate(g.satrecs[i], simDate);
            if (!pv.position) { arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 0; continue; } // decayed / bad TLE: hide inside Earth
            const e = sat.eciToEcf(pv.position, gmst);
            arr[i * 3] = e.x * k;
            arr[i * 3 + 1] = e.z * k;
            arr[i * 3 + 2] = -e.y * k;
        }
        g.points.geometry.attributes.position.needsUpdate = true;
    }
}
