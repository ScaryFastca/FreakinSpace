// Other galaxies as 3D particle clouds, like the Milky Way (milkyWay.js):
// real size, sky position and tilt, so each looks right from home (a faint
// smudge of the right size and shape) and up close. Some are bodies of their
// own (the Magellanic Clouds, Andromeda…); the rest are host galaxies drawn
// round a black hole (M87, the Phoenix cluster, Gargantua's).
//
// Particles are light-years in the galaxy's own frame (X: major axis, Y: the
// rest of the disk, Z: the disk's axis). Each frame the points are placed on
// their body and scaled by its scene units per light-year, so a galaxy keeps
// its true size seen from the Sun in every scale mode. Built the first time a
// galaxy is big enough on screen to see.
import * as THREE from 'three';
import { raDecToAppFrame, LY } from './celestialData.js?v=331';
import { FAN_GLSL_UNIFORMS, FAN_GLSL_FUNCTIONS, FAN_DEFINES, makeFanUniforms, newFanState, stepFan } from './milkyWay.js?v=331';

// pa: position angle of the major axis on the sky (° east of north);
// inc: tilt (0 face-on, 90 edge-on). Sizes are stellar-disk radii.
export const GALAXIES = [
    { body: 'Large Magellanic Cloud', ra: 80.89, dec: -69.76, pa: 170, inc: 35, radiusLy: 16000,
        shape: 'magellanic', count: 32000, seed: 11, landmarks: ['R136a1'] },
    { body: 'Small Magellanic Cloud', ra: 13.19, dec: -72.83, pa: 45, inc: 65, radiusLy: 9500,
        shape: 'irregular', count: 15000, seed: 12 },
    { body: 'Andromeda Galaxy', ra: 10.68, dec: 41.27, pa: 38, inc: 77, radiusLy: 76000,
        shape: 'spiral', arms: 2, pitch: 9, bulge: 0.22, count: 70000, seed: 13 },
    { body: 'Triangulum Galaxy', ra: 23.46, dec: 30.66, pa: 23, inc: 54, radiusLy: 30000,
        shape: 'spiral', arms: 2, pitch: 22, bulge: 0.05, flocculent: true, count: 30000, seed: 14 },
    { body: 'Whirlpool Galaxy', ra: 202.48, dec: 47.2, pa: 163, inc: 22, radiusLy: 38000,
        shape: 'spiral', arms: 2, pitch: 17, bulge: 0.1, companion: true, count: 40000, seed: 15 },
    { body: 'Sombrero Galaxy', ra: 189.998, dec: -11.62, pa: 90, inc: 84, radiusLy: 25000,
        shape: 'sombrero', count: 45000, seed: 16 },
    // Host galaxies (drawn round a black hole; not separately clickable)
    { body: 'M87*', host: 'M87', ra: 187.71, dec: 12.39, pa: 290, inc: 90, radiusLy: 60000,
        shape: 'elliptical', flatten: 0.88, jet: true, count: 45000, seed: 17 },
    { body: 'Phoenix A*', host: 'Phoenix Cluster', ra: 356.18, dec: -42.72, pa: 20, inc: 50, radiusLy: 110000,
        shape: 'cluster', clusterLy: 2600000, members: 70, count: 40000, seed: 18 },
    { body: 'Gargantua (Interstellar)', host: "Gargantua's galaxy", ra: 266.42, dec: -29.01, pa: 60, inc: 55,
        radiusLy: 50000, shape: 'spiral', arms: 4, pitch: 14, bulge: 0.15, count: 45000, seed: 19 }
];

const BACKDROP_OPACITY = 0.18;
const PICK_MAX_PX = 30;       // a galaxy body's click target: the galaxy, up to this big on screen
const BUILD_MIN_PX = 1;       // build the particles once the galaxy is this big on screen
const FAN_MIN_PX = 250;       // the cursor swirl (as on the Milky Way) once it's this big (CSS px radius)

// ── Particle shapes ──────────────────────────────────────────────────────
function mulberry32(seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const WARM = [1.0, 0.80, 0.52], OLD = [1.0, 0.90, 0.76], YOUNG = [0.66, 0.78, 1.0],
    WHITE = [0.92, 0.94, 1.0], HII = [1.0, 0.42, 0.62], RED = [1.0, 0.72, 0.45];

function makeBuilder(seed) {
    const rand = mulberry32(seed);
    const gauss = () => {
        let a = 0;
        while (a === 0) a = rand();
        return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * rand());
    };
    const pos = [], col = [], size = [], bright = [];
    const dust = { pos: [], size: [] };
    const jitter = (c, amt) => c.map(v => Math.min(1, Math.max(0, v + (rand() - 0.5) * amt)));
    const add = (x, y, z, c, s, b) => { pos.push(x, y, z); col.push(c[0], c[1], c[2]); size.push(s); bright.push(b); };
    const addDust = (x, y, z, s) => { dust.pos.push(x, y, z); dust.size.push(s); };
    // Hernquist profile radius (scale a), capped
    const hernquist = (a, cap) => {
        for (;;) {
            const u = Math.sqrt(rand());
            const r = a * u / (1 - u);
            if (r < cap) return r;
        }
    };
    const randDir = () => {
        const z = rand() * 2 - 1, phi = rand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        return [s * Math.cos(phi), s * Math.sin(phi), z];
    };
    return { rand, gauss, jitter, add, addDust, hernquist, randDir, pos, col, size, bright, dust };
}

// Points per galaxy are sized so the surface brightness matches the Milky
// Way's whatever the count: size ∝ radius / √count
const sizeFor = (R, n, k = 1) => 2.4 * k * R / Math.sqrt(n);

function buildSpiral(b, cfg, R, n, cx = 0, cy = 0, cz = 0) {
    const { rand, gauss, jitter, add } = b;
    const nBulge = Math.round(n * cfg.bulge), nDisk = Math.round(n * 0.35), nArms = n - nBulge - nDisk;
    const s = sizeFor(R, n);
    for (let i = 0; i < nBulge; i++) {
        const r = b.hernquist(R * 0.05, R * 0.4);
        const [dx, dy, dz] = b.randDir();
        add(cx + dx * r, cy + dy * r, cz + dz * r * 0.65, jitter(rand() < 0.6 ? WARM : OLD, 0.1), s * 0.8, 0.26);
    }
    for (let i = 0; i < nDisk; i++) {
        const r = -R / 3.6 * Math.log(Math.max(rand() * rand(), 1e-9));
        if (r > R * 1.05) { i--; continue; }
        const phi = rand() * Math.PI * 2;
        add(cx + r * Math.cos(phi), cy + r * Math.sin(phi), cz + gauss() * R * 0.012, jitter(OLD, 0.1), s * 1.3, 0.11);
    }
    const tanP = Math.tan(THREE.MathUtils.degToRad(cfg.pitch));
    const rIn = R * 0.12;
    let made = 0;
    while (made < nArms) {
        const r0 = rIn * Math.pow(R / rIn, rand());
        if (rand() > Math.exp(-(r0 - rIn) / (R * 0.75))) continue;
        const k = Math.floor(rand() * cfg.arms);
        // Flocculent spirals: short, broken arm pieces
        const wobble = cfg.flocculent ? gauss() * 0.7 : gauss() * 0.06;
        const phi0 = Math.log(r0 / R) / tanP + k * Math.PI * 2 / cfg.arms + wobble;
        const width = R * (0.02 + 0.035 * r0 / R);
        const clump = rand() < 0.55;
        const m = clump ? 14 : 1;
        const spread = clump ? R * 0.008 : width;
        const cr = r0 + (clump ? gauss() * width * 0.7 : 0);
        for (let j = 0; j < m && made < nArms; j++, made++) {
            const r = cr + gauss() * spread;
            const phi = phi0 + gauss() * spread / Math.max(r, 1) * 0.6;
            const x = cx + r * Math.cos(phi), y = cy + r * Math.sin(phi), z = cz + gauss() * R * (clump ? 0.004 : 0.007);
            const roll = rand();
            if (roll < 0.035) add(x, y, z, jitter(HII, 0.1), s * 0.7, 0.9);
            else if (roll < 0.09) add(x, y, z, jitter(YOUNG, 0.08), s * 0.55, 1.0);
            else add(x, y, z, jitter(rand() < 0.6 ? YOUNG : WHITE, 0.1), s, 0.27);
        }
    }
    if (cfg.companion) {
        // NGC 5195 at the tip of an arm, a little behind the disk, with a
        // faint bridge of stars back along the arm
        const tipPhi = Math.log(1.05) / tanP;
        const tx = R * 1.08 * Math.cos(tipPhi), ty = R * 1.08 * Math.sin(tipPhi), tz = -R * 0.15;
        const nc = Math.round(n * 0.08);
        for (let i = 0; i < nc; i++) {
            const r = b.hernquist(R * 0.05, R * 0.3);
            const [dx, dy, dz] = b.randDir();
            add(tx + dx * r, ty + dy * r * 0.8, tz + dz * r * 0.7, jitter(WARM, 0.1), s, 0.24);
        }
        for (let i = 0; i < nc / 3; i++) {
            const f = rand();
            const r = R * (0.85 + 0.25 * f), phi = Math.log(r / R) / tanP + gauss() * 0.04;
            add(r * Math.cos(phi), r * Math.sin(phi), tz * f + gauss() * R * 0.01, jitter(OLD, 0.1), s, 0.1);
        }
    }
}

function buildElliptical(b, R, n, flatten = 0.85, k = 1, cx = 0, cy = 0, cz = 0, rot = null, glow = 1) {
    const { rand, jitter, add } = b;
    const s = sizeFor(R, n, k);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        const r = b.hernquist(R / 6, R * 1.2);
        const [dx, dy, dz] = b.randDir();
        v.set(dx * r, dy * r * (0.5 + flatten * 0.5), dz * r * flatten);
        if (rot) v.applyMatrix3(rot);
        add(cx + v.x, cy + v.y, cz + v.z, jitter(rand() < 0.5 ? WARM : RED, 0.1), s * (0.6 + 0.8 * r / R), 0.24 * glow);
    }
}

function buildM87(b, cfg, R, n) {
    const { rand, gauss, jitter, add } = b;
    buildElliptical(b, R, Math.round(n * 0.9), cfg.flatten);
    // Globular clusters: ~12,000 of them, far out into the halo
    const s = sizeFor(R, n);
    for (let i = 0; i < n * 0.07; i++) {
        const r = b.hernquist(R / 3, R * 1.6);
        const [dx, dy, dz] = b.randDir();
        add(dx * r, dy * r, dz * r, jitter(OLD, 0.1), s * 0.25, 0.9);
    }
    // The jet: ~5,000 light-years along the major axis, knotted, blue-white
    if (cfg.jet) {
        for (let i = 0; i < n * 0.03; i++) {
            const f = Math.pow(rand(), 0.8);
            const knot = Math.sin(f * 40) > 0.6 ? 1.6 : 1;
            const x = f * R * 0.085, w = R * (0.0006 + 0.004 * f);
            add(x, gauss() * w, gauss() * w, jitter([0.62, 0.76, 1.0], 0.05), s * 0.2, 0.7 * knot);
        }
    }
}

function buildSombrero(b, R, n) {
    const { rand, gauss, jitter, add, addDust } = b;
    const s = sizeFor(R, n);
    // Huge round bulge and halo
    for (let i = 0; i < n * 0.55; i++) {
        const r = b.hernquist(R * 0.16, R * 1.25);
        const [dx, dy, dz] = b.randDir();
        add(dx * r, dy * r, dz * r * 0.72, jitter(rand() < 0.6 ? WARM : OLD, 0.1), s * (0.7 + r / R), 0.22);
    }
    // Disk of old stars, brightest in a broad ring
    for (let i = 0; i < n * 0.45; i++) {
        const r = Math.abs(R * 0.72 + gauss() * R * 0.18);
        const phi = rand() * Math.PI * 2;
        add(r * Math.cos(phi), r * Math.sin(phi), gauss() * R * 0.008, jitter(OLD, 0.1), s, 0.2);
    }
    // The dark ring of dust that gives it the brim
    for (let i = 0; i < n * 0.2; i++) {
        const r = R * 0.8 + gauss() * R * 0.05;
        const phi = rand() * Math.PI * 2;
        addDust(r * Math.cos(phi), r * Math.sin(phi), gauss() * R * 0.006, s * 1.6);
    }
}

// Irregular clouds of young stars (the SMC); the LMC adds its off-centre bar
// and one stubby arm
function buildIrregular(b, cfg, R, n, landmarkLocal) {
    const { rand, gauss, jitter, add } = b;
    const s = sizeFor(R, n);
    const lmc = cfg.shape === 'magellanic';
    // Old diffuse body
    for (let i = 0; i < n * 0.4; i++) {
        const r = -R / 3 * Math.log(Math.max(rand() * rand(), 1e-9));
        if (r > R * 1.1) { i--; continue; }
        const phi = rand() * Math.PI * 2;
        add(r * Math.cos(phi), r * Math.sin(phi) * (lmc ? 0.9 : 0.55), gauss() * R * (lmc ? 0.04 : 0.15), jitter(OLD, 0.1), s * 1.3, 0.12);
    }
    if (lmc) {
        // Off-centre bar
        for (let i = 0; i < n * 0.2; i++) {
            add(R * 0.12 + gauss() * R * 0.22, R * -0.08 + gauss() * R * 0.055, gauss() * R * 0.03, jitter(WARM, 0.1), s, 0.25);
        }
        // One arm curling from the bar's end
        for (let i = 0; i < n * 0.12; i++) {
            const t = rand();
            const phi = 0.4 + t * 2.4, r = R * (0.45 + 0.25 * t);
            add(r * Math.cos(phi) + gauss() * R * 0.05, r * Math.sin(phi) + gauss() * R * 0.05, gauss() * R * 0.02,
                jitter(rand() < 0.6 ? YOUNG : WHITE, 0.1), s, 0.26);
        }
    }
    // Patchy star-forming clumps
    const clumps = lmc ? 40 : 30;
    const per = Math.floor(n * (lmc ? 0.24 : 0.6) / clumps);
    for (let c = 0; c < clumps; c++) {
        const r = R * 0.7 * Math.sqrt(rand()), phi = rand() * Math.PI * 2;
        const x0 = r * Math.cos(phi), y0 = r * Math.sin(phi) * (lmc ? 0.9 : 0.5), z0 = gauss() * R * (lmc ? 0.03 : 0.12);
        const w = R * (0.02 + 0.05 * rand());
        for (let i = 0; i < per; i++) {
            const roll = rand();
            add(x0 + gauss() * w, y0 + gauss() * w, z0 + gauss() * w * 0.6,
                jitter(roll < 0.12 ? HII : roll < 0.6 ? YOUNG : WHITE, 0.1), s * 0.7, roll < 0.12 ? 0.8 : 0.3);
        }
    }
    // The Tarantula Nebula round R136a1, where the real star sits
    if (landmarkLocal) {
        const w = R * 0.025;
        for (let i = 0; i < n * 0.05; i++) {
            const roll = rand();
            add(landmarkLocal.x + gauss() * w, landmarkLocal.y + gauss() * w, landmarkLocal.z + gauss() * w * 0.6,
                jitter(roll < 0.5 ? HII : YOUNG, 0.1), s * 0.6, 1.0);
        }
    }
}

// A galaxy cluster: the giant central galaxy (with the Phoenix's blue
// starburst filaments) and dozens of member galaxies around it
function buildCluster(b, cfg, R, n) {
    const { rand, gauss, jitter, add } = b;
    // (brighter than true surface brightness: seen whole, the cluster is
    // millions of light-years across and each galaxy only a pixel or two)
    buildElliptical(b, R, Math.round(n * 0.6), 0.8, 1, 0, 0, 0, null, 2);
    const s = sizeFor(R, n);
    for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = b.randDir();
        const bend = b.randDir();
        for (let i = 0; i < n * 0.02; i++) {
            const t = rand();
            const r = R * 0.6 * t;
            const x = dx * r + bend[0] * R * 0.15 * t * t, y = dy * r + bend[1] * R * 0.15 * t * t, z = dz * r + bend[2] * R * 0.15 * t * t;
            add(x + gauss() * R * 0.01, y + gauss() * R * 0.01, z + gauss() * R * 0.01,
                jitter(rand() < 0.5 ? HII : YOUNG, 0.1), s * 0.5, 0.8);
        }
    }
    // Members: King-like concentration toward the centre
    const rc = cfg.clusterLy * 0.15;
    const per = Math.floor(n * 0.28 / cfg.members);
    const rot = new THREE.Matrix3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let m = 0; m < cfg.members; m++) {
        const r = rc * Math.tan(rand() * Math.atan(cfg.clusterLy / rc));
        const [dx, dy, dz] = b.randDir();
        const cx = dx * r, cy = dy * r, cz = dz * r;
        const Rm = 8000 + 32000 * rand() * rand();
        e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
        rot.setFromMatrix4(m4.makeRotationFromQuaternion(q.setFromEuler(e)));
        if (rand() < 0.75) buildElliptical(b, Rm, per, 0.5 + 0.5 * rand(), 1, cx, cy, cz, rot, 5);
        else {
            // A small disk galaxy, turned at random
            const v = new THREE.Vector3();
            const sm = sizeFor(Rm, per);
            for (let i = 0; i < per; i++) {
                const rr = -Rm / 3 * Math.log(Math.max(rand(), 1e-9));
                const phi = rand() * Math.PI * 2 + Math.log(Math.max(rr, 1) / Rm) * 3 * (i % 2);
                v.set(rr * Math.cos(phi), rr * Math.sin(phi), gauss() * Rm * 0.03).applyMatrix3(rot);
                add(cx + v.x, cy + v.y, cz + v.z, jitter(rand() < 0.5 ? YOUNG : WHITE, 0.1), sm, 1.5);
            }
        }
    }
}

// Which of the fan's two spin phases each particle is in (milkyWay.js fan())
const fanSets = n => Array.from({ length: n }, (_, i) => i % 2);

function buildGeometry(cfg, landmarkLocal) {
    const b = makeBuilder(cfg.seed);
    const R = cfg.radiusLy, n = cfg.count;
    if (cfg.shape === 'spiral') buildSpiral(b, cfg, R, n);
    else if (cfg.shape === 'elliptical') buildM87(b, cfg, R, n);
    else if (cfg.shape === 'sombrero') buildSombrero(b, R, n);
    else if (cfg.shape === 'cluster') buildCluster(b, cfg, R, n);
    else buildIrregular(b, cfg, R, n, landmarkLocal);
    const extent = cfg.shape === 'cluster' ? cfg.clusterLy * 1.2 : R * 1.6;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('tint', new THREE.Float32BufferAttribute(b.col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(b.size, 1));
    g.setAttribute('bright', new THREE.Float32BufferAttribute(b.bright, 1));
    g.setAttribute('fanSet', new THREE.Float32BufferAttribute(fanSets(b.size.length), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), extent);
    let dust = null;
    if (b.dust.pos.length) {
        dust = new THREE.BufferGeometry();
        dust.setAttribute('position', new THREE.Float32BufferAttribute(b.dust.pos, 3));
        dust.setAttribute('size', new THREE.Float32BufferAttribute(b.dust.size, 1));
        dust.setAttribute('fanSet', new THREE.Float32BufferAttribute(fanSets(b.dust.size.length), 1));
        dust.boundingSphere = g.boundingSphere.clone();
    }
    return { stars: g, dust };
}

// ── Rendering ────────────────────────────────────────────────────────────
// Positions go through modelViewMatrix (built on the CPU in double
// precision), so points stay steady far from the origin
const vertexShader = /* glsl */`
    attribute vec3 tint;
    attribute float size;
    attribute float bright;
    attribute float fanSet;
    uniform float uPxPerUnit;   // pixels per scene unit at distance 1
    uniform float uScale;       // scene units per light-year
    uniform float uOpacity;
    uniform float uNearFade;    // scene units: points closer than this fade out
${FAN_GLSL_UNIFORMS}    varying vec3 vColor;
    varying float vAlpha;
    #include <common>
    #include <logdepthbuf_pars_vertex>
${FAN_GLSL_FUNCTIONS}
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = size * uScale * uPxPerUnit / max(-mv.z, 1e-9);
        float a = bright * uOpacity * smoothstep(uNearFade * 0.3, uNearFade, -mv.z);
        applyFan(gl_Position, a);
        // Same light whatever the clamp (see milkyWay.js)
        const float MIN_PX = 1.5, MAX_PX = 24.0;
        if (px < MIN_PX) { a *= (px * px) / (MIN_PX * MIN_PX); px = MIN_PX; }
        else if (px > MAX_PX) { a *= (MAX_PX * MAX_PX) / (px * px); px = MAX_PX; }
        gl_PointSize = px;
        vColor = tint;
        vAlpha = a;
        #include <logdepthbuf_vertex>
    }
`;
const fragmentShader = /* glsl */`
    varying vec3 vColor;
    varying float vAlpha;
    #include <logdepthbuf_pars_fragment>
    void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vColor, vAlpha * exp(-r2 * 4.0));
        #include <logdepthbuf_fragment>
    }
`;
// Dust: dark, drawn over the stars with normal blending
const dustVertex = vertexShader.replace('attribute vec3 tint;', '').replace('attribute float bright;', '')
    .replace('bright * uOpacity', '0.5 * uOpacity').replace('vColor = tint;', 'vColor = vec3(0.07, 0.045, 0.03);');

const makeUniforms = () => ({
    uPxPerUnit: { value: 1 }, uScale: { value: 1 }, uOpacity: { value: 1 }, uNearFade: { value: 0 }
});

export function createGalaxies(scene) {
    const root = new THREE.Group();
    root.name = 'galaxies';
    scene.add(root);
    return { root, items: GALAXIES.map(cfg => ({ cfg, obj: null, basis: null })) };
}

const _pos = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

// The galaxy's frame: X along its major axis on the sky, Z its disk's axis
// tilted `inc` away from our line of sight
function galaxyBasis(cfg, lineOfSight) {
    const n = lineOfSight.clone().normalize();
    const a = raDecToAppFrame(cfg.ra, cfg.dec), b = raDecToAppFrame(cfg.ra, cfg.dec + 0.01);
    const north = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    north.addScaledVector(n, -north.dot(n)).normalize();
    const east = new THREE.Vector3().crossVectors(north, n).normalize(); // on the sky as seen from inside
    const pa = THREE.MathUtils.degToRad(cfg.pa), inc = THREE.MathUtils.degToRad(cfg.inc);
    const major = north.clone().multiplyScalar(Math.cos(pa)).addScaledVector(east, Math.sin(pa));
    const minorSky = new THREE.Vector3().crossVectors(n, major).normalize();
    const axis = n.clone().multiplyScalar(-Math.cos(inc)).addScaledVector(minorSky, Math.sin(inc)).normalize();
    const y = new THREE.Vector3().crossVectors(axis, major).normalize();
    return new THREE.Matrix4().makeBasis(major, y, axis);
}

// Light-year scale and placement for a galaxy this frame, or null if its body
// isn't showing
function placement(item, bodies) {
    const body = bodies.get(item.cfg.body);
    // Always shown, even while the body itself is hidden (big stars off,
    // a black hole away from the view): few, huge, and part of the sky
    if (!body?.mesh || !body.data?.distance) return null;
    body.mesh.getWorldPosition(_pos);
    const distLy = body.data.distance / LY;
    const unitsPerLy = _pos.length() / distLy;
    return { body, pos: _pos.clone(), unitsPerLy };
}

function build(item, place, bodies) {
    const { cfg } = item;
    item.basis = galaxyBasis(cfg, place.pos);
    // Landmarks (R136a1 in the LMC): where the real star sits, in the
    // galaxy's frame, so its nebula grows round it
    let landmarkLocal = null;
    const lm = cfg.landmarks?.map(name => bodies.get(name)).find(Boolean);
    if (lm) {
        const inv = item.basis.clone().invert();
        landmarkLocal = lm.mesh.getWorldPosition(new THREE.Vector3()).sub(place.pos)
            .divideScalar(place.unitsPerLy).applyMatrix4(inv);
    }
    const { stars, dust } = buildGeometry(cfg, landmarkLocal);
    const obj = new THREE.Group();
    obj.name = 'galaxy:' + (cfg.host || cfg.body);
    obj.matrixAutoUpdate = false;
    const fanU = makeFanUniforms();
    obj.userData.fan = newFanState();
    obj.userData.fanUniforms = fanU;
    const mat = new THREE.ShaderMaterial({
        vertexShader, fragmentShader, uniforms: { ...makeUniforms(), ...fanU }, defines: { ...FAN_DEFINES },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(stars, mat);
    points.raycast = () => {};
    obj.add(points);
    const mats = [mat];
    if (dust) {
        const dm = new THREE.ShaderMaterial({
            vertexShader: dustVertex, fragmentShader, uniforms: { ...makeUniforms(), ...fanU }, defines: { ...FAN_DEFINES },
            transparent: true, depthWrite: false, blending: THREE.NormalBlending
        });
        const d = new THREE.Points(dust, dm);
        d.raycast = () => {};
        d.renderOrder = 1;
        obj.add(d);
        mats.push(dm);
    }
    obj.userData.materials = mats;
    item.obj = obj;
}

// Each frame (map view). pxPerUnit: CSS-px height / (2·tan(fov/2));
// focusDist: the camera's distance to what it's looking at
// pointer: the cursor for the swirl, as for the Milky Way (main.js)
export function updateGalaxies(state, bodies, camera, pxPerUnit, devicePxPerUnit, focusDist, inMap, pointer) {
    for (const item of state.items) {
        const place = inMap ? placement(item, bodies) : null;
        if (!place) { if (item.obj) item.obj.visible = false; continue; }
        const Rs = item.cfg.radiusLy * place.unitsPerLy;
        const camDist = Math.max(camera.position.distanceTo(place.pos), 1e-9);
        const screenR = Rs * pxPerUnit / camDist;
        // Galaxy bodies: framing, the magnifier and a click target the size of
        // the galaxy (up to PICK_MAX_PX, so stars inside it stay clickable)
        if (!item.cfg.host) {
            const ud = place.body.mesh.userData;
            ud.galaxyRadius = Rs;
            ud.previewRadius = Rs;
            const pick = place.body.mesh.getObjectByName('galaxyPick');
            if (pick) {
                const want = Math.min(Rs, PICK_MAX_PX * camDist / pxPerUnit);
                place.body.mesh.getWorldScale(_s);
                pick.scale.setScalar(want / Math.max(_s.x, 1e-30));
            }
        }
        if (!item.obj) {
            if (screenR < BUILD_MIN_PX) continue;
            build(item, place, bodies);
            state.root.add(item.obj);
        }
        const obj = item.obj;
        obj.visible = true;
        obj.matrix.copy(item.basis).multiply(_m.makeScale(place.unitsPerLy, place.unitsPerLy, place.unitsPerLy));
        obj.matrix.setPosition(place.pos);
        obj.matrixWorldNeedsUpdate = true;
        // A backdrop while you're zoomed in on something inside it; full
        // brightness when the view is galaxy-sized or it's far away
        const wide = Math.max(THREE.MathUtils.smoothstep(focusDist / Rs, 0.05, 0.6),
            THREE.MathUtils.smoothstep(camDist / Rs, 6, 20));
        for (const m of obj.userData.materials) {
            const u = m.uniforms;
            u.uPxPerUnit.value = devicePxPerUnit;
            u.uScale.value = place.unitsPerLy;
            u.uOpacity.value = THREE.MathUtils.lerp(BACKDROP_OPACITY, 1, wide);
            u.uNearFade.value = Rs * 0.05;
        }
        // The cursor swirl, when the galaxy is the view (bright, big on screen)
        if (!state.fansSuspended) stepFan(obj.userData.fan, obj.userData.fanUniforms, pointer, wide > 0.6 && screenR > FAN_MIN_PX);
    }
}

// Switch the swirls off for another view of the scene (the magnifier)
export function suspendGalaxyFans(state, suspended) {
    state.fansSuspended = suspended;
    for (const item of state.items) {
        const u = item.obj?.userData.fanUniforms;
        if (!u) continue;
        if (suspended) {
            item.fanSaved = [u.uCursor.value.z, u.uTrail.value[0].z];
            u.uCursor.value.z = 0;
            u.uTrail.value[0].z = 0;
        } else if (item.fanSaved) {
            [u.uCursor.value.z, u.uTrail.value[0].z] = item.fanSaved;
        }
    }
}

// The host galaxy's name for a black hole (info panel), if drawn
export function hostGalaxyOf(name) {
    return GALAXIES.find(g => g.body === name && g.host)?.host || null;
}
