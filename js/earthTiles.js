// Streaming satellite imagery for Earth close-ups. A quadtree of Web-Mercator
// tiles (Esri World Imagery) is draped over the globe as curved patches,
// children of the Earth mesh so they spin with it. Only levels sharper than
// the 8K base texture (z ≥ MIN_RENDER_Z) are drawn; below that the base globe
// shows through.
import * as THREE from 'three';

const TILE_URL = (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false`; // 404 instead of a "no data" placeholder
const ATTRIBUTION = 'Powered by Esri · Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const ROOT_Z = 2;
// Draw from z4 even though the 8K base map is about as sharp: Esri's colours
// differ from the base map (darker oceans), so if unloaded areas fell back to
// the base globe, loading showed as a zig-zag of light and dark squares. A
// z4 layer is only a few dozen tiles for the whole view, so it's ready almost
// at once and sharper tiles then refine it in the same colours.
const MIN_RENDER_Z = 4;
const MAX_Z = 17;         // Esri has gaps beyond this in rural areas
const SPLIT = 0.45;       // split when tile size / camera distance exceeds this
const MAX_INFLIGHT = 8;
const MAX_CACHED = 500;
// Tiles start below this altitude (Earth radii). Higher up, the 8K base map is
// sharp enough, and the whole disk would need ~1500 z6 tiles; lower, the
// view frustum limits coverage to a few dozen, so there's no patchy edge.
const MAX_ALT = 0.4;
const MAX_MERC_LAT = 85.05112878;

const cache = new Map();   // key → { z, x, y, mesh, texture, state: 'loading'|'ready'|'error', used }
// Decode tile JPEGs off the main thread (createImageBitmap). ImageBitmaps
// ignore texture.flipY, so the flip is done at decode time instead.
const loader = new THREE.ImageBitmapLoader();
loader.setOptions({ imageOrientation: 'flipY' });
loader.setCrossOrigin('anonymous');
const MAX_BUILDS_PER_FRAME = 4; // spread GPU uploads out when many tiles land at once
const readyQueue = [];          // decoded tiles waiting for a mesh
let root = null;
let attributionEl = null;
let inflight = 0;
let frame = 0;
let maxAnisotropy = 4;

// Lighting shared by every tile (same uniform objects, so main.js updates them
// once per frame). Tiles use a small custom shader instead of
// MeshStandardMaterial: only the Sun matters this close to Earth, and the full
// PBR loop over every scene light was costing several ms per frame. The night
// map is the globe's own texture, sampled via a second UV set (`uv1`, lon/lat),
// so no per-tile copies of the 8K image are ever uploaded.
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;
export const tileLighting = {
    uSunDirView: { value: new THREE.Vector3(1, 0, 0) },
    uSunIntensity: { value: 3.5 },
    uAmbient: { value: 0.01 },
    uNightStrength: { value: 0 },
    nightMap: { value: BLACK }
};

const TILE_VERTEX = /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    // (uv1 is declared by three.js itself because the geometry has it)
    varying vec2 vUv;
    varying vec2 vUv1;
    varying vec3 vNormalView;
    void main() {
        vUv = uv;
        vUv1 = uv1;
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
    }`;

const TILE_FRAGMENT = /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D map;
    uniform sampler2D nightMap;
    uniform vec3 uSunDirView;
    uniform float uSunIntensity;
    uniform float uAmbient;
    uniform float uNightStrength;
    varying vec2 vUv;
    varying vec2 vUv1;
    varying vec3 vNormalView;
    void main() {
        #include <logdepthbuf_fragment>
        float sunDot = dot(normalize(vNormalView), uSunDirView);
        // Lambert, matching MeshStandardMaterial's albedo / PI scaling
        vec3 color = texture2D(map, vUv).rgb * RECIPROCAL_PI * (uSunIntensity * max(sunDot, 0.0) + uAmbient);
        // Same terminator blend as the globe's night lights
        color += texture2D(nightMap, vUv1).rgb * smoothstep(0.1, -0.15, sunDot) * uNightStrength;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }`;

const _camLocal = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _world = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

// Same lat/lon → Earth-local convention as updateUserMarker() in main.js
function dirFromLatLon(latDeg, lonDeg, out) {
    const lat = THREE.MathUtils.degToRad(latDeg);
    const lon = THREE.MathUtils.degToRad(lonDeg);
    return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}
const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
const tileLat = (y, z) => THREE.MathUtils.radToDeg(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))));

// Geometric summary of a tile: unit direction of its center and the angular
// radius (radians) of a cone around it that contains the whole tile.
function tileBounds(z, x, y) {
    const lon0 = tileLon(x, z), lon1 = tileLon(x + 1, z);
    const lat0 = tileLat(y + 1, z), lat1 = tileLat(y, z);
    const center = dirFromLatLon((lat0 + lat1) / 2, (lon0 + lon1) / 2, new THREE.Vector3());
    let minDot = 1;
    for (const [la, lo] of [[lat0, lon0], [lat0, lon1], [lat1, lon0], [lat1, lon1], [lat0, (lon0 + lon1) / 2], [lat1, (lon0 + lon1) / 2]]) {
        minDot = Math.min(minDot, center.dot(dirFromLatLon(la, lo, _v)));
    }
    return { center, angRadius: Math.acos(Math.min(1, minDot)) };
}

function buildTileMesh(z, x, y, R, texture) {
    const N = z < 6 ? 32 : z < 9 ? 16 : 8; // coarse tiles span up to 22°; keep chord sag (and lift) small
    const spanRad = THREE.MathUtils.degToRad(360 / 2 ** z) / N;
    // Lift above the base sphere: cover this patch's own chord sag, plus the
    // base sphere is an inscribed polyhedron so it never pokes above R.
    const r = R * (1 + (1 - Math.cos(spanRad / 2)) * 1.5) + R * 2e-8;
    const { center } = tileBounds(z, x, y);
    const origin = center.clone().multiplyScalar(r); // vertices stored relative to this for float precision

    const positions = new Float32Array((N + 1) * (N + 1) * 3);
    const uvs = new Float32Array((N + 1) * (N + 1) * 2);
    const uvsEquirect = new Float32Array((N + 1) * (N + 1) * 2);
    let p = 0, q = 0;
    for (let j = 0; j <= N; j++) {
        const v = j / N;
        const lat = tileLat(y + v, z);
        for (let i = 0; i <= N; i++) {
            const u = i / N;
            const lon = tileLon(x + u, z);
            dirFromLatLon(lat, lon, _v).multiplyScalar(r).sub(origin);
            positions[p++] = _v.x; positions[p++] = _v.y; positions[p++] = _v.z;
            uvsEquirect[q] = (lon + 180) / 360; uvsEquirect[q + 1] = (lat + 90) / 180;
            uvs[q++] = u; uvs[q++] = 1 - v;
        }
    }
    const index = [];
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
            index.push(a, c, b, b, c, d);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('uv1', new THREE.BufferAttribute(uvsEquirect, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();

    const material = new THREE.ShaderMaterial({
        uniforms: { map: { value: texture }, ...tileLighting },
        vertexShader: TILE_VERTEX,
        fragmentShader: TILE_FRAGMENT
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(origin);
    mesh.frustumCulled = false; // culled by the quadtree instead
    mesh.visible = false;
    mesh.name = `tile ${z}/${x}/${y}`;
    return mesh;
}

function requestTile(key, z, x, y, R) {
    const entry = { z, x, y, mesh: null, texture: null, state: 'loading', used: frame };
    cache.set(key, entry);
    inflight++;
    loader.load(TILE_URL(z, x, y), bitmap => {
        inflight--;
        if (cache.get(key) !== entry) { bitmap.close(); return; } // evicted meanwhile
        const tex = new THREE.Texture(bitmap);
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAnisotropy;
        tex.needsUpdate = true;
        entry.texture = tex;
        readyQueue.push({ key, entry, R });
    }, undefined, () => {
        inflight--;
        entry.state = 'error';
    });
}

function evict() {
    if (cache.size <= MAX_CACHED) return;
    const old = [...cache].filter(([, e]) => e.used < frame && e.state !== 'loading').sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of old.slice(0, cache.size - MAX_CACHED)) {
        if (e.mesh) {
            root.remove(e.mesh);
            e.mesh.geometry.dispose();
            e.mesh.material.dispose();
        }
        if (e.texture) {
            e.texture.dispose();
            e.texture.image?.close?.(); // free the decoded ImageBitmap
        }
        cache.delete(key);
    }
}

function setAttribution(show) {
    if (!attributionEl) {
        attributionEl = document.createElement('div');
        attributionEl.id = 'imagery-attribution';
        attributionEl.textContent = ATTRIBUTION;
        document.body.appendChild(attributionEl);
    }
    attributionEl.classList.toggle('visible', show);
}

function hideAll() {
    for (const e of cache.values()) if (e.mesh) e.mesh.visible = false;
}

// Call once per frame after Earth's transform is final for the frame.
export function updateEarthTiles(earthMesh, camera, renderer, enabled) {
    if (!earthMesh) return;
    frame++;
    if (!root) {
        root = new THREE.Group();
        root.name = 'earth tiles';
        maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    if (root.parent !== earthMesh) earthMesh.add(root);

    for (let i = 0; i < MAX_BUILDS_PER_FRAME && readyQueue.length; i++) {
        const { key, entry, R: r } = readyQueue.shift();
        if (cache.get(key) !== entry) continue; // evicted while queued (texture already freed)
        entry.mesh = buildTileMesh(entry.z, entry.x, entry.y, r, entry.texture);
        root.add(entry.mesh);
        entry.state = 'ready';
    }

    const R = earthMesh.userData.visualRadius || 1;
    _camLocal.copy(camera.position);
    earthMesh.worldToLocal(_camLocal);
    const camDist = _camLocal.length();
    if (!enabled || camDist > R * (1 + MAX_ALT)) {
        root.visible = false;
        setAttribution(false);
        return;
    }
    root.visible = true;
    _camDir.copy(_camLocal).normalize();
    const horizonAng = Math.acos(Math.min(1, R / camDist));
    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);

    const wanted = [];   // unloaded tiles to fetch: [priority, key, z, x, y]
    const show = [];     // meshes to display this frame

    // Subtree states: READY = fully drawable from loaded tiles (or nothing
    // to draw), PENDING = still loading, MISSING = Esri has no imagery here at
    // this depth (open ocean, remote areas). Pushes what to draw into `out`.
    const READY = 0, PENDING = 1, MISSING = 2;
    function visit(z, x, y, out) {
        const b = tileBounds(z, x, y);
        const ang = Math.acos(THREE.MathUtils.clamp(b.center.dot(_camDir), -1, 1));
        if (ang - b.angRadius > horizonAng) return READY; // behind the horizon
        _world.copy(b.center).multiplyScalar(R);
        earthMesh.localToWorld(_world);
        _sphere.set(_world, R * b.angRadius * 1.05);
        if (!_frustum.intersectsSphere(_sphere)) return READY;

        const dist = _v.copy(b.center).multiplyScalar(R).distanceTo(_camLocal);
        const size = 2 * R * b.angRadius;
        const key = `${z}/${x}/${y}`;
        const entry = cache.get(key);
        if (entry) entry.used = frame;
        if (entry?.state === 'error') return MISSING; // don't look deeper either

        const split = z < MAX_Z && (z < MIN_RENDER_Z || size / dist > SPLIT);
        if (!split) {
            if (z < MIN_RENDER_Z) return READY;
            if (entry?.state === 'ready') { out.push(entry.mesh); return READY; }
            if (!entry) wanted.push([z * 1e3 + dist / R, key, z, x, y]);
            return PENDING;
        }

        const childOut = [];
        let pending = false, missing = false;
        for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
                const clat = tileLat(2 * y + dy + 0.5, z + 1);
                if (Math.abs(clat) > MAX_MERC_LAT) continue;
                const st = visit(z + 1, 2 * x + dx, 2 * y + dy, childOut);
                if (st === PENDING) pending = true;
                if (st === MISSING) missing = true;
            }
        }
        if (!pending && !missing) { out.push(...childOut); return READY; }
        // Draw this tile in place of its children until they're all loaded
        // (so zooming sharpens in place), or for good if some don't exist
        if (z >= MIN_RENDER_Z && entry?.state === 'ready') { out.push(entry.mesh); return READY; }
        if (z >= MIN_RENDER_Z && !entry) wanted.push([z * 1e3 + dist / R, key, z, x, y]);
        out.push(...childOut);
        return pending ? PENDING : MISSING;
    }

    const n = 2 ** ROOT_Z;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) visit(ROOT_Z, x, y, show);

    hideAll();
    for (const m of show) m.visible = true;
    setAttribution(show.length > 0);

    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, key, z, x, y] of wanted) {
        if (inflight >= MAX_INFLIGHT) break;
        requestTile(key, z, x, y, R);
    }
    evict();
}
