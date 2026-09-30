// Easter egg: a wedge of cheddar at the Moon's south pole. Click it and the
// Moon turns to cheese, then the next two years (of simulation time) follow
// John Scalzi's "When the Moon Hits Your Eye":
//
//   day 0        the Moon becomes cheese (a few seconds of real time)
//   0–30 d       it swells: same mass, a third of the density
//                (cheddar ≈ 1.15 g/cm³ vs Moon rock 3.34) → radius ×(3.34/1.15)^⅓ ≈ 1.43
//   30–180 d     it slumps under its own gravity, heats up and vents water
//   180–540 d    it breaks apart, flinging city-sized chunks toward Earth
//   400–720 d    the big fragments fall in too; impacts accelerate
//   480–730 d    what's left settles into a ring of cheese around Earth
//
// Every flying piece follows a real two-body orbit around Earth once it
// leaves: slowed pieces fall in and hit, others whip around Earth on long
// loops that decay until they hit. All of it is down within five years.
//
// It never turns back. Everything is a function of simulation time since the
// click, so scrubbing the timeline plays it forward or back (before the click
// the Moon is still rock, because in sim time it hasn't happened yet).
// A page reload resets it.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

const DAY = 86400000;
const SWELL = (3.34 / 1.15) ** (1 / 3);           // radius growth at constant mass
const STAGES = [
    { day: 0,   text: '🧀 The Moon is now cheese. It kept its mass, so the tides don\'t change… but cheese is a third as dense as rock.' },
    { day: 30,  text: 'The Moon has swollen to about 1.4× its old size. Same mass, much more cheese.' },
    { day: 120, text: 'The cheese is slumping under its own gravity, heating up and erupting geysers of water.' },
    { day: 240, text: 'The Moon is breaking apart, hurling city-sized chunks of cheese toward Earth.' },
    { day: 560, text: 'Impacts are accelerating. Humanity has months left to decide how to spend them.' },
    { day: 700, text: 'Most of the Moon has fallen to Earth. The rest is settling into a ring of cheese.' }
];
const CREDIT = 'From John Scalzi\'s novel "When the Moon Hits Your Eye".';
const DESCRIPTIONS = [
    [0,   'Cheese. Nobody knows why. Same mass as before, so it has to be bigger.'],
    [30,  'A swollen ball of cheese about 1.4× the Moon\'s old size, still keeping Earth\'s tides unchanged.'],
    [120, 'Slumping under its own weight, heating up, and venting geysers of water into space.'],
    [240, 'Structurally failing: shedding chunks of cheese and debris, some headed for Earth.'],
    [560, 'Shattering. City-destroying impacts on Earth are becoming frequent.'],
    [700, 'Mostly gone: fallen to Earth or spread into a ring around Earth.']
];

const smooth = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);
const FRAGMENTS = 20;       // pieces it breaks into
const BREAKUP_DAY = 260;    // cracks glow from day 150; it comes apart here

// Two-body motion around Earth in "Moon units": Earth–Moon distance 1 and
// the Moon's orbital speed 1 (GM = 1), so one lunar month is 2π
const TAU_PER_DAY = 2 * Math.PI / 27.321661;
const Q = 6371 / 384400;                 // Earth's radius in Moon units
const LN_Q = Math.log(1 / Q);
function stumpC(z) {
    if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
    if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
    return 0.5 - z / 24;
}
function stumpS(z) {
    if (z > 1e-6) { const q = Math.sqrt(z); return (q - Math.sin(q)) / (q * q * q); }
    if (z < -1e-6) { const q = Math.sqrt(-z); return (Math.sinh(q) - q) / (q * q * q); }
    return 1 / 6 - z / 120;
}
// Position `t` (≥ 0) after (r0, v0), universal-variable Kepler solution
// (ellipses and hyperbolas alike). The equation for chi is monotonic (its
// slope is the distance from Earth), so Newton is kept inside a bracket and
// falls back to bisection: plain Newton blows up on near-radial falls
function keplerPos(r0, v0, t, out, velOut = null) {
    const rn = r0.length(), vr = r0.dot(v0) / rn, alpha = 2 / rn - v0.lengthSq();
    if (t <= 0) { if (velOut) velOut.copy(v0); return out.copy(r0); }
    const kep = chi => {
        const z = alpha * chi * chi, C = stumpC(z), S = stumpS(z);
        return [rn * vr * chi * chi * C + (1 - alpha * rn) * chi * chi * chi * S + rn * chi - t,
            rn * vr * chi * (1 - z * S) + (1 - alpha * rn) * chi * chi * C + rn];
    };
    let lo = 0, hi = Math.max(alpha > 1e-6 ? alpha * t : t / rn, 1e-4);
    for (let i = 0; i < 60 && kep(hi)[0] < 0; i++) { lo = hi; hi *= 2; }
    let chi = (lo + hi) / 2;
    for (let i = 0; i < 80; i++) {
        const [F, dF] = kep(chi);
        if (F > 0) hi = chi; else lo = chi;
        let next = chi - F / dF;
        if (!(next > lo && next < hi)) next = (lo + hi) / 2;
        if (Math.abs(next - chi) < 1e-11) { chi = next; break; }
        chi = next;
    }
    const z = alpha * chi * chi, C = stumpC(z), S = stumpS(z);
    const f = 1 - chi * chi * C / rn, g = t - chi * chi * chi * S;
    out.copy(r0).multiplyScalar(f).addScaledVector(v0, g);
    if (velOut) {
        const r = out.length();
        const fd = (alpha * chi * chi * chi * S - chi) / (r * rn), gd = 1 - chi * chi * C / r;
        velOut.copy(r0).multiplyScalar(fd).addScaledVector(v0, gd);
    }
    return out;
}

// Small deterministic RNG so the cracks and pieces look the same every time
function seededRandom(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function radialTexture(inner, mid) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner); gr.addColorStop(0.3, mid); gr.addColorStop(1, 'rgba(255,80,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
}

// Spherical (equirectangular) UVs from each vertex's direction, so the cheese
// map wraps pieces and lumps; triangles straddling the date line are unwrapped
// UVs for cheese pieces: the equirectangular map on the Moon's outer shell,
// and on broken faces (all faces, for `allCut` shards) the map laid flat
// along the face at the same texel size, so holes show instead of streaks
function sphericalUVs(geo, allCut = false, density = 1) {
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = v.lengthSq() > 1e-12 ? v.clone().normalize() : new THREE.Vector3(0, 1, 0);
        uv[i * 2] = 0.5 + Math.atan2(n.z, n.x) / (2 * Math.PI);
        uv[i * 2 + 1] = 0.5 + Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) / Math.PI;
    }
    if (!geo.index) {
        for (let t = 0; t < pos.count; t += 3) {
            const us = [uv[t * 2], uv[t * 2 + 2], uv[t * 2 + 4]];
            if (Math.max(...us) - Math.min(...us) > 0.5) {
                for (let k = 0; k < 3; k++) if (uv[(t + k) * 2] < 0.5) uv[(t + k) * 2] += 1;
            }
        }
    }
    // Smooth normals on the outer shell, flat on the broken faces
    const nrm = geo.attributes.normal;
    if (nrm && !geo.index) {
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let t = 0; t < pos.count; t += 3) {
            let outer = !allCut;
            for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, t + k); if (v.length() < 0.97) outer = false; }
            if (!outer) {
                // Planar projection onto the face's dominant axis
                a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
                const n = b.clone().sub(a).cross(c.clone().sub(a));
                const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
                for (let k = 0; k < 3; k++) {
                    v.fromBufferAttribute(pos, t + k);
                    const [p, q] = ax >= ay && ax >= az ? [v.z, v.y] : ay >= az ? [v.x, v.z] : [v.x, v.y];
                    uv[(t + k) * 2] = 0.37 + p * density / (2 * Math.PI);
                    uv[(t + k) * 2 + 1] = 0.5 + q * density / Math.PI;
                }
                continue;
            }
            for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, t + k).normalize(); nrm.setXYZ(t + k, v.x, v.y, v.z); }
        }
        nrm.needsUpdate = true;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
}

// A lumpy rock: an icosphere pushed in and out by a few random bumps
// A small broken shard of cheese: the convex hull of a jagged scatter of
// points, flat broken faces like the Moon's big fragments
function shardGeometry(rand) {
    const pts = [];
    const stretch = new THREE.Vector3(0.8 + rand() * 0.6, 0.55 + rand() * 0.4, 0.8 + rand() * 0.6);
    for (let i = 0; i < 11; i++) {
        const d = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
        pts.push(d.multiplyScalar(0.6 + rand() * 0.5).multiply(stretch));
    }
    return sphericalUVs(new ConvexGeometry(pts), true, 2.5);   // denser holes: they read at small size
}

function cheeseTexture() {
    const w = 1024, h = 512;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#f6b73c'); grad.addColorStop(0.5, '#f2a31f'); grad.addColorStop(1, '#e9951a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // Mottling
    for (let i = 0; i < 2500; i++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,210,120' : '200,120,20'},${0.04 + Math.random() * 0.06})`;
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 18, 0, Math.PI * 2);
        g.fill();
    }
    // Holes (like craters, but cheese)
    for (let i = 0; i < 160; i++) {
        const x = Math.random() * w, y = h * 0.08 + Math.random() * h * 0.84;
        const r = 2 + Math.pow(Math.random(), 2.5) * 22;
        const hole = g.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.1, x, y, r);
        hole.addColorStop(0, 'rgba(120,60,5,0.85)');
        hole.addColorStop(0.75, 'rgba(170,95,15,0.6)');
        hole.addColorStop(1, 'rgba(255,215,130,0.5)');
        g.fillStyle = hole;
        g.beginPath();
        g.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2);
        g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;   // flat-laid faces run past the edges
    return tex;
}

// Impact scar: a scorched crater with a pool of melted cheese in it, globby
// at the edges, bubbled and glossy (transparent around the outside)
function craterTexture(seed) {
    const N = 256, C = N / 2, rand = seededRandom(seed);
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    // Scorched ground fading out, and a lighter ring of thrown-out rock
    let gr = g.createRadialGradient(C, C, 0, C, C, C);
    gr.addColorStop(0, 'rgba(30,18,8,0.95)'); gr.addColorStop(0.5, 'rgba(38,24,12,0.85)');
    gr.addColorStop(0.72, 'rgba(70,52,36,0.55)'); gr.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    // Melted cheese: a lumpy blob plus drips and globs round the rim
    const R0 = N * 0.19, waves = Array.from({ length: 5 }, (_, k) => [k + 2, rand() * 6.3, 0.05 + rand() * 0.08]);
    g.beginPath();
    for (let a = 0; a <= 96; a++) {
        const t = a / 96 * Math.PI * 2;
        const r = R0 * (1 + waves.reduce((acc, [f, ph, amp]) => acc + amp * Math.sin(f * t + ph), 0));
        if (a) g.lineTo(C + Math.cos(t) * r, C + Math.sin(t) * r); else g.moveTo(C + Math.cos(t) * r, C + Math.sin(t) * r);
    }
    for (let k = 0; k < 9; k++) {
        const t = rand() * Math.PI * 2, rr = R0 * (0.95 + rand() * 0.35), gs = N * (0.02 + rand() * 0.04);
        g.moveTo(C + Math.cos(t) * rr + gs, C + Math.sin(t) * rr);
        g.arc(C + Math.cos(t) * rr, C + Math.sin(t) * rr, gs, 0, Math.PI * 2);
    }
    gr = g.createRadialGradient(C - R0 * 0.3, C - R0 * 0.3, R0 * 0.1, C, C, R0 * 1.3);
    gr.addColorStop(0, '#ffd760'); gr.addColorStop(0.6, '#f3a92a'); gr.addColorStop(1, '#c9741a');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(120,60,10,0.8)'; g.lineWidth = 2.5; g.stroke();
    // Bubbles and a glossy sheen
    for (let k = 0; k < 14; k++) {
        const t = rand() * Math.PI * 2, rr = rand() * R0 * 0.8, br = N * (0.008 + rand() * 0.02);
        const x = C + Math.cos(t) * rr, y = C + Math.sin(t) * rr;
        g.fillStyle = 'rgba(170,95,20,0.7)'; g.beginPath(); g.arc(x, y, br, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,245,200,0.7)'; g.beginPath(); g.arc(x - br * 0.3, y - br * 0.3, br * 0.35, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,230,0.28)';
    g.beginPath(); g.ellipse(C - R0 * 0.3, C - R0 * 0.35, R0 * 0.45, R0 * 0.2, -0.6, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// Cheese surface with round holes, tiling seamlessly: colour plus a height
// map (holes low) so they read as dents on every face, sides included
function holeTextures() {
    const N = 256, rand = seededRandom(7);
    const col = document.createElement('canvas'), hgt = document.createElement('canvas');
    col.width = col.height = hgt.width = hgt.height = N;
    const c = col.getContext('2d'), h = hgt.getContext('2d');
    c.fillStyle = '#f2b233'; c.fillRect(0, 0, N, N);
    h.fillStyle = '#fff'; h.fillRect(0, 0, N, N);
    for (let i = 0; i < 9; i++) {
        const x = rand() * N, y = rand() * N, r = N * (0.04 + rand() * 0.07);
        for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
            const cx = x + ox, cy = y + oy;
            let g = c.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
            g.addColorStop(0, '#a8661a'); g.addColorStop(0.75, '#c98424'); g.addColorStop(1, '#f6c04a');
            c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
            g = h.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, '#000'); g.addColorStop(0.7, '#333'); g.addColorStop(1, '#fff');
            h.fillStyle = g; h.beginPath(); h.arc(cx, cy, r, 0, Math.PI * 2); h.fill();
        }
    }
    return [col, hgt].map(cv => {
        const t = new THREE.CanvasTexture(cv);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        return t;
    });
}

function wedgeMesh(R) {
    // A small, narrow, tall-sided wedge of cheddar lying on the surface
    // (thickness outward along local +Y). Small on purpose: it's a secret
    const u = R * 0.045;
    const L = 2.2 * u, W = 0.75 * u, H = 1.0 * u, SINK = 0.3 * u;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);                       // tip
    shape.lineTo(L, -W / 2);
    shape.lineTo(L, W / 2);                   // rind (back)
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: H + SINK,
        bevelEnabled: true, bevelThickness: u * 0.03, bevelSize: u * 0.025, bevelSegments: 2
    });
    geo.rotateX(Math.PI / 2);                 // extrude along −Y: wedge lies flat, thickness radial
    geo.translate(-L / 2, H, 0);              // sticks out H, the rest sunk into the ground
    // Extrude UVs are in geometry units on caps and sides alike: one hole tile per 1.1u
    const [map, bump] = holeTextures();
    map.colorSpace = THREE.SRGBColorSpace;
    [map, bump].forEach(t => t.repeat.set(1 / (1.1 * u), 1 / (1.1 * u)));
    const mat = (tint, glow) => new THREE.MeshStandardMaterial({
        map, bumpMap: bump, bumpScale: 3, color: tint, roughness: 0.6,
        emissive: glow, emissiveMap: map
    });
    const mesh = new THREE.Mesh(geo, [mat(0xffffff, 0x3a2a14), mat(0xf0d8b0, 0x2a1e0e)]);
    mesh.name = 'cheese wedge';
    mesh.userData.isCheeseWedge = true;
    return mesh;
}

export function initCheeseMoon({ moonMesh, earthMesh, moonData, scene, setNightLights = () => {} }) {
    if (!moonMesh || !earthMesh) return null;
    const R = moonMesh.userData.visualRadius || moonMesh.geometry?.parameters?.radius || 0.35;
    const RE = earthMesh.userData.visualRadius || 1.27;
    const originalDescription = moonData?.description;
    const rand = seededRandom(20260930);

    // The wedge, sitting on the south pole (mesh local −Y)
    const wedge = wedgeMesh(R);
    wedge.position.set(0, -R * 0.995, 0);
    wedge.rotation.x = Math.PI;               // top face outward (−Y)
    moonMesh.add(wedge);

    const cheeseMap = cheeseTexture();
    // Where it will split: seed directions of a spherical Voronoi partition.
    // The same seeds drive the glowing cracks and the fragments' shapes, so
    // it breaks exactly along the cracks.
    const SEEDS = Array.from({ length: FRAGMENTS }, () => new THREE.Vector3().randomDirection());

    // Heat + crack glow, shared by the whole body and its fragments
    const heat = { uHeat: { value: 0 }, uCrack: { value: 0 }, uSeeds: { value: SEEDS } };
    const cheeseMaterial = () => {
        const mat = new THREE.MeshStandardMaterial({ map: cheeseMap, roughness: 0.72, metalness: 0 });
        mat.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, heat);
            shader.vertexShader = 'varying vec3 vCheeseDir;\n' + shader.vertexShader.replace(
                // (not normalize(): the pieces' inner corner is the centre, length 0)
                '#include <begin_vertex>', '#include <begin_vertex>\nvCheeseDir = position / max(length(position), 1e-5);');
            shader.fragmentShader = `uniform float uHeat; uniform float uCrack; uniform vec3 uSeeds[${FRAGMENTS}];
varying vec3 vCheeseDir;\n` + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                // Nearest two Voronoi seeds: close to equal = on a crack line
                // (direction wobbled a little so cracks are jagged, not clean arcs)
                vec3 cp = vCheeseDir;
                vec3 cdir = normalize(cp + 0.03 * vec3(sin(cp.y * 23.0 + cp.z * 7.0), sin(cp.z * 19.0 + cp.x * 11.0), sin(cp.x * 29.0 + cp.y * 5.0))
                                         + 0.012 * vec3(sin(cp.z * 71.0 + cp.x * 13.0), sin(cp.x * 67.0 + cp.y * 17.0), sin(cp.y * 73.0 + cp.z * 19.0)));
                float d1 = -2.0, d2 = -2.0;
                for (int i = 0; i < ${FRAGMENTS}; i++) {
                    float d = dot(cdir, uSeeds[i]);
                    if (d > d1) { d2 = d1; d1 = d; } else if (d > d2) { d2 = d; }
                }
                float crack = 1.0 - smoothstep(0.0, 0.004 + 0.03 * uCrack, d1 - d2);
                totalEmissiveRadiance += vec3(1.0, 0.35, 0.05) * crack * uCrack * 2.2;
                // General heating: warm glow deepening in the holes
                totalEmissiveRadiance += vec3(1.0, 0.4, 0.1) * uHeat * (0.25 + 0.75 * (1.0 - diffuseColor.g));`);
        };
        mat.customProgramCacheKey = () => 'cheese-moon';
        return mat;
    };

    // The whole body (swells and slumps), then replaced by fragments
    const cheese = new THREE.Group();
    cheese.name = 'cheese moon';
    cheese.visible = false;
    moonMesh.add(cheese);
    const solidMat = cheeseMaterial();
    solidMat.transparent = true;
    solidMat.opacity = 0;
    const solid = new THREE.Mesh(new THREE.SphereGeometry(R * 1.003, 96, 64), solidMat);
    solid.raycast = () => {};
    cheese.add(solid);

    // Fragments: convex hull of each Voronoi cell's patch of the sphere plus
    // the centre (the cells are convex cones, so the pieces fit together).
    // Cheese texture continues on the broken inside faces.
    const fragMat = cheeseMaterial();
    const fragments = [];
    const sphereGeo = new THREE.IcosahedronGeometry(1, 5);
    const sp = sphereGeo.attributes.position;
    const cells = SEEDS.map(() => [new THREE.Vector3(0, 0, 0)]);
    for (let i = 0; i < sp.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(sp, i);
        let best = 0, bd = -2;
        SEEDS.forEach((s, k) => { const d = v.dot(s); if (d > bd) { bd = d; best = k; } });
        cells[best].push(v);
    }
    const fragGroup = new THREE.Group();
    fragGroup.visible = false;
    cheese.add(fragGroup);
    cells.forEach((pts, k) => {
        if (pts.length < 5) return;
        const geo = sphericalUVs(new ConvexGeometry(pts));
        geo.scale(R * 1.003, R * 1.003, R * 1.003);
        geo.computeBoundingBox();
        const centre = geo.boundingBox.getCenter(new THREE.Vector3());
        geo.translate(-centre.x, -centre.y, -centre.z);   // turn and shrink about its own middle
        const size = geo.boundingBox.getSize(new THREE.Vector3()).length() / 2;
        const mesh = new THREE.Mesh(geo, fragMat);
        mesh.raycast = () => {};
        mesh.position.copy(centre);
        const axis = new THREE.Vector3().randomDirection();
        fragments.push({ mesh, centre, size, dir: SEEDS[k].clone(), axis, speed: 0.7 + rand() * 0.6, spin: (rand() - 0.5) * 1.6 });
        fragGroup.add(mesh);
    });

    // Launch velocities (Moon units, in the frame the Moon was in at launch:
    // x out from Earth, y along the Moon's orbit, z its orbit's north), for
    // pieces leaving the Moon's spot where the Moon moves at speed 1:
    //   direct  lost nearly all its orbital speed → drifts off and falls in (a
    //           little sideways speed spreads the hits far from the point under the Moon)
    //   impact  lost most of its orbital speed → curves in and hits
    //   loop    slowed some → long ellipses whipping close past Earth; each time
    //           it swings back out it loses more speed (colliding with the debris
    //           cloud), so every pass dips lower until it hits
    const KICKS = {
        direct: () => new THREE.Vector3(-0.3 + rand() * 0.3, (rand() - 0.5) * 0.14, (rand() - 0.5) * 0.2),
        impact: () => new THREE.Vector3(-0.3 + rand() * 0.35, -0.12 + rand() * 0.27, (rand() - 0.5) * 0.2),
        loop: () => new THREE.Vector3(-0.4 + rand() * 0.7, 0.2 + rand() * 0.35, (rand() - 0.5) * 0.2)
    };
    // Big fragments don't fly off whole: each crumbles away over weeks to
    // months, shedding the chunks that drift off toward Earth. Staggered, so
    // a few big pieces are still left at the two-year mark
    const order = fragments.map((_, k) => k);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((k, n) => {
        const f = fragments[k];
        f.crumble = 330 + (n + rand() * 0.8) * (560 / fragments.length);
        f.crumbleSpan = 50 + rand() * 70;
    });

    // Water geysers: soft plumes that widen and fade as they rise
    const VENTS = 16, PER = 60;
    const vents = Array.from({ length: VENTS }, () => {
        const dir = new THREE.Vector3().randomDirection();
        const a = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
        const b = new THREE.Vector3().crossVectors(dir, a);
        return { dir, a, b, phase: rand(), speed: 0.35 + rand() * 0.35, height: 0.5 + rand() * 0.5 };
    });
    const NP = VENTS * PER;
    const gPos = new Float32Array(NP * 3), gAge = new Float32Array(NP);
    const spread = Float32Array.from({ length: NP * 2 }, () => (rand() - 0.5) * 2);
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
    gGeo.setAttribute('age', new THREE.BufferAttribute(gAge, 1));
    const geysers = new THREE.Points(gGeo, new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: `#include <common>
            #include <logdepthbuf_pars_vertex>
            attribute float age; varying float vAge;
            void main() {
                vAge = age;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = mix(2.0, 9.0, age);
                #include <logdepthbuf_vertex>
            }`,
        fragmentShader: `#include <logdepthbuf_pars_fragment>
            uniform float uOpacity; varying float vAge;
            void main() {
                #include <logdepthbuf_fragment>
                float r = length(gl_PointCoord - 0.5) * 2.0;
                float a = (1.0 - smoothstep(0.3, 1.0, r)) * (1.0 - vAge) * uOpacity;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vec3(0.85, 0.93, 1.0), a);
            }`,
        transparent: true, depthWrite: false
    }));
    geysers.raycast = () => {};
    geysers.frustumCulled = false;
    geysers.visible = false;
    solid.add(geysers);

    // Chunks flung off as it breaks up: lumpy cheese rocks (three shapes),
    // each launched once on its own orbit, glowing and trailing fire near Earth
    const CHUNKS = 120, SHAPES = 3;
    const KIND_ODDS = [['direct', 0.45], ['impact', 0.7], ['loop', 1]];
    // Each big fragment ends by bursting into a handful of large chunks. A few
    // more are held back for showcase(): big ones the tour drops where the
    // camera will see them land
    const BURST = 5, SHOWCASE = 6;
    const BURSTS_END = CHUNKS + fragments.length * BURST, TOTAL = BURSTS_END + SHOWCASE;
    const chunkMat = cheeseMaterial();          // same cheese (and heat glow) as the big fragments
    const chunkSets = Array.from({ length: SHAPES }, () => {
        const im = new THREE.InstancedMesh(shardGeometry(rand), chunkMat, Math.ceil(TOTAL / SHAPES));
        im.frustumCulled = false;
        im.raycast = () => {};
        im.visible = false;
        scene.add(im);
        return im;
    });
    const chunkInfo = Array.from({ length: TOTAL }, (_, i) => {
        if (i >= BURSTS_END) {
            const size = 0.035 + rand() * 0.015;       // seen from right beside the ISS, so smaller
            return {
                kind: 'showcase', showcase: true, size, wreckSize: size * RE * 1.2,
                release: Infinity, hitTau: Infinity, endTau: Infinity,
                showStart: new THREE.Vector3(), showTarget: new THREE.Vector3(),
                spin: new THREE.Vector3(rand(), rand(), rand()), flash: 1.4,
                set: i % SHAPES, slot: Math.floor(i / SHAPES)
            };
        }
        const x = rand();
        const kind = KIND_ODDS.find(([, p]) => x < p)[0];
        const burst = i >= CHUNKS;
        const size = burst ? 0.12 + rand() * 0.06 : 0.05 + rand() * 0.06;
        // Shed by one fragment: a few early as it comes apart, the rest while
        // that fragment crumbles, and the last big pieces when it bursts
        const parent = fragments[burst ? Math.floor((i - CHUNKS) / BURST) : i % fragments.length];
        const release = burst ? parent.crumble + parent.crumbleSpan + rand() * 0.3
            : i < 24 ? BREAKUP_DAY + 2 + rand() * 60
            : parent.crumble + rand() * parent.crumbleSpan;
        return {
            kind, v0: KICKS[kind](), size, wreckSize: size * RE * (burst ? 0.5 : 0.8), parent, release,
            scatter: new THREE.Vector3().randomDirection(),
            spin: new THREE.Vector3(rand(), rand(), rand()),
            flash: burst ? 1.1 : 0.55,
            set: i % SHAPES, slot: Math.floor(i / SHAPES)
        };
    });
    const flyers = chunkInfo;
    const R0 = new THREE.Vector3(1, 0, 0);

    // Work out when each flyer hits Earth (or leaves for good), once
    let planned = false;
    // Each flight is a chain of two-body orbit segments: loopers start a new,
    // slower segment at each high point after passing Earth. Everything is
    // down within five years
    const SLOWDOWN = 0.75;
    // Planned a slice at a time (a few ms per frame) so the click doesn't
    // stutter; nothing flies until the breakup, long before it's done
    let planIndex = 0;
    function planFlights(budgetMs = Infinity) {
        if (planned) return;
        const start = performance.now();
        while (planIndex < flyers.length && performance.now() - start < budgetMs) {
            const b = flyers[planIndex++];
            if (!b.showcase) planFlight(b);
        }
        if (planIndex < flyers.length) return;
        planned = true;
        endDay = Math.max(...flyers.map(b => !b.showcase && isFinite(b.hitTau) ? b.release + b.hitTau / TAU_PER_DAY : 0));
    }
    const _pk = new THREE.Vector3(), _pv = new THREE.Vector3();
    function planFlight(b) {
        const k = _pk, v = _pv;
        const tMax = 5 * 365 * TAU_PER_DAY;
        {
            b.segs = [{ t0: 0, r0: R0.clone(), v0: b.v0.clone() }];
            b.hitTau = Infinity;
            b.endTau = Infinity;
            let seg = b.segs[0], t = 0, r = 1, prevR = 1, trend = 0, passes = 0;
            for (let n = 0; n < 60000 && t < tMax; n++) {
                const lastT = t;
                t += Math.min(0.05, Math.max(2e-5, 0.015 * r ** 1.5));
                r = keplerPos(seg.r0, seg.v0, t - seg.t0, k).length();
                if (r < Q) {
                    let lo = lastT, hi = t;
                    for (let j = 0; j < 30; j++) {
                        const mid = (lo + hi) / 2;
                        if (keplerPos(seg.r0, seg.v0, mid - seg.t0, k).length() < Q) hi = mid; else lo = mid;
                    }
                    b.hitTau = hi;
                    return;
                }
                if (r > 6) { b.endTau = t; return; }
                const nt = Math.sign(r - prevR);
                if (trend < 0 && nt > 0) passes++;                    // just passed Earth
                if (trend > 0 && nt < 0 && passes > 0 && b.segs.length < 16) {
                    keplerPos(seg.r0, seg.v0, t - seg.t0, k, v);      // high point: slow down
                    seg = { t0: t, r0: k.clone(), v0: v.multiplyScalar(SLOWDOWN) };
                    b.segs.push(seg);
                    passes = 0;
                }
                if (nt) trend = nt;
                prevR = r;
            }
        }
    }
    let endDay = 0;
    // Position along a flyer's chain of orbits
    function rawPos(b, tau, out) {
        let i = b.segs.length - 1;
        while (i > 0 && tau < b.segs[i].t0) i--;
        return keplerPos(b.segs[i].r0, b.segs[i].v0, tau - b.segs[i].t0, out);
    }

    // Fiery trails + entry glows (chunks and falling fragments)
    // Each trail follows the actual curved path back a few hours, in short
    // segments that fade toward the tail
    const NF = flyers.length, TRAIL_SEGS = 24, TRAIL_TAU = 0.08;
    const TS = TRAIL_SEGS * 6;               // floats per trail
    const trailPos = new Float32Array(NF * TS), trailCol = new Float32Array(NF * TS);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
    const trails = new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial({
        vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    }));
    trails.frustumCulled = false;
    trails.raycast = () => {};
    scene.add(trails);
    const glowTex = radialTexture('rgba(255,240,200,1)', 'rgba(255,120,20,0.7)');
    const glows = flyers.map(() => {
        const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        g.visible = false;
        g.raycast = () => {};
        scene.add(g);
        return g;
    });

    // Impact flashes on Earth
    const flashTex = radialTexture('rgba(255,255,220,1)', 'rgba(255,160,40,0.8)');
    const flashes = Array.from({ length: 24 }, () => {
        const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        f.visible = false;
        f.raycast = () => {};
        f.name = 'cheese flash';
        Object.assign(f.userData, { life: 0, size: 0.5, decay: 0.02 });
        earthMesh.add(f);
        return f;
    });
    let nextFlash = 0;

    // Ring of cheese debris around Earth's equator, inside the Roche limit
    // for cheese (~4 Earth radii), where loose debris can't clump back together
    const RING_N = 2000;
    const ringR = Float32Array.from({ length: RING_N }, () => 1.6 + rand() * 2.4);   // Earth radii
    const ringA = Float32Array.from({ length: RING_N }, () => rand() * Math.PI * 2);
    const ringY = Float32Array.from({ length: RING_N }, () => rand() - 0.5);
    const rPos = new Float32Array(RING_N * 3);
    const ring = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(rPos, 3)),
        new THREE.PointsMaterial({ color: 0xf0a830, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false })
    );
    ring.name = 'cheese ring';
    ring.raycast = () => {};
    ring.frustumCulled = false;
    ring.visible = false;
    earthMesh.add(ring);
    let ringDR = 0;

    // Cheese that made it down: half-buried lumps where things hit, riding
    // on Earth's surface
    // Lit by the Sun like the ground they sit on (no heat glow, which made
    // them shine evenly on the night side), with the wedge's bold,
    // bump-mapped holes so they read as cheese from further out
    const [wreckMap, wreckBump] = holeTextures();
    wreckMap.colorSpace = THREE.SRGBColorSpace;
    [wreckMap, wreckBump].forEach(t => t.repeat.set(4, 4));   // several holes per face
    const wreckMat = new THREE.MeshStandardMaterial({
        map: wreckMap, bumpMap: wreckBump, bumpScale: 4, color: 0xe8c890, roughness: 0.8,
        emissive: 0x140b03, emissiveMap: wreckMap          // barely there at night
    });
    const wrecks = new THREE.InstancedMesh(shardGeometry(rand), wreckMat, flyers.length);
    wrecks.name = 'cheese wrecks';
    wrecks.frustumCulled = false;
    wrecks.raycast = () => {};
    wrecks.visible = false;
    earthMesh.add(wrecks);
    const Y_AXIS = new THREE.Vector3(0, 1, 0);

    // Craters: scorched ground with melted cheese spreading out, under each wreck
    const CRATER_KINDS = 3;
    const craterGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // lies flat, facing +Y
    const craterSets = Array.from({ length: CRATER_KINDS }, (_, k) => {
        const im = new THREE.InstancedMesh(craterGeo, new THREE.MeshStandardMaterial({
            map: craterTexture(31 + k), transparent: true, depthWrite: false, roughness: 0.85,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
        }), Math.ceil(TOTAL / CRATER_KINDS));
        im.name = 'cheese craters';
        im.frustumCulled = false;
        im.raycast = () => {};
        im.visible = false;
        earthMesh.add(im);
        return im;
    });

    // Smoke rising from fresh impacts and drifting east, lit by the Sun
    const SMOKE_PER = 10, SMOKE_LIFE = 45, SMOKE_CYCLE = 3;   // days
    const smokePos = new Float32Array(TOTAL * SMOKE_PER * 3), smokeSize = new Float32Array(TOTAL * SMOKE_PER);
    const smokeAlpha = new Float32Array(TOTAL * SMOKE_PER);
    const smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
    smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(smokeSize, 1));
    smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(smokeAlpha, 1));
    const smokeUniforms = { uSun: { value: new THREE.Vector3(1, 0, 0) }, uHalfH: { value: 400 } };
    const smoke = new THREE.Points(smokeGeo, new THREE.ShaderMaterial({
        uniforms: smokeUniforms,
        vertexShader: `#include <common>
            #include <logdepthbuf_pars_vertex>
            uniform vec3 uSun; uniform float uHalfH;
            attribute float aSize; attribute float aAlpha;
            varying float vAlpha; varying float vLit;
            void main() {
                vAlpha = aAlpha;
                vLit = 0.08 + 0.92 * smoothstep(-0.12, 0.3, dot(normalize(position), uSun));
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uHalfH / -mv.z, 1.0, 256.0);
                #include <logdepthbuf_vertex>
            }`,
        fragmentShader: `#include <logdepthbuf_pars_fragment>
            varying float vAlpha; varying float vLit;
            void main() {
                #include <logdepthbuf_fragment>
                float r = length(gl_PointCoord - 0.5) * 2.0;
                float a = (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vec3(0.58, 0.54, 0.5) * vLit, a);
            }`,
        transparent: true, depthWrite: false
    }));
    smoke.name = 'cheese smoke';
    smoke.frustumCulled = false;
    smoke.raycast = () => {};
    smoke.visible = false;
    earthMesh.add(smoke);
    const _sq = new THREE.Quaternion();

    // Story notes
    const toast = document.createElement('div');
    Object.assign(toast.style, {
        position: 'fixed', left: '50%', top: '84px', transform: 'translateX(-50%)', maxWidth: '560px',
        padding: '12px 18px', borderRadius: '10px', background: 'rgba(40,24,0,0.85)', color: '#ffd98a',
        border: '1px solid rgba(255,190,80,0.5)', font: '14px/1.45 system-ui, sans-serif', textAlign: 'center',
        zIndex: 3000, pointerEvents: 'none', opacity: '0', transition: 'opacity 0.6s ease'
    });
    document.body.appendChild(toast);
    let toastTimer = null;
    const say = (text, credit = true) => {
        toast.innerHTML = credit ? `${text}<div style="opacity:0.65;font-size:12px;margin-top:4px">${CREDIT}</div>` : text;
        toast.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 7000);
    };

    let triggeredAt = null;     // sim time of the click (ms)
    let triggerReal = 0;        // real time of the click, for the quick transformation
    let lastStage = -1;
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
    const _moonW = new THREE.Vector3(), _earthW = new THREE.Vector3(), _p = new THREE.Vector3(), _tail = new THREE.Vector3();
    const _trailA = new THREE.Vector3(), _trailB = new THREE.Vector3();
    const _k = new THREE.Vector3(), _off = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _e3 = new THREE.Vector3();
    let DR = 4;                 // Earth–Moon distance / Earth radius in the scene (varies with the scale)
    let lastD = -1;

    // Moon units → scene. The flight is computed in the Moon's frame at launch
    // (inertial); the Moon has since moved `tau` along its orbit, and the
    // current frame (_e1 toward the Moon, _e2 along its orbit, _e3 its north)
    // turns with it. Distances from Earth are remapped so Earth's surface and
    // the Moon's orbit land where they're drawn (the compressed scale puts
    // the Moon only a few Earth radii out): identity at realistic scale.
    function toScene(k, tau, out) {
        const c = Math.cos(tau), sn = Math.sin(tau);
        const x = k.x * c + k.y * sn, y = k.y * c - k.x * sn;
        const r = Math.max(k.length(), 1e-9);
        const m = RE * Math.pow(DR, Math.log(Math.max(r, Q) / Q) / LN_Q) / r;
        return out.copy(_earthW).addScaledVector(_e1, x * m).addScaledVector(_e2, y * m).addScaledVector(_e3, k.z * m);
    }
    const _local = new THREE.Vector3();
    function flightPos(b, tau, out) {
        if (b.showcase) {
            // Straight down its chosen line (Earth-local), speeding up as it falls
            const u = THREE.MathUtils.clamp(tau / b.hitTau, 0, 1);
            _local.copy(b.showStart).lerp(b.showTarget, u * u);
            b.r = _local.length() / RE * Q;
            return earthMesh.localToWorld(out.copy(_local));
        }
        rawPos(b, tau, _k);
        b.r = _k.length();
        return toScene(_k, tau, out);
    }

    function trigger(simDate) {
        if (triggeredAt !== null) return;
        triggeredAt = simDate.getTime();
        triggerReal = performance.now();
        wedge.visible = false;
        planFlights(4);
    }

    // Back to the plain rock Moon, as if it never happened
    function reset() {
        if (triggeredAt === null) return;
        triggeredAt = null;
        wedge.visible = true;
        cheese.visible = false;
        solid.visible = true;
        fragGroup.visible = false;
        if (moonMesh.material) moonMesh.material.visible = true;
        heat.uHeat.value = heat.uCrack.value = 0;
        chunkSets.forEach(im => { im.visible = false; });
        wrecks.visible = false;
        craterSets.forEach(im => { im.visible = false; });
        smoke.visible = trails.visible = ring.visible = geysers.visible = false;
        glows.forEach(g => { g.visible = false; });
        flashes.forEach(f => { f.visible = false; f.userData.life = 0; });
        flyers.forEach(b => {
            b.wreck = null;
            if (b.showcase) b.release = b.hitTau = Infinity;
        });
        lastStage = -1;
        lastD = -1;
        if (moonData) moonData.description = originalDescription;
        toast.style.opacity = '0';
        setNightLights(1);
    }

    // Keep the story where it is but move it in time, so `day` days after the
    // click falls at `nowMs` (the tour's finale brings the clock back to today)
    function rebase(nowMs, day) {
        if (triggeredAt === null) return;
        triggeredAt = nowMs - day * DAY;
        lastD = day;
    }

    // Where a flyer hits, in Earth's frame (Earth turned as it is now)
    function hitLocal(b, out) {
        if (b.showcase) return out.copy(b.showTarget);
        rawPos(b, b.hitTau, _k);
        toScene(_k, b.hitTau, out);
        return earthMesh.worldToLocal(out);
    }

    // Drop big chunks onto chosen spots: [{ day, fallDays, start, target }]
    // with start/target in Earth's frame (target on the surface)
    function showcase(list) {
        const slots = flyers.filter(b => b.showcase);
        list.slice(0, slots.length).forEach((it, k) => {
            const b = slots[k];
            b.release = it.day - it.fallDays;
            b.hitTau = it.fallDays * TAU_PER_DAY;
            b.showStart.copy(it.start);
            b.showTarget.copy(it.target);
            b.wreck = null;
        });
    }

    function update(simDate, visible = true) {
        if (triggeredAt === null) return;
        if (!visible) setNightLights(1);
        const days = (simDate.getTime() - triggeredAt) / DAY;
        const before = days < 0;
        // Quick transformation in real time, and only once it's "happened"
        const morph = before ? 0 : Math.min(1, (performance.now() - triggerReal) / 3000);
        cheese.visible = visible && morph > 0;
        wedge.visible = before;
        solidMat.opacity = morph;
        solidMat.transparent = morph < 1;
        if (moonMesh.material) moonMesh.material.visible = morph < 1; // rock hidden once fully cheese

        const d = Math.max(days, 0);
        planFlights(d > BREAKUP_DAY - 2 ? Infinity : 4);
        moonMesh.getWorldPosition(_moonW);
        earthMesh.getWorldPosition(_earthW);
        _e1.subVectors(_moonW, _earthW);
        const D = _e1.length();
        _e1.divideScalar(D || 1);
        DR = Math.max(1.05, D / RE);
        moonMesh.updateWorldMatrix(true, false);
        _e3.setFromMatrixColumn(moonMesh.matrixWorld, 1);     // the Moon's pole ≈ its orbit's north
        _e3.addScaledVector(_e1, -_e3.dot(_e1)).normalize();
        _e2.crossVectors(_e3, _e1);
        // Swell (same mass), then slump: flatter at the poles, keeping volume
        const grow = 1 + (SWELL - 1) * smooth(d, 0, 30);
        const slump = 1 - 0.28 * smooth(d, 30, 400);
        const bulge = 1 / Math.sqrt(slump);
        cheese.scale.set(grow * bulge, grow * slump, grow * bulge);
        heat.uHeat.value = 0.6 * smooth(d, 60, 520);
        // Cracks glow as they open, then cool once it has split along them
        // (the broken faces lie exactly on the cracks, so they would glow all over)
        heat.uCrack.value = smooth(d, 150, BREAKUP_DAY) * (1 - smooth(d, BREAKUP_DAY, BREAKUP_DAY + 14));

        // Breakup: the solid body gives way to fragments that drift apart and tumble
        const broken = d >= BREAKUP_DAY;
        solid.visible = !broken;
        fragGroup.visible = broken;
        if (broken) {
            const apart = Math.pow(smooth(d, BREAKUP_DAY, 730), 1.15);
            // Once in pieces there's no body left to slump: ease the flattening
            // off as they separate, so they relax into chunky wedges (not plates)
            const relax = smooth(d, BREAKUP_DAY, BREAKUP_DAY + 120);
            fragGroup.scale.set(
                THREE.MathUtils.lerp(1, grow / cheese.scale.x, relax),
                THREE.MathUtils.lerp(1, grow / cheese.scale.y, relax),
                THREE.MathUtils.lerp(1, grow / cheese.scale.z, relax));
            fragGroup.updateWorldMatrix(true, false);
            fragments.forEach(f => {
                // Drift apart and tumble, crumbling away into chunks
                const apart = Math.pow(smooth(d, BREAKUP_DAY, 730), 1.15);
                f.mesh.position.copy(f.centre).addScaledVector(f.dir, R * 2.4 * apart * f.speed);
                f.mesh.quaternion.setFromAxisAngle(f.axis, f.spin * Math.PI * (d - BREAKUP_DAY) / 300);
                f.left = 1 - smooth(d, f.crumble, f.crumble + f.crumbleSpan);
                // Shrinks to half as it sheds chunks, then bursts apart
                f.mesh.scale.setScalar(0.5 + 0.5 * Math.sqrt(f.left));
                f.mesh.visible = f.left > 0;
            });
        }

        // Geysers (until it breaks up)
        const gOn = smooth(d, 90, 150) * (broken ? 0 : 1);
        geysers.visible = cheese.visible && gOn > 0.01;
        if (geysers.visible) {
            geysers.material.uniforms.uOpacity.value = 0.8 * gOn;
            const t = performance.now() / 1000;
            let k = 0, n = 0;
            vents.forEach(v => {
                for (let j = 0; j < PER; j++, n++) {
                    const life = (t * v.speed + v.phase + j / PER) % 1;
                    const h = 1 + life * v.height * 0.9;
                    const w = life * v.height * 0.35;
                    _p.copy(v.dir).multiplyScalar(R * h)
                        .addScaledVector(v.a, spread[n * 2] * R * w)
                        .addScaledVector(v.b, spread[n * 2 + 1] * R * w);
                    gPos[k++] = _p.x; gPos[k++] = _p.y; gPos[k++] = _p.z;
                    gAge[n] = life;
                }
            });
            gGeo.attributes.position.needsUpdate = true;
            gGeo.attributes.age.needsUpdate = true;
        }

        // Chunks: launched one by one as it breaks up, each on its own orbit
        const used = new Array(SHAPES).fill(false);
        let anyWreck = false, smokeCount = 0;
        const scrubbed = d - lastD > 30 || d < lastD;       // big jumps don't set off a storm of flashes
        flyers.forEach((b, i) => {
            const isChunk = true;
            const tau = (d - b.release) * TAU_PER_DAY;
            const flying = visible && broken && tau > 0 && tau < b.hitTau && tau < b.endTau;
            let scale = 0, hot = 0;
            if (flying) {
                // It leaves from the side of its parent fragment and eases
                // onto its own path over the first few days
                const fadeTau = 3 * TAU_PER_DAY;
                const lead = 1 - smooth(tau, 0, fadeTau);
                const pf = b.parent;
                if (pf) {
                    pf.mesh.updateWorldMatrix(true, false);
                    pf.mesh.getWorldPosition(_off).sub(_moonW)
                        .addScaledVector(b.scatter, pf.size * grow * (0.5 + 0.5 * Math.sqrt(pf.left ?? 1)) * 0.8);
                } else {
                    _off.set(0, 0, 0);
                }
                const offBase = _tail.copy(_off);          // start offset before easing out
                _off.multiplyScalar(lead);
                flightPos(b, tau, _p).add(_off);
                scale = b.size * RE * (b.showcase ? 1 : smooth(tau, 0, 0.5 * TAU_PER_DAY) * (1 - smooth(b.r, 3, 6)));
                const r = b.r;
                hot = 1 - smooth(r, Q * 1.3, Q * 5);
                // Trail: back along its path over the last few hours
                const glow = Math.max(hot, 0.12 * (1 - lead));
                _trailA.copy(_p);
                // Fine segments near Earth, where paths bend hard; far out
                // they're nearly straight, so fewer will do
                const segs = r < 0.35 ? TRAIL_SEGS : 8;
                for (let j = 1; j <= segs; j++) {
                    const tt = Math.max(0, tau - TRAIL_TAU * j / segs);
                    flightPos(b, tt, _trailB).addScaledVector(offBase, 1 - smooth(tt, 0, fadeTau));
                    const o = i * TS + (j - 1) * 6;
                    const g0 = glow * (1 - (j - 1) / segs), g1 = glow * (1 - j / segs);
                    trailPos[o] = _trailA.x; trailPos[o + 1] = _trailA.y; trailPos[o + 2] = _trailA.z;
                    trailPos[o + 3] = _trailB.x; trailPos[o + 4] = _trailB.y; trailPos[o + 5] = _trailB.z;
                    trailCol[o] = g0; trailCol[o + 1] = 0.55 * g0; trailCol[o + 2] = 0.15 * g0;
                    trailCol[o + 3] = g1; trailCol[o + 4] = 0.55 * g1; trailCol[o + 5] = 0.15 * g1;
                    _trailA.copy(_trailB);
                }
                trailCol.fill(0, i * TS + segs * 6, (i + 1) * TS);
                b.r = r;
            } else {
                trailCol.fill(0, i * TS, (i + 1) * TS);
            }
            if (isChunk) {
                if (flying) used[b.set] = true;
                _q.setFromEuler(_e.set(b.spin.x * d * 3, b.spin.y * d * 3, b.spin.z * d * 3));
                _m.compose(_p, _q, _s.setScalar(scale));
                chunkSets[b.set].setMatrixAt(b.slot, _m);
            }
            const g = glows[i];
            g.visible = flying && hot > 0.02;
            if (g.visible) {
                g.position.copy(_p);
                g.scale.setScalar(scale * (b.showcase ? 3 : 5));
                g.material.opacity = hot;
            }
            // Impact flash where it hit, as the clock passes the moment
            const hitDay = b.release + b.hitTau / TAU_PER_DAY;
            if (visible && !scrubbed && lastD < hitDay && d >= hitDay) {
                const fl = flashes[nextFlash++ % flashes.length];
                fl.position.copy(hitLocal(b, _p)).multiplyScalar(1.06);
                fl.userData.life = 1;
                fl.userData.size = b.flash;
                fl.userData.decay = isChunk ? 0.014 : 0.005;
                b.wreck = null;          // re-place it from the exact impact spot
            }
            // Its remains on the ground (placed once; if the clock jumped past
            // the impact, Earth's turn at that moment isn't known, so it's
            // given a made-up longitude rather than piling up on today's side)
            let ws = 0;
            if (visible && !before && isFinite(b.hitTau) && d >= hitDay) {
                if (!b.wreck) {
                    const n = hitLocal(b, _p).normalize();
                    if (!b.showcase && !(lastD < hitDay && !scrubbed)) n.applyAxisAngle(Y_AXIS, i * 2.39996);
                    b.wreck = {
                        n: n.clone(),
                        east: new THREE.Vector3().crossVectors(Y_AXIS, n).normalize(),
                        pos: n.clone().multiplyScalar(RE * 0.995),
                        quat: new THREE.Quaternion().setFromUnitVectors(Y_AXIS, n)
                            .multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, i * 2.39))
                    };
                }
                ws = b.wreckSize;
                anyWreck = true;
            }
            const cSet = craterSets[i % CRATER_KINDS], cSlot = Math.floor(i / CRATER_KINDS);
            if (b.wreck) {
                _m.compose(b.wreck.pos, b.wreck.quat, _s.set(ws, ws * 0.5, ws));
                wrecks.setMatrixAt(i, _m);
                // The crater, its melted cheese spreading over the first days
                const age = d - hitDay;
                const cs = ws > 0 ? ws * 2.6 * (0.45 + 0.55 * smooth(age, 0, 8)) : 0;
                _p.copy(b.wreck.n).multiplyScalar(RE * 1.002);
                _m.compose(_p, b.wreck.quat, _s.set(cs, 1, cs));
                cSet.setMatrixAt(cSlot, _m);
                // Smoke plume while it's fresh
                if (ws > 0 && age < SMOKE_LIFE) {
                    const fade = smooth(age, 0, 0.3) * (1 - smooth(age, SMOKE_LIFE * 0.4, SMOKE_LIFE));
                    for (let k = 0; k < SMOKE_PER; k++) {
                        const tp = (age / SMOKE_CYCLE + k / SMOKE_PER) % 1;       // this puff's life
                        _p.copy(b.wreck.n).multiplyScalar(RE * (1.004 + tp * 0.03))
                            .addScaledVector(b.wreck.east, RE * tp * 0.22 * (0.7 + 0.3 * ((k * 7) % 5) / 4));
                        const o = smokeCount * 3;
                        smokePos[o] = _p.x; smokePos[o + 1] = _p.y; smokePos[o + 2] = _p.z;
                        smokeSize[smokeCount] = ws * (1.2 + tp * 4);
                        smokeAlpha[smokeCount] = 0.5 * fade * Math.sin(Math.PI * Math.min(1, tp * 1.3));
                        smokeCount++;
                    }
                }
            } else if (ws === 0) {
                wrecks.setMatrixAt(i, _m.makeScale(0, 0, 0));
                cSet.setMatrixAt(cSlot, _m);
            }
        });
        chunkSets.forEach((im, s) => { im.visible = used[s]; im.instanceMatrix.needsUpdate = true; });
        wrecks.visible = anyWreck;
        wrecks.instanceMatrix.needsUpdate = true;
        craterSets.forEach(im => { im.visible = anyWreck; im.instanceMatrix.needsUpdate = true; });
        smoke.visible = smokeCount > 0;
        if (smoke.visible) {
            smokeGeo.setDrawRange(0, smokeCount);
            ['position', 'aSize', 'aAlpha'].forEach(a => { smokeGeo.attributes[a].needsUpdate = true; });
            earthMesh.getWorldQuaternion(_sq).invert();
            smokeUniforms.uSun.value.copy(_earthW).negate().normalize().applyQuaternion(_sq);
            smokeUniforms.uHalfH.value = window.innerHeight * Math.min(window.devicePixelRatio || 1, 2) / 2;
        }
        // The lights go out across the night side as the disaster goes on
        setNightLights(before ? 1 : 1 - 0.8 * smooth(d, 300, 700));
        trailGeo.attributes.position.needsUpdate = true;
        trailGeo.attributes.color.needsUpdate = true;
        trails.visible = visible && broken;
        flashes.forEach(fl => {
            fl.userData.life = Math.max(0, fl.userData.life - (fl.userData.decay || 0.02));
            fl.visible = visible && fl.userData.life > 0;
            fl.material.opacity = fl.userData.life;
            if (fl.visible) fl.scale.setScalar(RE * fl.userData.size * (0.4 + 0.8 * (1 - fl.userData.life)));
        });
        lastD = before ? -1 : d;

        // Debris ring around Earth (re-laid out when the scale changes)
        const ringOn = smooth(d, 480, 730);
        ring.visible = visible && !before && ringOn > 0.01;
        ring.material.opacity = 0.85 * ringOn;
        if (ring.visible && Math.abs(DR - ringDR) > 0.005 * DR) {
            ringDR = DR;
            for (let i = 0; i < RING_N; i++) {
                const rr = RE * Math.pow(DR, Math.log(ringR[i]) / LN_Q);
                rPos[i * 3] = Math.cos(ringA[i]) * rr;
                rPos[i * 3 + 1] = ringY[i] * RE * 0.02;
                rPos[i * 3 + 2] = Math.sin(ringA[i]) * rr;
            }
            ring.geometry.attributes.position.needsUpdate = true;
        }

        // Story notes and the info card, as each stage begins (forward only)
        let stage = -1;
        STAGES.forEach((s, i) => { if (!before && d >= s.day) stage = i; });
        if (stage > lastStage) say(STAGES[stage].text);
        lastStage = stage;
        if (moonData) {
            let desc = originalDescription;
            if (!before) DESCRIPTIONS.forEach(([day, text]) => { if (d >= day) desc = `${text} (Day ${Math.floor(d)} since it turned to cheese.)`; });
            moonData.description = desc;
        }
    }

    return {
        trigger, update, reset, rebase, showcase,
        get active() { return triggeredAt !== null; },
        get triggeredAt() { return triggeredAt; },
        get flyers() { return flyers; },
        get ready() { return planned; },                     // flights worked out (endDay, hitDays)
        get endDay() { return endDay; },                     // last impact, days after the click
        get hitDays() {                                      // every impact, days after the click
            return flyers.filter(b => !b.showcase && isFinite(b.hitTau)).map(b => b.release + b.hitTau / TAU_PER_DAY);
        },
        say
    };
}
