// Streaming map tiles for Earth close-ups. A quadtree of Web-Mercator tiles is
// draped over the globe as curved patches, children of the Earth mesh so they
// spin with it. Each tile has two layers: satellite imagery (Esri World
// Imagery) for the day side and a dark street map with labels (Esri Dark Gray
// Canvas, base + transparent label overlay) for the night side, where imagery
// is just black.
// A tile only fetches the layers for the side(s) of the terminator it's on,
// and the shader blends them across the twilight band.
import * as THREE from 'three';

const LAYERS = {
    day: {
        // blankTile=false: 404 instead of a "no data" placeholder (open ocean etc.)
        url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false`,
        credit: 'Powered by Esri · Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    },
    // Keyless dark street map. (CARTO Dark Matter now watermarks browser
    // requests with "API key required".) Canvas services stop at z16.
    night: {
        url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
        credit: 'Map: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community',
        maxZ: 16
    },
    labels: {
        url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/${z}/${y}/${x}`,
        credit: null, // covered by the night credit
        maxZ: 16
    }
};
// Must match the shader's twilight smoothstep(0.1, -0.15, sunDot), widened a
// little so tiles have their layer before the terminator reaches them
const DAY_IF_SUNDOT_ABOVE = -0.2;
const NIGHT_IF_SUNDOT_BELOW = 0.15;
// Esri renders open ocean darker the further you zoom in (mean blue, sRGB:
// z4 74 → z8 50 → z11 37, measured over six oceans), so wherever tiles of
// different zoom meet, the sea shows light/dark squares that never go away.
// Water pixels are scaled toward the z8 look; gains are linear-light ratios,
// (50.2 / blue_z)^2.2, and land/cloud pixels are left alone (see shader).
const OCEAN_GAIN_BY_Z = { 4: 0.43, 5: 0.47, 6: 0.48, 7: 0.70, 8: 1, 9: 1.34, 10: 1.65, 11: 1.91 };
const oceanGainFor = z => OCEAN_GAIN_BY_Z[z] ?? (z < 4 ? 0.43 : 1.85); // z12+ is a flat fill ≈ z11
const NIGHT_MAP_GAIN = 0.9;  // keep the dark-grey map dark after tone mapping
const LABEL_GAIN = 1.6;     // keep street names legible after tone mapping

const ROOT_Z = 2;
// Draw from z4 even though the 8K base map is about as sharp: Esri's colours
// differ from the base map (darker oceans), so if unloaded areas fell back to
// the base globe, loading showed as a zig-zag of light and dark squares. A
// z4 layer is only a few dozen tiles for the whole view, so it's ready almost
// at once and sharper tiles then refine it in the same colours.
const MIN_RENDER_Z = 4;
const MAX_Z = 17;         // Esri has gaps beyond this in rural areas
const SPLIT = 0.45;       // split when tile size / camera distance exceeds this
const MAX_INFLIGHT = 10;
const MAX_CACHED = 500;
// Tiles start below this altitude (Earth radii). Higher up, the 8K base map is
// sharp enough, and the whole disk would need ~1500 z6 tiles; lower, the
// view frustum limits coverage to a few dozen, so there's no patchy edge.
const MAX_ALT = 0.4;
const MAX_MERC_LAT = 85.05112878;

// key → { z, x, y, mesh, used, layers: { day?|night?|labels?: { state, tex } } },
// layer state: 'loading' | 'ready' | 'error'
const cache = new Map();
// Decode tile JPEGs off the main thread (createImageBitmap). ImageBitmaps
// ignore texture.flipY, so the flip is done at decode time instead.
const loader = new THREE.ImageBitmapLoader();
loader.setOptions({ imageOrientation: 'flipY' });
loader.setCrossOrigin('anonymous');
const MAX_BUILDS_PER_FRAME = 4; // spread GPU uploads out when many tiles land at once
const readyQueue = [];          // decoded layers waiting to be attached: { key, entry, layer, R }
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
    nightMap: { value: BLACK },
    uUseStreetMap: { value: 1 } // 0 = city lights on the night side at every zoom
};

// Night-side style: 'map' (dark street map with labels) or 'lights' (the
// globe's city lights). In 'lights' mode no street-map tiles are fetched.
let nightStyle = 'map';
export function setNightStyle(style) {
    nightStyle = style;
    tileLighting.uUseStreetMap.value = style === 'map' ? 1 : 0;
}

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
    uniform sampler2D dayMap;
    uniform sampler2D streetMap;
    uniform float uHasDay;
    uniform float uOceanGain;
    uniform float uHasNight;
    uniform float uStreetGain;
    uniform sampler2D labelMap;
    uniform float uHasLabels;
    uniform float uLabelGain;
    uniform sampler2D nightMap;
    uniform vec3 uSunDirView;
    uniform float uSunIntensity;
    uniform float uAmbient;
    uniform float uNightStrength;
    uniform float uUseStreetMap;
    varying vec2 vUv;
    varying vec2 vUv1;
    varying vec3 vNormalView;
    void main() {
        #include <logdepthbuf_fragment>
        float sunDot = dot(normalize(vNormalView), uSunDirView);
        float night = smoothstep(0.1, -0.15, sunDot); // same twilight band as the globe
        vec3 street = texture2D(streetMap, vUv).rgb * uStreetGain;
        if (uHasLabels > 0.5) {
            vec4 label = texture2D(labelMap, vUv);
            street = mix(street, label.rgb * uLabelGain, label.a);
        }
        // Day: Lambert-lit imagery, matching MeshStandardMaterial's albedo / PI
        // scaling. If the imagery isn't loaded, show the street map instead.
        vec3 imagery = texture2D(dayMap, vUv).rgb;
        // Deep water has almost no red and is clearly blue; land, cloud and ice
        // have plenty of red. Only water gets the per-zoom brightness match.
        float ocean = (1.0 - smoothstep(0.004, 0.02, imagery.r)) * step(imagery.r * 3.0, imagery.b);
        imagery *= mix(1.0, uOceanGain, ocean);
        vec3 day = uHasDay > 0.5
            ? imagery * RECIPROCAL_PI * (uSunIntensity * max(sunDot, 0.0) + uAmbient)
            : street;
        // City lights come from the globe's 8K night map, ~5 km per pixel: up
        // close a whole city is one flat glow. Shape it with the daytime
        // imagery underneath, so built-up areas and roads (bright in the
        // photo) glow while water, parks and fields stay dark.
        float lightDetail = 1.0;
        if (uHasDay > 0.5) {
            float lum = dot(imagery, vec3(0.2126, 0.7152, 0.0722));
            // Steep curve + low ceiling: only the brightest built-up areas glow
            lightDetail = mix(0.03, 0.55, pow(smoothstep(0.02, 0.3, lum), 1.5)) * (1.0 - ocean);
        }
        vec3 cityLights = texture2D(nightMap, vUv1).rgb * uNightStrength * lightDetail;
        // Night: the street map, or city lights (by choice, or until it arrives)
        vec3 nightColor = uHasNight > 0.5 && uUseStreetMap > 0.5
            ? street
            : day + cityLights;
        gl_FragColor = vec4(mix(day, nightColor, night), 1.0);
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
const _sunLocal = new THREE.Vector3();

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

function buildTileMesh(z, x, y, R) {
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
        uniforms: {
            dayMap: { value: BLACK }, streetMap: { value: BLACK },
            uHasDay: { value: 0 }, uHasNight: { value: 0 },
            uOceanGain: { value: oceanGainFor(z) },
            uStreetGain: { value: NIGHT_MAP_GAIN },
            labelMap: { value: BLACK }, uHasLabels: { value: 0 }, uLabelGain: { value: LABEL_GAIN },
            ...tileLighting
        },
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

const layerState = (entry, layer) => entry?.layers[layer]?.state;
const isLoading = entry => Object.values(entry.layers).some(l => l.state === 'loading');

function requestLayer(key, layer, z, x, y, R) {
    let entry = cache.get(key);
    if (!entry) {
        entry = { z, x, y, mesh: null, used: frame, layers: {} };
        cache.set(key, entry);
    }
    const slot = entry.layers[layer] = { state: 'loading', tex: null };
    inflight++;
    loader.load(LAYERS[layer].url(z, x, y), bitmap => {
        inflight--;
        if (cache.get(key) !== entry) { bitmap.close(); return; } // evicted meanwhile
        const tex = new THREE.Texture(bitmap);
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAnisotropy;
        tex.needsUpdate = true;
        slot.tex = tex;
        readyQueue.push({ key, entry, layer, R });
    }, undefined, () => {
        inflight--;
        slot.state = 'error';
    });
}

function evict() {
    if (cache.size <= MAX_CACHED) return;
    const old = [...cache].filter(([, e]) => e.used < frame && !isLoading(e)).sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of old.slice(0, cache.size - MAX_CACHED)) {
        if (e.mesh) {
            root.remove(e.mesh);
            e.mesh.geometry.dispose();
            e.mesh.material.dispose();
        }
        for (const slot of Object.values(e.layers)) {
            if (!slot.tex) continue;
            slot.tex.dispose();
            slot.tex.image?.close?.(); // free the decoded ImageBitmap
        }
        cache.delete(key);
    }
}

function setAttribution(layersShown) {
    if (!attributionEl) {
        attributionEl = document.createElement('div');
        attributionEl.id = 'imagery-attribution';
        document.body.appendChild(attributionEl);
    }
    const text = [...layersShown].map(l => LAYERS[l].credit).filter(Boolean).join(' · ');
    if (attributionEl.textContent !== text) attributionEl.textContent = text;
    attributionEl.classList.toggle('visible', layersShown.size > 0);
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
        const { key, entry, layer, R: r } = readyQueue.shift();
        if (cache.get(key) !== entry) continue; // evicted while queued (texture already freed)
        if (!entry.mesh) {
            entry.mesh = buildTileMesh(entry.z, entry.x, entry.y, r);
            root.add(entry.mesh);
        }
        const slot = entry.layers[layer];
        const u = entry.mesh.material.uniforms;
        if (layer === 'day') { u.dayMap.value = slot.tex; u.uHasDay.value = 1; }
        else if (layer === 'night') { u.streetMap.value = slot.tex; u.uHasNight.value = 1; }
        else { u.labelMap.value = slot.tex; u.uHasLabels.value = 1; }
        slot.state = 'ready';
    }

    const R = earthMesh.userData.visualRadius || 1;
    _camLocal.copy(camera.position);
    earthMesh.worldToLocal(_camLocal);
    const camDist = _camLocal.length();
    if (!enabled || camDist > R * (1 + MAX_ALT)) {
        root.visible = false;
        setAttribution(new Set());
        return;
    }
    root.visible = true;
    // Sun direction in Earth's frame (the Sun sits at the world origin)
    _sunLocal.set(0, 0, 0);
    earthMesh.worldToLocal(_sunLocal).normalize();
    _camDir.copy(_camLocal).normalize();
    const horizonAng = Math.acos(Math.min(1, R / camDist));
    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);

    const wanted = [];   // layers to fetch: [priority, key, layer, z, x, y]
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

        // Which layers this tile needs: day if any of it is sunlit, night if
        // any of it is past the twilight band
        const sunAng = Math.acos(THREE.MathUtils.clamp(b.center.dot(_sunLocal), -1, 1));
        const sunlit = Math.cos(Math.max(0, sunAng - b.angRadius)) > DAY_IF_SUNDOT_ABOVE;
        const inNight = Math.cos(Math.min(Math.PI, sunAng + b.angRadius)) < NIGHT_IF_SUNDOT_BELOW;
        const streetMap = nightStyle === 'map';
        // City-lights mode: night tiles use the imagery too (the shader adds the
        // globe's city lights on top), exactly like the globe further out
        const needDay = sunlit || (inNight && !streetMap);
        // Past the street map's deepest zoom a night-only tile has nothing to
        // show, so its parent stays on screen (z16 is sharp enough for names)
        if (streetMap && inNight && !needDay && z > LAYERS.night.maxZ) return MISSING;
        const needNight = streetMap && inNight && z <= LAYERS.night.maxZ;
        if (needDay && layerState(entry, 'day') === 'error') return MISSING; // no imagery this deep
        // Drawable once any needed layer is in: the shader stands in for a
        // missing one (city lights for the map, the map for imagery), so the
        // terminator sweeping over a tile doesn't bounce it back to its parent
        const ready = l => layerState(entry, l) === 'ready';
        const drawable = entry?.mesh && ((needDay && ready('day')) || (needNight && ready('night')));
        const prio = z * 1e3 + dist / R;
        const fetchMissing = () => {
            if (needDay && !layerState(entry, 'day')) wanted.push([prio, key, 'day', z, x, y]);
            if (needNight && !layerState(entry, 'night')) wanted.push([prio, key, 'night', z, x, y]);
            if (needNight && !layerState(entry, 'labels')) wanted.push([prio + 0.5, key, 'labels', z, x, y]);
        };
        const draw = o => {
            o.push(entry.mesh);
            if (needDay) layersShown.add('day');
            if (needNight) layersShown.add('night');
        };

        const split = z < MAX_Z && (z < MIN_RENDER_Z || size / dist > SPLIT);
        if (!split) {
            if (z < MIN_RENDER_Z) return READY;
            fetchMissing();
            if (drawable) { draw(out); return READY; }
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
        if (z >= MIN_RENDER_Z) {
            fetchMissing();
            if (drawable) { draw(out); return READY; }
        }
        out.push(...childOut);
        return pending ? PENDING : MISSING;
    }

    const layersShown = new Set();
    const n = 2 ** ROOT_Z;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) visit(ROOT_Z, x, y, show);

    hideAll();
    for (const m of show) m.visible = true;
    setAttribution(layersShown);

    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, key, layer, z, x, y] of wanted) {
        if (inflight >= MAX_INFLIGHT) break;
        requestLayer(key, layer, z, x, y, R);
    }
    evict();
}
