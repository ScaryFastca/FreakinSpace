// Small bodies: dwarf planets, an asteroid, a comet, interstellar objects and
// outbound spacecraft, placed at their real positions for the simulation date.
//
// Orbits come from published osculating elements (JPL). Ellipses are solved
// with Kepler's equation and the interstellar objects' open (hyperbolic)
// paths with its hyperbolic form, so positions are good to a fraction of a
// degree at this map's scale for decades either side of today. The outbound
// spacecraft now coast in near-straight lines, so they use a direction on the
// sky plus a distance growing at a known rate, valid after their last
// planetary flyby.
//
// Distances: main.js supplies a mapper from true distance (AU) to scene units
// that follows the planets' current orbit radii (so Ceres sits between Mars
// and Jupiter at any Scale setting); directions are true.
import * as THREE from 'three';

const K = 0.01720209895;               // Gaussian gravitational constant (rad/day, AU^1.5)
const MS_PER_DAY = 86400000;
const toJD = iso => Date.parse(iso) / MS_PER_DAY + 2440587.5;
const J2000_JD = 2451545.0;
const DEG = Math.PI / 180;
const OBLIQUITY = 23.4393 * DEG;

export const SMALL_BODY_GROUPS = {
    dwarf: 'Dwarf planets',
    asteroid: 'Asteroids',
    comet: 'Comets',
    interstellar: 'Interstellar objects',
    spacecraft: 'Spacecraft'
};

// a (AU), e, i/node/peri (deg, ecliptic J2000), tp = time of perihelion.
// Hyperbolic orbits give q (perihelion distance) instead of a.
const BODIES = [
    { name: 'Pluto', group: 'dwarf', radiusKm: 1188, color: 0xd8b48a, mass: '1.30 × 10²² kg',
      orbit: { a: 39.482, e: 0.2488, i: 17.14, node: 110.30, peri: 113.76, tp: '1989-09-05' },
      description: 'Dwarf planet in the Kuiper Belt. Its tilted, stretched orbit brings it closer to the Sun than Neptune for 20 years of each 248-year lap. Visited by New Horizons in 2015.' },
    { name: 'Eris', group: 'dwarf', radiusKm: 1163, color: 0xe8e8e8, mass: '1.66 × 10²² kg',
      orbit: { a: 67.86, e: 0.4407, i: 44.04, node: 35.95, peri: 151.64, tp: '2257-06-01' },
      description: 'The most massive known dwarf planet, now near the far end of its 559-year orbit, about 96 AU from the Sun. Its discovery in 2005 led to Pluto being reclassified.' },
    { name: 'Makemake', group: 'dwarf', radiusKm: 715, color: 0xc98c6a, mass: '≈3.1 × 10²¹ kg',
      orbit: { a: 45.43, e: 0.161, i: 28.98, node: 79.62, peri: 294.83, tp: '1881-01-01' },
      description: 'Reddish Kuiper Belt dwarf planet with one small moon. Takes about 306 years to orbit the Sun.' },
    { name: 'Haumea', group: 'dwarf', radiusKm: 816, color: 0xdfe6ee, mass: '4.0 × 10²¹ kg',
      orbit: { a: 43.12, e: 0.195, i: 28.21, node: 121.79, peri: 239.04, tp: '2133-01-01' },
      description: 'Egg-shaped dwarf planet that spins once every 4 hours, with a ring and two moons.' },
    { name: 'Ceres', group: 'dwarf', radiusKm: 470, color: 0x9a948c, mass: '9.4 × 10²⁰ kg',
      orbit: { a: 2.767, e: 0.0785, i: 10.59, node: 80.27, peri: 73.60, tp: '2022-12-07' },
      description: 'The largest object in the asteroid belt and the only dwarf planet in the inner Solar System. Mapped up close by NASA\'s Dawn spacecraft.' },
    { name: 'Apophis', group: 'asteroid', radiusKm: 0.17, color: 0xb09a80,
      // time of perihelion chosen so it crosses Earth's orbit at Earth's spot
      // on 2029-04-13 21:46 UTC (its famous close pass)
      orbit: { a: 0.9224, e: 0.1911, i: 3.339, node: 204.43, peri: 126.4, tpJD: 2462336.787 },
      description: 'Near-Earth asteroid about 340 m across. On 13 April 2029 it passes about 32,000 km above Earth, closer than the geostationary satellites, and will be visible to the naked eye.' },
    { name: 'Halley\'s Comet', group: 'comet', radiusKm: 5.5, color: 0xa9c4e0, comet: true,
      orbit: { a: 17.83, e: 0.96714, i: 162.26, node: 58.42, peri: 111.33, tp: '1986-02-09T12:00Z' },
      description: 'The best-known periodic comet, returning about every 76 years on a backwards (retrograde) orbit. Last seen in 1986, it turned for home in late 2023 and will be back in 2061.' },
    { name: 'ʻOumuamua', group: 'interstellar', radiusKm: 0.1, color: 0xff9a66,
      orbit: { q: 0.25534, e: 1.20113, i: 122.74, node: 24.60, peri: 241.81, tp: '2017-09-09T12:10Z' },
      description: 'The first object known to come from another star (2017). Long and thin or flat, it sped up slightly as it left, most likely from gas escaping its surface.' },
    { name: '2I/Borisov', group: 'interstellar', radiusKm: 0.5, color: 0x88ddff, comet: true,
      orbit: { q: 2.00652, e: 3.3565, i: 44.05, node: 308.15, peri: 209.12, tp: '2019-12-08T13:00Z' },
      description: 'The first known interstellar comet, discovered by amateur astronomer Gennadiy Borisov in 2019.' },
    { name: '3I/ATLAS', group: 'interstellar', radiusKm: 1, color: 0x9dff9d, comet: true,
      orbit: { q: 1.3565, e: 6.139, i: 175.11, node: 322.16, peri: 128.01, tp: '2025-10-29T11:30Z' },
      description: 'The third known interstellar visitor, a comet found in July 2025, on a very fast, open path through the inner Solar System.' },
    { name: 'Voyager 1', group: 'spacecraft', radiusKm: 0.002, color: 0xffd27a,
      coast: { ra: 258.3, dec: 12.0, au: 164.8, at: '2025-01-01', auPerYear: 3.573, from: '1981-01-01' },
      description: 'Launched 1977, the most distant human-made object, leaving at about 17 km/s. Its nuclear power is running down; contact is expected to end around 2030.' },
    { name: 'Voyager 2', group: 'spacecraft', radiusKm: 0.002, color: 0xffd27a,
      coast: { ra: 301.3, dec: -58.4, au: 138.0, at: '2025-01-01', auPerYear: 3.25, from: '1990-01-01' },
      description: 'The only spacecraft to visit Uranus (1986) and Neptune (1989). Now in interstellar space, with power expected to last until about 2030.' },
    { name: 'New Horizons', group: 'spacecraft', radiusKm: 0.002, color: 0xffd27a,
      coast: { ra: 290.8, dec: -20.4, au: 60.8, at: '2025-01-01', auPerYear: 2.91, from: '2019-06-01' },
      description: 'Flew past Pluto in 2015 and the Kuiper Belt object Arrokoth in 2019, and is now heading out of the Solar System.' }
];

// ── Orbit maths ─────────────────────────────────────────────────────────
function solveKepler(M, e) {
    let E = e < 0.8 ? M : Math.PI;
    for (let k = 0; k < 30; k++) {
        const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        E -= d;
        if (Math.abs(d) < 1e-12) break;
    }
    return E;
}

function solveHyperbolic(M, e) {
    let H = Math.asinh(M / e);
    for (let k = 0; k < 50; k++) {
        const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
        H -= d;
        if (Math.abs(d) < 1e-12) break;
    }
    return H;
}

// Ecliptic (x, y, z) in AU → app frame (ecliptic plane = XZ, +Y = north),
// same convention as the planets and the star sky
const eclipticToApp = (x, y, z, out) => out.set(x, z, -y);

function orbitPointAtAnomaly(o, nu, r, out) {
    const i = o.i * DEG, node = o.node * DEG, u = (o.peri + 0) * DEG + nu;
    const cu = Math.cos(u), su = Math.sin(u), cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(i), si = Math.sin(i);
    return eclipticToApp(r * (cn * cu - sn * su * ci), r * (sn * cu + cn * su * ci), r * su * si, out);
}

function orbitalPositionAU(o, jd, out) {
    const tp = o.tpJD ?? toJD(o.tp);
    if (o.e < 1) {
        const n = K / Math.pow(o.a, 1.5);
        const E = solveKepler(((n * (jd - tp)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), o.e);
        const nu = 2 * Math.atan2(Math.sqrt(1 + o.e) * Math.sin(E / 2), Math.sqrt(1 - o.e) * Math.cos(E / 2));
        return orbitPointAtAnomaly(o, nu, o.a * (1 - o.e * Math.cos(E)), out);
    }
    const a = o.q / (1 - o.e); // negative for a hyperbola
    const n = K / Math.pow(-a, 1.5);
    const H = solveHyperbolic(n * (jd - tp), o.e);
    const nu = 2 * Math.atan(Math.sqrt((o.e + 1) / (o.e - 1)) * Math.tanh(H / 2));
    return orbitPointAtAnomaly(o, nu, a * (1 - o.e * Math.cosh(H)), out);
}

function skyDirection(raDeg, decDeg, out) {
    const ra = raDeg * DEG, dec = decDeg * DEG;
    const x = Math.cos(dec) * Math.cos(ra), y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
    const ye = y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY);
    const ze = -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
    return eclipticToApp(x, ye, ze, out).normalize();
}

// Sample points (AU, app frame) along an orbit for its drawn path
function orbitPathAU(o) {
    const pts = [];
    if (o.e < 1) {
        const N = 360;
        for (let k = 0; k <= N; k++) {
            const E = (k / N) * 2 * Math.PI; // uniform in eccentric anomaly: dense near perihelion
            const nu = 2 * Math.atan2(Math.sqrt(1 + o.e) * Math.sin(E / 2), Math.sqrt(1 - o.e) * Math.cos(E / 2));
            pts.push(orbitPointAtAnomaly(o, nu, o.a * (1 - o.e * Math.cos(E)), new THREE.Vector3()));
        }
    } else {
        const a = o.q / (1 - o.e);
        const rMax = 40; // draw the pass through the planetary region
        const Hmax = Math.acosh((1 - rMax / a) / o.e);
        const N = 200;
        for (let k = 0; k <= N; k++) {
            const H = -Hmax + (2 * Hmax * k) / N;
            const nu = 2 * Math.atan(Math.sqrt((o.e + 1) / (o.e - 1)) * Math.tanh(H / 2));
            pts.push(orbitPointAtAnomaly(o, nu, a * (1 - o.e * Math.cosh(H)), new THREE.Vector3()));
        }
    }
    return pts;
}

// ── Comet tails ─────────────────────────────────────────────────────────
// A comet wakes up as it nears the Sun: sunlight boils ice off the nucleus
// into a glowing coma, and two tails stream away from it. The gas (ion) tail
// is pushed straight out by the solar wind, thin and bluish; the dust tail
// is broader and yellowish, and curves back along the orbit because the
// dust lags behind. Both are built in AU around the comet's real position
// and mapped into the scene like everything else, so they follow the Scale
// setting. Lengths are a stylised version of the real thing (Halley's tails
// reached ~0.2–0.3 AU in 1986): active inside ~4.5 AU, longest near the Sun.
const TAIL_SEGMENTS = 32;
const NUCLEUS_GREY = new THREE.Color(0x4a4744);
const TAIL_VERTEX = /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute float aT; attribute float aS;
    varying float vT; varying float vS;
    void main() {
        vT = aT; vS = aS;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
    }`;
const TAIL_FRAGMENT = /* glsl */`
    #include <logdepthbuf_pars_fragment>
    uniform vec3 uColor; uniform float uIntensity;
    varying float vT; varying float vS;
    void main() {
        #include <logdepthbuf_fragment>
        float along = pow(1.0 - vT, 1.4) * (0.35 + 0.65 * smoothstep(0.0, 0.06, vT));
        float across = 1.0 - smoothstep(0.25, 1.0, abs(vS));
        float a = along * across * uIntensity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
    }`;
let comaTexture = null;
function getComaTexture() {
    if (comaTexture) return comaTexture;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(220,240,255,0.85)');
    gr.addColorStop(0.4, 'rgba(150,200,255,0.25)'); gr.addColorStop(1, 'rgba(120,180,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    comaTexture = new THREE.CanvasTexture(c);
    return comaTexture;
}
function makeTailStrip(color) {
    const n = TAIL_SEGMENTS;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const t = new Float32Array(n * 2), sd = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { t[i * 2] = t[i * 2 + 1] = i / (n - 1); sd[i * 2] = -1; sd[i * 2 + 1] = 1; }
    geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    geo.setAttribute('aS', new THREE.BufferAttribute(sd, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0 } },
        vertexShader: TAIL_VERTEX, fragmentShader: TAIL_FRAGMENT,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    }));
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    return mesh;
}
function makeCometTails(group) {
    const coma = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getComaTexture(), color: 0xd8ecff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    coma.raycast = () => {};
    const ion = makeTailStrip(0x7fb4ff), dust = makeTailStrip(0xffe7bf);
    group.add(dust, ion, coma);
    return { coma, ion, dust };
}
const _tailP = new THREE.Vector3(), _tailQ = new THREE.Vector3(), _tailPrev = new THREE.Vector3();
const _tailTan = new THREE.Vector3(), _tailToCam = new THREE.Vector3(), _tailSide = new THREE.Vector3();
const _vel = new THREE.Vector3(), _anti = new THREE.Vector3(), _camLocal = new THREE.Vector3();
// Lay one tail strip along the AU-space curve point(t) (t 0..1), facing the camera
function layTail(strip, group, mapAU, pointAt, widthAt) {
    const n = TAIL_SEGMENTS, arr = strip.geometry.attributes.position.array;
    const pts = [];
    for (let i = 0; i < n; i++) {
        pointAt(i / (n - 1), _tailP);
        const r = _tailP.length();
        pts.push(_tailP.clone().multiplyScalar(mapAU(r) / r).sub(group.position));   // group-local
    }
    const length = pts[n - 1].distanceTo(pts[0]);
    for (let i = 0; i < n; i++) {
        const q = pts[i];
        _tailTan.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
        _tailSide.crossVectors(_tailTan, _tailToCam.subVectors(_camLocal, q)).normalize()
            .multiplyScalar(widthAt(i / (n - 1)) * length);
        arr.set([q.x - _tailSide.x, q.y - _tailSide.y, q.z - _tailSide.z, q.x + _tailSide.x, q.y + _tailSide.y, q.z + _tailSide.z], i * 6);
    }
    strip.geometry.attributes.position.needsUpdate = true;
    return length;
}
function updateCometTails(e, jd, rAU, mapAU, camera) {
    const tails = e.tails, o = e.data.orbit;
    const activity = Math.pow(THREE.MathUtils.clamp((4.5 - rAU) / 3.5, 0, 1), 1.5);
    const on = activity > 0.01 && camera;
    tails.coma.visible = tails.ion.visible = tails.dust.visible = !!on;
    e.group.userData.previewRadius = undefined;
    // The nucleus is dark and tiny next to its coma: while active, shrink the
    // marker sphere and darken it from its map colour to sooty grey
    e.nucleusColor ??= e.sphere.material.color.clone();
    e.sphere.material.color.copy(e.nucleusColor).lerp(NUCLEUS_GREY, on ? activity : 0);
    if (!trueSize) e.sphere.scale.setScalar(1 - 0.6 * (on ? activity : 0));
    if (!on) return;
    _camLocal.copy(camera.position).sub(e.group.position);
    _anti.copy(_pos).normalize();                                        // straight away from the Sun
    orbitalPositionAU(o, jd + 0.5, _vel).sub(_pos).normalize();          // direction of travel
    const ionLen = 0.3 * activity / Math.sqrt(Math.max(rAU, 0.4));      // AU
    const dustLen = ionLen * 0.65;
    const head = _pos.clone();
    const ionScene = layTail(tails.ion, e.group, mapAU,
        (t, out) => out.copy(head).addScaledVector(_anti, ionLen * t),
        t => 0.03 * (0.2 + 0.8 * Math.sqrt(t)));
    layTail(tails.dust, e.group, mapAU,
        (t, out) => out.copy(head).addScaledVector(_anti, dustLen * t).addScaledVector(_vel, -dustLen * 0.5 * t * t),
        t => 0.07 * (0.15 + 0.85 * t));
    tails.ion.material.uniforms.uIntensity.value = 0.9 * activity;
    tails.dust.material.uniforms.uIntensity.value = 0.75 * activity;
    const comaSize = Math.max(e.enlargedRadius * 4, ionScene * 0.06) * (0.4 + 0.6 * activity);
    tails.coma.scale.setScalar(comaSize);
    tails.coma.material.opacity = 0.35 + 0.65 * activity;
    e.group.userData.previewRadius = comaSize * 0.6;                     // hover magnifier frames the coma
}

// ── Scene objects ───────────────────────────────────────────────────────
const entries = []; // { data, group, marker, path, pathAU, dir }
const groupVisible = Object.fromEntries(Object.keys(SMALL_BODY_GROUPS).map(g => [g, true]));
let orbitsVisible = true;
let trueSize = false; // spheres at real radius (km / 5000) instead of enlarged
let pathSignature = '';
const _pos = new THREE.Vector3();
const _earth = new THREE.Vector3();

export function setSmallBodyGroupVisible(group, on) { groupVisible[group] = on; }
export function setSmallBodyOrbitsVisible(on) { orbitsVisible = on; }
export function getSmallBodyVisibility() { return { groups: { ...groupVisible }, orbits: orbitsVisible, trueSize }; }

// Enlarged sizes keep them visible from afar; true size is for zooming in
// (Apophis is ~340 m across next to a 12,700 km Earth). The screen-space dot
// keeps them findable either way.
export function setSmallBodyTrueSize(on) {
    trueSize = on;
    for (const e of entries) {
        const r = on ? e.data.radiusKm / 5000 : e.enlargedRadius;
        e.sphere.scale.setScalar(r / e.enlargedRadius);
        e.group.userData.visualRadius = r;
    }
}

export function initSmallBodies(scene) {
    for (const b of BODIES) {
        const group = new THREE.Group();
        group.name = b.name;
        group.userData.name = b.name;
        const visualRadius = b.group === 'dwarf' ? Math.max(b.radiusKm / 5000, 0.3) : 0.2;
        group.userData.visualRadius = visualRadius;
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(visualRadius, 24, 16),
            new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.9, metalness: 0 })
        );
        group.add(sphere);
        // Always-visible dot so they can be found from afar (not clickable
        // itself: Points hit-test within a whole scene unit)
        const dot = new THREE.Points(
            new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
            new THREE.PointsMaterial({ color: b.color, size: b.group === 'spacecraft' ? 5 : 4, sizeAttenuation: false, depthWrite: false })
        );
        dot.raycast = () => {};
        group.add(dot);
        scene.add(group);

        const pathAU = b.orbit ? orbitPathAU(b.orbit) : null;
        const path = new THREE.Line(
            new THREE.BufferGeometry().setAttribute('position',
                new THREE.Float32BufferAttribute(new Float32Array((pathAU ? pathAU.length : 2) * 3), 3)),
            new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.0875, depthWrite: false })
        );
        path.raycast = () => {};
        path.frustumCulled = false;
        path.layers.set(1); // main.js ORBIT_LAYER: hidden with the Q key
        scene.add(path);

        entries.push({ data: b, group, sphere, enlargedRadius: visualRadius, path, pathAU, dir: b.coast ? skyDirection(b.coast.ra, b.coast.dec, new THREE.Vector3()) : null,
            tails: b.comet ? makeCometTails(group) : null });
    }
    return entries.map(e => ({
        name: e.data.name,
        mesh: e.group,
        data: {
            name: e.data.name,
            type: SMALL_BODY_GROUPS[e.data.group].replace(/s$/, '').replace(/ies$/, 'y'),
            radius: e.data.radiusKm,
            color: e.data.color,
            mass: e.data.mass,
            description: e.data.description,
            orbitalPeriod: e.data.orbit && e.data.orbit.e < 1 ? Math.pow(e.data.orbit.a, 1.5) * 365.25 : undefined,
            distance: 0 // km from Earth, kept live below
        }
    }));
}

// Earth's heliocentric position (AU, app frame), low precision — for the
// list's distance-from-Earth column only
function earthPositionAU(jd, out) {
    const d = jd - J2000_JD;
    const M = (357.529 + 0.98560028 * d) * DEG;
    const L = (280.459 + 0.98564736 * d) * DEG + (1.915 * Math.sin(M) + 0.02 * Math.sin(2 * M)) * DEG + Math.PI;
    return eclipticToApp(Math.cos(L), Math.sin(L), 0, out);
}

// Per frame. mapAU(rAU) → scene units along the same direction. `camera`
// turns the comet tails to face the viewer
export function updateSmallBodies(simDate, mapAU, visible, registry, camera = null) {
    const jd = simDate.getTime() / MS_PER_DAY + 2440587.5;
    const signature = [0.4, 1, 5, 30, 50, 100].map(r => mapAU(r).toFixed(3)).join(',');
    const rebuildPaths = signature !== pathSignature;
    pathSignature = signature;
    earthPositionAU(jd, _earth);

    for (const e of entries) {
        const b = e.data;
        let shown = visible && groupVisible[b.group];
        let rAU;
        if (b.orbit) {
            orbitalPositionAU(b.orbit, jd, _pos);
        } else {
            const c = b.coast;
            rAU = c.au + ((jd - toJD(c.at)) / 365.25) * c.auPerYear;
            if (jd < toJD(c.from) || rAU <= 0) shown = false; // before its straight-line coast
            _pos.copy(e.dir).multiplyScalar(Math.max(rAU, 0.01));
        }
        rAU = _pos.length();
        const reg = registry?.get(b.name);
        if (reg) reg.data.distance = _pos.distanceTo(_earth) * 149597870.7;
        e.group.position.copy(_pos).multiplyScalar(mapAU(rAU) / rAU);
        e.group.visible = shown;
        if (e.tails && shown) updateCometTails(e, jd, rAU, mapAU, camera);

        // Orbit / trajectory line
        e.path.visible = shown && orbitsVisible;
        if (!e.path.visible) continue;
        const arr = e.path.geometry.attributes.position.array;
        if (e.pathAU) {
            if (!rebuildPaths && e.path.userData.built) continue;
            e.pathAU.forEach((p, k) => {
                const r = p.length();
                const s = mapAU(r) / r;
                arr[k * 3] = p.x * s; arr[k * 3 + 1] = p.y * s; arr[k * 3 + 2] = p.z * s;
            });
            e.path.userData.built = true;
        } else {
            // Spacecraft: straight path from the planetary region out to now
            const r0 = Math.min(10, rAU);
            const p0 = _pos.clone().setLength(mapAU(r0));
            arr[0] = p0.x; arr[1] = p0.y; arr[2] = p0.z;
            arr[3] = e.group.position.x; arr[4] = e.group.position.y; arr[5] = e.group.position.z;
        }
        e.path.geometry.attributes.position.needsUpdate = true;
        e.path.geometry.computeBoundingSphere();
    }
}
