import * as THREE from 'three';

// Shared by every effect: one update per frame, no per-object animation work.
export const stellarTime = { value: 0 };

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT) and animated cellular
// noise. Noise is sampled on the object-space sphere, so there's no UV seam or
// pole pinching (sine patterns on a sphere read as watermelon stripes).
const NOISE_GLSL = `
vec3 sn_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 sn_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 sn_permute(vec4 x) { return sn_mod289(((x * 34.0) + 10.0) * x); }
vec4 sn_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = sn_mod289(i);
    vec4 p = sn_permute(sn_permute(sn_permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = sn_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
vec3 cell_hash(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
}
// Distances to the nearest and second-nearest feature points; the points
// wander so the cells boil
vec2 worley(vec3 x, float t) {
    vec3 i = floor(x), f = fract(x);
    float F1 = 8.0, F2 = 8.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int k = -1; k <= 1; k++) {
        vec3 g = vec3(float(k), float(y), float(z));
        vec3 o = cell_hash(i + g);
        o = 0.5 + 0.42 * sin(t + 6.2831 * o);
        vec3 r = g + o - f;
        float d = dot(r, r);
        if (d < F1) { F2 = F1; F1 = d; } else if (d < F2) { F2 = d; }
    }
    return sqrt(vec2(F1, F2));
}
`;

// Extend built-in materials so logarithmic depth and color management remain intact.
// Also provides view-space normal / eye vector for limb effects.
function shade(material, declarations, fragment, vertex = '') {
    material.onBeforeCompile = shader => {
        shader.uniforms.stellarTime = stellarTime;
        Object.assign(shader.uniforms, material.userData.uniforms || {});
        shader.vertexShader = `varying vec3 stellarPosition;\nvarying vec3 stellarNormal;\nvarying vec3 stellarViewPosition;\n${shader.vertexShader}`
            .replace('#include <begin_vertex>', `#include <begin_vertex>\nstellarPosition = position;\n${vertex}`)
            .replace('#include <project_vertex>',
                '#include <project_vertex>\nstellarNormal = normalize(normalMatrix * normal);\nstellarViewPosition = -mvPosition.xyz;');
        shader.fragmentShader = `uniform float stellarTime;\nvarying vec3 stellarPosition;\nvarying vec3 stellarNormal;\nvarying vec3 stellarViewPosition;\n${declarations}\n${shader.fragmentShader}`
            .replace('#include <color_fragment>', `#include <color_fragment>\n${fragment}`);
    };
    material.customProgramCacheKey = () => declarations + fragment + vertex;
    return material;
}

// Photosphere: boiling granulation cells, large-scale mottling, starspots and
// limb darkening. Per-star settings are uniforms so every star shares one
// shader program:
//   cells   granulation cells per radius (big stars have few, huge cells)
//   spots   starspot strength (cool stars are spotty, hot ones aren't)
//   mottle  large-scale brightness variation (low for the Sun's real map)
export function enhanceStarSurface(material, { cells = 55, spots = 0.5, mottle = 0.14 } = {}) {
    material.userData.uniforms = {
        uCells: { value: cells }, uSpots: { value: spots }, uMottle: { value: mottle }
    };
    return shade(material, NOISE_GLSL + 'uniform float uCells; uniform float uSpots; uniform float uMottle;', `
        vec3 p = normalize(stellarPosition);
        float t = stellarTime;
        vec3 warp = vec3(snoise(p * 3.0 + vec3(0.0, 0.0, t * 0.012)),
                         snoise(p * 3.0 + vec3(17.0, 0.0, -t * 0.010)),
                         snoise(p * 3.0 + vec3(0.0, 31.0, t * 0.011)));
        // Granulation: bright cell interiors, dark intergranular lanes
        vec3 gp = p * uCells + warp * 0.8;
        vec2 w = worley(gp, t * 0.25);
        float gran = smoothstep(0.02, 0.4, w.y - w.x);
        // Fade the cells out when they shrink below a pixel (else they shimmer)
        float cellPx = length(fwidth(gp));
        float granAmt = 1.0 - smoothstep(0.35, 1.0, cellPx);
        // Supergranulation / faculae mottling
        float mott = snoise(p * 6.0 + warp * 0.6) * 0.6 + snoise(p * 15.0 - warp) * 0.4;
        // Starspots: slowly evolving dark patches with a penumbra
        // (two octaves so spots are few, soft-edged and irregular, not holes)
        float s = snoise(p * 2.6 + warp * 0.3 + vec3(t * 0.003)) * 0.75
                + snoise(p * 9.0 - warp * 0.5) * 0.25;
        float umbra = smoothstep(0.62, 0.8, s);
        float penumbra = smoothstep(0.45, 0.68, s);
        float bright = 1.0 + uMottle * mott;
        bright *= mix(1.0, 0.74 + 0.36 * gran, granAmt * 0.85);
        bright *= 1.0 - uSpots * (0.22 * penumbra + 0.4 * umbra);
        // Limb darkening: the edge shows cooler, higher layers
        float mu = clamp(dot(normalize(stellarNormal), normalize(stellarViewPosition)), 0.0, 1.0);
        float limb = 1.0 - 0.62 * (1.0 - pow(mu, 0.85));
        vec3 col = diffuseColor.rgb * bright * limb;
        col *= mix(vec3(1.0), vec3(1.06, 0.86, 0.7), (1.0 - mu) * 0.6);
        diffuseColor.rgb = col;
    `);
}

export function createCorona(radius, color) {
    const material = shade(new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
    }), NOISE_GLSL, `
        float facing = abs(dot(normalize(stellarNormal), normalize(stellarViewPosition)));
        float rim = 6.0 * facing * exp(-8.0 * facing);
        vec3 p = normalize(stellarPosition);
        float rays = 0.75 + 0.25 * snoise(p * 5.0 + vec3(stellarTime * 0.03));
        diffuseColor.a *= rim * rays;
    `);
    const corona = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.12, 32, 24), material);
    corona.name = 'stellarCorona';
    corona.raycast = () => {};
    return corona;
}

// Plasma at the limb: a camera-facing disc drawn just outside the star's
// silhouette — flickering spicules all round, plus tall prominence loops that
// rise in a few regions and drift. Additive, so it lights up what's behind.
const LIMB_EXTENT = 1.8; // disc radius in star radii
export function createStellarLimb(radius, color) {
    const uniforms = { uLimbRadius: { value: radius } };
    const material = new THREE.MeshBasicMaterial({
        color, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
    });
    material.userData.uniforms = uniforms;
    shade(material, NOISE_GLSL + 'uniform float uLimbRadius;', `
        vec2 xy = stellarPosition.xy / uLimbRadius;
        float r = length(xy);
        if (r < 0.985) discard;
        float h = r - 1.0;                   // height above the limb, in radii
        vec2 dir = xy / r;
        float t = stellarTime;
        // Spicules / flickering chromosphere
        float n1 = snoise(vec3(dir * 5.0, h * 4.0 - t * 0.22));
        float n2 = snoise(vec3(dir * 16.0, h * 10.0 - t * 0.5));
        float reach = 0.025 + 0.045 * (0.5 + 0.5 * n1) + 0.02 * (0.5 + 0.5 * n2);
        float spicules = exp(-h / reach);
        // Prominences: a few regions where soft plumes of plasma climb high.
        // Stretched along the height axis and domain-warped so they curl up
        // from the surface like flames rather than forming a crack network.
        float region = smoothstep(0.3, 0.7, snoise(vec3(dir * 1.3, t * 0.01)));
        vec2 wp = dir * 6.0 + 0.6 * vec2(snoise(vec3(dir * 3.0, h * 3.0 - t * 0.05)),
                                          snoise(vec3(dir * 3.0 + 9.0, h * 3.0 - t * 0.05)));
        float plume = 0.5 + 0.5 * snoise(vec3(wp, h * 1.6 - t * 0.04));
        plume = smoothstep(0.45, 0.95, plume);
        float wisps = 0.65 + 0.35 * snoise(vec3(dir * 22.0, h * 6.0 - t * 0.15));
        float prom = region * plume * wisps * exp(-h / 0.12) * smoothstep(0.0, 0.02, h);
        // Thin rim hugging the photosphere
        float rim = exp(-h * 70.0);
        float fade = smoothstep(1.0, 0.8, r / ${LIMB_EXTENT.toFixed(2)});
        vec3 base = diffuseColor.rgb;
        vec3 promColor = base * vec3(1.25, 0.6, 0.38);   // cooler, reddish plasma
        vec3 col = base * (0.45 * rim + 0.5 * spicules) + promColor * 1.4 * prom;
        diffuseColor.rgb = col * fade;
        diffuseColor.a = 1.0;
    `);
    const limb = new THREE.Mesh(new THREE.PlaneGeometry(2 * LIMB_EXTENT * radius, 2 * LIMB_EXTENT * radius), material);
    limb.name = 'stellarLimb';
    limb.raycast = () => {};
    // Face the camera, and push the rim out to the silhouette as seen from
    // here: up close the visible limb in the centre plane is at R/√(1−R²/d²)
    const starPos = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    limb.onBeforeRender = (_renderer, _scene, camera) => {
        const star = limb.parent;
        if (!star) return;
        star.getWorldPosition(starPos);
        camera.getWorldPosition(camPos);
        star.getWorldScale(scale);
        limb.lookAt(camPos);
        limb.updateMatrixWorld(true);
        const d = camPos.distanceTo(starPos) / scale.x;
        const k = Math.min(radius / Math.max(d, radius * 1.01), 0.99);
        uniforms.uLimbRadius.value = radius / Math.sqrt(1 - k * k);
    };
    return limb;
}

// Black holes are drawn by js/blackHole.js (ray-traced disk and shadow)
