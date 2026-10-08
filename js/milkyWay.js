// The Milky Way as a 3D particle galaxy: central bar and bulge, an
// exponential disk, four log-spiral arms and the Orion Spur the Sun sits on.
//
// Built in light-years in a galactocentric frame (origin at Sgr A*, +X from
// the Sun toward the centre, +Z toward the north galactic pole, +Y toward
// galactic longitude 90°), then placed each frame on Sagittarius A*'s scene
// position and scaled so the Sun–centre distance matches it. That keeps the
// disk lined up with Sgr A* and the Sun in every scale mode, including the
// log-squeezed "pull far objects in" layout (where it is not to scale).
//
// Geometry roughly follows Reid et al. 2019: arms pitched ~12°, Perseus
// ~1.2 R0 out along the Sun's azimuth, Sagittarius–Carina just inside the
// Sun, bar ~27° off the Sun–centre line with its near end at positive
// longitude. The Galaxy turns clockwise seen from the north pole, so the
// trailing arms wind outward counter-clockwise.
import * as THREE from 'three';
import { raDecToAppFrame } from './celestialData.js?v=334';

export const SUN_TO_CENTER_LY = 26673;
export const MILKY_WAY_RADIUS_LY = 52000; // visible disk, for picking and framing

const ARM_PITCH = THREE.MathUtils.degToRad(12);
const TAN_PITCH = Math.tan(ARM_PITCH);
const PERSEUS_AT_SUN_LY = 32500;     // Perseus arm radius on the Sun's azimuth
const ARM_STEP = Math.PI / 2;        // four arms, 90° apart
const BAR_ANGLE = THREE.MathUtils.degToRad(27);

// Deterministic so the galaxy looks the same on every load
function mulberry32(seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function buildPoints() {
    const rand = mulberry32(20260903);
    const gauss = () => {
        let a = 0;
        while (a === 0) a = rand();
        return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * rand());
    };
    const pos = [], col = [], size = [], bright = [], fanSet = [];
    let n = 0;
    const add = (x, y, z, c, s, b) => {
        pos.push(x, y, z);
        col.push(c[0], c[1], c[2]);
        size.push(s);
        bright.push(b);
        fanSet.push(n++ % 2); // which of the fan's two spin phases (see fan())
    };
    const jitter = (c, amt) => c.map(v => Math.min(1, Math.max(0, v + (rand() - 0.5) * amt)));

    const WARM = [1.0, 0.80, 0.52], OLD = [1.0, 0.90, 0.76], YOUNG = [0.66, 0.78, 1.0],
        WHITE = [0.92, 0.94, 1.0], HII = [1.0, 0.42, 0.62];

    // Bar: triaxial, near end toward the Sun at positive longitude (+Y)
    const ux = -Math.cos(BAR_ANGLE), uy = Math.sin(BAR_ANGLE);   // bar axis
    const wx = -uy, wy = ux;                                      // across it
    for (let i = 0; i < 16000; i++) {
        const a = gauss() * 4500, w = gauss() * 1700, z = gauss() * 1200;
        add(a * ux + w * wx, a * uy + w * wy, z, jitter(WARM, 0.12), 320, 0.22);
    }
    // Long thin bar out to ~15,000 ly
    for (let i = 0; i < 5000; i++) {
        const a = (rand() * 2 - 1) * 15000, w = gauss() * 900, z = gauss() * 450;
        add(a * ux + w * wx, a * uy + w * wy, z, jitter(WARM, 0.12), 300, 0.2);
    }
    // Round inner bulge
    for (let i = 0; i < 9000; i++) {
        add(gauss() * 1600, gauss() * 1600, gauss() * 1150, jitter([1.0, 0.86, 0.62], 0.1), 260, 0.26);
    }

    // Old disk: exponential surface density (scale length ~9,000 ly)
    for (let i = 0; i < 42000; i++) {
        const r = -9000 * Math.log(Math.max(rand() * rand(), 1e-9));
        if (r > 62000 || r < 2500) { i--; continue; }
        const phi = rand() * Math.PI * 2;
        add(r * Math.cos(phi), r * Math.sin(phi), gauss() * 750, jitter(OLD, 0.1), 420, 0.11);
    }

    // Spiral arms. Arm k sits a factor exp(k·step·tan pitch) inside Perseus at
    // a fixed azimuth: k = 0 Perseus, 1 Sagittarius–Carina, 2 Scutum–Centaurus,
    // 3 Norma / Outer. Perseus and Scutum–Centaurus are the major stellar arms.
    const armPoint = (k, r) => Math.PI + (Math.log(r / PERSEUS_AT_SUN_LY) + k * ARM_STEP * TAN_PITCH) / TAN_PITCH;
    const R_START = 10500, R_END = 56000;
    for (let k = 0; k < 4; k++) {
        const major = k % 2 === 0;
        const count = major ? 24000 : 15000;
        let made = 0;
        while (made < count) {
            // log-uniform in r (fewer points per length further out), extra fade
            const r0 = R_START * Math.pow(R_END / R_START, rand());
            if (rand() > Math.exp(-(r0 - R_START) / 45000)) continue;
            // Fade in from the bar ends
            if (r0 < R_START + 3000 && rand() > (r0 - R_START) / 3000) continue;
            const phi0 = armPoint(k, r0);
            const width = 800 + 0.035 * r0;
            // Clumps of young stars and star-forming regions along the arm
            const clump = rand() < 0.55;
            const n = clump ? 18 : 1;
            const spread = clump ? 380 : width;
            const cr = r0 + (clump ? gauss() * width * 0.7 : 0);
            for (let j = 0; j < n && made < count; j++, made++) {
                const r = cr + gauss() * spread;
                const phi = phi0 + gauss() * spread / Math.max(r, 1) * 0.6;
                const z = gauss() * (clump ? 220 : 380);
                const roll = rand();
                if (roll < 0.035) add(r * Math.cos(phi), r * Math.sin(phi), z, jitter(HII, 0.1), 200, 0.9);
                else if (roll < 0.09) add(r * Math.cos(phi), r * Math.sin(phi), z, jitter(YOUNG, 0.08), 160, 1.0);
                else add(r * Math.cos(phi), r * Math.sin(phi), z, jitter(rand() < 0.6 ? YOUNG : WHITE, 0.1), 280, major ? 0.3 : 0.24);
            }
        }
    }

    // Orion Spur: a short, fainter arm segment running through the Sun
    for (let i = 0; i < 6000; i++) {
        const r0 = 23500 + rand() * 7500;
        const phi = Math.PI + Math.log(r0 / SUN_TO_CENTER_LY) / TAN_PITCH + gauss() * 0.03;
        const r = r0 + gauss() * 1100;
        add(r * Math.cos(phi), r * Math.sin(phi), gauss() * 280, jitter(rand() < 0.6 ? YOUNG : WHITE, 0.1), 260, 0.16);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('tint', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('bright', new THREE.Float32BufferAttribute(bright, 1));
    g.setAttribute('fanSet', new THREE.Float32BufferAttribute(fanSet, 1));
    // Galaxy-sized bounds (the shader moves nothing, but keep culling honest)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 65000);
    return g;
}

// Cursor fan GLSL, shared with the other galaxies (galaxies.js). Needs the
// TRAIL_N define and a per-particle `fanSet` attribute (alternating 0/1)
export const FAN_GLSL_UNIFORMS = /* glsl */`
    // Cursor fan (device px, GL origin bottom-left; z = strength 0..1)
    uniform vec3 uCursor;
    uniform vec3 uTrail[TRAIL_N];
    uniform float uFanR;
    uniform float uWakeR;
    uniform float uSpin;
    uniform vec2 uViewport;
`;
export const FAN_GLSL_FUNCTIONS = /* glsl */`
    vec2 rotateAbout(vec2 p, vec2 c, float a) {
        vec2 d = p - c;
        float cs = cos(a), sn = sin(a);
        return c + vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    }
    // Open a hole of radius h around c by pushing outward; r -> sqrt(r² + h²)
    // keeps area, so particles don't pile up into a bright rim
    vec2 hole(vec2 p, vec2 c, float h) {
        vec2 d = p - c;
        float r = length(d);
        if (r < 1e-3) return c + vec2(h, 0.0);
        return c + d * (sqrt(r * r + h * h) / r);
    }
    // The fan: hole under the cursor and particles spinning round it. The
    // inner ring turns rigidly (angle = spin phase, which wraps every turn
    // with no visible change); further out the turn tapers off (angle =
    // phase · g), which would jump at the wrap. So particles come in two sets
    // spinning half a turn apart, and each set's tapered particles fade out
    // as their phase wraps (sin² weights, the two sets sum to constant light).
    // s: 0 = off, 1 = full; alpha is scaled in place
    vec2 fan(vec2 p, vec2 c, float R, float s, inout float alpha) {
        p = hole(p, c, R * 0.8 * s);
        float r = length(p - c);
        float g = 1.0 - smoothstep(R * 1.1, R * 2.0, r);
        if (g <= 0.0) return p;
        float ph = mod(uSpin + fanSet * 3.14159265, 6.28318531);
        float band = 4.0 * g * (1.0 - g);
        float sh = sin(ph * 0.5);
        alpha *= mix(1.0, 2.0 * sh * sh, band * s);
        float twist = 1.2 * exp(-(r * r) / (R * R * 2.0));
        return rotateAbout(p, c, s * (ph * g + twist));
    }
    // A wake swirl: a small vortex that unwinds as s fades, so the particles
    // slide back to where they belong
    vec2 wake(vec2 p, vec2 c, float R, float s) {
        p = hole(p, c, R * 0.3 * s);
        vec2 d = p - c;
        float g = exp(-dot(d, d) / (R * R));
        return rotateAbout(p, c, 2.4 * s * g);
    }

    // Swirl a vertex (clip space) round the cursor and its wake; a: alpha
    void applyFan(inout vec4 clip, inout float a) {
        if ((uCursor.z > 0.001 || uTrail[0].z > 0.001) && clip.w > 0.0) {
            vec2 pix = (clip.xy / clip.w * 0.5 + 0.5) * uViewport;
            // Wake first (oldest to newest), then the fan at the cursor on top
            for (int i = TRAIL_N - 1; i >= 0; i--) {
                if (uTrail[i].z > 0.001) pix = wake(pix, uTrail[i].xy, uWakeR, uTrail[i].z);
            }
            if (uCursor.z > 0.001) pix = fan(pix, uCursor.xy, uFanR, uCursor.z, a);
            clip.xy = (pix / uViewport * 2.0 - 1.0) * clip.w;
        }
    }
`;

const vertexShader = /* glsl */`
    attribute vec3 tint;
    attribute float size;
    attribute float bright;
    attribute float fanSet;
    uniform float uPxPerUnit;   // pixels per scene unit at distance 1
    // Placement: particle positions are light-years in the galactic frame;
    // they're turned into Sun-relative light-years (uBasis, uCenterLy) and
    // then laid out with the same distance mapping as the stars (see
    // mapDistLy in this file), times a factor easing from 1 near the Sun to
    // uK at the centre's distance so the centre lands on Sgr A* (see kAt)
    uniform mat3 uBasis;
    uniform vec3 uCenterLy;
    uniform float uStarU, uU0, uD0, uTrueU, uW, uBlend, uK, uCenterDist;
    uniform float uOpacity;
    uniform float uNearFade;    // scene units: points closer than this fade out
${FAN_GLSL_UNIFORMS}    varying vec3 vColor;
    varying float vAlpha;
    #include <common>
    #include <logdepthbuf_pars_vertex>

${FAN_GLSL_FUNCTIONS}
    float mapDistLy(float d) {
        float lin = d * uStarU;
        if (uBlend <= 0.0) return lin;
        float L = d <= uD0 ? d : uD0 * (1.0 + log(d / uD0));
        float r0 = max(L * uU0, 1e-6);
        float r1 = max(d * uTrueU, r0);
        float pulled = min(r0 * pow(r1 / r0, uW), lin); // pull-in never pushes out
        return lin * pow(pulled / max(lin, 1e-6), uBlend);
    }

    void main() {
        vec3 pLy = uBasis * position + uCenterLy;
        float d = max(length(pLy), 1e-3);
        float kd = min(d / uCenterDist, 1.0);
        float r = mapDistLy(d) * (1.0 + (uK - 1.0) * kd * kd);
        float uUnitsPerLy = r / d; // local scale (sideways), for point sizes
        vec4 mv = viewMatrix * vec4(pLy * uUnitsPerLy, 1.0);
        gl_Position = projectionMatrix * mv;
        float a = bright * uOpacity;
        applyFan(gl_Position, a);
        float px = size * uUnitsPerLy * uPxPerUnit / max(-mv.z, 1e-9);
        // Nearby points would be huge soft blobs over whatever you're looking at
        a *= smoothstep(uNearFade * 0.3, uNearFade, -mv.z);
        // Keep each point's total light constant when its size is clamped, so
        // the galaxy doesn't flare up when seen from far away (tiny points) or
        // turn into big blobs right next to the camera
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

// Galactocentric axes in the app frame (unit vectors, J2000 positions)
function galacticBasis() {
    const v = ({ x, y, z }) => new THREE.Vector3(x, y, z).normalize();
    const toCenter = v(raDecToAppFrame(266.40499, -28.93617));   // l = 0°, b = 0°
    const north = v(raDecToAppFrame(192.85948, 27.12825));       // NGP
    const l90 = v(raDecToAppFrame(318.00438, 48.32963));         // l = 90°, b = 0°
    return { x: toCenter, y: l90, z: north };
}

export function createMilkyWay() {
    const material = new THREE.ShaderMaterial({
        vertexShader, fragmentShader,
        uniforms: { uPxPerUnit: { value: 1 }, uOpacity: { value: 1 }, uNearFade: { value: 0 },
            uBasis: { value: new THREE.Matrix3() }, uCenterLy: { value: new THREE.Vector3() },
            uStarU: { value: 1 }, uU0: { value: 1 }, uD0: { value: 4.24 }, uTrueU: { value: 1 },
            uW: { value: 1 }, uBlend: { value: 0 }, uK: { value: 1 }, uCenterDist: { value: SUN_TO_CENTER_LY },
            uCursor: { value: new THREE.Vector3() }, uTrail: { value: Array.from({ length: TRAIL_N }, () => new THREE.Vector3()) },
            uFanR: { value: 180 }, uWakeR: { value: 48 }, uSpin: { value: 0 }, uViewport: { value: new THREE.Vector2(1, 1) } },
        defines: { TRAIL_N },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(buildPoints(), material);
    points.raycast = () => {}; // decorative; never picked
    points.frustumCulled = false; // camera often sits inside it

    const group = new THREE.Group();
    group.name = 'Milky Way';
    group.add(points);
    group.matrixAutoUpdate = false;
    const b = galacticBasis();
    group.userData.basis = new THREE.Matrix4().makeBasis(b.x, b.y, b.z);
    group.userData.material = material;
    material.uniforms.uBasis.value.setFromMatrix4(group.userData.basis);
    group.userData.fan = { level: 0, trail: [], lastTime: 0, spin: 0 };
    return group;
}

// Sun is at the scene origin. centerPos: Sgr A*'s scene position.
// pxPerUnit: drawing-buffer height / (2·tan(fov/2)). focusDist: camera's
// distance to what it's looking at.
// Fades out as the camera comes in toward the Sun, where the disk would only
// add a second Milky Way band over the background sky. Dimmed to a backdrop
// while you're zoomed in on something (a star, a black hole) so it doesn't
// bury clickable objects; full brightness when the view is galaxy-sized or
// the galaxy is far away.
// Scene distance for a true distance in light-years, matching the stars:
// linear (starU per ly), or with "Pull far objects in" the log-squeezed
// arrangement gliding to the truth (r0^(1−w)·r1^w), blended geometrically
// by the toggle's animation weight. m: see main.js milkyWayDistanceMap().
// (The stars' own no-overlap and Solar-System-clearance pushes aren't
// copied; they only nudge individual stars outward.)
function mapDistLy(d, m) {
    const lin = d * m.starU;
    if (m.blend <= 0) return lin;
    const L = d <= m.d0 ? d : m.d0 * (1 + Math.log(d / m.d0));
    const r0 = Math.max(L * m.u0, 1e-6);
    const r1 = Math.max(d * m.trueU, r0);
    const pulled = Math.min(r0 * Math.pow(r1 / r0, m.w), lin); // pull-in never pushes out
    return lin * Math.pow(pulled / Math.max(lin, 1e-6), m.blend);
}

const BACKDROP_OPACITY = 0.18;
export function updateMilkyWay(group, centerPos, cameraPos, pxPerUnit, focusDist, pointer, distMap) {
    const r0 = centerPos.length();
    if (r0 < 1e-9) { group.visible = false; return 0; }
    const m = group.userData.material;
    const u = m.uniforms;
    // Lay the disk out like the stars, then stretch it so the centre sits on
    // Sgr A*, which the stars' no-overlap rule pushes out a little (13% with
    // pull-in on). The stretch eases in with distance (kAt) so the objects
    // between here and the centre, which aren't pushed, stay put.
    u.uStarU.value = distMap.starU;
    u.uU0.value = distMap.u0;
    u.uD0.value = distMap.d0;
    u.uTrueU.value = distMap.trueU;
    u.uW.value = distMap.w;
    u.uBlend.value = distMap.blend;
    const k = r0 / mapDistLy(SUN_TO_CENTER_LY, distMap);
    u.uK.value = k;
    u.uCenterLy.value.copy(centerPos).multiplyScalar(SUN_TO_CENTER_LY / r0);
    // Scene units per light-year around the centre (fades, fan sizes)
    const unitsPerLy = r0 / SUN_TO_CENTER_LY;
    // Hidden while "Pull far objects in" is squeezing distances: there the
    // giant stars are pushed well outside any disk (they're drawn far too big
    // for their squeezed spots) and a warped disk turns into a fisheye ball.
    // Pull-in is for comparing objects, not geography. Fades with how
    // squeezed the layout is (toggle animation × slider, gone by Realistic).
    const squeeze = distMap.blend * (1 - distMap.w);
    const t = THREE.MathUtils.smoothstep(cameraPos.length() / r0, 0.04, 0.3)
        * (1 - THREE.MathUtils.smoothstep(squeeze, 0.05, 0.4));
    const wide = Math.max(THREE.MathUtils.smoothstep(focusDist / r0, 0.05, 0.6),
        THREE.MathUtils.smoothstep(cameraPos.distanceTo(centerPos) / r0, 6, 20));
    u.uOpacity.value = t * THREE.MathUtils.lerp(BACKDROP_OPACITY, 1, wide);
    u.uNearFade.value = 3000 * unitsPerLy;
    u.uPxPerUnit.value = pxPerUnit;
    // The group sits on the centre (for picking and fly-to); the shader
    // places the particles itself
    group.matrix.makeTranslation(centerPos.x, centerPos.y, centerPos.z);
    group.matrixWorldNeedsUpdate = true;
    // Disk radius in scene units, measured along the Sun–centre line (rims
    // beyond the centre and behind the Sun); the warp makes them unequal
    const kAt = d => { const f = Math.min(d / SUN_TO_CENTER_LY, 1); return 1 + (k - 1) * f * f; };
    const dFar = SUN_TO_CENTER_LY + MILKY_WAY_RADIUS_LY, dNear = MILKY_WAY_RADIUS_LY - SUN_TO_CENTER_LY;
    const far = mapDistLy(dFar, distMap) * kAt(dFar);
    const near = mapDistLy(dNear, distMap) * kAt(dNear);
    group.userData.previewRadius = (far + near) / 2; // magnifier framing, picking
    // Fan only when the galaxy is the view: bright and big on screen
    const screenR = group.userData.previewRadius * pxPerUnit / Math.max(cameraPos.distanceTo(centerPos), 1e-9);
    updateFan(group, pointer, t * wide > 0.6 && screenR > 250 * (pointer?.dpr || 1));
    return t;
}

// ── Cursor fan ──────────────────────────────────────────────────────────
// A spinning disc of particles follows the cursor and keeps a hole open under
// it; moving leaves a wake of smaller swirls that fade over WAKE_S, letting
// the particles drift back to where they belong. All in the vertex shader
// from the cursor and its recent trail, so nothing per particle is stored.
const TRAIL_N = 24;
const FAN_RADIUS_CSS = 180;         // px
const WAKE_RADIUS_CSS = 48;         // px
const WAKE_SPACING_CSS = 14;        // px between trail samples
const WAKE_S = 1.5;                 // seconds for a wake swirl to settle
const FAN_SPIN = 1.4;               // rad/s
const FAN_EASE_S = 0.25;            // fan fade in/out time constant

function updateFan(group, pointer, allowed) {
    stepFan(group.userData.fan, group.userData.material.uniforms, pointer, allowed);
}

export const FAN_DEFINES = { TRAIL_N };
export function makeFanUniforms() {
    return { uCursor: { value: new THREE.Vector3() }, uTrail: { value: Array.from({ length: TRAIL_N }, () => new THREE.Vector3()) },
        uFanR: { value: 180 }, uWakeR: { value: 48 }, uSpin: { value: 0 }, uViewport: { value: new THREE.Vector2(1, 1) } };
}
export function newFanState() { return { level: 0, trail: [], lastTime: 0, spin: 0 }; }

// One frame of a fan: ease it in or out, lay down the wake, fill the uniforms
export function stepFan(fan, u, pointer, allowed) {
    const now = performance.now() / 1000;
    const dt = Math.min(fan.lastTime ? now - fan.lastTime : 0, 0.1);
    fan.lastTime = now;
    const on = allowed && pointer?.inside;
    fan.level += ((on ? 1 : 0) - fan.level) * (1 - Math.exp(-dt / FAN_EASE_S));
    if (fan.level < 0.002 && !fan.trail.length) {
        u.uCursor.value.z = 0;
        u.uTrail.value[0].z = 0;
        return;
    }
    const dpr = pointer?.dpr || 1;
    fan.spin = (fan.spin + FAN_SPIN * dt) % (Math.PI * 2);
    u.uSpin.value = fan.spin;
    u.uFanR.value = FAN_RADIUS_CSS * dpr;
    u.uWakeR.value = WAKE_RADIUS_CSS * dpr;
    if (pointer) u.uViewport.value.set(pointer.viewW, pointer.viewH);

    // Lay down wake samples along the path (filling gaps on fast moves)
    // (anchor: where the last sample was laid, or where the cursor came in)
    if (on) {
        const a = fan.anchor;
        if (!a) fan.anchor = { x: pointer.x, y: pointer.y };
        else {
            const dx = pointer.x - a.x, dy = pointer.y - a.y;
            const steps = Math.min(Math.floor(Math.hypot(dx, dy) / (WAKE_SPACING_CSS * dpr)), TRAIL_N);
            if (steps > 0) {
                for (let i = 1; i <= steps; i++) fan.trail.push({ x: a.x + dx * i / steps, y: a.y + dy * i / steps, t: now });
                fan.anchor = { x: pointer.x, y: pointer.y };
            }
        }
    } else {
        fan.anchor = null;
    }
    fan.trail = fan.trail.filter(p => now - p.t < WAKE_S).slice(-TRAIL_N);

    if (pointer) u.uCursor.value.set(pointer.x, pointer.y, fan.level);
    else u.uCursor.value.z = fan.level;
    // Newest first in the uniform array; strength eases out with age
    for (let i = 0; i < TRAIL_N; i++) {
        const p = fan.trail[fan.trail.length - 1 - i];
        if (!p) { u.uTrail.value[i].z = 0; continue; }
        const k = 1 - (now - p.t) / WAKE_S;
        u.uTrail.value[i].set(p.x, p.y, 0.45 * k * k * Math.max(fan.level, 0.3));
    }
}

// Switch the fan off for another view of the scene (the magnifier)
export function suspendMilkyWayFan(group, suspended) {
    const u = group.userData.material.uniforms;
    if (suspended) {
        group.userData.fanSaved = [u.uCursor.value.z, u.uTrail.value[0].z];
        u.uCursor.value.z = 0;
        u.uTrail.value[0].z = 0;
    } else if (group.userData.fanSaved) {
        [u.uCursor.value.z, u.uTrail.value[0].z] = group.userData.fanSaved;
    }
}

// ── Milky Way in the night sky ──────────────────────────────────────────
// The band as seen from home, painted on the sky sphere: brightest and widest
// toward Sagittarius (the centre), warm there and bluish-white elsewhere,
// broken into star clouds by noise and crossed by dust lanes, with the Great
// Rift splitting it from Cygnus down to Sagittarius. Drawn behind everything
// (skybox: depth ignored, at the far end of the view), additively.
const skyVertexShader = /* glsl */`
    varying vec3 vDir;
    void main() {
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
    }
`;

const skyFragmentShader = /* glsl */`
    uniform vec3 uGx, uGy, uGz;   // galactic axes: centre, l = 90°, north pole
    uniform float uGlow;
    varying vec3 vDir;
    float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float noise(vec3 x) {
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                       mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                       mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
    }
    void main() {
        vec3 d = normalize(vDir);
        float ld = degrees(atan(dot(d, uGy), dot(d, uGx)));        // longitude, 0 = centre
        float bd = degrees(asin(clamp(dot(d, uGz), -1.0, 1.0)));  // latitude
        // Band: thicker and brighter toward the centre; bulge around it
        float centre = exp(-pow(ld / 55.0, 2.0));
        float width = 4.5 + 4.5 * centre;
        float band = exp(-pow(bd / width, 2.0)) * (0.3 + 0.7 * centre);
        float bulge = exp(-(ld * ld + bd * bd * 2.2) / (2.0 * 11.0 * 11.0));
        // Star clouds (noise on the direction, so there's no seam)
        float clouds = 0.35 + 1.8 * fbm(d * 9.0) * fbm(d * 27.0 + 3.1);
        // Fine grain: the band is unresolved stars, not a smooth cloud
        float grain = 0.65 + 0.7 * noise(d * 240.0);
        // Dust: patchy lanes hugging the plane, and the Great Rift just north
        // of it from Cygnus (l ≈ 70°) to Sagittarius
        float rift = exp(-pow((bd - 1.5 - 1.5 * sin(radians(ld) * 3.0)) / 2.4, 2.0))
            * smoothstep(80.0, 60.0, ld) * smoothstep(-20.0, -2.0, ld);
        // (the lane wanders and changes width, so it reads as clouds of dust
        // rather than a ruled line)
        float laneB = 2.4 * (fbm(d * 5.0) - 0.5);
        float laneW = 0.9 + 2.2 * fbm(d * 4.0 + 11.0);
        float lane = exp(-pow((bd - laneB) / laneW, 2.0));
        // Combined like layers of fog (adding them saturated into a flat
        // dark slab where the rift crosses the lane), each broken up by noise
        rift *= smoothstep(0.25, 0.65, fbm(d * 8.0 + 2.0));
        lane *= smoothstep(0.25, 0.7, fbm(d * 12.0 + 7.0) + 0.12);
        float dust = 1.0 - (1.0 - 0.8 * rift) * (1.0 - 0.65 * lane);
        float I = (band * clouds * grain + bulge * (0.8 + 0.4 * grain)) * (1.0 - 0.9 * dust);
        vec3 col = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.86, 0.68), clamp(centre * 0.7 + bulge, 0.0, 1.0));
        gl_FragColor = vec4(col * I * uGlow, 1.0);
    }
`;

// Painting the band per pixel per frame (~30 noise lookups each) was heavy on
// big high-DPI screens (Chrome slowed right down), so it's painted once into
// a cube map at startup and the sky just looks it up.
const SKY_BAKE_SIZE = 1024;       // per cube face: ~0.09° per texel
const SKY_GLOW_MAX = 0.45;        // brightness at the top of the slider
const bakeVertexShader = /* glsl */`
    varying vec3 vDir;
    void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const skyLookupFragmentShader = /* glsl */`
    uniform samplerCube uSky;
    uniform float uGain;
    varying vec3 vDir;
    void main() {
        gl_FragColor = vec4(textureCube(uSky, normalize(vDir)).rgb * uGain, 1.0);
    }
`;

export function createMilkyWaySkyGlow(renderer) {
    const b = galacticBasis();
    // Bake: a camera at the centre of the painted sphere renders all six faces
    const bakeScene = new THREE.Scene();
    bakeScene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.ShaderMaterial({
        vertexShader: bakeVertexShader, fragmentShader: skyFragmentShader,
        uniforms: { uGx: { value: b.x }, uGy: { value: b.y }, uGz: { value: b.z }, uGlow: { value: SKY_GLOW_MAX } },
        side: THREE.BackSide, depthTest: false, depthWrite: false
    })));
    const target = new THREE.WebGLCubeRenderTarget(SKY_BAKE_SIZE, {
        generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter
    });
    const cubeCamera = new THREE.CubeCamera(0.1, 10, target);
    cubeCamera.update(renderer, bakeScene);
    bakeScene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.ShaderMaterial({
        vertexShader: skyVertexShader, fragmentShader: skyLookupFragmentShader,
        uniforms: { uSky: { value: target.texture }, uGain: { value: 0 } },
        // Not "transparent": three.js draws transparent things after every
        // solid object, so the glow landed on top of Earth's night side. In the
        // solid pass with renderOrder −2 it's drawn first, and depth-tested at
        // the far end of the view so anything in front still covers it.
        side: THREE.BackSide, transparent: false, depthTest: true, depthWrite: false,
        blending: THREE.AdditiveBlending
    }));
    mesh.name = 'milkyWaySkyGlow';
    mesh.renderOrder = -2; // before the sky's stars
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    return mesh;
}

// level: the user's slider, 0..1; fade: 0..1 (gone out among the stars)
export function setMilkyWaySkyGlow(mesh, level, fade) {
    // Eased (^1.5) so the low end of the slider stays subtle
    const gain = Math.pow(level, 1.5) * fade;
    mesh.material.uniforms.uGain.value = gain;
    mesh.visible = gain > 1e-4;
}
