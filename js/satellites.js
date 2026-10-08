// Artificial satellites from CelesTrak's public GP (TLE) catalogue, propagated
// with SGP4 (satellite.js) to the simulation date and drawn as one point cloud
// per group, parented to the Earth mesh so positions are Earth-fixed.
import * as THREE from 'three';

const SATELLITE_JS_URL = 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm';
const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=';
// The FreakinSpace API (worker/): keeps one copy of each group, refreshed on
// a schedule, so visitors don't each count against CelesTrak's limit (one
// download per group per 2 h per network). Empty: straight to CelesTrak
const SPACE_API = 'https://freakinspace-api.freakinspace.workers.dev';
// CelesTrak updates every ~2 h and asks clients not to re-download more often
const CACHE_TTL_MS = 2 * 3600 * 1000;
// A saved copy younger than this is used straight away (refreshed in the
// background once past CACHE_TTL_MS): TLEs stay good for days, and CelesTrak
// can take a minute or more to answer, which left groups (the geostationary
// ring) missing long after the others appeared
const CACHE_USE_MS = 7 * 24 * 3600 * 1000;
// Give up on a download that hangs rather than wait for the browser's timeout
const FETCH_TIMEOUT_MS = 30000;
const EARTH_RADIUS_KM = 6371;
// SGP4 budget per frame; big groups (Starlink ~10k) refresh over several frames
const PROPAGATIONS_PER_FRAME = 1500; // ~6 ms
const ISS_NORAD_ID = '25544'; // drawn separately by iss.js
// SGP4 cost is constant for most orbits, but for resonant deep-space ones
// (geostationary, Molniya: satrec.irez ≠ 0) it numerically integrates from
// the TLE epoch in 12 h steps: ~3 µs a day out, ~430 µs six years out, per
// satellite per call (hundreds of ms a frame). Beyond one orbit from the
// epoch we propagate to the same point in the orbit within the first period
// instead (the inertial orbit repeats) and apply Earth's real rotation for the
// actual date. Checked against full integration over all 567 GEO objects:
// ≤ 60 km at 3 days, ≤ 580 km at 20 days, ~3,000 km median at 90 days (a few
// degrees along the ring; the real TLE is stale by then anyway).

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
// 0..1: show the standard groups (not Starlink, which stays opt-in) at this
// fade, whatever the mode, for the one-time "here are the satellites" moment
// main.js plays near Earth
let preview = 0;

let statusListener = null;
// fn(problems): called with a list of human-readable problems ([] when all OK)
export function setSatelliteStatusListener(fn) { statusListener = fn; }
const problems = new Map(); // group label → message
function reportProblem(label, message) {
    if (message) problems.set(label, message); else problems.delete(label);
    statusListener?.([...problems.values()]);
}

async function downloadTle(key, cacheKey) {
    // Our own copy first; CelesTrak itself if the API isn't there or fails
    // (if the API answers that it hasn't got the group, that's final: it's
    // CelesTrak that's failing, and asking it from here only adds a long
    // wait; CelesTrak only if the API itself can't be reached)
    if (SPACE_API) {
        try { return await fetchTleFrom(`${SPACE_API}/tle/${key}`, cacheKey); }
        catch (err) {
            if (/^HTTP /.test(err.message)) throw err;
            console.warn(`Satellite API: ${key} (${err.message}); trying CelesTrak`);
        }
    }
    return fetchTleFrom(CELESTRAK + key, cacheKey);
}

async function fetchTleFrom(url, cacheKey) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        // 403 = CelesTrak's limit: same group fetched <2 h ago from this IP
        // (e.g. a second browser on the same network)
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), text })); } catch { /* quota */ }
        return text;
    } catch (err) {
        throw err.name === 'AbortError' ? new Error(`no answer after ${FETCH_TIMEOUT_MS / 1000} s`) : err;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTle(key) {
    const cacheKey = 'tle:' + key;
    let cached = null;
    try {
        cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    } catch { /* corrupt cache: refetch */ }
    const age = cached?.text ? Date.now() - cached.t : Infinity;
    if (age < CACHE_USE_MS) {
        // Saved copy now; past CelesTrak's 2 h refresh, fetch a new one for next time
        if (age >= CACHE_TTL_MS) {
            downloadTle(key, cacheKey).catch(err => console.warn(`Background refresh of ${key} failed (${err.message}); keeping the saved copy`));
        }
        return cached.text;
    }
    try {
        return await downloadTle(key, cacheKey);
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

export function setSatellitePreview(alpha) {
    preview = alpha;
    if (alpha > 0) for (const cfg of GROUPS) if (!cfg.optional && !groups.has(cfg.key)) loadGroup(cfg);
    // Download problems from the preview (e.g. CelesTrak's limit on Starlink)
    // shouldn't leave a warning on a setting the user never turned on
    if (alpha === 0) {
        for (const cfg of GROUPS) {
            const byMode = mode !== 'Off' && (!cfg.optional || mode === 'On + Starlink');
            if (!byMode) reportProblem(cfg.label, null);
        }
    }
}
// Groups the current mode wants that are still downloading or being placed
export function satellitesLoading() {
    return GROUPS.some(cfg => {
        const g = groups.get(cfg.key);
        const byMode = mode !== 'Off' && (!cfg.optional || mode === 'On + Starlink');
        return byMode && g && (g.loading || (g.points && !g.fullPass));
    });
}

// The standard groups downloaded and positioned once (failed ones don't count)
// At least one group downloaded and positioned (the intro needn't wait for
// a slow or missing one)
export function satellitesAnyReady() {
    return [...groups.values()].some(g => g.points && g.fullPass);
}

export function satellitesReady() {
    return GROUPS.filter(cfg => !cfg.optional).every(cfg => {
        const g = groups.get(cfg.key);
        return !g || (!g.loading && (!g.points || g.fullPass));
    }) && GROUPS.some(cfg => groups.has(cfg.key));
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
    root.visible = visible && (mode !== 'Off' || preview > 0);
    if (!root.visible || !sat) return;

    const k = (earthMesh.userData.visualRadius || 1) / EARTH_RADIUS_KM;
    const gmst = sat.gstime(simDate);
    const jd = simDate.getTime() / 86400000 + 2440587.5;
    const epochDate = new Date(0);
    let budget = PROPAGATIONS_PER_FRAME;

    for (const g of groups.values()) {
        if (!g.points) continue;
        const byMode = mode !== 'Off' && (!g.cfg.optional || mode === 'On + Starlink');
        const wanted = byMode || (preview > 0 && !g.cfg.optional);
        g.points.visible = wanted && g.fullPass;
        g.points.material.opacity = 0.9 * (byMode ? 1 : preview);
        if (!wanted || budget <= 0) continue;

        const arr = g.points.geometry.attributes.position.array;
        const n = g.satrecs.length;
        const count = Math.min(n, budget);
        budget -= count;
        for (let j = 0; j < count; j++) {
            const i = g.cursor;
            g.cursor = (g.cursor + 1) % n;
            if (g.cursor === 0) g.fullPass = true;
            const rec = g.satrecs[i];
            let when = simDate;
            if (rec.irez) {
                const days = jd - rec.jdsatepoch;
                const period = 2 * Math.PI / rec.no / 1440; // days (no = rad/min)
                if (Math.abs(days) > period) {
                    const phase = ((days % period) + period) % period;
                    epochDate.setTime((rec.jdsatepoch + phase - 2440587.5) * 86400000);
                    when = epochDate;
                }
            }
            const pv = sat.propagate(rec, when);
            if (!pv.position) { arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 0; continue; } // decayed / bad TLE: hide inside Earth
            const e = sat.eciToEcf(pv.position, gmst);
            arr[i * 3] = e.x * k;
            arr[i * 3 + 1] = e.z * k;
            arr[i * 3 + 2] = -e.y * k;
        }
        g.points.geometry.attributes.position.needsUpdate = true;
    }
}
