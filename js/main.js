// Local imports carry the same ?v= as main.js in index.html so browsers refetch
// them on deploy; bump all together (only main.js imports local modules).
import { stellarTime, enhanceStarSurface, createCorona, createStellarLimb } from './stellarEffects.js?v=227';
import { createBlackHoleVisual, BLACK_HOLE_REACH } from './blackHole.js?v=227';
import * as THREE from 'three';
import { initISS, updateISS, issState, getISSGroup, ISS_DATA } from './iss.js?v=227';
import { updateEarthTiles, tileLighting, setNightStyle } from './earthTiles.js?v=227';
import { initCheeseMoon } from './cheeseMoon.js?v=227';
import { setCloudLayer, updateWeather, cloudLayerStatus } from './weather.js?v=227';
import { setGlobeMode, updateGlobeMode, isGlobeMode } from './globeMode.js?v=227';
import { initSmallBodies, updateSmallBodies, setSmallBodyGroupVisible, setSmallBodyOrbitsVisible, setSmallBodyTrueSize } from './smallBodies.js?v=227';
import { SATELLITE_MODES, setSatelliteMode, setSatelliteStatusListener, updateSatellites, satelliteCounts, setSatellitePreview, satellitesReady } from './satellites.js?v=227';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { solarSystem, nearbyStars, sizeComparison, ZOOM_LEVELS, calculateStarPosition, LY, AU } from './celestialData.js?v=227';
import { generatePlanetTexture, generateStarTexture, generateStarSpriteTexture, createAtmosphereTexture } from './textures.js?v=227';

// Pull confirmed mapped exoplanets into the true-scale lineup without
// duplicating their physical data. Hypothetical companions remain excluded.
const mappedExoplanetComparisons = nearbyStars.flatMap(host =>
    (host.children || [])
        .filter(child => child.type === 'planet'
            && !/hypothetical/i.test(child.description || ''))
        .map(child => ({
            ...child,
            type: 'exoplanet',
            hostName: host.name
        }))
);
const sizeComparisonCatalog = Array.from(new Map(
    [...sizeComparison, ...mappedExoplanetComparisons]
        .map(item => [item.name, item])
).values()).sort((a, b) => (a.radius || 0) - (b.radius || 0));
const mappedExoplanetHostsByName = new Map(
    mappedExoplanetComparisons.map(planet => [planet.name, planet.hostName])
);
const AU_IN_KM = 149597870.7;

// Real NASA-derived equirectangular surface maps (Solar System Scope, CC-BY 4.0,
// https://www.solarsystemscope.com/textures/). Bodies not listed here fall back
// to the procedural generator in textures.js.
const REAL_TEXTURE_FILES = {
    'Sun': 'textures/2k_sun.jpg',
    'Mercury': 'textures/2k_mercury.jpg',
    'Venus': 'textures/2k_venus_atmosphere.jpg',
    'Earth': 'textures/2k_earth_daymap.jpg',
    'Moon': 'textures/2k_moon.jpg',
    'Mars': 'textures/2k_mars.jpg',
    'Jupiter': 'textures/2k_jupiter.jpg',
    'Saturn': 'textures/2k_saturn.jpg',
    'Uranus': 'textures/2k_uranus.jpg',
    'Neptune': 'textures/2k_neptune.jpg'
};

// Sharper maps swapped in after the 2K one loads (desktop only: many phones
// cap textures at 4096 px and the files are several MB)
const HI_RES_TEXTURE_FILES = {
    'Earth': 'textures/8k_earth_daymap.jpg'
};
const EARTH_NIGHT_TEXTURE = 'textures/8k_earth_nightmap.jpg';

function canUseHiResTextures() {
    return !isMobileLayout() && (!renderer || renderer.capabilities.maxTextureSize >= 8192);
}

const textureLoader = new THREE.TextureLoader();
const realTextureCache = new Map();
const realTextureConsumers = new Map();

// True blackbody color from a star's surface temperature (Kelvin), using the
// standard Tanner Helland fit. Makes Rigel blue-white, Betelgeuse orange-red,
// the Sun near-white — instead of hand-picked hex colors.
function blackbodyColor(kelvin) {
    const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
    let r, g, b;
    r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661
                : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307);
    const clamp = v => Math.max(0, Math.min(255, v)) / 255;
    const c = new THREE.Color(clamp(r), clamp(g), clamp(b));
    // The raw fit is perceptually correct but too pale for display (3500 K
    // reads as near-white). Deepen lightness so the hue actually shows.
    const hsl = {};
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(1, hsl.s * 1.6), Math.max(0.45, hsl.l * 0.7));
    return c;
}

// Star display color: physical temperature when the data has one ("5,778 K"),
// otherwise the hand-authored color.
// Surface shader settings from a star's size and temperature
const SUN_RADIUS_KM = 696000;
function starSurfaceParams(data, hasRealMap) {
    const k = typeof data.temperature === 'string' ? parseFloat(data.temperature.replace(/,/g, '')) : data.temperature;
    const rSun = (data.radius || SUN_RADIUS_KM) / SUN_RADIUS_KM;
    return {
        // Granules scale with the star: ~55 per radius for the Sun, a handful on supergiants
        cells: THREE.MathUtils.clamp(55 * Math.pow(rSun, -0.35), 6, 70),
        // Convective, cool stars are spotty; hot (> ~7000 K) ones aren't. The
        // Sun's real map already has its own features.
        spots: hasRealMap || !(k > 0) ? 0 : 1 - THREE.MathUtils.smoothstep(k, 4000, 7000),
        mottle: hasRealMap ? 0.04 : 0.14
    };
}

function starDisplayColor(data) {
    const k = typeof data.temperature === 'string' ? parseFloat(data.temperature.replace(/,/g, '')) : data.temperature;
    if (k && isFinite(k)) return blackbodyColor(k).getHex();
    return data.color || 0xFFAA00;
}

// Uranus's source JPEG is compressed so hard that its chroma blocks show up as
// large blotches drifting across the otherwise featureless disk as the planet
// rotates. The real planet's color varies only with latitude, so we collapse
// the map to its per-row average — same colors, zero compression artifacts.
const ROW_AVERAGE_TEXTURES = new Set(['Uranus']);

function rowAverageImage(image) {
    const h = image.height;
    const column = document.createElement('canvas');
    column.width = 1;
    column.height = h;
    const colCtx = column.getContext('2d');
    colCtx.drawImage(image, 0, 0, 1, h); // squash to 1px wide = average each row
    const out = document.createElement('canvas');
    out.width = 16;
    out.height = h;
    const outCtx = out.getContext('2d');
    outCtx.drawImage(column, 0, 0, 16, h); // stretch back so rows are uniform
    return out;
}

// Returns a real surface texture for the named body, or null if none exists.
// If the file fails to load, the material falls back to a procedural texture.
function loadRealTexture(name, material, makeFallbackTexture) {
    const file = REAL_TEXTURE_FILES[name];
    if (!file) return null;
    if (realTextureCache.get(name)?.image) return realTextureCache.get(name);
    if (!realTextureConsumers.has(name)) realTextureConsumers.set(name, []);
    realTextureConsumers.get(name).push({ material, makeFallbackTexture });
    if (realTextureCache.has(name)) return realTextureCache.get(name);

    const texture = textureLoader.load(file, (tex) => {
        realTextureConsumers.delete(name);
        if (ROW_AVERAGE_TEXTURES.has(name)) {
            tex.image = rowAverageImage(tex.image);
            tex.needsUpdate = true;
        }
        // Upgrade in place: every material sharing this texture gets the 8K image
        if (HI_RES_TEXTURE_FILES[name] && canUseHiResTextures()) {
            new THREE.ImageLoader().load(HI_RES_TEXTURE_FILES[name], img => {
                // GPU storage was allocated (immutably) at 2K; free it so the next
                // upload reallocates at 8K instead of overflowing with texSubImage
                tex.dispose();
                tex.image = img;
                tex.needsUpdate = true;
            });
        }
    }, undefined, () => {
        realTextureCache.delete(name);
        for (const consumer of realTextureConsumers.get(name) || []) {
            consumer.material.map = consumer.makeFallbackTexture();
            consumer.material.needsUpdate = true;
        }
        realTextureConsumers.delete(name);
        texture.dispose();
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    realTextureCache.set(name, texture);
    return texture;
}

// City lights on Earth's night side: the night map is used as an emissive
// map, faded in where the surface faces away from the Sun. The Sun direction
// is a shared uniform updated each frame in updateEarthNightUniforms().
const earthNightUniforms = {
    uSunDirView: { value: new THREE.Vector3(1, 0, 0) },
    uNightStrength: { value: 1.6 }
};

let earthNightTexture = null; // Promise<Texture>, loaded once
let nightLightsScale = 1;      // city lights dimmed by the cheese-Moon disaster

// Make Earth's material glow with city lights on the night side. Satellite
// tiles share the same texture through tileLighting.nightMap (no copies: a
// cloned 8K texture is re-uploaded to the GPU, ~300 ms and ~350 MB each).
function addEarthNightLights(material) {
    if (!canUseHiResTextures()) return;
    earthNightTexture ??= new Promise(resolve => textureLoader.load(EARTH_NIGHT_TEXTURE, tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
        resolve(tex);
    }));
    earthNightTexture.then(tex => {
        tileLighting.nightMap.value = tex;
        material.emissiveMap = tex;
        material.emissive.set(0xffffff);
        material.emissiveIntensity = 1;
        material.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, earthNightUniforms);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nuniform vec3 uSunDirView;\nuniform float uNightStrength;')
                .replace('#include <emissivemap_fragment>', `
                    #ifdef USE_EMISSIVEMAP
                        // 0 on the day side, 1 past the terminator, soft twilight band
                        float night = smoothstep(0.1, -0.15, dot(normal, uSunDirView));
                        totalEmissiveRadiance = texture2D(emissiveMap, vEmissiveMapUv).rgb * night * uNightStrength;
                    #endif`);
        };
        material.needsUpdate = true;
    });
}

const _nightEarthPos = new THREE.Vector3();
function updateEarthNightUniforms() {
    const earth = celestialBodies.get('Earth');
    if (!earth || viewMode !== 'map') {
        earthNightUniforms.uNightStrength.value = 0; // size-compare Earth is lit by a headlight
        return;
    }
    earthNightUniforms.uNightStrength.value = 1.6 * nightLightsScale;
    earth.mesh.getWorldPosition(_nightEarthPos);
    earthNightUniforms.uSunDirView.value.copy(_nightEarthPos).negate().normalize()
        .transformDirection(camera.matrixWorldInverse);
    tileLighting.uSunDirView.value.copy(earthNightUniforms.uSunDirView.value);
    tileLighting.uNightStrength.value = tileLighting.nightMap.value.image?.width > 1 ? 1.6 * nightLightsScale : 0;
}

// Gravity well calculations - approximate masses relative to Earth (Earth = 1)
const MASS_RATIOS = {
    'Sun': 333000,
    'Mercury': 0.055,
    'Venus': 0.815,
    'Earth': 1,
    'Moon': 0.0123,
    'Mars': 0.107,
    'Phobos': 0.000000001,
    'Deimos': 0.0000000001,
    'Jupiter': 317.8,
    'Io': 0.015,
    'Europa': 0.008,
    'Ganymede': 0.025,
    'Callisto': 0.018,
    'Saturn': 95.2,
    'Titan': 0.0225,
    'Enceladus': 0.000018,
    'Uranus': 14.5,
    'Neptune': 17.1
};

// Precise orbital elements at J2000 epoch from JPL DE430 (Table 1, valid 1800-2050 AD)
// L0: mean longitude at J2000 (degrees)
// rate: mean longitude rate (degrees per century) — far more accurate than 360/period
// Source: https://ssd.jpl.nasa.gov/planets/approx_pos.html
const ORBITAL_ELEMENTS = {
    Mercury: { L0: 252.25032350, rate: 149472.67411175 },
    Venus:   { L0: 181.97909950, rate:  58517.81538729 },
    Earth:   { L0: 100.46457166, rate:  35999.37244981 },
    Mars:    { L0: 355.44656122, rate:  19140.30268499 }, // -4.55 + 360
    Jupiter: { L0:  34.39644051, rate:   3034.74612775 },
    Saturn:  { L0:  49.95424423, rate:   1222.49362201 },
    Uranus:  { L0: 313.23810451, rate:    428.48202785 },
    Neptune: { L0: 304.87997031, rate:    218.45945325 }, // -55.12 + 360
    // Moon: geocentric ecliptic mean longitude at J2000, rate deg/century (IAU/JPL)
    Moon:    { L0: 218.3165,     rate: 481267.8813 },
};

const J2000 = new Date('2000-01-01T12:00:00Z');
const MS_PER_DAY = 86400000;

// Keplerian elements for the planets (Earth = Earth-Moon barycentre), J2000
// ecliptic, valid 1800–2050, from JPL's "Approximate Positions of the Planets"
// (Standish): [value, rate per century] for a (AU), e, I, L, ϖ (longitude of
// perihelion), Ω (ascending node), angles in degrees. Solving Kepler's
// equation gives true distance, longitude and height above the ecliptic:
// eccentric, tilted orbits instead of circles (Mercury's distance swings
// 0.31–0.47 AU and its orbit tilts 7°; Saturn's position was off by up to 6°).
const PLANET_KEPLER = {
    Mercury: [[0.38709927, 0.00000037], [0.20563593, 0.00001906], [7.00497902, -0.00594749], [252.25032350, 149472.67411175], [77.45779628, 0.16047689], [48.33076593, -0.12534081]],
    Venus:   [[0.72333566, 0.00000390], [0.00677672, -0.00004107], [3.39467605, -0.00078890], [181.97909950, 58517.81538729], [131.60246718, 0.00268329], [76.67984255, -0.27769418]],
    Earth:   [[1.00000261, 0.00000562], [0.01671123, -0.00004392], [-0.00001531, -0.01294668], [100.46457166, 35999.37244981], [102.93768193, 0.32327364], [0, 0]],
    Mars:    [[1.52371034, 0.00001847], [0.09339410, 0.00007882], [1.84969142, -0.00813131], [-4.55343205, 19140.30268499], [-23.94362959, 0.44441088], [49.55953891, -0.29257343]],
    Jupiter: [[5.20288700, -0.00011607], [0.04838624, -0.00013253], [1.30439695, -0.00183714], [34.39644051, 3034.74612775], [14.72847983, 0.21252668], [100.47390909, 0.20469106]],
    Saturn:  [[9.53667594, -0.00125060], [0.05386179, -0.00050991], [2.48599187, 0.00193609], [49.95424423, 1222.49362201], [92.59887831, -0.41897216], [113.66242448, -0.28867794]],
    Uranus:  [[19.18916464, -0.00196176], [0.04725744, -0.00004397], [0.77263783, -0.00242939], [313.23810451, 428.48202785], [170.95427630, 0.40805281], [74.01692503, 0.04240589]],
    Neptune: [[30.06992276, 0.00026291], [0.00859048, 0.00005105], [1.77004347, 0.00035372], [-55.12002969, 218.45945325], [44.96476227, -0.32241464], [131.78422574, -0.00508664]]
};
function planetElements(name, daysSinceJ2000) {
    const k = PLANET_KEPLER[name];
    if (!k) return null;
    const T = daysSinceJ2000 / 36525;
    const [a, e, I, L, peri, node] = k.map(([v, rate]) => v + rate * T);
    return { a, e, I, L, peri, node };
}
// Point on an orbit at eccentric anomaly E (radians) → J2000 ecliptic AU
function orbitPointAU(el, E, out) {
    const rad = Math.PI / 180;
    const w = (el.peri - el.node) * rad, O = el.node * rad, I = el.I * rad;
    const xp = el.a * (Math.cos(E) - el.e), yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
    const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
    return out.set(
        (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
        (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
        (sw * sI) * xp + (cw * sI) * yp
    );
}
// Heliocentric J2000 ecliptic position (AU) of a planet
function planetHelioAU(name, daysSinceJ2000, out) {
    const el = planetElements(name, daysSinceJ2000);
    if (!el) return null;
    const M = THREE.MathUtils.euclideanModulo(el.L - el.peri + 180, 360) - 180;
    const Mr = M * Math.PI / 180;
    let E = Mr + el.e * Math.sin(Mr);
    for (let i = 0; i < 8; i++) E -= (E - el.e * Math.sin(E) - Mr) / (1 - el.e * Math.cos(E));
    return orbitPointAU(el, E, out);
}

// Returns heliocentric ecliptic longitude (radians): the true longitude from
// the Keplerian orbit for planets; a fractional orbit for other moons
const _keplerPos = new THREE.Vector3();
function calculatePlanetAngle(planetData, daysSinceJ2000) {
    if (planetHelioAU(planetData.name, daysSinceJ2000, _keplerPos)) {
        return THREE.MathUtils.euclideanModulo(Math.atan2(_keplerPos.y, _keplerPos.x), 2 * Math.PI);
    }
    const el = ORBITAL_ELEMENTS[planetData.name];
    const L0   = el ? el.L0   : 0;
    const rate = el ? el.rate : (360 / (planetData.orbitalPeriod || 365.25)) * 36525;
    const T = daysSinceJ2000 / 36525; // Julian centuries since J2000
    
    // Mean longitude
    let longitude = (L0 + rate * T) % 360;
    
    // Approximate True Anomaly correction for Earth to align realistic eclipses
    if (planetData.name === 'Earth') {
        const earthM = (357.5291 + 35999.0503 * T) % 360;
        const earthC = 1.9148 * Math.sin(earthM * Math.PI / 180) + 0.02 * Math.sin(2 * earthM * Math.PI / 180);
        longitude += earthC;
    }
    // Mars, Mercury, Venus, etc. could use equation of center but keeping simple for now
    
    if (longitude < 0) longitude += 360;
    return longitude * Math.PI / 180;
}

// Every orbit angle here uses the same sense as Object3D.rotation.y: a body
// at angle θ sits at (cos θ, 0, −sin θ), which runs counter-clockwise seen
// from ecliptic north (+Y) — the way the planets and regular moons really go.
// (Aligned mode used (cos, 0, +sin) and so ran every orbit clockwise.)
function orbitOffset(angle, radius, out) {
    return out.set(Math.cos(angle) * radius, 0, -Math.sin(angle) * radius);
}

// ── Axial tilt and spin ─────────────────────────────────────────────────
// North pole direction (J2000 RA/Dec) and prime-meridian angle W = W0 + rate·d
// (deg, d = days since J2000) from the IAU WGCCRE report. The pole is fixed in
// space, so as a planet orbits it gives seasons; W's sign gives the spin
// sense (Venus and Uranus turn backwards). Earth uses sidereal time instead.
// Texture longitude 0 (the map's centre) sits on the mesh's local +X, which
// W puts at the IAU prime meridian (Greenwich for Earth).
const BODY_POLES = {
    Sun:     { ra: 286.13,     dec: 63.87,     W0: 84.176,  rate: 14.1844 },
    Mercury: { ra: 281.0103,   dec: 61.4155,   W0: 329.5988, rate: 6.1385108 },
    Venus:   { ra: 272.76,     dec: 67.16,     W0: 160.20,  rate: -1.4813688 },
    Earth:   { ra: 0,          dec: 90,        earth: true },
    Mars:    { ra: 317.68143,  dec: 52.88650,  W0: 176.630, rate: 350.89198226 },
    Jupiter: { ra: 268.056595, dec: 64.495303, W0: 284.95,  rate: 870.5360000 },
    Saturn:  { ra: 40.589,     dec: 83.537,    W0: 38.90,   rate: 810.7939024 },
    Uranus:  { ra: 257.311,    dec: -15.175,   W0: 203.81,  rate: -501.1600928 },
    Neptune: { ra: 299.36,     dec: 43.46,     W0: 249.978, rate: 541.1397757 }
};
const OBLIQUITY_J2000 = 23.4392911 * Math.PI / 180;
const _yAxis = new THREE.Vector3(0, 1, 0);
// J2000 equatorial unit vector → app frame (ecliptic plane XZ, +Y ecliptic north)
function equatorialToApp(x, y, z, out) {
    const c = Math.cos(OBLIQUITY_J2000), s = Math.sin(OBLIQUITY_J2000);
    const ey = y * c + z * s, ez = -y * s + z * c;
    return out.set(x, ez, -ey);
}
// Quaternion taking the mesh's local +Y to the pole and local +X to the IAU
// node (where the body's equator crosses Earth's; the vernal equinox for Earth)
const poleFrames = new Map();
function poleFrame(name) {
    if (poleFrames.has(name)) return poleFrames.get(name);
    const p = BODY_POLES[name];
    let frame = null;
    if (p) {
        const ra = p.ra * Math.PI / 180, dec = p.dec * Math.PI / 180;
        const px = Math.cos(dec) * Math.cos(ra), py = Math.cos(dec) * Math.sin(ra), pz = Math.sin(dec);
        const pole = equatorialToApp(px, py, pz, new THREE.Vector3()).normalize();
        const nodeLen = Math.hypot(px, py);
        const node = nodeLen > 1e-9
            ? equatorialToApp(-py / nodeLen, px / nodeLen, 0, new THREE.Vector3())
            : new THREE.Vector3(1, 0, 0);
        const zAxis = new THREE.Vector3().crossVectors(node, pole);
        frame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(node, pole, zAxis));
        frame.obliquity = Math.acos(THREE.MathUtils.clamp(pole.y, -1, 1)); // tilt vs the ecliptic
    }
    poleFrames.set(name, frame);
    return frame;
}
// Spin angle (radians) about the pole at the simulation date
function bodySpinAngle(name) {
    const p = BODY_POLES[name];
    if (!p) return celestialBodies.get(name)?.mesh.rotation.y ?? 0;
    const d = (simDate - J2000) / MS_PER_DAY;
    const deg = p.earth
        ? 280.46061837 + 360.98564736629 * d // Greenwich mean sidereal time
        : p.W0 + p.rate * d;
    return THREE.MathUtils.euclideanModulo(deg, 360) * Math.PI / 180;
}
// Orientation relative to the body's parent (its orbit group, which Realistic
// mode rotates): world = pole frame · spin
const _orientParentQ = new THREE.Quaternion();
const _orientSpinQ = new THREE.Quaternion();
function bodyLocalQuaternion(name, out) {
    const body = celestialBodies.get(name);
    const frame = poleFrame(name);
    if (!body || !frame) return out.setFromAxisAngle(_yAxis, bodySpinAngle(name));
    out.copy(frame).multiply(_orientSpinQ.setFromAxisAngle(_yAxis, bodySpinAngle(name)));
    // Aligned mode puts planets at schematic spots on their orbits, not their
    // real ones. Turn the whole orientation by the difference so the geometry
    // relative to the Sun (seasons, time of day) still matches the date;
    // otherwise the seasons depended on the day the page was opened.
    if (orbitalMode !== 'realistic' && body.orbitGroup && PLANET_KEPLER[name]) {
        const d = (simDate - J2000) / MS_PER_DAY;
        const shift = calculateAlignedOrbitAngle(body.data) - calculatePlanetAngle(body.data, d);
        out.premultiply(_orientParentQ.setFromAxisAngle(_yAxis, shift));
    }
    if (body.mesh.parent) out.premultiply(body.mesh.parent.getWorldQuaternion(_orientParentQ).invert());
    return out;
}
// Apply tilt + spin to a planet (map view); rings lie in its equatorial plane
function orientBody(name) {
    const body = celestialBodies.get(name);
    if (!body || !poleFrame(name)) return false;
    bodyLocalQuaternion(name, body.mesh.quaternion);
    const spin = bodySpinAngle(name);
    body.mesh.userData.spin = spin;
    for (const ringName of ['rings', 'outerRing']) {
        body.mesh.getObjectByName(ringName)?.rotation.set(Math.PI / 2, -spin, 0);
    }
    return true;
}

// Moons: most big moons orbit in their planet's equatorial plane, so their
// offset is set in the tilted frame and only the spin is undone. Earth's Moon
// orbits ~5° from the ecliptic instead (not Earth's 23° equator), so its
// offset is built in the orbit-group frame and carried through the whole
// tilt + spin. `angle` is in the orbit-group (or equatorial) frame, rotation.y
// sense; `lat` is the Moon's ecliptic latitude.
const ECLIPTIC_MOONS = new Set(['Moon']);
const _moonQ = new THREE.Quaternion();
const _moonYawQ = new THREE.Quaternion();
function placeMoon(moonBody, angle, dist, lat = 0) {
    const parentName = moonBody.parent?.userData?.name;
    const offset = MOON_TIDAL_OFFSET[moonBody.data.name] || 0;
    const mesh = moonBody.mesh;
    if (ECLIPTIC_MOONS.has(moonBody.data.name) && poleFrame(parentName)) {
        bodyLocalQuaternion(parentName, _moonQ).invert();
        mesh.position.set(Math.cos(lat) * Math.cos(angle) * dist, Math.sin(lat) * dist,
            -Math.cos(lat) * Math.sin(angle) * dist).applyQuaternion(_moonQ);
        if (viewMode !== 'sizeCompare') mesh.quaternion.copy(_moonQ).multiply(_moonYawQ.setFromAxisAngle(_yAxis, angle + offset));
    } else {
        const spin = parentName ? bodySpinAngle(parentName) : 0;
        orbitOffset(angle, dist, mesh.position).applyAxisAngle(_yAxis, -spin);
        // Tidal locking: the same face toward the planet every orbit
        if (viewMode !== 'sizeCompare') mesh.quaternion.setFromAxisAngle(_yAxis, angle + offset - spin);
    }
}

// Returns the Moon's angle (radians) in Earth's orbit-group frame, whose +X
// points away from the Sun: geocentric longitude minus Earth's heliocentric one.
function calculateMoonAngle(daysSinceJ2000) {
    const T = daysSinceJ2000 / 36525; // Julian centuries
    const moonEl  = ORBITAL_ELEMENTS['Moon'];
    const earthEl = ORBITAL_ELEMENTS['Earth'];
    
    // Mean longitudes
    let moonLon  = (moonEl.L0  + moonEl.rate  * T) % 360;
    let earthLon = (earthEl.L0 + earthEl.rate * T) % 360;
    
    // Earth True Longitude (Eq of Center)
    const earthM = (357.5291 + 35999.0503 * T) % 360;
    const earthC = 1.9148 * Math.sin(earthM * Math.PI / 180) + 0.02 * Math.sin(2 * earthM * Math.PI / 180);
    earthLon = (earthLon + earthC) % 360;
    
    // Moon True Longitude (Equation of Center + Evection + Variation + Annual Eq)
    const moonM = (134.9634 + 477198.8676 * T) % 360;
    const D = (297.8502 + 445267.1115 * T) % 360; // Mean elongation
    const F = (93.2721 + 483202.0175 * T) % 360;  // Mean distance to ascending node
    
    const moonC = 6.289 * Math.sin(moonM * Math.PI / 180) 
                + 1.274 * Math.sin((2 * D - moonM) * Math.PI / 180)
                + 0.658 * Math.sin(2 * D * Math.PI / 180)
                - 0.186 * Math.sin(earthM * Math.PI / 180);
    
    moonLon = (moonLon + moonC) % 360;

    if (moonLon  < 0) moonLon  += 360;
    if (earthLon < 0) earthLon += 360;
    
    // Relative to the orbit group's angle (Earth's Keplerian longitude)
    const groupLon = calculatePlanetAngle({ name: 'Earth' }, daysSinceJ2000) * 180 / Math.PI;
    let localAngle = moonLon - groupLon;
    return ((localAngle % 360) + 360) % 360 * Math.PI / 180;
}

// Moon's ecliptic latitude (radians): its orbit is inclined ~5.1° to the
// ecliptic, crossing it at nodes that regress every 18.6 years
function calculateMoonLatitude(daysSinceJ2000) {
    const F = (93.2721 + 483202.0175 * daysSinceJ2000 / 36525) * Math.PI / 180;
    return 5.128 * Math.PI / 180 * Math.sin(F);
}

// Aligned mode starts every orbit on +X and advances from the selected
// alignment epoch. Keep this calculation shared by rendering, scale changes,
// and distance readouts so those paths cannot drift apart.
function calculateAlignedOrbitAngle(bodyData) {
    if (orbitalMode === 'custom') return customOrbitAngles[bodyData.name] ?? 0;
    const elapsedDays = (simDate - alignedStartDate) / MS_PER_DAY;
    const fallbackPeriod = bodyData.type === 'moon' ? 27.3 : 365.25;
    const period = bodyData.orbitalPeriod || fallbackPeriod;
    return (elapsedDays / period) * Math.PI * 2;
}

function findParentBodyData(bodyData) {
    return solarSystem.children.find(parent =>
        parent.children && parent.children.some(child => child.name === bodyData.name)
    ) || null;
}

// Return a body's simulated physical X/Z position in kilometres. This mirrors
// the scene transforms without using compressed display units.
function getSimulatedPhysicalPosition(bodyData) {
    if (!bodyData) return null;
    if (bodyData.name === 'Sun') return { x: 0, z: 0 };

    if (bodyData.type === 'planet' && orbitalMode === 'realistic'
        && planetHelioAU(bodyData.name, (simDate - J2000) / MS_PER_DAY, _keplerPos)) {
        return { x: _keplerPos.x * AU, z: -_keplerPos.y * AU };
    }
    if (bodyData.type === 'planet') {
        const angle = orbitalMode === 'realistic'
            ? calculatePlanetAngle(bodyData, (simDate - J2000) / MS_PER_DAY)
            : calculateAlignedOrbitAngle(bodyData);
        return {
            x: Math.cos(angle) * bodyData.distance,
            z: -Math.sin(angle) * bodyData.distance
        };
    }

    if (bodyData.type === 'moon') {
        const parentData = findParentBodyData(bodyData);
        const parentPosition = getSimulatedPhysicalPosition(parentData);
        if (!parentData || !parentPosition) return null;

        let offsetX;
        let offsetZ;
        if (orbitalMode === 'realistic') {
            const daysSinceJ2000 = (simDate - J2000) / MS_PER_DAY;
            const parentAngle = calculatePlanetAngle(parentData, daysSinceJ2000);
            const localAngle = bodyData.name === 'Moon'
                ? calculateMoonAngle(daysSinceJ2000)
                : calculatePlanetAngle(bodyData, daysSinceJ2000);
            const localX = Math.cos(localAngle) * bodyData.distance;
            const localZ = -Math.sin(localAngle) * bodyData.distance;

            // Match the parent's orbit-group Y rotation used by the scene.
            offsetX = Math.cos(parentAngle) * localX + Math.sin(parentAngle) * localZ;
            offsetZ = -Math.sin(parentAngle) * localX + Math.cos(parentAngle) * localZ;
        } else {
            const angle = calculateAlignedOrbitAngle(bodyData);
            offsetX = Math.cos(angle) * bodyData.distance;
            offsetZ = -Math.sin(angle) * bodyData.distance;
        }

        return {
            x: parentPosition.x + offsetX,
            z: parentPosition.z + offsetZ
        };
    }

    return null;
}

// Calculate precise dynamic real-world distance between an object and Earth
export function getCurrentDistanceToEarth(data) {
    if (!data) return null;
    if (data.name === 'Earth') return 0;

    // Use default distance for stars/distant objects (relative difference to Earth vs Sun is negligible)
    if (data.type !== 'planet' && data.type !== 'moon' && data.name !== 'Sun') {
        return data.distance; 
    }

    const earthData = solarSystem.children.find(p => p.name === 'Earth');
    const earthPosition = getSimulatedPhysicalPosition(earthData);
    const targetPosition = getSimulatedPhysicalPosition(data);
    if (!earthPosition || !targetPosition) return data.distance;

    return Math.hypot(
        earthPosition.x - targetPosition.x,
        earthPosition.z - targetPosition.z
    );
}

// Global state
let scene, camera, renderer, controls;
let sunLight;
let celestialBodies = new Map();
let orbitGroups = new Map();
let orbitLines = new Map();
// Planet orbits, small-body paths and the ISS trail render on their own layer
// so the Q key can hide them all at once (camera.layers decides what's drawn)
const ORBIT_LAYER = 1;
let showOrbitLines = true;
let currentZoomLevel = 'EARTH_MOON';
let currentFocusedBody = null;
let scaleMode = 'compressed'; // 'compressed' or 'realistic'
let orbitalMode = 'aligned'; // aligned, realistic, custom
const CUSTOM_ORBITS_KEY = 'spacemap-custom-orbits-v1';
let customOrbitAngles = Object.create(null);
try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_ORBITS_KEY));
    if (saved && typeof saved === 'object') {
        for (const [name, angle] of Object.entries(saved)) {
            if (typeof angle === 'number' && Number.isFinite(angle)) customOrbitAngles[name] = angle;
        }
    }
} catch { /* Storage may be unavailable. Keep arrangements in memory. */ }
let customOrbitDrag = null;
function saveCustomOrbits() {
    try { localStorage.setItem(CUSTOM_ORBITS_KEY, JSON.stringify(customOrbitAngles)); } catch { /* private mode */ }
}
let showHomeIndicator = true; // Toggle for home direction arrow
let mikoIndicatorActive = false; // Konami-code easter egg: CodeMiko arrow on Uranus
let showStars = true; // Background real-sky starfield
let showBigStars = true; // Named star systems (Betelgeuse, Sirius…) as 3D objects
// Star distances, in scene units per light year. Separate from the planet
// Scale toggle. "Far" pushes the big stars out so they read as distant points.
const STAR_SCALES = {
    near: { label: 'Compressed (near stars)', unitsPerLy: 500 },
    far: { label: 'Compressed (far stars)', unitsPerLy: 2500 },
    realistic: { label: 'Realistic', unitsPerLy: 10000 }
};
let starScaleMode = 'near';

// ── Continuous distance scale (Scale menu slider) ───────────────────────
// scaleValue: 0 = maximum compression, 1 = realistic. Distances shrink
// geometrically toward 0, but every orbit has a floor worked out from the
// on-screen sizes, so nothing can clip: each moon clears its planet (and
// rings) and the moons inside it; each planet clears the Sun or the previous
// planet's whole system; each star clears the Solar System and every other
// star. Body sizes never change. ("Compressed" is the old default look.)
const SCALE_PRESETS = { max: 0, compressed: 0.565, realistic: 1 };
const PLANET_UNITS_PER_AU = [5, 1000];      // at scaleValue 0 → 1 (compressed preset ≈ 100)
const MOON_SCALE = [0.004, 1];              // × true distance (km / 5000) at 0 → 1
const STAR_UNITS_PER_LY_REALISTIC = 10000;
// chosen so the compressed preset keeps the old 500 units per light year
const STAR_UNITS_PER_LY_MIN = Math.pow(500 / Math.pow(STAR_UNITS_PER_LY_REALISTIC, SCALE_PRESETS.compressed), 1 / (1 - SCALE_PRESETS.compressed));
let scaleValue = SCALE_PRESETS.compressed;
let currentUnitsPerAU = 100;     // live values for readouts / scale bar
let currentStarUnitsPerLy = 500;
let currentSystemEdge = 0;
let cheeseMoon = null; // easter egg (js/cheeseMoon.js)
let pullFarStars = false; // Stars menu: log-compress distant objects' distances (not to scale)
// ...only with compressed scales: Realistic always shows true distances
// Pull-in weight: 1 when "Pull far objects in" is on, 0 when off. Toggling
// animates it (scale transitions lerp starBlend), blending the two layouts.
const starPullAt = () => (pullFarStars ? 1 : 0);
let starsPulledInNow = false; // pull-in weight last laid out > 0 (labels, menu)
let currentStarBlend = 0, currentSv = 0;
// Pulled-in arrangement at the tightest scale (Max), computed once. With the
// toggle on, each object then glides on its own fixed direction from this
// spot (sv 0) to its true position (sv 1), geometrically like the planets,
// with a weight that stays mostly pulled in through Compressed:
//   r(sv) = max(r0^(1−w)·r1^w, clear of the Solar System),  w = PULL_W(sv)
// Every object moves outward at every step (true distances are further than
// the Max arrangement) and ends exactly at the truth at Realistic. Scaling
// the arrangement with the Solar System instead carried nearby stars past
// their true distances, so they drifted back inward near Realistic.
let pulledRef = null; // { P: Vector3[] }
function getPulledRef() {
    if (pulledRef) return pulledRef;
    const raw0 = computeRawScaleLayout(0, true);
    pulledRef = { P: layoutPulledInStars(raw0.starU, raw0.systemEdge) };
    return pulledRef;
}
// 0.1·sv + 0.9·sv⁴: ~0.15 at Compressed (still pulled in), 1 at Realistic,
// and never flat, so objects move from the first nudge off Max
const PULL_W = sv => 0.1 * sv + 0.9 * sv * sv * sv * sv;
function pulledPositions(sv, systemEdge) {
    const ref = getPulledRef();
    const w = PULL_W(THREE.MathUtils.clamp(sv, 0, 1));
    return getStarLayoutInfo().map((st, i) => {
        const r0 = Math.max(ref.P[i].length(), 1e-6);
        const r1 = Math.max(st.distLy * STAR_UNITS_PER_LY_REALISTIC, r0);
        const r = Math.max(r0 * Math.pow(r1 / r0, w), 1.2 * (systemEdge + st.ext));
        return st.dir.clone().multiplyScalar(r);
    });
}
// With realistic distances the stars are always realistic; the Stars menu's
// near/far choice is for decluttering compressed views.
const effectiveStarScale = () => (scaleValue >= 0.999 ? 'realistic' : starScaleMode);
// Keep interactive stars distinguishable from the 1-3.5px background field.
// This is the full diameter of the existing glow/spike sprite, not the star core.
const COARSE_POINTER_MQ = window.matchMedia('(pointer: coarse)');
const MIN_INTERACTIVE_STAR_GLINT_PX = 18;
const TOUCH_TAP_MOVE_TOLERANCE_PX = 12;
const MOUSE_BODY_HIT_RADIUS_PX = 18;
const TOUCH_BODY_HIT_RADIUS_PX = 36;
let showConstellations = false; // Constellation lines and labels (off at start; see constellation intro)
// On load: constellations appear after 3 s, fade in over 2 s, fade out over 4 s
const CONSTELLATION_INTRO = { delay: 3000, fadeIn: 2000, fadeOut: 4000 };
let constellationIntro = { start: null }; // clock starts once constellations are drawing; null once finished or overridden
let constellationsCache = null; // cached JSON for constellations
let constellationsGroup = null; // THREE.Group containing lines and labels
let userLatitude = 40.7128; // Default: New York
let userLongitude = -74.0060;
let userCity = 'New York';
let userCountry = 'USA';
let userMarker = null; // THREE.Mesh for Earth surface target
const _markerWorldPos = new THREE.Vector3();
// showGravityWells - REMOVED
let viewMode = 'map'; // 'map' or 'sizeCompare' - toggles between normal map view and size comparison view
let sizeComparisonObjects = new Map(); // Stores meshes for size comparison view
let sizeComparisonGroup = null; // Group containing all size comparison objects
let compareLight = null; // Camera-following "headlight" so comparison objects are always lit
let moonShadows = []; // Projected transit-shadow decals: { moonMesh, planetMesh, decal, radius, lift }
let stellarComparisonOverlay = null;
let sunHologram = null;
let earthHologram = null;
let stellarComparisonOpacity = 0;
let stellarComparisonEnabled = false;
let hologramToggleTimer = null;
let stellarReferenceSun = null;
let stellarReferenceEarth = null;
let stellarReferenceOpacity = 0;
const SUN_REFERENCE_RADIUS_KM = 696340;
const EARTH_REFERENCE_RADIUS_KM = 6371;

// Spacetime fabric and gravity wells - REMOVED

// Simulation time controls
let simDate = new Date();           // Current simulation date/time
let simSpeed = 0;                   // ms of sim time per ms of real time (0 = paused)
let simPaused = true;               // Whether simulation is paused
let timeScale = 1.0;                // Speed multiplier set by the slider
// Starting speed: 2560 sim-seconds per second (≈43 min/s, a rung of the speed
// ladder) is slow enough to follow and fast enough that a new visitor sees
// planets, moons and satellites moving. The app opens playing at this speed.
const DEFAULT_SIM_SPS = 2560;
// Riding along with the ISS, Earth turning below at the default speed is
// jarring; picking it slows the clock to this (never speeds it up)
const ISS_VIEW_SPS = 120;   // 2 min/s
// The ISS view, in the station's frame (+Z travel, +Y away from Earth, +X
// truss): camera above and behind, looking a little above and ahead of it so
// the ISS sits low in the frame with Earth's horizon behind
const ISS_CAM_OFFSET = new THREE.Vector3(0, 0.04, -0.11);
const ISS_TARGET_OFFSET = new THREE.Vector3(0, 0.015, 0.01);
let lastFrameTime = Date.now();     // For delta-time calculations
let lastTimelineDisplayMinute = null;
let realisticMoonPositionsDirty = true;

function mapSliderToRealisticSpeed(val) {
    const v = val / 100; // -1..1
    if (v >= 0) {
        // Forward: 1 day/sec (v = 0) to 365 days/sec (v = 1)
        const days = 1.0 + Math.pow(v, 3) * 364.0;
        return days * MS_PER_DAY;
    } else {
        // Backward / Slow:
        if (v >= -0.2) {
            // Linear ramp from 1 day/sec down to 0 days/sec at -0.2
            const days = 1.0 + v * 5.0;
            return days * MS_PER_DAY;
        } else {
            // Cubic ramp from 0 days/sec at -0.2 down to -365 days/sec at -1.0
            const t = (v + 0.2) / 0.8; // Maps -0.2..-1.0 to 0..-1
            const days = Math.pow(t, 3) * 365.0;
            return days * MS_PER_DAY;
        }
    }
}

function mapSliderToAlignedSpeed(val) {
    const v = val / 100; // -1..1
    if (v >= 0) {
        // Forward: 1x (v = 0) to 100x (v = 1)
        return 1.0 + Math.pow(v, 3) * 99.0;
    } else {
        // Backward / Slow:
        if (v >= -0.2) {
            // Linear ramp from 1x down to 0x at -0.2
            return 1.0 + v * 5.0;
        } else {
            // Cubic ramp from 0x down to -100x at -1.0
            const t = (v + 0.2) / 0.8;
            return Math.pow(t, 3) * 100.0;
        }
    }
}

// Human-readable simulation rate, e.g. "1.0 sec/s", "-12 min/s", "2.4 yr/s"
function formatSimRate(daysPerSec) {
    const sign = daysPerSec < 0 ? '-' : '';
    const d = Math.abs(daysPerSec);
    const fmt = (x, unit) => `${sign}${x < 10 ? x.toFixed(1) : Math.round(x)} ${unit}/s`;
    if (d >= 365) return fmt(d / 365, 'yr');
    if (d >= 1) return fmt(d, d < 1.05 ? 'day' : 'days');
    if (d * 24 >= 1) return fmt(d * 24, 'hr');
    if (d * 1440 >= 1) return fmt(d * 1440, 'min');
    return fmt(d * 86400, 'sec');
}

// Speed ladder, in seconds of simulated time per real second. Scroll notches
// and the −/+ buttons move one rung: pause → 20 s/s, doubling up to 1 yr/s,
// and the same rungs in reverse past pause. Presets (tl-presets) can land
// between rungs; stepping from there goes to the next rung in that direction.
const SECONDS_PER_YEAR = 365 * 86400;
const SPEED_LADDER_SPS = (() => {
    const rungs = [];
    for (let sps = 20; sps < SECONDS_PER_YEAR; sps *= 2) rungs.push(sps);
    rungs.push(SECONDS_PER_YEAR);
    return rungs;
})();
const SIGNED_SPEED_LADDER = [...SPEED_LADDER_SPS.map(v => -v).reverse(), 0, ...SPEED_LADDER_SPS];

function currentSimSps() {
    return simPaused ? 0 : getSimulationRate() / 1000; // rate is sim-ms per real second
}

function setSimRateSps(sps) {
    if (sps === 0) {
        simPaused = true;
    } else {
        simPaused = false;
        timeScale = sps / 86400;          // aligned mode: days per second
        simSpeed = timeScale * MS_PER_DAY; // realistic mode: sim-ms per second
    }
    // Move the slider thumb to the closest matching position (display only)
    const slider = document.getElementById('tl-speed-slider');
    if (slider) {
        const d = sps / 86400;
        let best = 0, bestDiff = Infinity;
        for (let val = -100; val <= 100; val++) {
            const diff = Math.abs(mapSliderToRealisticSpeed(val) / MS_PER_DAY - d);
            if (diff < bestDiff) { bestDiff = diff; best = val; }
        }
        slider.value = best;
    }
    syncTimelineUI();
}

function stepSimSpeed(steps) {
    let sps = currentSimSps();
    const dir = Math.sign(steps);
    for (let i = 0; i < Math.abs(steps); i++) {
        const tol = Math.abs(sps) * 1e-6 + 1e-9;
        const next = dir > 0
            ? SIGNED_SPEED_LADDER.find(v => v > sps + tol)
            : SIGNED_SPEED_LADDER.findLast(v => v < sps - tol);
        if (next === undefined) break;
        sps = next;
    }
    setSimRateSps(sps);
}

function updateSpeedPresetHighlight() {
    const sps = Math.abs(currentSimSps());
    document.querySelectorAll('.tl-preset').forEach(btn => {
        const target = Number(btn.dataset.sps);
        btn.classList.toggle('active', sps > 0 && Math.abs(sps - target) < target * 1e-6);
    });
}

function getCurrentSpeedMultiplier() {
    if (simPaused) return 0;
    if (orbitalMode === 'aligned') {
        return timeScale;
    } else {
        return simSpeed / MS_PER_DAY;
    }
}

function getSimulationRate() {
    if (orbitalMode === 'custom') return 0;
    // Aligned mode's 1× baseline is one simulated day per real second.
    return orbitalMode === 'aligned' ? timeScale * MS_PER_DAY : simSpeed;
}

function setSpeedMultiplier(multiplier) {
    if (multiplier === 0) {
        simPaused = true;
        syncTimelineUI();
        return;
    }
    
    simPaused = false;
    
    // Find the slider value that gets closest to this multiplier
    let bestVal = 0;
    let minDiff = Infinity;
    
    for (let val = -100; val <= 100; val++) {
        const mapped = (orbitalMode === 'aligned') 
            ? mapSliderToAlignedSpeed(val) 
            : mapSliderToRealisticSpeed(val) / MS_PER_DAY;
        const diff = Math.abs(mapped - multiplier);
        if (diff < minDiff) {
            minDiff = diff;
            bestVal = val;
        }
    }
    
    const slider = document.getElementById('tl-speed-slider');
    if (slider) {
        slider.value = bestVal;
    }
    
    timeScale = mapSliderToAlignedSpeed(bestVal);
    simSpeed = mapSliderToRealisticSpeed(bestVal);
    
    syncTimelineUI();
}

// Camera fly-to animation state
let flyToAnimation = null;
let isCameraLocked = true; // Default: camera moves with object
// Third follow state ("On + angle"): the camera also keeps its viewing angle
// *relative to the object*, turning with it (a chase cam). The offset is stored
// in the object's local frame and re-applied each frame; whatever the user
// drags or zooms becomes the new stored offset, so letting go re-locks there.
let cameraAngleLock = false;
const chaseCam = { active: false, bodyName: null, offsetLocal: new THREE.Vector3(), upLocal: new THREE.Vector3(0, 1, 0), targetOffsetLocal: new THREE.Vector3(), hasOffset: false };
const _chaseQuat = new THREE.Quaternion();
// Panning while following a satellite (the ISS) shifts the view and keeps the
// shift riding along with it: OrbitControls applies the pan inside
// controls.update(), and the difference from the target the follow code set is
// kept as an offset (in the object's frame for "On + angle", else in world)
// (Scroll zoom runs controls.update() inside the wheel handler, between
// frames, so changes since the end of the last frame are picked up too)
const satPan = { offset: new THREE.Vector3(), setTarget: new THREE.Vector3(), endTarget: new THREE.Vector3(), body: null, valid: false, endValid: false };
const _satPanDelta = new THREE.Vector3();
function addSatPanDelta(body, delta) {
    if (!body || delta.lengthSq() < 1e-16) return;
    // (by the mode, not chaseCam.active: that's cleared at the top of each frame)
    if (isCameraLocked && cameraAngleLock) {
        body.mesh.getWorldQuaternion(_chaseQuat).invert();
        chaseCam.targetOffsetLocal.add(delta.applyQuaternion(_chaseQuat));
    } else {
        satPan.offset.add(delta);
    }
}
const _chaseVec = new THREE.Vector3();
const _chaseSph = new THREE.Spherical();
const _targetVec = new THREE.Vector3();

// Focus hand-off without moving the camera: the look-at point glides from the
// old target to the new body (and the camera's roll eases to match), so e.g.
// following the ISS you can switch to Earth and scroll straight down into it,
// instead of flying out to Earth's default framing.
let focusRetarget = null;
const FOCUS_RETARGET_MS = 700;
const _retargetVec = new THREE.Vector3();

function retargetFocus(name) {
    const body = celestialBodies.get(name);
    if (!body) return;
    const bodyPos = body.mesh.getWorldPosition(new THREE.Vector3());
    flyToAnimation = null;
    focusRetarget = {
        name,
        fromOffset: controls.target.clone().sub(bodyPos), // old target, relative to the new body
        lastBodyPos: bodyPos,
        start: performance.now()
    };
    currentFocusedBody = name;
    cameraOffsetFromTarget = null;
    chaseCam.hasOffset = false;
    // No distance clamp mid-glide (the camera may be closer than the body's
    // normal minimum); the Earth close-up camera sets its own limits after
    controls.minDistance = 1e-6;
    updateSidebarSelection(name);
    showBodyInfo(body.data);
    // Picking a planet or moon means "show me this body": north up, like the
    // flight would. (Spacecraft keep the current roll.)
    if (body.type !== 'satellite') startRollAnimation('north');
}

// ── Fly to a spot on Earth ───────────────────────────────────────────────
// Clicking Earth when it's big on screen (or while following the ISS), or
// clicking the "You" label, glides the camera round to look straight down at
// that spot from satellite-view height, north up, focused on Earth, so the
// user can keep scrolling down into it. Worked in Earth's own frame so the
// spot stays put while Earth spins during the flight.
let earthSpotFlight = null;
const EARTH_SPOT_FLIGHT_MS = 2200;
const _spotQuat = new THREE.Quaternion();
const _spotVec = new THREE.Vector3();
const _spotEarth = new THREE.Vector3();

function flyToEarthSpot(spotLocalDir, durationMs = EARTH_SPOT_FLIGHT_MS, endAltKm = null) {
    const earth = celestialBodies.get('Earth');
    if (!earth) return;
    const R = earth.mesh.userData.visualRadius;
    earth.mesh.getWorldPosition(_spotEarth);
    earth.mesh.getWorldQuaternion(_spotQuat);
    const toLocal = _spotQuat.clone().invert();
    const camLocal = camera.position.clone().sub(_spotEarth).applyQuaternion(toLocal);
    const startAlt = Math.max(camLocal.length() - R, 1e-6);
    // Satellite-view height: well below where we are, within ~250-2000 km
    const km = R / 6371;
    const endAlt = endAltKm ? endAltKm * km : THREE.MathUtils.clamp(startAlt * 0.35, 250 * km, 2000 * km);
    flyToAnimation = null;
    focusRetarget = null;
    earthSpotFlight = {
        start: performance.now(),
        ms: durationMs,
        fromDir: camLocal.clone().normalize(),
        toDir: spotLocalDir.clone().normalize(),
        fromAlt: startAlt,
        toAlt: endAlt,
        fromTargetLocal: controls.target.clone().sub(_spotEarth).applyQuaternion(toLocal),
        fromUp: camera.up.clone()
    };
    if (currentFocusedBody !== 'Earth') {
        currentFocusedBody = 'Earth';
        updateSidebarSelection('Earth');
        showBodyInfo(earth.data);
    }
    cameraOffsetFromTarget = null;
    chaseCam.hasOffset = false;
    rollAnimation = null;
    controls.minDistance = 1e-6; // limits are set again by the Earth close-up camera
}

// Per frame, from the follow block while focused on Earth
function stepEarthSpotFlight(earthMesh, earthWorld) {
    const f = earthSpotFlight;
    const t = Math.min(1, (performance.now() - f.start) / f.ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const R = earthMesh.userData.visualRadius;
    earthMesh.getWorldQuaternion(_spotQuat);
    // Direction: turn from where the camera is to above the spot (great circle)
    const angle = f.fromDir.angleTo(f.toDir);
    _spotVec.crossVectors(f.fromDir, f.toDir);
    const dir = _spotVec.lengthSq() > 1e-12
        ? f.fromDir.clone().applyAxisAngle(_spotVec.normalize(), angle * e)
        : f.toDir.clone();
    const alt = f.fromAlt * Math.pow(f.toAlt / f.fromAlt, e);
    camera.position.copy(dir.applyQuaternion(_spotQuat)).multiplyScalar(R + alt).add(earthWorld);
    // Look-at point glides to Earth's centre; view eases to north up
    controls.target.copy(f.fromTargetLocal).multiplyScalar(1 - e).applyQuaternion(_spotQuat).add(earthWorld);
    camera.up.copy(f.fromUp).lerp(_spotVec.set(0, 1, 0).applyQuaternion(_spotQuat), e).normalize();
    if (t >= 1) {
        earthSpotFlight = null;
        // Hand straight over to the Earth close-up camera, already riding
        // Earth's spin; otherwise the first frames after landing don't turn
        // with Earth and the spot slips (0.3° per frame at 1.4 hr/s)
        earthSurfaceCam.active = true;
        earthSurfaceCam.lastDist = 0;
        earthSurfaceCam.prevQuat.copy(_spotQuat);
        earthSurfaceCam.hasPrevQuat = true;
    }
}

// Earth-local direction of the ground under a screen point. Ray built from
// the fov and camera orientation: Raycaster.setFromCamera loses precision with
// the tiny near planes used up close (see earthGroundUnderCursor).
function earthSpotUnderPointer(clientX, clientY) {
    const earth = celestialBodies.get('Earth');
    if (!earth) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const ray = new THREE.Ray(camera.position.clone(),
        new THREE.Vector3(nx * tanHalf * camera.aspect, ny * tanHalf, -1).applyQuaternion(camera.quaternion).normalize());
    const center = earth.mesh.getWorldPosition(new THREE.Vector3());
    const hit = ray.intersectSphere(new THREE.Sphere(center, earth.mesh.userData.visualRadius), new THREE.Vector3());
    if (!hit) return null;
    return hit.sub(center).applyQuaternion(earth.mesh.getWorldQuaternion(_spotQuat).invert()).normalize();
}

function isEarthLargeOnScreen() {
    const earth = celestialBodies.get('Earth');
    if (!earth) return false;
    const d = camera.position.distanceTo(earth.mesh.getWorldPosition(_spotEarth));
    const R = earth.mesh.userData.visualRadius;
    if (d <= R) return true;
    const angularDiameter = 2 * Math.asin(R / d);
    return angularDiameter / THREE.MathUtils.degToRad(camera.fov) >= 1 / 3;
}

// Earth-local direction of the user's location (the "You" marker)
function userLocationLocalDir() {
    if (userLatitude == null || userLongitude == null) return null;
    const lat = THREE.MathUtils.degToRad(userLatitude), lon = THREE.MathUtils.degToRad(userLongitude);
    return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

// "Already close" means within a few radii of the body: clicking it then hands
// off in place rather than flying to the standard framing
function isCameraNearBody(body) {
    const r = body.mesh.userData.visualRadius || 1;
    return camera.position.distanceTo(body.mesh.getWorldPosition(_retargetVec)) < r * 8;
}
// While chasing, orbiting is done here in the object's frame (pole = object
// up), not by OrbitControls: its angles are measured against world up, so with
// the camera rolled to the object's up it hit invisible pole limits and drags
// came out rotated or reversed. Zoom and pan stay with OrbitControls.
const chaseDrag = { pointerId: null, x: 0, y: 0, dTheta: 0, dPhi: 0 };
const CHASE_DAMPING = 0.2; // share of the pending drag applied per frame (smooth like OrbitControls)
const _WORLD_UP = new THREE.Vector3(0, 1, 0);
const _poleAlign = new THREE.Quaternion();

// Take this frame's share of the pending mouse orbit (eased like OrbitControls)
function takeOrbitStep() {
    const dTheta = chaseDrag.dTheta * CHASE_DAMPING, dPhi = chaseDrag.dPhi * CHASE_DAMPING;
    chaseDrag.dTheta -= dTheta;
    chaseDrag.dPhi -= dPhi;
    if (Math.abs(chaseDrag.dTheta) < 1e-5) chaseDrag.dTheta = 0;
    if (Math.abs(chaseDrag.dPhi) < 1e-5) chaseDrag.dPhi = 0;
    return [dTheta, dPhi];
}

// Orbit `offset` (camera minus target) around `pole`, OrbitControls-style
function orbitAroundPole(offset, pole, dTheta, dPhi) {
    _poleAlign.setFromUnitVectors(pole, _WORLD_UP);
    offset.applyQuaternion(_poleAlign);
    _chaseSph.setFromVector3(offset);
    _chaseSph.theta += dTheta;
    _chaseSph.phi = THREE.MathUtils.clamp(_chaseSph.phi + dPhi, 0.001, Math.PI - 0.001);
    offset.setFromSpherical(_chaseSph).applyQuaternion(_poleAlign.invert());
}

// The camera keeps whatever roll it has when follow modes change (no snapping).
// OrbitControls only orbits correctly around world up, so while the camera is
// rolled (or chasing) mouse orbiting is done by orbitAroundPole instead.
function cameraIsRolled() {
    return camera.up.dot(_WORLD_UP) < 0.99999;
}

// Scrolling mid-flight: the flight overwrites the camera every frame, so a
// normal zoom would be lost. Scale where the flight lands instead, so a
// click-then-scroll zooms right away. Also remembers the cursor for
// zoom-to-cursor on Earth (see finishEarthSurfaceCamera).
const lastWheel = { x: 0, y: 0, time: 0 };
function setupWheelHelpers(canvas) {
    canvas.addEventListener('wheel', (e) => {
        lastWheel.x = e.clientX;
        lastWheel.y = e.clientY;
        lastWheel.time = performance.now();
        const anim = flyToAnimation;
        if (viewMode !== 'map' || !anim || anim.isSizeCompare) return;
        const offset = anim.offset || anim.offsetLocal;
        if (!offset) return;
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        if (!dy) return;
        const factor = Math.pow(0.95, -controls.zoomSpeed * Math.sign(dy)); // wheel up (dy < 0) → 0.95, closer
        const len = Math.max(offset.length() * factor, controls.minDistance);
        offset.setLength(len);
        if (anim.endDistanceToTarget) anim.endDistanceToTarget = len;
    }, { capture: true, passive: true });
}

// ── View roll: Ctrl+drag, compass (north up), level horizon ─────────────
// Roll = rotating camera.up around the viewing direction. In "On + angle"
// the chase cam re-applies its own up every frame, so roll changes are
// written into chaseCam.upLocal as well (see setCameraUp).
const _rollFwd = new THREE.Vector3();
const _rollTarget = new THREE.Vector3();
const _rollNorth = new THREE.Vector3();
const _rollTmp = new THREE.Vector3();
const _rollQuat = new THREE.Quaternion();
let rollAnimation = null; // { start, from: Vector3, kind: 'north' | 'horizon' }
const ROLL_ANIM_MS = 600;
const rollDrag = { pointerId: null, x: 0 };

function setCameraUp(up) {
    camera.up.copy(up).normalize();
    if (chaseCam.active || (cameraAngleLock && isCameraLocked)) {
        const chased = celestialBodies.get(chaseCam.bodyName);
        if (chased) {
            chased.mesh.getWorldQuaternion(_rollQuat).invert();
            chaseCam.upLocal.copy(camera.up).applyQuaternion(_rollQuat).normalize();
        }
    }
}

// "Up" for a roll target, flattened so it's perpendicular to the view
// direction (that's what makes it an upright screen direction)
function screenUpFrom(dir, out) {
    _rollFwd.copy(controls.target).sub(camera.position).normalize();
    out.copy(dir).addScaledVector(_rollFwd, -dir.dot(_rollFwd));
    return out.lengthSq() > 1e-8 ? out.normalize() : null; // looking straight along it
}

// North = the rotation axis of the focused body's planet (Earth for the ISS)
function northDirection(out) {
    let body = currentFocusedBody && celestialBodies.get(currentFocusedBody);
    if (body?.type === 'satellite' || body?.type === 'moon') {
        const parent = [...celestialBodies.values()].find(b => b.mesh === body.parent);
        if (parent) body = parent;
    }
    out.set(0, 1, 0);
    if (body) out.applyQuaternion(body.mesh.getWorldQuaternion(_rollQuat));
    return out;
}

// Level horizon: the focused object's own up (for the ISS, away from Earth)
function horizonUpDirection(out) {
    const body = currentFocusedBody && celestialBodies.get(currentFocusedBody);
    if (!body) return null;
    return out.set(0, 1, 0).applyQuaternion(body.mesh.getWorldQuaternion(_rollQuat));
}

function startRollAnimation(kind) {
    rollAnimation = { start: performance.now(), from: camera.up.clone(), kind };
}

// Per frame, after the follow/chase code and before controls.update()
function updateViewRoll() {
    if (!rollAnimation) return;
    const want = rollAnimation.kind === 'north' ? northDirection(_rollTmp) : horizonUpDirection(_rollTmp);
    const target = want && screenUpFrom(want, _rollTarget);
    if (!target) { rollAnimation = null; return; }
    const t = Math.min(1, (performance.now() - rollAnimation.start) / ROLL_ANIM_MS);
    const e = t * t * (3 - 2 * t);
    // Rotate from the starting up toward the target around the view axis
    const from = screenUpFrom(rollAnimation.from, _rollNorth) || camera.up;
    const angle = Math.atan2(_rollFwd.dot(_rollTmp.crossVectors(from, target)), from.dot(target));
    setCameraUp(_rollTmp.copy(from).applyAxisAngle(_rollFwd, angle * e));
    if (t >= 1) rollAnimation = null;
}

function setupViewRoll(canvas) {
    // Ctrl+drag rolls; caught before OrbitControls (which would pan)
    canvas.addEventListener('pointerdown', (e) => {
        if (!e.ctrlKey || e.button !== 0 || viewMode !== 'map') return;
        e.stopImmediatePropagation();
        e.preventDefault();
        rollDrag.pointerId = e.pointerId;
        rollDrag.x = e.clientX;
        rollAnimation = null;
    }, { capture: true });
    window.addEventListener('pointermove', (e) => {
        if (e.pointerId !== rollDrag.pointerId) return;
        const dx = e.clientX - rollDrag.x;
        rollDrag.x = e.clientX;
        _rollFwd.copy(controls.target).sub(camera.position).normalize();
        // Full-width drag ≈ one full turn; drag right turns the view clockwise
        setCameraUp(_rollTmp.copy(camera.up).applyAxisAngle(_rollFwd, dx / canvas.clientWidth * Math.PI * 2));
    });
    const end = (e) => { if (e.pointerId === rollDrag.pointerId) rollDrag.pointerId = null; };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    document.getElementById('compass-btn')?.addEventListener('click', () => startRollAnimation('north'));
    document.getElementById('level-horizon-btn')?.addEventListener('click', () => startRollAnimation('horizon'));
}

// Compass needle points where north is on screen; horizon button only for
// spacecraft. Called from the ~30 Hz UI tick.
function updateViewOrientationUI() {
    const needle = document.getElementById('compass-needle');
    if (needle) {
        northDirection(_rollNorth).transformDirection(camera.matrixWorldInverse);
        const deg = Math.atan2(_rollNorth.x, _rollNorth.y) * 180 / Math.PI;
        needle.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    }
    const levelBtn = document.getElementById('level-horizon-btn');
    if (levelBtn) {
        const body = currentFocusedBody && celestialBodies.get(currentFocusedBody);
        levelBtn.hidden = !(body?.type === 'satellite') || viewMode !== 'map';
    }
}

function setupChaseCamDrag(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
        if (!chaseCam.active && !cameraIsRolled()) return;
        // One primary pointer, left button, no pan modifier; a second finger
        // (pinch) cancels so OrbitControls can zoom
        if (chaseDrag.pointerId !== null) { chaseDrag.pointerId = null; return; }
        if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
        chaseDrag.pointerId = e.pointerId;
        chaseDrag.x = e.clientX;
        chaseDrag.y = e.clientY;
    });
    canvas.addEventListener('pointermove', (e) => {
        if (e.pointerId !== chaseDrag.pointerId) return;
        const dx = e.clientX - chaseDrag.x, dy = e.clientY - chaseDrag.y;
        chaseDrag.x = e.clientX;
        chaseDrag.y = e.clientY;
        // Same feel as OrbitControls: a full-height drag = 2π × rotateSpeed
        const k = 2 * Math.PI * controls.rotateSpeed / canvas.clientHeight;
        chaseDrag.dTheta -= dx * k;
        chaseDrag.dPhi -= dy * k;
    });
    const end = (e) => { if (e.pointerId === chaseDrag.pointerId) chaseDrag.pointerId = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
}
let cameraOffsetFromTarget = null; // Stores camera offset when locked
let starField;
let currentStarFieldScale = 100000; // Track current scale for smooth transitions
let travelStreakCanvas = null;
let travelStreakContext = null;
let travelStreakParticles = [];
let travelStreaksWereVisible = false;
const REDUCED_MOTION_MQ = window.matchMedia('(prefers-reduced-motion: reduce)');
let animationId;
let time = 0;
let alignedStartDate = new Date(); // The starting date for planet alignment in Aligned mode
let categorySortModes = {
    'Solar System': 'distance',  // Default: distance from Sun
    'Stars': 'size',              // Default: biggest first
    'Exoplanets': 'name',         // Default: alphabetical
    'Black Holes': 'name',        // Default: alphabetical
    'Small Bodies': 'distance'    // Default: nearest to Earth first
}; // Each category has its own sort mode: 'name', 'size', or 'distance'

// Track which categories are expanded (persisted in localStorage)
let categoryExpansionState = {
    'Solar System': true,   // Default: expanded
    'Stars': true,          // Default: expanded
    'Exoplanets': true,     // Default: expanded
    'Black Holes': true,    // Default: expanded
    'Small Bodies': true
};

// Load expansion state from localStorage if available
try {
    const saved = localStorage.getItem('categoryExpansionState');
    if (saved) {
        categoryExpansionState = JSON.parse(saved);
    }
} catch (e) {
    // If localStorage fails, use defaults
}
let hoveredBody = null;
let hoveredOrbit = null;
let hoveredConstellation = null;
let constellationSprites = [];
let raycaster, mouse;
let isDragging = false;
let mouseDownPos = { x: 0, y: 0 };
let activeTapPointerId = null;
let hoverStateDirty = false;
let controlsStateDirty = false;
let lastControlsDistance = null;
let lastHomeIndicatorUpdate = 0;
const _animLocalPosition = new THREE.Vector3();
const _animYAxis = new THREE.Vector3(0, 1, 0);
const _compareTiltAxis = new THREE.Vector3(0, 0, 1); // size comparison: lean planets across the screen
const _compareSpinQ = new THREE.Quaternion();
const _compareLeanQ = new THREE.Quaternion();
const _compareTipAxis = new THREE.Vector3(1, 0, 0);
const COMPARE_VIEW_TIP = 0.2; // radians
const _animEarthPosition = new THREE.Vector3();
const _animDirectionToSun = new THREE.Vector3();
const _animWorldPosition = new THREE.Vector3();
const _animCameraOffset = new THREE.Vector3();
const _comparisonProjectedPosition = new THREE.Vector3();
const _comparisonDirection = new THREE.Vector3();
const _comparisonCameraForward = new THREE.Vector3();
const _comparisonCameraRight = new THREE.Vector3();
const _animWorldQuat = new THREE.Quaternion();
const _animIssTargetOffset = new THREE.Vector3();
const _animIssCamOffset = new THREE.Vector3();
const _animIssUp = new THREE.Vector3();









// Initialize the application
function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000002);
    
    // Camera setup - start with solar system overview
    const aspect = window.innerWidth / window.innerHeight;
    // Massive Far plane needed for True Scale comparison view (millions of units)
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000000000); 
    camera.layers.enable(ORBIT_LAYER); // orbit lines (toggled with Q)
    // Note: With such a large range (0.1 to 10B), we should use logarithmicDepthBuffer in renderer

    // Position camera to show Sun with planets extending to upper right
    // Camera needs to be positioned lower-left-back to look up-right-forward at the scene
    const viewDistance = 250; // Closer for better visibility
    camera.position.set(
        -viewDistance * 0.8, // Left of Sun
        viewDistance * 0.5,  // Above Sun
        viewDistance * 1.0    // Back/away from Sun
    );

    // Renderer setup
    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('space-canvas'),
        antialias: true,
        logarithmicDepthBuffer: true // Essential for handling the massive scale difference between planetary and galactic views
    });
    // Filmic tone mapping: highlights roll off instead of clipping to white
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;

    // Shadow maps are disabled: no single shadow map can span solar-system
    // distances without blocky edges or acne (VSM also silently makes every
    // receiver self-cast, which re-broke Saturn). Moon transit shadows are
    // drawn as projected decals instead — see updateMoonShadows().
    renderer.shadowMap.enabled = false;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    setupTravelStreaks();
    setupStellarComparison();
    setupKonamiCode();

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    setupChaseCamDrag(renderer.domElement);
    setupWheelHelpers(renderer.domElement);
    setupViewRoll(renderer.domElement);
    document.getElementById('home-label')?.addEventListener('click', () => {
        const dir = userLocationLocalDir();
        if (dir && viewMode === 'map') flyToEarthSpot(dir);
    });
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1; // Allow getting very close in comparison view
    controls.maxDistance = 2000000000; // Increased to 2B to handle distance stars in realistic scale
    controls.rotateSpeed = 0.5; // Default rotation speed
    controls.zoomSpeed = 1.0; // Default zoom speed
    controls.panSpeed = 0.5; // Default pan speed
    controls.target.set(0, 0, 0); // Look at the Sun

    // Configure mouse buttons: Left=rotate, Middle=pan, Right=pan (with shift)
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN
    };
    controls.addEventListener('change', () => {
        controlsStateDirty = true;
        hoverStateDirty = true;
    });

    // Lighting
    // Low ambient light so we can see the dark sides of planets slightly
    const ambientLight = new THREE.AmbientLight(0x333333, 0.3);
    scene.add(ambientLight);

    // Add point light at the Sun's position to illuminate planets from all directions
    // PointLight radiates in all directions, so planets are lit correctly regardless of orbital position
    // As planets orbit, they're automatically lit from the correct angle relative to the Sun
    sunLight = new THREE.PointLight(0xffffff, 3.5, 0, 0); // distance=0 (infinite), decay=0 (no falloff)
    sunLight.position.set(0, 0, 0); // At the Sun's position (origin)
    scene.add(sunLight);

    // Headlight for size comparison mode: the lineup sits far from the sun's
    // point light, so without this the spheres are lit edge-on or not at all.
    // Follows the camera each frame in animate(); only visible in sizeCompare.
    compareLight = new THREE.DirectionalLight(0xffffff, 2.2);
    compareLight.visible = false;
    scene.add(compareLight);
    scene.add(compareLight.target);

    // Create celestial bodies
    createSolarSystem();
    detectUserLocation();
    initMoonShadows();
    initISS();
    setSatelliteMode('Off');   // shown briefly the first time you come near Earth (updateSatelliteIntro)
    createNearbyStars();
    setScaleValue(scaleValue, false); // lay out planets, moons and stars for the starting scale
    // Dwarf planets, asteroid, comet, interstellar objects, spacecraft
    initSmallBodies(scene).forEach(sb => celestialBodies.set(sb.name, { mesh: sb.mesh, data: sb.data, type: 'smallbody' }));
    // Easter egg: a wedge of cheddar at the Moon's south pole. Never allowed to
    // stop the app loading
    try {
        cheeseMoon = initCheeseMoon({
            moonMesh: celestialBodies.get('Moon')?.mesh, earthMesh: celestialBodies.get('Earth')?.mesh,
            moonData: celestialBodies.get('Moon')?.data, scene,
            setNightLights: k => { nightLightsScale = k; }
        });
    } catch (err) {
        console.warn('Easter egg unavailable:', err);
        cheeseMoon = null;
    }
    setupStellarReferenceMeshes();
    createStarField();

    // Console debugging handle (harmless in production)
    window.__DEBUG = { scene, camera, renderer, controls, celestialBodies, moonShadows, get iss() { return issState; }, satelliteCounts, computeScaleLayout, computeRawScaleLayout, getStarLayoutInfo, get currentSystemEdge() { return currentSystemEdge; }, get flyTo() { return flyToAnimation; }, get cheeseMoon() { return cheeseMoon; }, cheeseTour, startCheese: () => { cheeseMoon.trigger(simDate); startCheeseTour(); } };

    // Spacetime grid removed

    // Set up initial Earth-centered view with wider zoom to show neighboring planets
    flyToEarth();

    // Event listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointerdown', onMouseDown);
    window.addEventListener('pointerup', onMouseUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('popstate', applyViewModeFromUrl);
    
    // Initialize raycaster for hover detection
    raycaster = new THREE.Raycaster();
    setupMagnifier();
    mouse = new THREE.Vector2();
    setupCustomOrbitDrag(renderer.domElement);
    
    // UI
    document.getElementById('close-info').addEventListener('click', hideBodyInfo);
    document.getElementById('camera-lock-toggle').addEventListener('click', toggleCameraLock);
    document.getElementById('orbital-toggle').addEventListener('click', toggleOrbitalMode);
    document.getElementById('home-indicator-toggle').addEventListener('click', toggleHomeIndicator);
    setSatelliteStatusListener(problems => {
        const btn = document.getElementById('satellites-toggle');
        if (!btn) return;
        btn.classList.toggle('has-warning', problems.length > 0);
        btn.title = problems.length ? problems.join('\n') : 'Live satellite positions from CelesTrak';
    });
    // Night side up close: dark street map with labels, or city lights.
    // Remembered between visits.
    const NIGHT_VIEW_KEY = 'nightView:v1';
    const applyNightView = style => {
        setNightStyle(style);
        const label = document.getElementById('night-view-mode');
        if (label) label.textContent = style === 'map' ? 'Street map' : 'City lights';
    };
    applyNightView(localStorage.getItem(NIGHT_VIEW_KEY) === 'lights' ? 'lights' : 'map');
    // Globe mode: Earth as a desktop globe (grid, glowing equator, tilted stand)
    const applyGlobeMode = on => {
        setGlobeMode(on, celestialBodies.get('Earth')?.mesh, scene);
        const label = document.getElementById('globe-mode');
        if (label) label.textContent = on ? 'On' : 'Off';
    };
    document.getElementById('globe-toggle')?.addEventListener('click', () => applyGlobeMode(!isGlobeMode()));
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyG' || e.repeat || isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
        applyGlobeMode(!isGlobeMode());
    });

    document.getElementById('night-view-toggle')?.addEventListener('click', () => {
        const next = document.getElementById('night-view-mode').textContent === 'Street map' ? 'lights' : 'map';
        applyNightView(next);
        try { localStorage.setItem(NIGHT_VIEW_KEY, next); } catch { /* private mode */ }
    });

    // The time panel sits just above the settings row; track the row's real
    // height (it can wrap on narrower windows) instead of a fixed offset
    const settingsRow = document.getElementById('scale-toggle-container');
    if (settingsRow && 'ResizeObserver' in window) {
        new ResizeObserver(() => {
            document.documentElement.style.setProperty('--settings-row-height', settingsRow.offsetHeight + 'px');
        }).observe(settingsRow);
    }
    document.getElementById('satellites-toggle')?.addEventListener('click', () => {
        const label = document.getElementById('satellites-mode');
        const next = SATELLITE_MODES[(SATELLITE_MODES.indexOf(label.textContent) + 1) % SATELLITE_MODES.length];
        label.textContent = next;
        setSatelliteMode(next);
        endSatelliteIntro();                     // the user's choice from here on
    });
    setupPopupMenus();
    setupScaleMenu();
    setupSmallBodiesMenu();
    setupWeatherMenu();
    setupBodyInfoPeek();
    

    
    const viewModeToggle = document.getElementById('view-mode-toggle');
    if (viewModeToggle) {
        viewModeToggle.addEventListener('click', toggleViewMode);
    }
    
    const sizeCompareBtn = document.getElementById('size-compare-btn');
    if (sizeCompareBtn) {
        sizeCompareBtn.addEventListener('click', toggleViewMode);
    }
    
    document.getElementById('home-btn').addEventListener('click', () => flyToEarth());

    setupSidebarPeek();

    const minimizeInfo = document.getElementById('minimize-info');
    if (minimizeInfo) {
        minimizeInfo.addEventListener('click', () => {
            const panel = document.getElementById('body-info');
            if (panel) {
                panel.classList.toggle('minimized');
            }
        });
    }

    // ── Timeline controls ─────────────────────────────────────────────
    // −/+ step one rung of the speed ladder; ⏪/⏩ step four (16×)
    document.getElementById('tl-reverse-fast').addEventListener('click', () => stepSimSpeed(-4));
    document.getElementById('tl-reverse').addEventListener('click', () => stepSimSpeed(-1));
    document.getElementById('tl-play-pause').addEventListener('click', () => {
        if (simPaused) {
            simPaused = false;
            // Resume at whatever speed was set. Only fall back to the default
            // when no speed is set at all; don't judge by the slider thumb,
            // since slow speeds (sec/s, min/s) sit on its "paused" notch.
            if (getSimulationRate() === 0) {
                setSimRateSps(DEFAULT_SIM_SPS);
                return;
            }
        } else {
            simPaused = true;
        }
        syncTimelineUI();
    });
    // Space = play/pause (instead of scrolling the side panel). Also swallowed
    // on keyup: a focused button (e.g. Play, just clicked) would otherwise be
    // "pressed" by the browser on release and toggle a second time.
    const isTextEntry = el => el instanceof HTMLElement && (el.isContentEditable
        || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
        || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type)));
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        if (!e.repeat) document.getElementById('tl-play-pause').click();
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && !isTextEntry(e.target)) e.preventDefault();
    });

    // A / D step the speed ladder down / up, same as the − / + buttons
    // (below the slowest forward rung, A continues into reverse)
    window.addEventListener('keydown', (e) => {
        if (e.repeat || isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.code === 'KeyD') stepSimSpeed(1);
        else if (e.code === 'KeyA') stepSimSpeed(-1);
    });

    // Q hides every orbit line and trail (pair with H for a bare view);
    // E flies to Earth, I to the ISS (same as clicking them)
    window.addEventListener('keydown', (e) => {
        if (e.repeat || isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.code === 'KeyQ') {
            showOrbitLines = !showOrbitLines;
            camera.layers.toggle(ORBIT_LAYER);
        } else if (e.code === 'KeyR') {
            endCheeseMoon(false);                 // back to the present (and the plain Moon)
        } else if ((e.code === 'KeyE' || e.code === 'KeyI' || e.code === 'KeyM') && viewMode === 'map') {
            const name = { KeyE: 'Earth', KeyI: 'ISS', KeyM: 'Moon' }[e.code];
            cheeseTour.camera = false;
            tourGlide = null;
            // The ISS has no position until its TLE loads
            if (name !== 'ISS' || celestialBodies.get(name)?.mesh.visible) focusOnBody(name);
        }
    });
    // Dragging or zooming during the cheese Moon tour hands the camera back
    const takeCamera = () => { cheeseTour.camera = false; tourGlide = null; };
    renderer.domElement.addEventListener('pointerdown', takeCamera);
    renderer.domElement.addEventListener('wheel', takeCamera, { passive: true });

    // W / S spread out / compress the distance scale while held; the motion
    // eases in and out (updateScaleKeys), ignoring the OS key auto-repeat
    window.addEventListener('keydown', (e) => {
        if ((e.code !== 'KeyW' && e.code !== 'KeyS') || isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
        scaleKeys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => { if (e.code in scaleKeys) scaleKeys[e.code] = false; });
    window.addEventListener('blur', () => { scaleKeys.KeyW = scaleKeys.KeyS = false; });

    // H hides every panel and button for clean screenshots and recordings
    let uiHintTimer = null;
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyH' || e.repeat || isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
        const hidden = document.body.classList.toggle('ui-hidden');
        const hint = document.getElementById('ui-hidden-hint');
        clearTimeout(uiHintTimer);
        hint.classList.toggle('show', hidden);
        if (hidden) uiHintTimer = setTimeout(() => hint.classList.remove('show'), 2000);
    });

    // Open playing at the default speed (also sets the slider and readout)
    setSimRateSps(DEFAULT_SIM_SPS);

    document.getElementById('tl-forward').addEventListener('click', () => stepSimSpeed(1));
    document.getElementById('tl-forward-fast').addEventListener('click', () => stepSimSpeed(4));

    // Presets keep the current direction, so they work while reversing too
    document.querySelectorAll('.tl-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const sign = currentSimSps() < 0 ? -1 : 1;
            setSimRateSps(sign * Number(btn.dataset.sps));
        });
    });

    // Scroll anywhere over the time panel to step the speed ladder (a pointer
    // that drifts off the thin slider shouldn't break a recording). One wheel
    // notch = one step, however large its delta (mice send anything from ~100
    // to 500+ per notch depending on OS settings). Trackpads send many small
    // deltas per gesture, so those are summed until they amount to a notch.
    const timelinePanel = document.getElementById('timeline-panel');
    const WHEEL_NOTCH = 50;   // a single event at least this big is a mouse notch
    const TRACKPAD_STEP = 100; // small deltas summed to this make one step
    let speedWheelAccum = 0;
    timelinePanel?.addEventListener('wheel', (e) => {
        e.preventDefault(); // don't zoom the map / scroll the page
        const delta = -(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY); // up = faster
        if (delta === 0) return;
        if (Math.abs(delta) >= WHEEL_NOTCH) {
            speedWheelAccum = 0;
            stepSimSpeed(Math.sign(delta));
            return;
        }
        if (Math.sign(delta) !== Math.sign(speedWheelAccum)) speedWheelAccum = 0;
        speedWheelAccum += delta;
        if (Math.abs(speedWheelAccum) >= TRACKPAD_STEP) {
            stepSimSpeed(Math.sign(speedWheelAccum));
            speedWheelAccum = 0;
        }
    }, { passive: false });

    const speedSlider = document.getElementById('tl-speed-slider');
    if (speedSlider) {
        speedSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            timeScale = mapSliderToAlignedSpeed(val);
            simSpeed = mapSliderToRealisticSpeed(val);
            if (val === -20) {
                simPaused = true;
            } else {
                if (simPaused) {
                    simPaused = false;
                }
            }
            syncTimelineUI();
        });
    }

    // Date picker button opens the native date picker
    const datePickerBtn = document.getElementById('tl-date-picker-btn');
    const datePicker = document.getElementById('tl-date-picker');
    if (datePickerBtn && datePicker) {
        datePickerBtn.addEventListener('click', () => {
            try {
                datePicker.showPicker();
            } catch (e) {
                datePicker.click();
            }
        });
    }

    // Date picker: jump to a specific date/time
    if (datePicker) {
        datePicker.addEventListener('change', (e) => {
            const picked = new Date(e.target.value);
            if (!isNaN(picked.getTime())) {
                simDate = picked;
                if (orbitalMode === 'realistic') updateRealisticPositions(simDate);
                updateTimelineDisplay();
            }
        });
    }

    // "Now" button: snap back to real current time
    document.getElementById('tl-goto-now').addEventListener('click', () => {
        simDate = new Date();
        if (orbitalMode === 'aligned') {
            alignedStartDate = new Date(simDate.getTime());
            orbitGroups.forEach(group => { group.rotation.y = 0; });
        } else if (orbitalMode === 'realistic') {
            updateRealisticPositions(simDate);
        }
        updateTimelineDisplay();
        syncTimelineUI();
    });
    // ── End timeline controls ─────────────────────────────────────────

    // Create guide line canvas
    createGuideLineCanvas();
    
    // Prevent sidebar scroll from affecting the map
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        // Start with the object drawer open on roomy desktop viewports so
        // it's discoverable, then slide it away (like the info panel)
        if (LARGE_DESKTOP_LAYOUT_MQ.matches && !isMobileLayout()) {
            sidebar.classList.remove('collapsed');
            sidebarPeek.state = 'peek';
            scheduleSidebarTuck();
        }

        sidebar.addEventListener('wheel', (e) => {
            e.stopPropagation();
        }, { passive: false });
    }

    // Initialize sidebar object list
    setTimeout(populateObjectList, 100);

    // Start animation
    animate();

    // Update UI
    updateUI();

    // Initialize home indicator toggle state
    document.getElementById('home-indicator-mode').textContent = showHomeIndicator ? 'On' : 'Off';
    if (showHomeIndicator) {
        document.getElementById('home-indicator').classList.remove('hidden');
    }
    
    // Initialize show stars toggle state
    
    // Initialize constellations toggle state
    

    // Initialize gravity well toggle state - REMOVED

    // Setup info popup
    setupInfoPopup();
    setupControlsInfo();

    // Setup mobile bottom nav + sheets
    setupMobileNav();
    setupCompareTouchNav();

    // Check URL parameters for direct linking
    // Example: ?mode=sizeCompare&target=Earth
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    
    if (modeParam === 'sizeCompare') {
        // Toggle directly to size comparison mode
        toggleViewMode(null, false);
        
        // Check for specific target
        // Wait briefly for the view to switch and meshes to be created
        setTimeout(() => {
            const targetParam = urlParams.get('target');
            if (targetParam) {
                // Decode the name (e.g., "Stephenson%202-18" -> "Stephenson 2-18")
                const decodedName = decodeURIComponent(targetParam);
                focusOnSizeComparisonObject(decodedName);
            }
        }, 100);
    } else {
        // Show timeline panel on startup for map view
        showTimelinePanel();
    }
}

function createSolarSystem() {
    // Create Sun
    const sunData = solarSystem;
    const sunMesh = createBodyMesh(sunData);
    sunMesh.position.set(0, 0, 0);
    scene.add(sunMesh);
    
    

    celestialBodies.set('Sun', {
        mesh: sunMesh,
        data: sunData,
        type: 'star'
    });
    
    // Create a clickable solar system marker for stellar zoom
    const solarSystemMarker = createSolarSystemMarker();
    scene.add(solarSystemMarker);
    celestialBodies.set('Solar System', {
        mesh: solarSystemMarker,
        data: {
            name: 'Solar System',
            type: 'system',
            description: 'Our home planetary system'
        },
        type: 'system',
        isDistant: true
    });

    // Create orbit groups for planets (independent of sun rotation)
    sunData.children.forEach(planetData => {
        const orbitGroup = new THREE.Group();
        scene.add(orbitGroup);
        orbitGroups.set(planetData.name, orbitGroup);

        // Create planet
        const planetMesh = createBodyMesh(planetData);
        
        // Scale distance for visibility (not to scale)
        const distance = scaleDistance(planetData.distance);
        planetMesh.position.x = distance;
        orbitGroup.add(planetMesh);

        celestialBodies.set(planetData.name, {
            mesh: planetMesh,
            data: planetData,
            type: 'planet',
            orbitGroup: orbitGroup,
            orbitRadius: distance,
            orbitSpeed: planetData.orbitalPeriod ? (2 * Math.PI) / (planetData.orbitalPeriod * 10) : 0
        });

        // Create orbit line
        createOrbitLine(distance, planetData.color, planetData.name);

        // Create moons
        if (planetData.children) {
            planetData.children.forEach(moonData => {
                const moonMesh = createBodyMesh(moonData);
                const moonDistance = scaleDistance(moonData.distance, true);
                
                // Moon orbits planet
                moonMesh.position.x = moonDistance;
                planetMesh.add(moonMesh);

                celestialBodies.set(moonData.name, {
                    mesh: moonMesh,
                    data: moonData,
                    type: 'moon',
                    parent: planetMesh,
                    orbitRadius: moonDistance,
                    orbitSpeed: moonData.orbitalPeriod ? (2 * Math.PI) / (moonData.orbitalPeriod * 100) : 0
                });
            });
        }

        // The ISS is listed and focusable like a moon; iss.js positions it
        if (planetData.name === 'Earth') {
            const issMesh = getISSGroup();
            planetMesh.add(issMesh);
            celestialBodies.set(ISS_DATA.name, { mesh: issMesh, data: ISS_DATA, type: 'satellite', parent: planetMesh });
        }
    });
}

// ── Moon transit shadows ─────────────────────────────────────────────────
// Drawn as soft radial-gradient decals projected onto the parent planet along
// the sun→moon line. Shadow maps can't do this cleanly: one map spanning the
// whole solar system leaves only a few texels per planet, giving blocky edges.

function createMoonShadowTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(0,0,0,0.8)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.65)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.2)');
    g.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

function initMoonShadows() {
    const texture = createMoonShadowTexture();
    celestialBodies.forEach(body => {
        if (body.type !== 'moon' || !body.parent) return;
        const moonR = body.mesh.geometry.parameters.radius;
        const planetR = body.parent.geometry.parameters.radius;
        // Umbra + penumbra somewhat wider than the moon; capped for big moons
        const half = Math.min(moonR * 1.6, planetR * 0.6);
        const decal = new THREE.Mesh(
            new THREE.PlaneGeometry(half * 2, half * 2),
            new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false
            })
        );
        decal.raycast = function() {};
        decal.visible = false;
        scene.add(decal);
        moonShadows.push({
            moonMesh: body.mesh,
            planetMesh: body.parent,
            decal: decal,
            radius: planetR,
            lift: planetR * 0.01 // float just above the surface to avoid z-fighting
        });
    });
}

const _msMoonPos = new THREE.Vector3();
const _msPlanetPos = new THREE.Vector3();
const _msSunDir = new THREE.Vector3();
const _msOffset = new THREE.Vector3();
const _msNormal = new THREE.Vector3();
const _msLookAt = new THREE.Vector3();

function updateMoonShadows() {
    const active = viewMode === 'map';
    for (const s of moonShadows) {
        if (!active || !s.moonMesh.visible || !s.planetMesh.visible) {
            s.decal.visible = false;
            continue;
        }
        s.moonMesh.getWorldPosition(_msMoonPos);
        s.planetMesh.getWorldPosition(_msPlanetPos);

        // Ray from the moon along the sun→moon direction (sun is at the origin),
        // intersected with the parent planet's sphere.
        _msSunDir.copy(_msMoonPos).normalize();
        _msOffset.copy(_msMoonPos).sub(_msPlanetPos);
        const b = _msOffset.dot(_msSunDir);
        const c = _msOffset.lengthSq() - s.radius * s.radius;
        const disc = b * b - c;
        if (disc <= 0) { s.decal.visible = false; continue; }
        const t = -b - Math.sqrt(disc);
        if (t <= 0) { s.decal.visible = false; continue; } // moon is beside/behind the planet

        // Surface point the shadow lands on, and its outward normal
        _msNormal.copy(_msSunDir).multiplyScalar(t).add(_msMoonPos).sub(_msPlanetPos).normalize();
        s.decal.position.copy(_msNormal).multiplyScalar(s.radius + s.lift).add(_msPlanetPos);
        _msLookAt.copy(s.decal.position).add(_msNormal);
        s.decal.lookAt(_msLookAt);
        s.decal.visible = true;
    }
}

function scaleDistance(distance, isMoon = false, isStellar = false) {
    if (isMoon && scaleMode === 'realistic') {
        // True scale: same km-per-unit as body radii (createBodyMesh), so moons,
        // satellites and planet sizes all agree (the Moon sits ~60 Earth radii
        // out, well beyond the geostationary ring)
        return distance / 5000;
    }
    if (isMoon) {
        // Moons - scale to be clearly visible but close to their parent planet
        // Must balance: small planet moons stay close, large planet moons stay outside parent
        if (distance > 1000000) {
            // Jupiter's/Saturn's outer moons (Callisto ~1.88M km, Titan 1.22M)
            return Math.max(distance / 50000, 2);
        } else if (distance > 600000) {
            // Jupiter's mid-range moons (Europa 671k, Ganymede 1.07M)
            // Parent Jupiter has 14 unit radius, needs to be outside
            return Math.max(distance / 40000, 2);
        } else if (distance > 420000) {
            // Jupiter's Io (422k) - parent is huge (14 unit radius), needs more space
            return Math.max(distance / 25000, 2);
        } else if (distance > 350000) {
            // Earth's Moon (384k) - parent is small (1.3 unit radius), can be closer
            return Math.max(distance / 80000, 2);
        } else if (distance > 230000) {
            // Saturn's Enceladus (238k) - parent is huge (11.6 unit radius)
            return Math.max(distance / 15000, 2);
        } else if (distance > 20000) {
            // Medium-close moons (50k-230k range)
            return Math.max(distance / 80000, 2);
        } else if (distance > 5000) {
            // Very close moons (Mars moons: 9k-23k km)
            // Scale more aggressively so they're visible outside tiny Mars
            return Math.max(distance / 3000, 2);
        } else {
            // Ultra-close moons
            return Math.max(distance / 1000, 2);
        }
    }
    
    // (AU imported from celestialData.js)
    
    if (isStellar) {
        // Stellar distances (light years)
        if (scaleMode === 'realistic') {
            // Realistic: 1 LY = 10000 units (much more spread out)
            return (distance / LY) * 10000;
        } else {
            // Compressed: 1 LY = 500 units (original)
            return (distance / LY) * 500;
        }
    }
    
    if (scaleMode === 'realistic') {
        // Realistic scale: 1 AU = 1000 units
        return (distance / AU) * 1000;
    } else {
        // Compressed scale: heavily scaled for visibility
        // Earth's distance (1 AU) should be around 100 units
        return (distance / AU) * 100;
    }
}

function scaleExoplanetDistance(distance, hostMesh, planetMesh) {
    const scaledDistance = scaleDistance(distance);
    const hostRadius = hostMesh.userData.visualRadius
        || hostMesh.geometry?.parameters?.radius
        || 5;
    const planetRadius = planetMesh.userData.visualRadius
        || planetMesh.geometry?.parameters?.radius
        || 1;

    // Compressed orbital distances and deliberately enlarged body radii use
    // different scales. Preserve the orbit when it already clears the star,
    // otherwise add enough display-only separation to clear its 2x corona and
    // leave a readable gap between the host and planet.
    const minimumDisplayDistance = hostRadius * 3 + planetRadius * 1.5;
    return Math.max(scaledDistance, minimumDisplayDistance);
}

function createDistantObjectMesh(data) {
    let visualRadius;
    // Black holes ignore their hand-set displayRadius and use the true
    // Schwarzschild radius (below), consistent with stars and size comparison
    if (data.displayRadius && data.type !== 'blackhole') {
        visualRadius = data.displayRadius;
    } else if (data.radius) {
        // Cap giant stars so they don't overlap everything. Black holes use
        // their true Schwarzschild radius like stars do (the log cap shrank
        // Phoenix A*, ~200× Stephenson 2-18, to smaller than a giant star)
        if (data.radius > 100000000 && data.type !== 'blackhole') { // > ~140 solar radii
            visualRadius = 40 + Math.log10(data.radius / 100000000) * 5; // Logarithmic growth
        } else {
            visualRadius = Math.max(data.radius / 50000, 5);
        }
    } else {
        visualRadius = 10;
    }
    
    // Create a group to hold the object and any effects
    const group = new THREE.Group();
    
    if (data.type === 'blackhole') {
        // Disk shown nearly edge-on to the Solar System (the object sits out
        // along its sky direction, so the Sun is back along −direction)
        const sp = calculateStarPosition(data);
        const towardSun = new THREE.Vector3(-sp.x, -sp.y, -sp.z).normalize();
        const visual = createBlackHoleVisual(visualRadius, data.accretionColor || 0xFF7A30, data.name.length, stellarTime, towardSun);
        visual.getObjectByName('blackHolePick').userData.name = data.name;
        group.add(visual);
        group.userData.visualRadius = visualRadius;
        // Hover magnifier frames the glowing disk, not just the black shadow
        group.userData.previewRadius = visualRadius * BLACK_HOLE_REACH;

    } else if (data.type === 'neutronstar') {
        // Neutron star - small, bright, with pulse effect
        const geometry = new THREE.SphereGeometry(visualRadius, 32, 32);
        const material = new THREE.MeshBasicMaterial({
            color: data.color || 0xCCFFFF
        });
        const star = new THREE.Mesh(geometry, material);
        star.userData.name = data.name;
        group.add(star);
        
        // Pulsar beams
        const beamGeo = new THREE.ConeGeometry(visualRadius * 0.5, visualRadius * 8, 16);
        const beamMat = new THREE.MeshBasicMaterial({
            color: data.color || 0xCCFFFF,
            transparent: true,
            opacity: 0.3
        });
        const beam1 = new THREE.Mesh(beamGeo, beamMat);
        beam1.position.y = visualRadius * 4;
        beam1.rotation.x = Math.PI;
        group.add(beam1);
        
        const beam2 = new THREE.Mesh(beamGeo, beamMat);
        beam2.position.y = -visualRadius * 4;
        group.add(beam2);
        
    } else if (data.type === 'galaxy') {
        // Galaxy - spiral representation
        const geometry = new THREE.SphereGeometry(visualRadius, 32, 32);
        const material = new THREE.MeshBasicMaterial({ 
            color: data.color || 0xDDDDBB,
            transparent: true,
            opacity: 0.6
        });
        const galaxy = new THREE.Mesh(geometry, material);
        galaxy.userData.name = data.name;
        group.add(galaxy);
        
        // Spiral arms (simplified as rings)
        for (let i = 0; i < 3; i++) {
            const armGeo = new THREE.RingGeometry(
                visualRadius * (0.3 + i * 0.3), 
                visualRadius * (0.4 + i * 0.3), 
                32
            );
            const armMat = new THREE.MeshBasicMaterial({
                color: data.emissive || 0xCCCCAA,
                transparent: true,
                opacity: 0.3 - i * 0.05,
                side: THREE.DoubleSide
            });
            const arm = new THREE.Mesh(armGeo, armMat);
            arm.rotation.x = Math.PI / 2;
            arm.rotation.z = i * Math.PI / 3;
            group.add(arm);
        }
        
    } else if (data.type === 'nebula') {
        // Nebula - diffuse cloud
        const geometry = new THREE.SphereGeometry(visualRadius, 32, 32);
        const material = new THREE.MeshBasicMaterial({
            color: data.color || 0xFFAA88,
            transparent: true,
            opacity: 0.4
        });
        const nebula = new THREE.Mesh(geometry, material);
        nebula.userData.name = data.name;
        group.add(nebula);
        
        // Inner glow
        const glowGeo = new THREE.SphereGeometry(visualRadius * 0.7, 32, 32);
        const glowMat = new THREE.MeshBasicMaterial({
            color: data.emissive || 0xFF8866,
            transparent: true,
            opacity: 0.3
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.raycast = function() {};
        group.add(glow);
        
    } else if (data.type === 'cluster') {
        // Star cluster - group of points
        const geometry = new THREE.SphereGeometry(visualRadius, 32, 32);
        const material = new THREE.MeshBasicMaterial({
            color: data.color || 0xAAAADD,
            transparent: true,
            opacity: 0.5
        });
        const cluster = new THREE.Mesh(geometry, material);
        cluster.userData.name = data.name;
        group.add(cluster);
        
        // Add sparkle points
        for (let i = 0; i < 20; i++) {
            const pointGeo = new THREE.SphereGeometry(visualRadius * 0.1, 8, 8);
            const pointMat = new THREE.MeshBasicMaterial({
                color: 0xFFFFFF
            });
            const point = new THREE.Mesh(pointGeo, pointMat);
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const r = visualRadius * (0.5 + Math.random() * 0.5);
            point.position.set(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.sin(phi) * Math.sin(theta),
                r * Math.cos(phi)
            );
            group.add(point);
        }
        
    } else {
        // Default star rendering
        return createBodyMesh(data);
    }
    
    group.userData.name = data.name;
    return group;
}

function createBodyMesh(data) {
    let geometry, material;

    // Scale radius for visibility
    let visualRadius;
    if (data.type === 'star') {
        visualRadius = Math.max(data.radius / 50000, 5);
    } else if (data.type === 'moon') {
        // Use same scaling as planets for consistent size ratios
        visualRadius = Math.max(data.radius / 5000, 0.3);
    } else {
        visualRadius = Math.max(data.radius / 5000, 1);
    }

    geometry = new THREE.SphereGeometry(visualRadius, 64, 64);

    if (data.type === 'star') {
        // Real surface map if we have one (the Sun). Other stars are their
        // temperature colour; the surface shader adds granulation, starspots
        // and limb darkening (a baked noise texture read as stripes).
        const hasRealMap = !!REAL_TEXTURE_FILES[data.name];
        material = new THREE.MeshBasicMaterial({
            color: hasRealMap ? 0xffffff : starDisplayColor(data),
            // ACES washes saturated star colours out to pale yellow/white;
            // show the temperature colour as-is (the Sun's map is tuned for it)
            toneMapped: hasRealMap
        });
        if (hasRealMap) {
            const makeFallback = () => new THREE.CanvasTexture(generateStarTexture(starDisplayColor(data), data.name.length));
            material.map = loadRealTexture(data.name, material, makeFallback) || makeFallback();
        }
        enhanceStarSurface(material, starSurfaceParams(data, hasRealMap));
    } else if (data.type === 'blackhole') {
        material = new THREE.MeshBasicMaterial({ 
            color: 0x000000
        });
    } else {
        // Determine planet type for texture
        let planetType = 'rocky';
        if (data.hasBands || (data.name === 'Jupiter' || data.name === 'Saturn')) {
            planetType = 'gas';
        } else if (data.hasAtmosphere && data.name !== 'Earth') {
            planetType = 'terrestrial';
        } else if (data.name === 'Earth') {
            planetType = 'terrestrial';
        } else if (data.color === 0x99DDDD || data.name === 'Uranus' || data.name === 'Neptune') {
            planetType = 'ice';
        }
        
        // Use StandardMaterial for better lighting
        material = new THREE.MeshStandardMaterial({
            roughness: 0.9,  // High roughness to reduce specular highlights
            metalness: 0.0,  // No metalness to prevent over-bright reflections
            emissive: data.emissive || 0x000000,
            emissiveIntensity: data.emissiveIntensity || 0
        });

        // Real NASA-derived surface map if available; otherwise procedural
        // (Earth's procedural fallback is the hand-authored continent texture)
        const makeFallback = () => new THREE.CanvasTexture(generatePlanetTexture(planetType, data.color, data.name.length, data.name));
        material.map = loadRealTexture(data.name, material, makeFallback) || makeFallback();
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.name = data.name;
    mesh.userData.visualRadius = visualRadius;

    // Align Earth's texture so the Prime Meridian (Greenwich, lon 0°) faces correctly.
    // Three.js SphereGeometry UV seam is at lon 180° (the back, −Z side).
    // No extra offset needed — the texture's left edge (lon −180°) maps to lon −180° on the sphere,
    // so the continents will appear at their correct longitudes automatically.
    // We do need a half-turn so the front of the sphere (+Z) shows the Eastern Hemisphere
    // as it would appear looking at Earth from space above the ecliptic.
    if (data.name === 'Earth') {
        mesh.rotation.y = Math.PI; // align so Africa/Europe face outward at lon 0°
        addEarthNightLights(material);
    }

    // Add atmosphere glow for planets
    if (data.hasAtmosphere) {
        const atmoColor = data.atmosphereColor || data.color;
        
        // Use a sprite or outer shell to mimic atmosphere, rather than wrapping the planet in a sphere
        // Outer glow layer
        const glowGeo = new THREE.SphereGeometry(visualRadius * 1.05, 64, 64);
        const glowMat = new THREE.MeshBasicMaterial({
            color: atmoColor,
            transparent: true,
            opacity: 0.15,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const outerGlow = new THREE.Mesh(glowGeo, glowMat);
        outerGlow.raycast = function() {};
        mesh.add(outerGlow);
    }

    // Add enhanced glow for stars
    if (data.type === 'star' || data.emissive) {
        const starColor = data.type === 'star' ? starDisplayColor(data) : (data.emissive || data.color);
        
        mesh.add(createCorona(visualRadius, starColor));
        if (data.type === 'star') mesh.add(createStellarLimb(visualRadius, starColor));

        // Diffraction spike sprite — always faces camera, gives stars a star-like look
        const spriteCanvas = generateStarSpriteTexture(starColor);
        const spriteTex = new THREE.CanvasTexture(spriteCanvas);
        const spriteMat = new THREE.SpriteMaterial({
            map: spriteTex,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
        });
        const sprite = new THREE.Sprite(spriteMat);
        const baseGlintScale = visualRadius * 5;
        sprite.scale.setScalar(baseGlintScale);
        sprite.userData.baseScale = baseGlintScale;
        sprite.raycast = function() {};
        sprite.name = 'starSpike';
        mesh.add(sprite);
    }

    // Add enhanced rings for Saturn
    if (data.hasRings) {
        // Main ring system
        const ringGeo = new THREE.RingGeometry(visualRadius * 1.3, visualRadius * 2.2, 128);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xC4A574,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        const rings = new THREE.Mesh(ringGeo, ringMat);
        rings.name = 'rings';
        rings.rotation.order = 'YXZ';
        rings.rotation.x = Math.PI / 2; // equatorial; the planet mesh carries the tilt
        mesh.add(rings);
        
        // Outer faint ring
        const outerRingGeo = new THREE.RingGeometry(visualRadius * 2.3, visualRadius * 2.5, 64);
        const outerRingMat = new THREE.MeshBasicMaterial({
            color: 0xA09060,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
        outerRing.name = 'outerRing';
        outerRing.rotation.order = 'YXZ';
        outerRing.rotation.x = Math.PI / 2;
        mesh.add(outerRing);
    }

    return mesh;
}

function createNearbyStars() {
    nearbyStars.forEach(starData => {
        const position = calculateStarPosition(starData);
        
        // Create a system container for the star and its planets
        // This provides a clean pivot point for orbital mechanics
        const systemContainer = new THREE.Group();
        
        // Create appropriate mesh based on type
        const mesh = createDistantObjectMesh(starData);
        
        // Add star mesh to system container (at local origin)
        systemContainer.add(mesh);
        
        // Position the entire system at stellar scale (much further out)
        const scaleFactor = currentStarUnitsPerLy;
        systemContainer.position.set(
            position.x * scaleFactor,
            position.y * scaleFactor,
            position.z * scaleFactor
        );

        // Visibility is controlled by the updateZoomLevel loop which checks showStars
        // But we default to true if showStars is active
        systemContainer.visible = showBigStars;

        scene.add(systemContainer);

        const bodyType = starData.type || 'star';
        celestialBodies.set(starData.name, {
            mesh: systemContainer,  // Use container as the main mesh
            visualMesh: mesh,       // Keep reference to visual mesh for effects
            data: starData,
            type: bodyType,
            isDistant: true
        });

        // Create planets for stars that have them
        if (starData.children) {
            let outermostPlanetDistance = 0;
            starData.children.forEach(planetData => {
                const planetMesh = createBodyMesh(planetData);
                const distance = scaleExoplanetDistance(planetData.distance, mesh, planetMesh);
                outermostPlanetDistance = Math.max(outermostPlanetDistance, distance);
                planetMesh.position.x = distance;
                planetMesh.visible = false;
                
                // Add planet to system container (not to star mesh)
                // This avoids visual artifacts from star's glow effects
                systemContainer.add(planetMesh);

                celestialBodies.set(planetData.name, {
                    mesh: planetMesh,
                    data: planetData,
                    type: 'exoplanet',
                    parent: systemContainer,
                    orbitRadius: distance,
                    isDistant: true
                });
            });

            // The emissive host mesh is only visual; MeshStandardMaterial needs
            // a real light. Keep this light local to its planetary system so
            // multiple stars do not wash out unrelated objects.
            if (outermostPlanetDistance > 0) {
                const hostLightColor = new THREE.Color(starDisplayColor(starData))
                    .lerp(new THREE.Color(0xffffff), 0.25);
                const hostLight = new THREE.PointLight(
                    hostLightColor,
                    3.5,
                    outermostPlanetDistance * 4,
                    0
                );
                hostLight.name = 'exoplanetHostLight';
                systemContainer.add(hostLight);
            }
        }
    });
}

function createSolarSystemMarker() {
    const group = new THREE.Group();
    
    // Central Sun glow
    const sunGeo = new THREE.SphereGeometry(15, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({
        color: 0xFFAA00,
        transparent: true,
        opacity: 0.8
    });
    const sun = new THREE.Mesh(sunGeo, sunMat);
    group.add(sun);
    
    // Outer glow
    const glowGeo = new THREE.SphereGeometry(25, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0xFFDD44,
        transparent: true,
        opacity: 0.3,
        depthWrite: false
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.raycast = function() {};
    group.add(glow);
    
    // Label indicator ring
    const ringGeo = new THREE.RingGeometry(35, 38, 64);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x4a9eff,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    
    group.userData.name = 'Solar System';
    group.visible = false; // Only visible at stellar zoom
    
    return group;
}

function createOrbitLine(radius, color, planetName) {
    // Create the visible thin orbit line
    const points = [];
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(
            Math.cos(angle) * radius,
            0,
            Math.sin(angle) * radius
        ));
    }
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.2,
        depthWrite: false
    });
    const orbit = new THREE.Line(geometry, material);
    orbit.layers.set(ORBIT_LAYER);
    scene.add(orbit);
    
    // Create an invisible ring for easier hover/click detection
    // Inner radius slightly smaller, outer radius slightly larger than orbit
    const thickness = Math.max(radius * 0.03, 2); // 3% of radius or at least 2 units
    const ringGeometry = new THREE.RingGeometry(radius - thickness, radius + thickness, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.0, // Invisible
        side: THREE.DoubleSide,
        depthWrite: false // must not silently occlude transparent objects (clipped moon shadows in half)
    });
    const hitTarget = new THREE.Mesh(ringGeometry, ringMaterial);
    hitTarget.rotation.x = -Math.PI / 2; // Lay flat on XZ plane
    hitTarget.userData = { isOrbitLine: true, planetName: planetName, isHitTarget: true };
    scene.add(hitTarget);
    
    // Store reference to orbit visual and hit target
    orbitLines.set(planetName, { visible: orbit, hitTarget: hitTarget, baseRadius: radius });
}

// Real night sky from the HYG star database (astronexus HYG v41,
// https://github.com/astronexus/HYG-Database, CC BY-SA 4.0). The compact
// data/brightstars.json we build from it holds ~8,900 stars with visual
// magnitude <= 6.5 as [x, y, z unit direction, magnitude, B-V color index],
// already rotated into the app's ecliptic frame (XZ plane, +Y ecliptic north).
let brightStarCache = null; // parsed JSON, cached so toggling scale doesn't refetch

// B-V color index -> temperature (Kelvin), Ballesteros' formula.
function bvToTemperature(bv) {
    return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

// Magnitude buckets -> point size. PointsMaterial can't vary size per vertex,
// so bright stars go in a large-size group, faint stars in a small one.
const STAR_MAG_BUCKETS = [
    { max: 1.5, size: 3.5 },
    { max: 3.0, size: 2.5 },
    { max: 4.5, size: 1.8 },
    { max: Infinity, size: 1.2 },
];

function buildStarFieldFromData(stars) {
    const group = new THREE.Group();
    group.renderOrder = -1;

    const buckets = STAR_MAG_BUCKETS.map(() => ({ positions: [], colors: [] }));

    for (const s of stars) {
        const [x, y, z, mag, ci] = s;
        // Pick the size bucket for this magnitude.
        let bi = buckets.length - 1;
        for (let k = 0; k < STAR_MAG_BUCKETS.length; k++) {
            if (mag < STAR_MAG_BUCKETS[k].max) { bi = k; break; }
        }
        const b = buckets[bi];

        // Color from B-V via blackbody temperature; brightness falls off with
        // magnitude so faint stars read as dim.
        const color = blackbodyColor(bvToTemperature(ci));
        const bright = THREE.MathUtils.clamp(1.12 - (mag + 1.5) * 0.11, 0.28, 1.0);

        b.positions.push(x, y, -z);
        b.colors.push(color.r * bright, color.g * bright, color.b * bright);
    }

    buckets.forEach((b, k) => {
        if (b.positions.length === 0) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
        const material = new THREE.PointsMaterial({
            size: STAR_MAG_BUCKETS[k].size,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: false,
            // A backdrop: the sky sphere is nearer than the farthest objects
            // (giant black holes), so writing depth would hide them behind it
            depthWrite: false,
        });
        const points = new THREE.Points(geometry, material);
        points.renderOrder = -1;
        group.add(points);
    });

    group.add(createMilkyWayHaze());

    if (constellationsCache) {
        group.add(buildConstellationLinesAndLabels(constellationsCache));
    }

    starField = group;
    starField.visible = showStars;
    scene.add(starField);
}

// Faint blue-white haze scattered along the galactic plane to suggest the
// Milky Way band. Points are spread with a gaussian ~12 deg off the plane.
function createMilkyWayHaze() {
    // Galactic north pole (RA 192.85948, Dec 27.12825), transformed into the
    // app's ecliptic frame the same way the star data was.
    const eps = THREE.MathUtils.degToRad(23.4393);
    const cosE = Math.cos(eps), sinE = Math.sin(eps);
    const ra = THREE.MathUtils.degToRad(192.85948);
    const dec = THREE.MathUtils.degToRad(27.12825);
    const ex = Math.cos(dec) * Math.cos(ra);
    const ey = Math.cos(dec) * Math.sin(ra);
    const ez = Math.sin(dec);
    // equatorial -> ecliptic (rotate about X), then map to app frame (Y = north)
    const n = new THREE.Vector3(ex, -ey * sinE + ez * cosE, ey * cosE + ez * sinE).normalize();

    // Orthonormal basis (u, v) spanning the galactic plane.
    let u = new THREE.Vector3(0, 1, 0).cross(n);
    if (u.lengthSq() < 1e-6) u = new THREE.Vector3(1, 0, 0).cross(n);
    u.normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();

    const spread = THREE.MathUtils.degToRad(12);
    const count = 4000;
    const positions = [];
    const colors = [];
    const gaussian = () => {
        // Box-Muller
        let a = 0, bb = 0;
        while (a === 0) a = Math.random();
        while (bb === 0) bb = Math.random();
        return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * bb);
    };
    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const lat = gaussian() * spread; // offset from the plane
        const inPlane = Math.cos(lat);
        const dir = new THREE.Vector3()
            .addScaledVector(u, inPlane * Math.cos(theta))
            .addScaledVector(v, inPlane * Math.sin(theta))
            .addScaledVector(n, Math.sin(lat))
            .normalize();
        positions.push(dir.x, dir.y, -dir.z);
        const tint = 0.09 + Math.random() * 0.06;
        colors.push(tint * 0.75, tint * 0.85, tint); // dim white-blue
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
        size: 1.0,
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        sizeAttenuation: false,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = -1;
    return points;
}

function createStarField() {
    // Reuse cached data across scale toggles so we fetch only once.
    if (brightStarCache) {
        buildStarFieldFromData(brightStarCache);
        return;
    }

    const starsPromise = fetch('data/brightstars.json').then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    });

    const constellationsPromise = fetch('data/constellations.lines.json')
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .catch(err => {
            console.warn('constellations.lines.json unavailable:', err);
            return null;
        });

    Promise.all([starsPromise, constellationsPromise])
        .then(([stars, constellations]) => {
            brightStarCache = stars;
            constellationsCache = constellations;
            buildStarFieldFromData(stars);
        })
        .catch(err => {
            console.warn('brightstars.json unavailable, using random starfield:', err);
            createRandomStarField();
        });
}

const CONSTELLATION_NAMES = {
    "And": "Andromeda", "Ant": "Antlia", "Aps": "Apus", "Aqr": "Aquarius", "Aql": "Aquila",
    "Ara": "Ara", "Ari": "Aries", "Aur": "Auriga", "Boo": "Boötes", "Cae": "Caelum",
    "Cam": "Camelopardalis", "Cnc": "Cancer", "CVn": "Canes Venatici", "CMa": "Canis Major",
    "CMi": "Canis Minor", "Cap": "Capricornus", "Car": "Carina", "Cas": "Cassiopeia",
    "Cen": "Centaurus", "Cep": "Cepheus", "Cet": "Cetus", "Cha": "Chamaeleon",
    "Cir": "Circinus", "Col": "Columba", "Com": "Coma Berenices", "CrA": "Corona Australis",
    "CrB": "Corona Borealis", "Crv": "Corvus", "Crt": "Crater", "Cru": "Crux",
    "Cyg": "Cygnus", "Del": "Delphinus", "Dor": "Dorado", "Dra": "Draco",
    "Equ": "Equuleus", "Eri": "Eridanus", "For": "Fornax", "Gem": "Gemini",
    "Gru": "Grus", "Her": "Hercules", "Hor": "Horologium", "Hya": "Hydra",
    "Hyi": "Hydrus", "Ind": "Indus", "Lac": "Lacerta", "Leo": "Leo",
    "LMi": "Leo Minor", "Lep": "Lepus", "Lib": "Libra", "Lup": "Lupus",
    "Lyn": "Lynx", "Lyr": "Lyra", "Men": "Mensa", "Mic": "Microscopium",
    "Mon": "Monoceros", "Mus": "Musca", "Nor": "Norma", "Oct": "Octans",
    "Oph": "Ophiuchus", "Ori": "Orion", "Pav": "Pavo", "Peg": "Pegasus",
    "Per": "Perseus", "Phe": "Phoenix", "Pic": "Pictor", "Psc": "Pisces",
    "PsA": "Piscis Austrinus", "Pup": "Puppis", "Pyx": "Pyxis", "Ret": "Reticulum",
    "Sge": "Sagitta", "Sgr": "Sagittarius", "Sco": "Scorpius", "Scl": "Sculptor",
    "Sct": "Scutum", "Ser": "Serpens", "Sex": "Sextans", "Tau": "Taurus",
    "Tel": "Telescopium", "Tri": "Triangulum", "TrA": "Triangulum Australe",
    "Tuc": "Tucana", "UMa": "Ursa Major", "UMi": "Ursa Minor", "Vel": "Vela",
};

const CONSTELLATION_INFO = {
    "And": {
        meaning: "The Chained Princess",
        brightestStar: "Alpheratz",
        features: "Andromeda Galaxy (M31)",
        desc: "Named after Andromeda, princess of Greek myth. It contains the Andromeda Galaxy, the nearest spiral galaxy to the Milky Way, visible to the naked eye."
    },
    "Ant": {
        meaning: "The Air Pump",
        brightestStar: "Alpha Antliae",
        features: "Antlia Dwarf Galaxy",
        desc: "A faint southern constellation introduced by Nicolas-Louis de Lacaille in the 18th century, representing the pneumatic air pump."
    },
    "Aps": {
        meaning: "Bird of Paradise",
        brightestStar: "Alpha Apodis",
        features: "Globular Cluster NGC 6101",
        desc: "A faint constellation near the south celestial pole representing the exotic Bird of Paradise."
    },
    "Aqr": {
        meaning: "The Water Bearer",
        brightestStar: "Sadalsuud",
        features: "Helix Nebula (NGC 7293)",
        desc: "A large zodiac constellation representing Ganymede pouring water. It is one of the oldest recognized patterns in the sky."
    },
    "Aql": {
        meaning: "The Eagle",
        brightestStar: "Altair",
        features: "Altair (vertex of Summer Triangle)",
        desc: "Represents the eagle that carried Zeus's thunderbolts. Altair is a rapidly spinning star only 16.7 light-years away."
    },
    "Ara": {
        meaning: "The Altar",
        brightestStar: "Beta Arae",
        features: "Stingray Nebula, Westerlund 1 cluster",
        desc: "An ancient southern constellation representing the altar where the Greek gods swore allegiance before fighting the Titans."
    },
    "Ari": {
        meaning: "The Ram",
        brightestStar: "Hamal",
        features: "Hamal, Sheratan",
        desc: "A zodiac constellation representing the golden ram from Greek myth. Its first point once marked the vernal equinox."
    },
    "Aur": {
        meaning: "The Charioteer",
        brightestStar: "Capella",
        features: "Capella, several open clusters",
        desc: "A prominent northern constellation. Capella is the sixth brightest star in the sky, actually a quadruple star system."
    },
    "Boo": {
        meaning: "The Herdsman",
        brightestStar: "Arcturus",
        features: "Arcturus (fourth brightest star)",
        desc: "Home to Arcturus, a giant orange star that is the brightest in the northern celestial hemisphere."
    },
    "Cae": {
        meaning: "The Chisel",
        brightestStar: "Alpha Caeli",
        features: "Faint deep-sky objects",
        desc: "A small, faint southern constellation representing an engraver's tool, created by Lacaille in 1752."
    },
    "Cam": {
        meaning: "The Giraffe",
        brightestStar: "Beta Camelopardalis",
        features: "Kemble's Cascade asterism",
        desc: "A large, faint northern constellation representing a giraffe. It was created in 1613 by Petrus Plancius."
    },
    "Cnc": {
        meaning: "The Crab",
        brightestStar: "Tarf (Beta Cancri)",
        features: "Beehive Cluster (M44)",
        desc: "The faintest zodiac constellation, representing the crab sent to distract Heracles. M44 is a beautiful nearby open cluster."
    },
    "CVn": {
        meaning: "The Hunting Dogs",
        brightestStar: "Cor Caroli",
        features: "Whirlpool Galaxy (M51)",
        desc: "Represents the hunting dogs of Boötes. Cor Caroli ('Charles's Heart') is a bright, easily resolved double star."
    },
    "CMa": {
        meaning: "The Greater Dog",
        brightestStar: "Sirius (Dog Star)",
        features: "Sirius (brightest night star)",
        desc: "Represents the larger of Orion's hunting dogs. Home to Sirius, a brilliant A-type star just 8.6 light-years away."
    },
    "CMi": {
        meaning: "The Lesser Dog",
        brightestStar: "Procyon",
        features: "Procyon (eighth brightest star)",
        desc: "Represents the smaller of Orion's hunting dogs. Procyon is a binary system and one of our closest stellar neighbors."
    },
    "Cap": {
        meaning: "The Sea-Goat",
        brightestStar: "Deneb Algedi",
        features: "Zodiac constellation",
        desc: "An ancient zodiac constellation representing a creature with a goat's head and a fish's tail, associated with the god Pan."
    },
    "Car": {
        meaning: "The Keel",
        brightestStar: "Canopus",
        features: "Canopus, Eta Carinae, Carina Nebula",
        desc: "Part of the ancient constellation Argo Navis (the ship). Canopus is the second-brightest star in the night sky."
    },
    "Cas": {
        meaning: "The Queen",
        brightestStar: "Schedar",
        features: "Distinctive 'W' shape",
        desc: "A circumpolar northern constellation representing Cassiopeia, the boastful queen of Greek mythology."
    },
    "Cen": {
        meaning: "The Centaur",
        brightestStar: "Rigil Kentaurus (Alpha Centauri)",
        features: "Alpha Centauri system, Omega Centauri",
        desc: "A large southern constellation containing Alpha Centauri (the closest star system to Earth at 4.37 ly) and Omega Centauri cluster."
    },
    "Cep": {
        meaning: "The King",
        brightestStar: "Alderamin",
        features: "Garnet Star (Mu Cephei), Delta Cephei",
        desc: "Represents Cepheus, King of Joppa. Delta Cephei is the prototype for Cepheid variable stars, crucial for cosmic distance scale calculations."
    },
    "Cet": {
        meaning: "The Whale / Sea Monster",
        brightestStar: "Deneb Kaitos",
        features: "Mira (celebrated variable star)",
        desc: "A large constellation in the celestial equator, representing the sea monster slain by Perseus to save Andromeda."
    },
    "Cha": {
        meaning: "The Chameleon",
        brightestStar: "Alpha Chamaeleontis",
        features: "Chamaeleon dark cloud complex",
        desc: "A small southern constellation named after the chameleon, a lizard that changes color. Defined by Plancius."
    },
    "Cir": {
        meaning: "The Compasses",
        brightestStar: "Alpha Circini",
        features: "Circinus Galaxy",
        desc: "A tiny southern constellation representing drafting compasses, defined by Lacaille in 1756."
    },
    "Col": {
        meaning: "The Dove",
        brightestStar: "Fact (Alpha Columbae)",
        features: "Runaway star Mu Columbae",
        desc: "A small southern constellation representing Noah's dove or the dove sent by the Argonauts to navigate the Clashing Rocks."
    },
    "Com": {
        meaning: "Berenice's Hair",
        brightestStar: "Beta Comae Berenices",
        features: "Coma Star Cluster (Mel 111)",
        desc: "Named after Queen Berenice II of Egypt. It contains the north galactic pole and numerous bright galaxies."
    },
    "CrA": {
        meaning: "Southern Crown",
        brightestStar: "Alfecca Meridiana",
        features: "Corona Australis Molecular Cloud",
        desc: "A small southern constellation resembling a crown, known since antiquity. Faint but distinctive arc."
    },
    "CrB": {
        meaning: "Northern Crown",
        brightestStar: "Alphecca (Gemma)",
        features: "Alphecca",
        desc: "A beautiful, horseshoe-shaped northern constellation representing the crown worn by Ariadne, daughter of King Minos."
    },
    "Crv": {
        meaning: "The Crow",
        brightestStar: "Gienah (Gamma Corvi)",
        features: "Antennae Galaxies (NGC 4038/4039)",
        desc: "A small, box-shaped southern constellation representing Apollo's sacred raven, placed in the stars for laziness."
    },
    "Crt": {
        meaning: "The Cup",
        brightestStar: "Labrum (Delta Crateri)",
        features: "Faint spiral galaxies",
        desc: "An ancient constellation representing the chalice or cup of Apollo, associated with the raven (Corvus) and water snake (Hydra)."
    },
    "Cru": {
        meaning: "The Southern Cross",
        brightestStar: "Acrux",
        features: "Southern Cross, Coalsack Nebula",
        desc: "The smallest of the 88 constellations but highly prominent in the Southern Hemisphere, used for centuries to find celestial south."
    },
    "Cyg": {
        meaning: "The Swan",
        brightestStar: "Deneb",
        features: "Deneb, Northern Cross, Cygnus X-1",
        desc: "Depicts a swan soaring down the Milky Way. Deneb is a massive blue supergiant, and Cygnus X-1 was the first discovered stellar black hole."
    },
    "Del": {
        meaning: "The Dolphin",
        brightestStar: "Rotanev",
        features: "Distinctive diamond asterism (Job's Coffin)",
        desc: "A small, compact northern constellation shaped like a jumping dolphin, associated with Poseidon's messenger."
    },
    "Dor": {
        meaning: "The Dolphinfish / Swordfish",
        brightestStar: "Alpha Doradus",
        features: "Large Magellanic Cloud (LMC)",
        desc: "Contains the bulk of the Large Magellanic Cloud, a satellite galaxy of the Milky Way. Named after the dolphinfish (Mahi-mahi)."
    },
    "Dra": {
        meaning: "The Dragon",
        brightestStar: "Eltanin",
        features: "Cat's Eye Nebula (NGC 6543)",
        desc: "A long, winding northern constellation. Thuban, in the dragon's tail, was the north pole star in 2700 BC during the Egyptian Old Kingdom."
    },
    "Equ": {
        meaning: "The Little Horse",
        brightestStar: "Kitalpha",
        features: "Second-smallest constellation",
        desc: "The second-smallest constellation in the sky. Represented in myth as Celeris, the brother of Pegasus."
    },
    "Eri": {
        meaning: "The River",
        brightestStar: "Achernar",
        features: "Achernar (brightest star), Eridani Supervoid",
        desc: "A long, winding constellation representing a celestial river. Achernar is a bright blue star that spins so fast it is flattened."
    },
    "For": {
        meaning: "The Furnace",
        brightestStar: "Alpha Fornacis",
        features: "Fornax Cluster of Galaxies",
        desc: "A faint southern constellation created by Lacaille to honor Antoine Lavoisier's chemical furnace."
    },
    "Gem": {
        meaning: "The Twins",
        brightestStar: "Pollux",
        features: "Castor and Pollux twin stars, Eskimo Nebula",
        desc: "A famous zodiac constellation representing the Greek twin heroes Castor (a white sextuple star) and Pollux (an orange giant)."
    },
    "Gru": {
        meaning: "The Crane",
        brightestStar: "Alnair",
        features: "Grus Quartet of galaxies",
        desc: "A bright southern constellation resembling a flying crane. Introduced by Plancius in the late 16th century."
    },
    "Her": {
        meaning: "Hercules",
        brightestStar: "Kornephoros",
        features: "Great Globular Cluster in Hercules (M13)",
        desc: "The fifth-largest constellation. M13 is the brightest globular cluster in the northern sky, containing hundreds of thousands of stars."
    },
    "Hor": {
        meaning: "The Pendulum Clock",
        brightestStar: "Alpha Horologii",
        features: "Horologium Supercluster",
        desc: "A faint southern constellation representing a pendulum clock, created by Lacaille to honor Christian Huygens."
    },
    "Hya": {
        meaning: "The Water Snake",
        brightestStar: "Alphard",
        features: "Alphard ('The Solitary One')",
        desc: "The largest of all 88 constellations, stretching across a quarter of the sky. Represents the multi-headed Lernaean Hydra."
    },
    "Hyi": {
        meaning: "The Lesser Water Snake",
        brightestStar: "Beta Hydri",
        features: "Stellar neighbors",
        desc: "A small southern constellation near the Magellanic Clouds, representing a male water snake (distinct from the female Hydra)."
    },
    "Ind": {
        meaning: "The Indian",
        brightestStar: "Alpha Indi",
        features: "Nearby star Epsilon Indi",
        desc: "A southern constellation representing an indigenous hunter. Epsilon Indi is a close solar analog star with brown dwarf companions."
    },
    "Lac": {
        meaning: "The Lizard",
        brightestStar: "Alpha Lacertae",
        features: "BL Lacertae (active galactic nucleus)",
        desc: "A small northern constellation shaped like a zigzag lizard, created by Johannes Hevelius in 1687."
    },
    "Leo": {
        meaning: "The Lion",
        brightestStar: "Regulus",
        features: "Regulus, Sickle of Leo, Leo Triplet",
        desc: "A prominent zodiac constellation representing the Nemean Lion. Regulus marks the lion's heart, and the Sickle represents its mane."
    },
    "LMi": {
        meaning: "The Lesser Lion",
        brightestStar: "Praecipua",
        features: "Hanny's Voorwerp",
        desc: "A small northern constellation between Leo and Ursa Major, created by Hevelius in 1687."
    },
    "Lep": {
        meaning: "The Hare",
        brightestStar: "Arneb",
        features: "Hind's Crimson Star",
        desc: "Located directly below Orion, representing a hare being chased by Orion and his hunting dogs."
    },
    "Lib": {
        meaning: "The Scales",
        brightestStar: "Zubeneschamali",
        features: "Zodiac constellation, Gliese 581",
        desc: "The only zodiac constellation representing an inanimate object. Its stars were once considered the claws of Scorpius."
    },
    "Lup": {
        meaning: "The Wolf",
        brightestStar: "Men",
        features: "Supernova remnant SN 1006",
        desc: "An ancient southern constellation representing a wolf impaled on the Centaur's spear. SN 1006 was the brightest recorded stellar event."
    },
    "Lyn": {
        meaning: "The Lynx",
        brightestStar: "Alpha Lyncis",
        features: "Intergalactic Wanderer (NGC 2419)",
        desc: "A faint northern constellation. Hevelius named it Lynx because one would need the eyes of a lynx to see its dim stars."
    },
    "Lyr": {
        meaning: "The Lyre / Harp",
        brightestStar: "Vega",
        features: "Vega, Ring Nebula (M57)",
        desc: "Vega is a brilliant blue-white star, the fifth-brightest in the sky. M57 is the prototype planetary nebula (the Ring)."
    },
    "Men": {
        meaning: "Table Mountain",
        brightestStar: "Alpha Mensae",
        features: "Part of the Large Magellanic Cloud",
        desc: "Named after Table Mountain in South Africa, where Lacaille conducted observations. The southernmost constellation in the sky."
    },
    "Mic": {
        meaning: "The Microscope",
        brightestStar: "Gamma Microscopii",
        features: "AU Microscopii planet system",
        desc: "A faint southern constellation introduced by Lacaille to commemorate the compound microscope."
    },
    "Mon": {
        meaning: "The Unicorn",
        brightestStar: "Beta Monocerotis",
        features: "Rosette Nebula, Cone Nebula",
        desc: "A faint constellation on the celestial equator representing a unicorn, created by Plancius in 1612."
    },
    "Mus": {
        meaning: "The Fly",
        brightestStar: "Alpha Muscae",
        features: "Dark Doodad Nebula",
        desc: "A small southern constellation representing a common housefly, situated in the rich starfields of the Milky Way."
    },
    "Nor": {
        meaning: "The Normal / Ruler",
        brightestStar: "Gamma2 Normae",
        features: "Fine Ring Nebula",
        desc: "A faint southern constellation created by Lacaille representing a carpenter's square, level, and ruler."
    },
    "Oct": {
        meaning: "The Octant",
        brightestStar: "Nu Octantis",
        features: "Sigma Octantis (South Star)",
        desc: "Home to the south celestial pole. Sigma Octantis is the southern counterpart of Polaris, but it is extremely faint."
    },
    "Oph": {
        meaning: "The Serpent Bearer",
        brightestStar: "Rasalhague",
        features: "Barnard's Star (fastest proper motion)",
        desc: "Represents Asclepius, the Greek healer. Kepler's Supernova (SN 1604) occurred here. Barnard's star is only 6 ly away."
    },
    "Ori": {
        meaning: "The Hunter",
        brightestStar: "Rigel",
        features: "Orion's Belt, Betelgeuse, Orion Nebula",
        desc: "One of the most famous and recognizable constellations. Orion's Belt points to Sirius. Betelgeuse is a red supergiant nearing supernova."
    },
    "Pav": {
        meaning: "The Peacock",
        brightestStar: "Peacock (Alpha Pavonis)",
        features: "Spiral galaxy NGC 6744",
        desc: "A bright southern constellation named after the green peacock, introduced by Plancius in 1598."
    },
    "Peg": {
        meaning: "The Winged Horse",
        brightestStar: "Enif",
        features: "Great Square of Pegasus, 51 Pegasi",
        desc: "A large northern constellation. 51 Pegasi b was the first exoplanet discovered orbiting a sun-like star."
    },
    "Per": {
        meaning: "Perseus",
        brightestStar: "Mirfak",
        features: "Algol (The Demon Star), Perseid meteor shower",
        desc: "Named after the hero who slew Medusa. Algol is the prototype eclipsing binary star, dipping in brightness every 2.87 days."
    },
    "Phe": {
        meaning: "The Phoenix",
        brightestStar: "Ankaa",
        features: "Phoenix Cluster of Galaxies",
        desc: "Named after the mythical firebird that is reborn from its ashes. Introduced by Plancius in 1598."
    },
    "Pic": {
        meaning: "The Easel",
        brightestStar: "Alpha Pictoris",
        features: "Beta Pictoris debris disk",
        desc: "A faint southern constellation representing a painter's easel, created by Lacaille in 1752."
    },
    "Psc": {
        meaning: "The Fishes",
        brightestStar: "Alpherg",
        features: "Phantom Galaxy (M74), Vernal Equinox",
        desc: "A zodiac constellation representing two fish tied by a cord, associated with Aphrodite and Eros fleeing Typhon."
    },
    "PsA": {
        meaning: "The Southern Fish",
        brightestStar: "Fomalhaut",
        features: "Fomalhaut (dust ring and exoplanet)",
        desc: "Home to Fomalhaut, a bright star just 25 light-years away, known as the 'Lonely Star of Autumn' in the Northern Hemisphere."
    },
    "Pup": {
        meaning: "The Poop Deck",
        brightestStar: "Naos",
        features: "Bright open clusters M46 and M47",
        desc: "Part of the ancient Argo Navis (the ship of the Argonauts) representing the poop deck or stern."
    },
    "Pyx": {
        meaning: "The Mariner's Compass",
        brightestStar: "Alpha Pyxidis",
        features: "Recurrent nova T Pyxidis",
        desc: "A faint southern constellation representing a compass, introduced by Lacaille to replace the mast of Argo Navis."
    },
    "Ret": {
        meaning: "The Reticle",
        brightestStar: "Alpha Reticuli",
        features: "Binary star Zeta Reticuli",
        desc: "A small southern constellation representing a telescope's crosshairs, created by Lacaille. Famous in UFO lore."
    },
    "Sge": {
        meaning: "The Arrow",
        brightestStar: "Gamma Sagittae",
        features: "Third-smallest constellation",
        desc: "The third-smallest constellation in the sky. Resembles a tiny arrow, associated in myth with Hercules's arrow."
    },
    "Sgr": {
        meaning: "The Archer",
        brightestStar: "Kaus Australis",
        features: "Sagittarius A* (Milky Way core), Teapot",
        desc: "A zodiac constellation depicting a centaur archer. Points to the center of the Milky Way galaxy, home to supermassive black hole Sgr A*."
    },
    "Sco": {
        meaning: "The Scorpion",
        brightestStar: "Antares",
        features: "Antares, Butterfly Cluster (M6)",
        desc: "A southern zodiac constellation. Antares is a massive red supergiant star marking the scorpion's heart, colored reddish-orange."
    },
    "Scl": {
        meaning: "The Sculptor",
        brightestStar: "Alpha Sculptoris",
        features: "Cartwheel Galaxy, Sculptor Galaxy",
        desc: "A faint southern constellation created by Lacaille to honor the sculptor's workshop. Contains the Sculptor Group of galaxies."
    },
    "Sct": {
        meaning: "The Shield",
        brightestStar: "Alpha Scuti",
        features: "Wild Duck Cluster (M11)",
        desc: "Originally named Scutum Sobiescianum by Hevelius to honor Polish King John III Sobieski. Home to the hypergiant UY Scuti."
    },
    "Ser": {
        meaning: "The Serpent",
        brightestStar: "Unukalhai",
        features: "Pillars of Creation (Eagle Nebula M16)",
        desc: "The only constellation split into two disconnected halves: Serpens Caput (Serpent's Head) and Serpens Cauda (Serpent's Tail)."
    },
    "Sex": {
        meaning: "The Sextant",
        brightestStar: "Alpha Sextantis",
        features: "Sextans A dwarf galaxy",
        desc: "A faint constellation on the celestial equator created by Hevelius to commemorate his astronomical sextant."
    },
    "Tau": {
        meaning: "The Bull",
        brightestStar: "Aldebaran",
        features: "Pleiades (Seven Sisters), Crab Nebula (M1)",
        desc: "A bright zodiac constellation. Aldebaran is an orange giant marking the Bull's eye. M1 is the remnant of the famous 1054 AD supernova."
    },
    "Tel": {
        meaning: "The Telescope",
        brightestStar: "Alpha Telescopii",
        features: "Black hole system HR 6819",
        desc: "A faint southern constellation introduced by Lacaille to honor the aerial telescope."
    },
    "Tri": {
        meaning: "The Triangle",
        brightestStar: "Metallah",
        features: "Triangulum Galaxy (M33)",
        desc: "A small northern constellation containing the Triangulum Galaxy, the third-largest member of our Local Group."
    },
    "TrA": {
        meaning: "Southern Triangle",
        brightestStar: "Atria",
        features: "Bright, tight triangle",
        desc: "A small southern constellation forming a nearly equilateral triangle of moderately bright stars."
    },
    "Tuc": {
        meaning: "The Toucan",
        brightestStar: "Alpha Tucanae",
        features: "Small Magellanic Cloud (SMC), 47 Tucanae",
        desc: "Home to the Small Magellanic Cloud, a satellite galaxy of the Milky Way, and 47 Tucanae, the second-brightest globular cluster."
    },
    "UMa": {
        meaning: "The Great Bear",
        brightestStar: "Alioth",
        features: "Contains the Big Dipper asterism",
        desc: "Third-largest constellation. The 'pointers' in the Big Dipper lead directly to Polaris, the North Star. The Big Dipper is an asterism inside this constellation."
    },
    "UMi": {
        meaning: "The Lesser Bear",
        brightestStar: "Polaris (North Star)",
        features: "Contains the Little Dipper asterism",
        desc: "Home to Polaris, which marks the Earth's north celestial pole. The handle stars of the Little Dipper lead to Polaris."
    },
    "Vel": {
        meaning: "The Sails",
        brightestStar: "Regor",
        features: "Vela Pulsar, Eight-Burst Nebula",
        desc: "Part of the ancient Argo Navis ship. Home to the Vela Pulsar, a rapidly spinning neutron star remnant of a supernova."
    },
    "Vir": {
        meaning: "The Virgin",
        brightestStar: "Spica",
        features: "Spica, Virgo Cluster of Galaxies",
        desc: "The second-largest constellation. Spica is a brilliant blue-white star. The Virgo Cluster contains thousands of galaxies."
    },
    "Vol": {
        meaning: "The Flying Fish",
        brightestStar: "Gamma2 Volantis",
        features: "Lindsay-Shapley Ring galaxy",
        desc: "A small southern constellation depicting a flying fish, introduced by Plancius in 1598."
    },
    "Vul": {
        meaning: "The Little Fox",
        brightestStar: "Anser",
        features: "Dumbbell Nebula (M27), Coathanger asterism",
        desc: "A faint northern constellation. M27 is the first planetary nebula ever discovered, resembling a dumbbell."
    }
};

function celestialToAppFrame(raDeg, decDeg) {
    const raRad = THREE.MathUtils.degToRad(raDeg);
    const decRad = THREE.MathUtils.degToRad(decDeg);
    
    const x = Math.cos(decRad) * Math.cos(raRad);
    const y = Math.cos(decRad) * Math.sin(raRad);
    const z = Math.sin(decRad);
    
    const eps = THREE.MathUtils.degToRad(23.4393);
    const cosE = Math.cos(eps);
    const sinE = Math.sin(eps);
    
    const xe = x;
    const ye = y * cosE + z * sinE;
    const ze = -y * sinE + z * cosE;
    
    // App frame: ecliptic plane is XZ, +Y is ecliptic north.
    return new THREE.Vector3(xe, ze, -ye);
}

function createTextSprite(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = 256;
    canvas.height = 64;
    
    ctx.font = 'bold 22px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    
    ctx.fillStyle = 'rgba(136, 170, 255, 0.75)';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0.8,
        // Labels sit on the far sky sphere, so depth testing lets planets and
        // moons in front hide them (they used to show through Earth up close)
        depthTest: true,
        depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.08, 0.02, 1.0);
    return sprite;
}

function buildConstellationLinesAndLabels(data) {
    constellationSprites = [];
    const group = new THREE.Group();
    const positions = [];
    const labelsGroup = new THREE.Group();
    
    for (const feature of data.features) {
        if (!feature.geometry) continue;
        
        let sum = new THREE.Vector3();
        let pointCount = 0;
        
        if (feature.geometry.type === 'MultiLineString') {
            for (const path of feature.geometry.coordinates) {
                for (let i = 0; i < path.length - 1; i++) {
                    const p1 = path[i];
                    const p2 = path[i + 1];
                    const v1 = celestialToAppFrame(p1[0], p1[1]);
                    const v2 = celestialToAppFrame(p2[0], p2[1]);
                    positions.push(v1.x, v1.y, v1.z);
                    positions.push(v2.x, v2.y, v2.z);
                }
                for (const p of path) {
                    const v = celestialToAppFrame(p[0], p[1]);
                    sum.add(v);
                    pointCount++;
                }
            }
        }
        
        if (pointCount > 0) {
            const center = sum.divideScalar(pointCount).normalize();
            const constId = feature.id;
            const constName = CONSTELLATION_NAMES[constId] || constId;
            
            const sprite = createTextSprite(constName);
            sprite.position.copy(center).multiplyScalar(0.99);
            sprite.userData = { isConstellationLabel: true, name: constName, id: constId };
            labelsGroup.add(sprite);
            constellationSprites.push(sprite);
        }
    }
    
    if (positions.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        
        const material = new THREE.LineBasicMaterial({
            color: 0x4a9eff,
            transparent: true,
            opacity: 0.28,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        
        const lineSegments = new THREE.LineSegments(geometry, material);
        lineSegments.renderOrder = -1;
        group.add(lineSegments);
    }
    
    group.add(labelsGroup);
    
    constellationsGroup = group;
    setConstellationOpacity(showConstellations ? 1 : 0);
    return group;
}

// Fallback: the original random uniform starfield, used only if the HYG data
// file fails to load.
function createRandomStarField() {
    const starCount = 15000;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];

    for (let i = 0; i < starCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions.push(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
        );
        const t = Math.random();
        const color = new THREE.Color();
        if (t < 0.2) {
            color.setHSL(0.6, 0.3, 0.75);
        } else if (t < 0.5) {
            color.setHSL(0.1, 0.1, 0.95);
        } else if (t < 0.8) {
            color.setHSL(0.08, 0.4, 0.75);
        } else {
            color.setHSL(0.05, 0.6, 0.6);
        }
        colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 2,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: false,
        depthWrite: false // backdrop: never hide real objects beyond its radius
    });

    starField = new THREE.Points(geometry, material);
    starField.renderOrder = -1;
    starField.visible = showStars;
    scene.add(starField);
}

// Moons are tidally locked: each rotates exactly once per orbit so the same
// hemisphere always faces its planet. A moon mesh is a child of its planet mesh,
// which already carries the planet's day-spin, so the moon's own rotation.y must
// cancel that parent spin and track the negative orbital angle. The result is
// tidal locking by construction — no drift, at any timeline speed, in both modes.
// offset (radians) picks which texture face is the near side; it only matters for
// the real Moon map (procedural moons look the same all the way around).
const MOON_TIDAL_OFFSET = {
    Moon: 0 // tune if the Moon's near side ends up pointing the wrong way
};

function animate() {
    animationId = requestAnimationFrame(animate);

    stellarTime.value = performance.now() / 1000;
    const nowMs = Date.now();
    const realDeltaMs = nowMs - lastFrameTime;
    lastFrameTime = nowMs;
    const frameScale = Math.min(realDeltaMs / 16.67, 4);
    const simulationRate = getSimulationRate();
    let simulationAdvanced = false;

    // The Solar light has infinite range to cover the compressed Solar System.
    // Turn it off when visiting a distant system so exoplanets are illuminated
    // only by their own finite-range host light.
    const focusedBody = currentFocusedBody ? celestialBodies.get(currentFocusedBody) : null;
    if (sunLight) {
        sunLight.visible = viewMode === 'map' && !(focusedBody && focusedBody.isDistant);
    }

    // Advance simulation date and update planet positions
    if (!simPaused && simulationRate !== 0) {
        simDate = new Date(simDate.getTime() + (realDeltaMs / 1000) * simulationRate);
        simulationAdvanced = true;
        
        if (orbitalMode === 'realistic') {
            updateRealisticPositions(simDate, 'planets');
        }
        
        updateTimelineDisplay();
        // Sync the date picker (throttle to every ~1s to avoid UI jitter)
        if (Math.round(nowMs / 1000) !== Math.round((nowMs - realDeltaMs) / 1000)) {
            const picker = document.getElementById('tl-date-picker');
            if (picker) {
                const offset = simDate.getTimezoneOffset() * 60000;
                picker.value = new Date(simDate.getTime() - offset).toISOString().slice(0, 16);
            }
        }

    }

    // Always increment time for continuous background visual effects (pulsing stars, etc.)
    time += Math.min(realDeltaMs, 66.68) * 0.00006;

    // Update star field to follow camera as a skybox
    if (starField) {
        // Position star field at camera location
        starField.position.copy(camera.position);

        // Scale star field based on camera distance to target
        // This ensures it's always visible but stays in background
        const distanceToTarget = camera.position.distanceTo(controls.target);
        const targetScale = Math.max(distanceToTarget * 2, 100000);

        // Smooth interpolation to prevent jittery scaling during animations
        // Use faster lerp during fly-to animations, slower when idle for stability
        const lerpFactor = flyToAnimation ? 0.15 : 0.05;
        currentStarFieldScale += (targetScale - currentStarFieldScale) * lerpFactor;

        starField.scale.setScalar(currentStarFieldScale);
    }

    // Update spacetime fabric with gravity wells block REMOVED

    applyScaleTransition();
    updateScaleKeys();
    updateConstellationIntro();
    refreshAUAnchors();
    updateOrbitLineShapes();
    updateSmallBodies(simDate, mapAUToScene, viewMode === 'map', celestialBodies, camera);

    // Animate orbits
    celestialBodies.forEach((body, name) => {
        if (viewMode !== 'map') return;

        if (body.orbitGroup && body.orbitSpeed && orbitalMode !== 'realistic') {
            // Planet orbiting sun (only in aligned mode; realistic mode uses orbitGroup.rotation.y)
            const angle = calculateAlignedOrbitAngle(body.data);
            orbitOffset(angle, body.orbitRadius, body.mesh.position);
        }

        if (body.parent && body.orbitSpeed && orbitalMode !== 'realistic') {
            // Moon orbiting planet (only in aligned mode; realistic mode sets positions in updateRealisticPositions)
            placeMoon(body, calculateAlignedOrbitAngle(body.data), body.orbitRadius);
        }

        // Rotate bodies
        if (body.type === 'moon' && viewMode !== 'sizeCompare') {
            // Moons are tidally locked in map view; their rotation is set alongside
            // their orbital position (aligned: above; realistic: updateRealisticPositions).
        } else if (viewMode === 'map' && orientBody(name)) {
            // Tilt + spin from the IAU pole and rotation model (orientBody)
        } else if (body.data.rotationPeriod) {
            if (viewMode === 'sizeCompare') {
                body.mesh.rotation.y += (0.002 * frameScale) / body.data.rotationPeriod;
            } else if (name === 'Earth') {
                // Align Earth's rotation with the time of day relative to the Sun
                body.mesh.getWorldPosition(_animEarthPosition);
                
                // Vector pointing from Earth to the Sun (at origin 0,0,0)
                _animDirectionToSun.copy(_animEarthPosition).negate().normalize();
                
                // Angle of the Sun in Earth's ecliptic plane (XZ)
                const sunAngle = Math.atan2(_animDirectionToSun.x, _animDirectionToSun.z);
                
                // UTC time of day in hours
                const utcHours = simDate.getUTCHours() + simDate.getUTCMinutes() / 60 + simDate.getUTCSeconds() / 3600;
                
                // Set rotation: Prime meridian (0 longitude) faces Sun at 12:00 UTC.
                body.mesh.rotation.y = sunAngle + (utcHours - 12) * (Math.PI / 12) - Math.PI / 2;
            } else {
                // Rotate other planets absolutely from the simulation date
                body.mesh.rotation.y = (simDate.getTime() / (body.data.rotationPeriod * 3600000)) * Math.PI * 2;
            }

            // Cancel out Y-rotation for Saturn's rings to prevent them from wobbling
            if (body.data.hasRings) {
                const rings = body.mesh.getObjectByName('rings');
                if (rings) rings.rotation.y = -body.mesh.rotation.y;
                const outerRing = body.mesh.getObjectByName('outerRing');
                if (outerRing) outerRing.rotation.y = -body.mesh.rotation.y;
            }
        }
        
        // Animate star surface texture and fade out glows/spikes up close
        // Use visualMesh for distant stars, mesh for solar system stars
        const starMesh = body.visualMesh || (body.mesh.material ? body.mesh : null);
        if (body.type === 'star' && starMesh && body.mesh.visible) {
            updateStarMeshEffects(starMesh, time);
        }
        
        // Rotate cloud layers independently for gas giants
        if (body.data.hasBands && body.mesh.children.length > 0) {
            body.mesh.children.forEach((child, idx) => {
                if (child.material && child.material.transparent) {
                    child.rotation.y += 0.0005 * frameScale * (idx + 1);
                }
            });
        }
    });
    
    // Update moon positions in realistic mode now that parent planet rotations are up to date
    if (viewMode === 'map' && orbitalMode === 'realistic' && (simulationAdvanced || realisticMoonPositionsDirty)) {
        updateRealisticPositions(simDate, 'moons');
    }

    // Project moon transit shadows onto their parent planets
    updateMoonShadows();

    // International Space Station, placed from its real orbit at simDate
    updateISS(celestialBodies.get('Earth')?.mesh, simDate, viewMode === 'map', camera);
    updateGlobeMode(celestialBodies.get('Earth')?.mesh, camera, viewMode === 'map');
    cheeseMoon?.update(simDate, viewMode === 'map');
    updateCheeseTour();
    updateWeather(celestialBodies.get('Earth')?.mesh, camera, simDate, viewMode === 'map');
    updateSatelliteIntro();
    updateSatellites(celestialBodies.get('Earth')?.mesh, simDate, viewMode === 'map');

    // Headlight for size comparison: light objects from the camera's viewpoint
    if (compareLight) {
        compareLight.visible = viewMode === 'sizeCompare';
        if (compareLight.visible) {
            compareLight.position.copy(camera.position);
            compareLight.target.position.copy(controls.target);
        }
    }

    // Animate size comparison objects (rotation only, no orbits)
    if (viewMode === 'sizeCompare' && sizeComparisonGroup && sizeComparisonGroup.visible) {
        sizeComparisonObjects.forEach((body, name) => {
            // Rotate bodies. Planets lean by their real axial tilt, across the
            // screen so it reads side by side (Uranus on its side, Venus upside
            // down), spinning in their real sense.
            const frame = poleFrame(name);
            if (frame) {
                // Comparison entries carry no rotationPeriod; use the IAU rate
                const rate = BODY_POLES[name].rate ?? 360.9856; // deg/day (Earth: sidereal)
                const periodHours = 24 * 360 / Math.abs(rate);
                body.mesh.userData.compareSpin = (body.mesh.userData.compareSpin || 0)
                    + Math.sign(rate) * (0.002 * frameScale) / periodHours;
                // ...and tip ~11° toward the viewer so rings open into an ellipse
                body.mesh.quaternion.setFromAxisAngle(_compareTipAxis, COMPARE_VIEW_TIP)
                    .multiply(_compareLeanQ.setFromAxisAngle(_compareTiltAxis, frame.obliquity))
                    .multiply(_compareSpinQ.setFromAxisAngle(_yAxis, body.mesh.userData.compareSpin));
                for (const ringName of ['rings', 'outerRing']) {
                    body.mesh.getObjectByName(ringName)?.rotation.set(Math.PI / 2, -body.mesh.userData.compareSpin, 0);
                }
            } else if (body.data.rotationPeriod) {
                body.mesh.rotation.y += (0.002 * frameScale) / body.data.rotationPeriod;
            }

            // Cancel out Y-rotation for Saturn's rings to prevent them from wobbling
            if (body.data.hasRings && !frame) {
                const rings = body.mesh.getObjectByName('rings');
                if (rings) rings.rotation.y = -body.mesh.rotation.y;
                const outerRing = body.mesh.getObjectByName('outerRing');
                if (outerRing) outerRing.rotation.y = -body.mesh.rotation.y;
            }
            
            // Animate star surface texture and fade out glows/spikes up close
            const starMesh = body.mesh.material ? body.mesh : null;
            if (body.type === 'star' && starMesh) {
                updateStarMeshEffects(starMesh, time);
            }
        });
    }
    
    // Handle fly-to animation
    if (flyToAnimation) {
        if (!flyToAnimation.isSizeCompare && flyToAnimation.bodyName && (flyToAnimation.offset || flyToAnimation.offsetLocal)) {
            let targetBody = null;
            if (flyToAnimation.bodyName === 'Earth (Wide View)') {
                targetBody = celestialBodies.get('Earth');
            } else {
                targetBody = celestialBodies.get(flyToAnimation.bodyName);
            }
            if (targetBody && targetBody.mesh && viewMode !== 'sizeCompare') {
                targetBody.mesh.updateWorldMatrix(true, false);
                targetBody.mesh.getWorldPosition(_animWorldPosition);
                if (flyToAnimation.bodyName === 'ISS' && flyToAnimation.offsetLocal) {
                    targetBody.mesh.getWorldQuaternion(_animWorldQuat);
                    _animIssTargetOffset.copy(flyToAnimation.targetOffsetLocal).applyQuaternion(_animWorldQuat);
                    flyToAnimation.endTarget.copy(_animWorldPosition).add(_animIssTargetOffset);
                    _animIssCamOffset.copy(flyToAnimation.offsetLocal).applyQuaternion(_animWorldQuat);
                    flyToAnimation.endPos.copy(flyToAnimation.endTarget).add(_animIssCamOffset);
                    _animIssUp.set(0, 1, 0).applyQuaternion(_animWorldQuat).normalize();
                } else if (flyToAnimation.offset) {
                    flyToAnimation.endTarget.copy(_animWorldPosition);
                    flyToAnimation.endPos.copy(_animWorldPosition).add(flyToAnimation.offset);
                }
            }
        }

        const now = Date.now();
        const elapsed = now - flyToAnimation.startTime;
        const progress = Math.min(elapsed / flyToAnimation.duration, 1);

        // Smooth cubic ease-in-out for all transitions
        const easeProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        if (flyToAnimation.isSizeCompare && flyToAnimation.logarithmicApproachRatio) {
            const ratio = flyToAnimation.logarithmicApproachRatio;
            const approachProgress = (1 - Math.pow(ratio, progress)) / (1 - ratio);
            camera.position.lerpVectors(
                flyToAnimation.startPos,
                flyToAnimation.endPos,
                approachProgress
            );
            controls.target.lerpVectors(
                flyToAnimation.startTarget,
                flyToAnimation.endTarget,
                approachProgress
            );
        } else if (flyToAnimation.isSizeCompare) {
            const p = progress;
            const p2 = p * p;
            const p3 = p2 * p;
            const h00 = 2 * p3 - 3 * p2 + 1;
            const h10 = p3 - 2 * p2 + p;
            const h01 = -2 * p3 + 3 * p2;
            const tangentScale = flyToAnimation.duration / 1000;

            // Hermite interpolation starts fresh moves at rest and carries the
            // current velocity into a new destination when the wheel retargets
            // an animation in progress. End velocity is always zero.
            camera.position.set(
                h00 * flyToAnimation.startPos.x
                    + h10 * tangentScale * flyToAnimation.startVelocity.x
                    + h01 * flyToAnimation.endPos.x,
                h00 * flyToAnimation.startPos.y
                    + h10 * tangentScale * flyToAnimation.startVelocity.y
                    + h01 * flyToAnimation.endPos.y,
                h00 * flyToAnimation.startPos.z
                    + h10 * tangentScale * flyToAnimation.startVelocity.z
                    + h01 * flyToAnimation.endPos.z
            );
            controls.target.set(
                h00 * flyToAnimation.startTarget.x
                    + h10 * tangentScale * flyToAnimation.startTargetVelocity.x
                    + h01 * flyToAnimation.endTarget.x,
                h00 * flyToAnimation.startTarget.y
                    + h10 * tangentScale * flyToAnimation.startTargetVelocity.y
                    + h01 * flyToAnimation.endTarget.y,
                h00 * flyToAnimation.startTarget.z
                    + h10 * tangentScale * flyToAnimation.startTargetVelocity.z
                    + h01 * flyToAnimation.endTarget.z
            );
        } else if (flyToAnimation.orbitApproach) {
            const A = flyToAnimation;
            const obj = A.endTarget;
            // Turn to face the object first (target glides onto it)
            const lookT = THREE.MathUtils.smootherstep(progress, 0, 0.28);
            // Distance: geometric (log) interpolation, eased at both ends
            const rEnd = Math.max(A.offset.length(), 1e-6);
            const distT = THREE.MathUtils.smootherstep(progress, 0, 1);
            const r = Math.exp(THREE.MathUtils.lerp(Math.log(A.rStart), Math.log(rEnd), distT));
            // Swing around to the home-in-view side in the second part
            const orbitT = THREE.MathUtils.smootherstep(progress, 0.3, 1);
            const az = A.az0 + A.dAz * orbitT;
            const el = THREE.MathUtils.lerp(A.el0, A.el1, orbitT);
            camera.position.set(
                obj.x + r * Math.cos(el) * Math.sin(az),
                obj.y + r * Math.sin(el),
                obj.z + r * Math.cos(el) * Math.cos(az)
            );
            controls.target.lerpVectors(A.startTarget, obj, lookT);
        } else if (flyToAnimation.travelTurn
            && progress < flyToAnimation.travelTurn.fraction) {
            // Pull away from the current view while rotating toward the new
            // destination. Forward travel begins only after the camera aligns.
            const turn = flyToAnimation.travelTurn;
            const turnProgress = THREE.MathUtils.smoothstep(
                progress,
                0,
                turn.fraction
            );
            const fullRotation = new THREE.Quaternion().setFromUnitVectors(
                turn.startDirection,
                turn.endDirection
            );
            const partialRotation = new THREE.Quaternion().identity()
                .slerp(fullRotation, turnProgress);
            const viewDirection = turn.startDirection.clone()
                .applyQuaternion(partialRotation)
                .normalize();

            camera.position.lerpVectors(
                flyToAnimation.startPos,
                turn.pullbackPos,
                turnProgress
            );
            controls.target.copy(camera.position)
                .addScaledVector(viewDirection, turn.lookDistance);
        } else if (flyToAnimation.isInterstellarFlight) {
            const turnFraction = flyToAnimation.travelTurn.fraction;
            const travelProgress = THREE.MathUtils.clamp(
                (progress - turnFraction) / (1 - turnFraction),
                0,
                1
            );
            let flightProgress;

            // Keep distant targets growing steadily instead of leaving them as
            // a dot until the final instant. This changes only the speed along
            // the line; the flight path itself remains perfectly straight.
            const startDistance = flyToAnimation.startDistanceToTarget;
            const endDistance = flyToAnimation.endDistanceToTarget;
            if (Math.abs(startDistance - endDistance) < 0.001) {
                flightProgress = THREE.MathUtils.smootherstep(travelProgress, 0, 0.94);
            } else {
                // Returning to the tiny solar-system scale needs a full-length
                // ease. Otherwise even a smooth world-space lerp covers the
                // entire visible final approach in its last few frames.
                const growthProgress = flyToAnimation.isInterstellarReturn
                    ? THREE.MathUtils.smootherstep(travelProgress, 0, 1)
                    : THREE.MathUtils.smoothstep(travelProgress, 0, 0.92);
                const desiredDistance = Math.exp(THREE.MathUtils.lerp(
                    Math.log(startDistance),
                    Math.log(endDistance),
                    growthProgress
                ));
                flightProgress = THREE.MathUtils.clamp(
                    (startDistance - desiredDistance) / (startDistance - endDistance),
                    0,
                    1
                );
            }

            camera.position.lerpVectors(
                flyToAnimation.travelTurn.pullbackPos,
                flyToAnimation.endPos,
                flightProgress
            );
            controls.target.copy(flyToAnimation.endTarget);
        } else {
            // Regular map view — direct linear interpolation with global ease
            camera.position.lerpVectors(flyToAnimation.startPos, flyToAnimation.endPos, easeProgress);
            controls.target.lerpVectors(flyToAnimation.startTarget, flyToAnimation.endTarget, easeProgress);
            if (flyToAnimation.bodyName === 'ISS' && flyToAnimation.startUp) {
                camera.up.lerpVectors(flyToAnimation.startUp, _animIssUp, easeProgress).normalize();
            }
        }

        // Animation complete
        if (progress >= 1) {
            if (flyToAnimation.endMinDistance !== undefined) {
                controls.minDistance = flyToAnimation.endMinDistance;
            }
            const arrivedAtISS = flyToAnimation.bodyName === 'ISS';
            const localOffset = flyToAnimation.offsetLocal ? flyToAnimation.offsetLocal.clone() : null;
            const localTargetOffset = flyToAnimation.targetOffsetLocal ? flyToAnimation.targetOffsetLocal.clone() : null;
            flyToAnimation = null;
            cameraOffsetFromTarget = null;
            
            if (arrivedAtISS) {
                camera.up.copy(_animIssUp);
                isCameraLocked = true;
                cameraAngleLock = true;
                chaseCam.bodyName = 'ISS';
                if (localOffset) chaseCam.offsetLocal.copy(localOffset);
                if (localTargetOffset) chaseCam.targetOffsetLocal.copy(localTargetOffset);
                chaseCam.upLocal.set(0, 1, 0);
                chaseCam.hasOffset = true;
                chaseCam.active = true;
                const lockModeEl = document.getElementById('camera-lock-mode');
                if (lockModeEl) lockModeEl.textContent = 'On + angle';
            } else {
                // Arrive upright (north up); the gradual re-level during the
                // flight may not have fully finished
                if (cameraIsRolled()) camera.up.set(0, 1, 0);
                chaseCam.hasOffset = false; // "On + angle" locks onto this new view
            }
        }
    }
    
    // Camera follow behavior
    chaseCam.active = false;
    // Flights move the look-at point too; they're not pans. Without this the
    // first frame after flying to the ISS counted the whole trip as one
    if (flyToAnimation || focusRetarget || earthSpotFlight || tourGlide) satPan.endValid = false;
    if (currentFocusedBody && !flyToAnimation && !isHoverPanning) {
        // Determine which body map to use based on view mode
        let body;
        if (viewMode === 'sizeCompare') {
            // In comparison mode, objects don't move, so we don't strictly need to follow them per frame
            // EXCEPT if we want to ensure controls.target stays snapped to them if something else drifts it.
            // But usually static objects don't need this. 
            // The problem was that it was looking up 'Earth' in celestialBodies (Map mode) which is at 0,0,0
            // while sizeCompare 'Earth' is far away.
            // So we just Skip follow behavior in size compare mode as objects are static.
            body = null; 
        } else {
            body = celestialBodies.get(currentFocusedBody);
        }

        if (body && body.mesh) {
            body.mesh.getWorldPosition(_animWorldPosition);
            
            // Look-at moves made between frames (scroll zoom toward the cursor)
            // while following a spacecraft: keep them as part of its offset
            if (body.type === 'satellite' && satPan.endValid && satPan.body === currentFocusedBody && !flyToAnimation) {
                addSatPanDelta(body, _satPanDelta.copy(controls.target).sub(satPan.endTarget));
            }
            satPan.endValid = false;
            // Get current camera offset from target (spherical coords)
            _animCameraOffset.copy(camera.position).sub(controls.target);
            // Close to Earth, ride along with its spin so the ground stays put
            if (currentFocusedBody === 'Earth' && earthSurfaceCam.active) {
                body.mesh.getWorldQuaternion(_surfaceQuat);
                if (earthSurfaceCam.hasPrevQuat) {
                    _surfaceDeltaQuat.copy(_surfaceQuat).multiply(earthSurfaceCam.prevQuat.invert());
                    _animCameraOffset.applyQuaternion(_surfaceDeltaQuat);
                }
                earthSurfaceCam.prevQuat.copy(_surfaceQuat);
                earthSurfaceCam.hasPrevQuat = true;
            }
            
            if (earthSpotFlight && currentFocusedBody === 'Earth') {
                stepEarthSpotFlight(body.mesh, _animWorldPosition);
            } else if (focusRetarget && focusRetarget.name === currentFocusedBody) {
                // Hand-off glide (see retargetFocus): camera rides along with the
                // body, only the look-at point and roll change
                const t = Math.min(1, (performance.now() - focusRetarget.start) / FOCUS_RETARGET_MS);
                const ease = t * t * (3 - 2 * t);
                camera.position.add(_retargetVec.copy(_animWorldPosition).sub(focusRetarget.lastBodyPos));
                focusRetarget.lastBodyPos.copy(_animWorldPosition);
                controls.target.copy(_animWorldPosition).addScaledVector(focusRetarget.fromOffset, 1 - ease);
                if (t >= 1) {
                    focusRetarget = null;
                    // Normal zoom floor again, never above where the camera already is
                    const r = body.mesh.userData.visualRadius || 1;
                    controls.minDistance = Math.min(r * 1.4, camera.position.distanceTo(_animWorldPosition) * 0.95);
                }
            } else if (isCameraLocked && cameraAngleLock) {
                // "On + angle": keep the viewpoint fixed in the object's own frame
                body.mesh.getWorldQuaternion(_chaseQuat);
                if (chaseCam.bodyName !== currentFocusedBody || !chaseCam.hasOffset) {
                    // Lock on from wherever the camera is now
                    chaseCam.bodyName = currentFocusedBody;
                    const toLocal = _chaseQuat.clone().invert();
                    chaseCam.offsetLocal.copy(_animCameraOffset).applyQuaternion(toLocal);
                    chaseCam.targetOffsetLocal.set(0, 0, 0);
                    // Keep the current roll too (relative to the object), so
                    // switching into this mode doesn't turn the view
                    chaseCam.upLocal.copy(camera.up).applyQuaternion(toLocal).normalize();
                    chaseCam.hasOffset = true;
                }
                // Zoom: OrbitControls applies wheel/pinch zoom inside its own
                // event handler, between frames. Keep the distance it set rather
                // than restoring last frame's offset (which undid every zoom).
                const zoomedDist = _animCameraOffset.length();
                if (Math.abs(zoomedDist - chaseCam.offsetLocal.length()) > zoomedDist * 1e-9) {
                    chaseCam.offsetLocal.setLength(zoomedDist);
                }
                // Mouse orbit, in the object's frame (see setupChaseCamDrag)
                if (chaseDrag.dTheta || chaseDrag.dPhi) {
                    const [dTheta, dPhi] = takeOrbitStep();
                    orbitAroundPole(chaseCam.offsetLocal, chaseCam.upLocal, dTheta, dPhi);
                }
                controls.target.copy(_animWorldPosition);
                if (chaseCam.targetOffsetLocal && chaseCam.targetOffsetLocal.lengthSq() > 1e-8) {
                    controls.target.add(_targetVec.copy(chaseCam.targetOffsetLocal).applyQuaternion(_chaseQuat));
                }
                camera.position.copy(controls.target)
                    .add(_chaseVec.copy(chaseCam.offsetLocal).applyQuaternion(_chaseQuat));
                // Roll with the object too, so a framed horizon stays level
                camera.up.copy(chaseCam.upLocal).applyQuaternion(_chaseQuat);
                chaseCam.active = true;
            } else if (isCameraLocked || (currentFocusedBody === 'Earth' && earthSurfaceCam.active)) {
                // Camera maintains its spherical position relative to the moving target
                // This allows free orbiting while traveling with the object.
                // Earth close-up always rides along (even with follow off):
                // otherwise Earth orbits/spins out from under the camera and the
                // spot you flew down to slides away.
                controls.target.copy(_animWorldPosition);
                if (body.type === 'satellite') controls.target.add(satPan.offset);
                camera.position.copy(controls.target).add(_animCameraOffset);
            } else {
                // Camera lock is OFF - camera stays in space, just pans to follow
                // Only update target position, camera stays where it is
                // This makes the camera rotate to track the object
                controls.target.copy(_animWorldPosition);
                if (body.type === 'satellite') controls.target.add(satPan.offset);
                cameraOffsetFromTarget = null;
            }
            // Remember where the follow code put the look-at point, to pick up pans
            if (body.type === 'satellite' && !flyToAnimation && !focusRetarget) {
                if (satPan.body !== currentFocusedBody) satPan.offset.set(0, 0, 0);
                satPan.body = currentFocusedBody;
                satPan.setTarget.copy(controls.target);
                satPan.valid = true;
            }
        }
    }

    // The DOM-based home indicator does not need to run at render frequency.
    if (nowMs - lastHomeIndicatorUpdate >= 33) {
        updateHomeIndicator();
        updateMikoIndicator();
        updateViewOrientationUI();
        lastHomeIndicatorUpdate = nowMs;
    }

    // Anything but the chase cam uses the normal world-up camera and lets
    // OrbitControls rotate; the chase cam rotates itself (setupChaseCamDrag)
    updateViewRoll();

    // Flights re-level a rolled camera gradually (the view is moving anyway), except when targeting the ISS
    if (flyToAnimation && flyToAnimation.bodyName !== 'ISS' && cameraIsRolled()) camera.up.lerp(_WORLD_UP, 0.08).normalize();
    // Rolled but not chasing: orbit around the camera's own up
    if (!chaseCam.active && cameraIsRolled() && !flyToAnimation && !earthSpotFlight && (chaseDrag.dTheta || chaseDrag.dPhi)) {
        const [dTheta, dPhi] = takeOrbitStep();
        _chaseVec.copy(camera.position).sub(controls.target);
        orbitAroundPole(_chaseVec, camera.up, dTheta, dPhi);
        camera.position.copy(controls.target).add(_chaseVec);
    }
    const customOrbit = chaseCam.active || cameraIsRolled();
    controls.enableRotate = !customOrbit;
    if (!customOrbit) chaseDrag.dTheta = chaseDrag.dPhi = 0;

    applyTourGlide();
    // Following a spacecraft, scroll zooms toward what's under the cursor: the
    // look-at point floats beside the model (so the horizon shows), and zooming
    // on it flew past the station. The shift it makes is kept by satPan
    controls.zoomToCursor = viewMode === 'map' && celestialBodies.get(currentFocusedBody)?.type === 'satellite';
    prepareEarthSurfaceCamera();
    if (!customOrbitDrag?.moved) controls.update();
    finishEarthSurfaceCamera();
    if (satPan.valid && satPan.body === currentFocusedBody && !tourGlide) {
        addSatPanDelta(celestialBodies.get(currentFocusedBody), _satPanDelta.copy(controls.target).sub(satPan.setTarget));
        satPan.endTarget.copy(controls.target);
        satPan.endValid = true;
    }
    satPan.valid = false;
    updateNearPlaneForFocus();

    // Chase cam: drags/zooms this frame become the new locked viewpoint
    if (chaseCam.active) {
        const chased = celestialBodies.get(chaseCam.bodyName);
        if (chased) {
            chased.mesh.getWorldQuaternion(_chaseQuat).invert();
            chaseCam.offsetLocal.copy(camera.position).sub(controls.target).applyQuaternion(_chaseQuat);
        }
    }

    if (controlsStateDirty && viewMode === 'map') {
        const controlsDistance = camera.position.distanceTo(controls.target);
        if (lastControlsDistance === null || Math.abs(controlsDistance - lastControlsDistance) > 0.0001) {
            updateZoomLevelFromDistance(controlsDistance);
            lastControlsDistance = controlsDistance;
        }
    }

    updateTravelStreaks(flyToAnimation, frameScale);
    updateStellarComparison(frameScale);
    controlsStateDirty = false;

    // Raycast only when pointer or camera state changed.
    if (hoverStateDirty && lastMouseX !== -1 && lastMouseY !== -1 && !HOVER_NONE_MQ.matches) {
        updateHoverState(lastMouseX, lastMouseY);
        hoverStateDirty = false;
    }

    // Update hover pan animation
    updateHoverPan();
    
    // Draw the animated guide only while one is active.
    if (hoveredObjectName) drawGuideLine();
    
    updateEarthNightUniforms();
    updateEarthTiles(celestialBodies.get('Earth')?.mesh, camera, renderer, viewMode === 'map');
    // Magnifier first: the main render then clears the whole canvas, so the
    // close-up doesn't linger in the canvas behind the scope's round frame
    renderMagnifier();
    renderer.render(scene, camera);
}

// ── Satellites intro ─────────────────────────────────────────────────────
// Satellites start off. The first time the camera comes near Earth (clicking
// it, the E key or zooming in) the standard groups (stations, GPS,
// geostationary; Starlink stays opt-in) fade in for a few seconds and out
// again, so you know they're there without having to turn them off. Data is
// fetched first, then the fade plays. Once per visit; touching the Satellites
// button cancels it
const SAT_INTRO = { nearRadii: 20, fadeIn: 2500, hold: 2500, fadeOut: 3000, prepTimeout: 9000 };
const satIntro = { state: 'waiting', t0: 0 };
function endSatelliteIntro() {
    if (satIntro.state === 'done') return;
    satIntro.state = 'done';
    setSatellitePreview(0);
}
function updateSatelliteIntro() {
    if (satIntro.state === 'done' || viewMode !== 'map') return;
    const earth = celestialBodies.get('Earth');
    if (!earth) return;
    const now = performance.now();
    if (satIntro.state === 'waiting') {
        earth.mesh.getWorldPosition(_magPos);
        if (camera.position.distanceTo(_magPos) > (earth.mesh.userData.visualRadius || 1) * SAT_INTRO.nearRadii) return;
        satIntro.state = 'preparing';
        satIntro.t0 = now;
        setSatellitePreview(1e-4);                   // fetch and position everything, invisibly
    }
    if (satIntro.state === 'preparing') {
        if (!satellitesReady() && now - satIntro.t0 < SAT_INTRO.prepTimeout) return;
        satIntro.state = 'running';
        satIntro.t0 = now;
    }
    const t = now - satIntro.t0, { fadeIn, hold, fadeOut } = SAT_INTRO;
    if (t >= fadeIn + hold + fadeOut) { endSatelliteIntro(); return; }
    const a = t < fadeIn ? THREE.MathUtils.smoothstep(t, 0, fadeIn)
        : t < fadeIn + hold ? 1
        : 1 - THREE.MathUtils.smoothstep(t, fadeIn + hold, fadeIn + hold + fadeOut);
    setSatellitePreview(Math.max(a, 1e-4));
}

// ── Hover magnifier ──────────────────────────────────────────────────────
// Point at a dot far off in space and a scope opens beside the cursor with a
// live close-up of it, seen from the same direction as the main view, so you
// can tell what it is without flying there. A second camera is put close to
// the object along the line of sight and the scene is drawn again into a
// small square of the same canvas (scissored); an HTML frame on top rounds
// it into a circle with a reticle, the name and the magnification.
const MAGNIFIER_PX = 380;            // CSS px (must match #magnifier in styles.css)
const MAGNIFIER_FILL = 0.5;          // share of the scope's width the object spans
const MAGNIFIER_DELAY_MS = 1000;     // rest the cursor on it this long
const MAGNIFIER_MAX_RADIUS_PX = 30;  // for things that look small (far-off planets, stars, black holes…)
const magnifier = { cam: new THREE.PerspectiveCamera(20, 1, 1e-6, 1e12), el: null, nameEl: null, zoomEl: null, body: null, since: 0 };
// (isDragging stays true after any mouse travel since the last press, so
// check for a held button instead)
let mouseButtonsHeld = 0;
const _magPos = new THREE.Vector3(), _magDir = new THREE.Vector3(), _magViewport = new THREE.Vector4();

const MAGNIFIER_PHASE = Math.acos(1 / 3);          // ≈ 70.5°: two-thirds lit
const SELF_LIT_TYPES = new Set(['star', 'blackhole', 'neutronstar', 'pulsar', 'magnetar', 'whitedwarf', 'galaxy', 'nebula', 'quasar']);
const _magLightAxis = new THREE.Vector3(), _magLight = new THREE.Vector3();
// Direction from the object to whatever lights it (null for things that shine
// on their own): its host star for exoplanets, otherwise the Sun at the origin
function magnifierLightDir(body, pos) {
    if (body.type === 'star' || SELF_LIT_TYPES.has(body.data?.type)) return null;
    if (body.data?.type === 'exoplanet' && body.parent) body.parent.getWorldPosition(_magLight);
    else _magLight.set(0, 0, 0);
    _magLight.sub(pos);
    return _magLight.lengthSq() > 1e-12 ? _magLight.normalize() : null;
}

// How big the object is, for framing: its own radius if it says, else the
// first sphere inside it (distant stars are a group around one), else its
// bounding box. Cached on the object
function magnifierRadius(mesh) {
    const ud = mesh.userData;
    if (ud.previewRadius) return ud.previewRadius;
    if (ud.visualRadius) return ud.visualRadius * (ud.shapeExtent || 1);
    if (mesh.geometry?.parameters?.radius) return mesh.geometry.parameters.radius;
    if (ud.magnifierRadius) return ud.magnifierRadius;
    let r = 0;
    mesh.traverse(o => { if (!r && o.isMesh && o.geometry?.parameters?.radius) r = o.geometry.parameters.radius * o.getWorldScale(_magDir).x; });
    if (!r) {
        const size = new THREE.Box3().setFromObject(mesh).getSize(_magDir);
        r = Math.max(size.x, size.y, size.z) / 2;
    }
    ud.magnifierRadius = r;
    return r;
}

function setupMagnifier() {
    const el = document.createElement('div');
    el.id = 'magnifier';
    // The view is drawn in the main canvas and copied into .mag-view, so the
    // scope is one HTML layer that sits above labels like "You" (which would
    // otherwise show through the middle of it)
    el.innerHTML = '<canvas class="mag-view"></canvas><div class="mag-ring"></div><div class="mag-sweep"></div><div class="mag-reticle"></div>' +
        '<div class="mag-name"></div><div class="mag-zoom"></div>';
    document.body.appendChild(el);
    magnifier.el = el;
    magnifier.view = el.querySelector('.mag-view');
    magnifier.viewCtx = magnifier.view.getContext('2d');
    magnifier.nameEl = el.querySelector('.mag-name');
    magnifier.zoomEl = el.querySelector('.mag-zoom');
}

function renderMagnifier() {
    if (!magnifier.el) return;
    const body = hoveredBody;
    let show = false, R = 0, radiusPx = 0;
    if (body && viewMode === 'map' && !HOVER_NONE_MQ.matches && !mouseButtonsHeld && !flyToAnimation
        && lastMouseX >= 0 && body.mesh.visible && body.mesh !== celestialBodies.get(currentFocusedBody)?.mesh) {
        body.mesh.getWorldPosition(_magPos);
        const dist = camera.position.distanceTo(_magPos);
        R = magnifierRadius(body.mesh);
        const pxPerUnit = (window.innerHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(dist, 1e-9);
        radiusPx = R * pxPerUnit;
        if (R > 0 && radiusPx < MAGNIFIER_MAX_RADIUS_PX && dist > R * 4) {
            if (magnifier.body !== body) {
                magnifier.body = body;
                magnifier.since = performance.now();
                magnifier.nameEl.textContent = body.data?.name || '';
            }
            show = performance.now() - magnifier.since > MAGNIFIER_DELAY_MS;
        }
    }
    if (!show && !body) magnifier.body = null;
    magnifier.el.classList.toggle('visible', show);
    if (!show) return;

    // Beside the cursor: above-right (the tooltip sits below-right), flipped at the edges
    // Above-right of the cursor (the tooltip sits below-right); with no room
    // above, beside it on the left, centred on the cursor and kept on screen
    const size = MAGNIFIER_PX, gap = 18;
    const W = window.innerWidth, H = window.innerHeight, mx = lastMouseX, my = lastMouseY;
    const tip = document.getElementById('hover-tooltip');
    const tipRect = tip && !tip.classList.contains('hidden') ? tip.getBoundingClientRect() : null;
    const midY = THREE.MathUtils.clamp(my - size / 2, 0, Math.max(0, H - size));
    // First spot that fits on screen without covering the tooltip
    const spots = [
        [mx + gap, my - gap - size],                       // above-right
        [mx - gap - size, my - gap - size],                // above-left
        [mx - gap - size, midY],                           // left
        [(tipRect ? tipRect.right : mx + gap) + gap, midY], // right, past the tooltip
        [mx - gap - size, my + gap]                        // below-left
    ];
    const fits = ([l, t]) => l >= 0 && t >= 0 && l + size <= W && t + size <= H
        && !(tipRect && l < tipRect.right && l + size > tipRect.left && t < tipRect.bottom && t + size > tipRect.top);
    let [left, top] = spots.find(fits) || spots[0];
    left = THREE.MathUtils.clamp(left, 0, Math.max(0, W - size));
    top = THREE.MathUtils.clamp(top, 0, Math.max(0, H - size));
    magnifier.el.style.transform = `translate(${left}px, ${top}px)`;

    // Close-up camera, the object filling half the scope. Self-lit things
    // (stars, black holes) are seen along your line of sight; sunlit ones from
    // where they look two-thirds lit, so a body seen from its night side isn't
    // just a black disc: phase angle 70.5° from its light (lit share
    // (1 + cos α)/2 = 2/3), swung toward your actual viewpoint
    const cam = magnifier.cam;
    const fromViewer = _magDir.copy(camera.position).sub(_magPos).normalize();   // object → you
    const light = magnifierLightDir(body, _magPos);
    if (light) {
        const axis = _magLightAxis.crossVectors(light, fromViewer);
        if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0).cross(light);
        if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
        fromViewer.copy(light).applyAxisAngle(axis.normalize(), MAGNIFIER_PHASE);
    }
    const d = R / (MAGNIFIER_FILL * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    cam.position.copy(_magPos).addScaledVector(fromViewer, d);
    cam.up.copy(camera.up);
    cam.lookAt(_magPos);
    cam.near = Math.max(d * 1e-3, 1e-7);
    cam.updateProjectionMatrix();
    const zoom = (MAGNIFIER_FILL * size / 2) / Math.max(radiusPx, 1e-6);
    magnifier.zoomEl.textContent = `×${zoom >= 100 ? Math.round(zoom).toLocaleString() : zoom >= 1 ? zoom.toFixed(1) : zoom.toFixed(2)}`;

    // Distant stars have their glow sprite blown up to stay a visible dot in
    // the main view; magnified ×100s that boost became a white disc or huge
    // spikes (a companion's glare flooded the whole scope). Draw every star's
    // at its natural size (5× the star) for the close-up
    if (!magnifier.spikes) {
        magnifier.spikes = [];
        scene.traverse(o => { if (o.name === 'starSpike' && o.userData.baseScale) magnifier.spikes.push(o); });
    }
    const spikeScales = magnifier.spikes.map(o => o.scale.x);
    magnifier.spikes.forEach(o => o.scale.setScalar(o.userData.baseScale));

    // Draw it into that square of the canvas
    renderer.getViewport(_magViewport);
    const y = window.innerHeight - top - size;
    renderer.setScissorTest(true);
    renderer.setScissor(left, y, size, size);
    renderer.setViewport(left, y, size, size);
    renderer.render(scene, cam);
    renderer.setScissorTest(false);
    renderer.setViewport(_magViewport);
    magnifier.spikes.forEach((o, i) => o.scale.setScalar(spikeScales[i]));
    // Copy it out right away (the drawing buffer isn't kept between frames)
    const pr = renderer.getPixelRatio(), px = Math.round(size * pr);
    if (magnifier.view.width !== px) { magnifier.view.width = px; magnifier.view.height = px; }
    magnifier.viewCtx.drawImage(renderer.domElement, left * pr, top * pr, px, px, 0, 0, px, px);
}

// ── Earth close-up camera ────────────────────────────────────────────────
// OrbitControls zooms by scaling distance to Earth's *center*, which is far
// too coarse near the surface. Below SURFACE_MODE_ALT radii of altitude we
// turn each zoom step into the same ratio applied to *altitude*, so wheel and
// pinch both go smoothly down to street level. Rotation slows with altitude.
const SURFACE_MODE_ALT = 1.5;    // Earth radii
const SURFACE_MIN_ALT_KM = 0.4;
const SURFACE_ZOOM_BOOST = 3;    // each zoom step changes altitude 3× as much (log scale)
const earthSurfaceCam = { active: false, lastDist: 0, hasPrevQuat: false, prevQuat: new THREE.Quaternion() };
const _surfaceQuat = new THREE.Quaternion();
const _surfaceDeltaQuat = new THREE.Quaternion();
const _surfaceDir = new THREE.Vector3();
const _surfaceAxis = new THREE.Vector3();
const _cursorGroundDir = new THREE.Vector3();
const _cursorRaycaster = new THREE.Raycaster();
const _cursorNdc = new THREE.Vector2();
const _earthSphere = new THREE.Sphere();

// Direction from Earth's center to the ground point under a screen position
// (into _cursorGroundDir); false if the pointer is off the globe
// `fromDist`: cast from the camera's distance *before* this frame's zoom.
// OrbitControls has already scaled the distance to Earth's centre by ~5%,
// which below ~300 km puts the camera inside the globe for a moment, and a
// ray from inside hits the far side of the planet.
function earthGroundUnderCursor(clientX, clientY, R, fromDist) {
    const rect = renderer.domElement.getBoundingClientRect();
    _cursorNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    // Build the ray from the field of view and the camera's orientation.
    // Raycaster.setFromCamera unprojects a point on the near plane, which is
    // millimetres from the camera near the surface; subtracting that from a
    // camera ~100 units from the origin leaves float noise, and the "ground
    // under the cursor" came out on the far side of Earth.
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const ray = _cursorRaycaster.ray;
    ray.origin.copy(camera.position).sub(controls.target).setLength(fromDist).add(controls.target);
    ray.direction.set(_cursorNdc.x * tanHalf * camera.aspect, _cursorNdc.y * tanHalf, -1)
        .applyQuaternion(camera.quaternion).normalize();
    _earthSphere.set(controls.target, R);
    if (!ray.intersectSphere(_earthSphere, _cursorGroundDir)) return false;
    _cursorGroundDir.sub(controls.target).normalize();
    return true;
}

function prepareEarthSurfaceCamera() {
    const earth = celestialBodies.get('Earth');
    const focused = earth && viewMode === 'map' && currentFocusedBody === 'Earth' && !flyToAnimation && !focusRetarget && !earthSpotFlight;
    const R = earth?.mesh.userData.visualRadius || 1;
    const dist = camera.position.distanceTo(controls.target);
    const active = focused && dist - R < R * SURFACE_MODE_ALT;

    if (!active) {
        // Leaving close-up by zooming out: restore Earth's normal limits. If
        // focus moved to another body (e.g. the ISS), focusOnBody has already
        // set that body's limits; overwriting them with Earth's (1.4 R) stopped
        // the flight short and blocked zooming until a second click.
        if (earthSurfaceCam.active && currentFocusedBody === 'Earth') {
            controls.minDistance = R * 1.4;
            controls.rotateSpeed = 0.5;
        }
        // (the near plane is handled by updateNearPlaneForFocus)
        earthSurfaceCam.active = false;
        earthSurfaceCam.hasPrevQuat = false;
        earthSurfaceCam.lastDist = 0;
        return;
    }
    earthSurfaceCam.active = true;
    if (!earthSurfaceCam.lastDist) earthSurfaceCam.lastDist = dist;
    const alt = dist - R;
    controls.minDistance = R * 0.01; // clamping is done on altitude in finishEarthSurfaceCamera()
    controls.rotateSpeed = Math.min(0.5, 0.2 * alt / R);
    // (near plane: set by updateNearPlaneForFocus after finishEarthSurfaceCamera
    // has placed the camera; setting it here from the pre-remap distance made a
    // quick zoom-out from low altitude clip the ground for a frame)
}

// Up close to something small (the ISS is ~0.04 units across) the default
// near plane (0.1) would slice it off, so it shrinks with the distance to the
// focus point. The log depth buffer keeps precision fine at any near value.
// Runs once per frame after the camera's final position is known (including
// the Earth close-up camera's altitude remap), so it covers that mode too.
const _nearBodyPos = new THREE.Vector3();
function updateNearPlaneForFocus() {
    // Nearest thing that could be clipped: the focus point, or the surface of
    // any Solar System body. Using only the focus distance clipped Earth away
    // (showing the sky through it) when zooming toward Earth while centred on
    // something else, e.g. the ISS or empty space after a scale change.
    let nearest = camera.position.distanceTo(controls.target);
    if (viewMode === 'map') {
        celestialBodies.forEach(body => {
            if (body.isDistant || !body.mesh.visible) return;
            const r = body.mesh.userData.visualRadius || 0;
            const surface = camera.position.distanceTo(body.mesh.getWorldPosition(_nearBodyPos)) - r;
            if (surface < nearest) nearest = surface;
        });
    }
    const near = THREE.MathUtils.clamp(Math.max(nearest, 0) * 0.05, 1e-6, 0.1);
    if (Math.abs(near - camera.near) > near * 0.05) {
        camera.near = near;
        camera.updateProjectionMatrix();
    }
}

function finishEarthSurfaceCamera() {
    if (!earthSurfaceCam.active) return;
    const R = celestialBodies.get('Earth').mesh.userData.visualRadius;
    // Compare with the end of the previous frame: OrbitControls applies wheel
    // zoom inside its own event handler, so changes can land between frames
    const dist = camera.position.distanceTo(controls.target);
    const ratio = dist / earthSurfaceCam.lastDist;
    if (Math.abs(ratio - 1) > 1e-9) {
        const prevAlt = earthSurfaceCam.lastDist - R;
        let alt = prevAlt * Math.pow(ratio, SURFACE_ZOOM_BOOST);
        if (alt > R * SURFACE_MODE_ALT) alt = Math.max(alt, dist - R); // hand back to normal zoom
        alt = Math.max(alt, SURFACE_MIN_ALT_KM * R / 6371);
        _surfaceDir.copy(camera.position).sub(controls.target).normalize();
        // Zoom toward the cursor, like a web map: swing the camera around
        // Earth toward the ground point under the pointer, by the share the
        // altitude changed, so that point stays under the pointer (small-angle
        // approximation; the camera looks straight down). Zooming out swings back.
        if (performance.now() - lastWheel.time < 250 && earthGroundUnderCursor(lastWheel.x, lastWheel.y, R, earthSurfaceCam.lastDist)) {
            const k = alt / prevAlt;                       // < 1 zooming in
            const angle = _surfaceDir.angleTo(_cursorGroundDir) * (1 - k);
            _surfaceAxis.crossVectors(_surfaceDir, _cursorGroundDir);
            if (_surfaceAxis.lengthSq() > 1e-12 && Math.abs(angle) < Math.PI / 2) {
                _surfaceAxis.normalize();
                _surfaceDir.applyAxisAngle(_surfaceAxis, angle);
                if (cameraIsRolled()) camera.up.applyAxisAngle(_surfaceAxis, angle);
            }
        }
        camera.position.copy(controls.target).addScaledVector(_surfaceDir, R + alt);
    }
    earthSurfaceCam.lastDist = camera.position.distanceTo(controls.target);
}

function focusOnBody(name) {
    const body = celestialBodies.get(name);
    if (!body) return;
    // Picking the ISS slows time so Earth doesn't race by below it (the
    // cheese tour sets its own speeds)
    if (name === 'ISS' && !cheeseTour.active && !simPaused && Math.abs(currentSimSps()) > ISS_VIEW_SPS) {
        setSimRateSps(Math.sign(currentSimSps()) * ISS_VIEW_SPS);
    }
    satPan.offset.set(0, 0, 0);
    satPan.endValid = false;
    earthSpotFlight = null;
    // A new selection starts fresh: otherwise "On + angle" restores the
    // viewpoint it last locked for this body, undoing the north-up framing
    chaseCam.hasOffset = false;
    rollAnimation = null;
    if (name !== 'ISS') {
        chaseCam.targetOffsetLocal.set(0, 0, 0);
        if (cameraAngleLock) {
            cameraAngleLock = false;
            const lockModeEl = document.getElementById('camera-lock-mode');
            if (lockModeEl) lockModeEl.textContent = isCameraLocked ? 'On' : 'Off';
        }
    }

    // Already close (e.g. following the ISS and picking Earth): switch focus
    // in place instead of flying to the standard framing
    // Not for spacecraft: they're tiny, so "near" really means "fly in and frame it"
    if (viewMode === 'map' && name !== 'Solar System' && currentFocusedBody !== name
        && !body.isDistant && body.type !== 'satellite' && isCameraNearBody(body)) {
        retargetFocus(name);
        return;
    }

    // Selecting Earth from interstellar space should use the same pullback and
    // direct homeward flight as the Home button, while opening Earth's card.
    if (name === 'Earth') {
        const earthPosition = new THREE.Vector3();
        body.mesh.getWorldPosition(earthPosition);
        if (camera.position.distanceTo(earthPosition) > 50000) {
            flyToEarth(true);
            return;
        }
    }

    // Special handling for Solar System marker
    if (name === 'Solar System') {
        currentFocusedBody = name;
        updateSidebarSelection(name);
        currentZoomLevel = 'FULL_SOLAR';
        updateZoomLevel();
        updateUI();
        
        // Reset camera to view the full solar system. Interstellar returns use
        // the same pullback, turn, and direct-flight sequence as every jump.
        const solarTarget = new THREE.Vector3(0, 0, 0);
        controls.minDistance = 1;
        const distance = currentUnitsPerAU * 30; // ~30 AU out
        const solarCameraPos = new THREE.Vector3(
            distance * 0.8,
            distance * 0.5,
            distance
        );

        if (camera.position.distanceTo(solarCameraPos) > 50000) {
            flyToAnimation = createInterstellarReturnFlight(
                solarCameraPos,
                solarTarget,
                'Solar System'
            );
        } else {
            controls.target.copy(solarTarget);
            camera.position.copy(solarCameraPos);
        }
        
        showBodyInfo(body.data);
        return;
    }

    // Track the currently focused body
    currentFocusedBody = name;
    updateSidebarSelection(name);
    
    // Reset camera offset for new body
    cameraOffsetFromTarget = null;

    const target = body.mesh;
    
    // Make sure the target is visible (especially important for distant stars)
    target.visible = true;
    
    const worldPosition = new THREE.Vector3();
    target.getWorldPosition(worldPosition);
    
    // Calculate appropriate camera distance
    // Use a consistent base distance for all objects, regardless of size
    // Only increase distance if there are moons to show
    
    // Get the visual radius of the mesh (for reference, not primary factor)
    const meshForSizing = body.visualMesh || target;
    // Measure only the body's own parts (atmosphere, rings). Moons, the ISS,
    // satellite clouds and imagery tiles hang off the planet mesh too and would
    // inflate the bounds (at realistic scale the Moon is ~77 units out).
    const passengers = meshForSizing.children.filter(child =>
        child === userMarker
        || ['satellites', 'earth tiles', 'ISS trail'].includes(child.name)
        || child.name.startsWith('cheese')
        || [...celestialBodies.values()].some(b => b.mesh === child));
    passengers.forEach(child => meshForSizing.remove(child));
    const box = new THREE.Box3().setFromObject(meshForSizing);
    passengers.forEach(child => meshForSizing.add(child));
    const size = box.getSize(new THREE.Vector3());
    const visualRadius = Math.max(size.x, size.y, size.z) / 2;
    // The bounds above include decorative glow/spike children. Camera framing
    // should use the solid body's radius so a giant star does not become tiny.
    const ownRadius = meshForSizing.userData.visualRadius
        || (meshForSizing.geometry && meshForSizing.geometry.parameters
            && meshForSizing.geometry.parameters.radius)
        || visualRadius;
    const isStarBody = body.type === 'star' || body.data.type === 'star';
    
    // Calculate camera distance
    let distance;

    // Check if this body has children (moons) - if so, use a larger distance
    // to keep them in frame
    let maxChildDistance = 0;
    if (body.data.children) {
        body.data.children.forEach(child => {
            const childBody = celestialBodies.get(child.name);
            const childIsMoon = child.type === 'moon' || childBody?.type === 'moon';
            const childIsExoplanet = child.type === 'exoplanet'
                || childBody?.type === 'exoplanet';
            // A star's regular planets should not force its portrait to include
            // the entire planetary system. Moons and close exoplanet companions
            // are the only children that participate in focus framing.
            if (!childIsMoon && !childIsExoplanet) return;
            // Moons far out (near-true scale) would shrink the planet to a dot
            // in the framing, so frame the planet alone
            const moonOrbit = childBody?.orbitRadius ?? scaleDistance(child.distance, childIsMoon);
            if (childIsMoon && !body.isDistant && moonOrbit > ownRadius * 12) return;
            const childDist = body.isDistant && childBody
                ? childBody.mesh.position.length()
                : moonOrbit;
            maxChildDistance = Math.max(maxChildDistance, childDist);
        });
    }

    // Calculate distance based on visual size using logarithmic scaling
    // This normalizes apparent sizes: small planets get zoomed in more,
    // large planets get zoomed out more, so they all look similar on screen
    const logRadius = Math.log(Math.max(visualRadius, 1));
    const baseDistance = 8 + logRadius * 3.5;  // Reduced from 4 to bring smaller objects closer

    // Use the larger of: base distance, or distance to see moons
    // Different multipliers based on moon system complexity
    let moonMultiplier = 0.6;  // Default for single moon
    if (body.data.children) {
        if (body.data.children.length > 2) {
            // Complex moon systems (Jupiter, Saturn) need more space
            moonMultiplier = 1.8;
        } else if (body.data.children.length === 2) {
            // Simple 2-moon systems (Mars) with very close moons
            // Check if moons are very close (< 1 unit away)
            if (maxChildDistance < 1) {
                moonMultiplier = 0.3;  // Ignore tiny moons, focus on planet
            } else {
                moonMultiplier = 1.0;
            }
        }
    }
    distance = Math.max(baseDistance, maxChildDistance * moonMultiplier);

    // Frame stars by their solid sphere, not by the much larger decorative
    // diffraction sprite. Five radii fills roughly 38% of a 60-degree viewport.
    const isMassiveStar = isStarBody && ownRadius > 30;
    const minDistance = isStarBody ? ownRadius * 5 : visualRadius * 2.5;
    distance = Math.max(distance, minDistance);
    distance = Math.max(distance, 6);   // Absolute minimum
    // Spacecraft are a few hundredths of a unit: frame the model up close
    // with Earth filling the background. True-size small bodies likewise.
    const tinyBody = body.type === 'satellite' || (body.type === 'smallbody' && ownRadius < 0.05);
    if (tinyBody) distance = ownRadius * 10;
    if (body.type === 'exoplanet' && body.orbitRadius) {
        // Start with both the planet and its host in frame. The user can zoom
        // closer after arriving at the system.
        distance = Math.max(distance, body.orbitRadius * 1.5);
    }
    // No maximum cap - let giant stars have appropriate viewing distance

    // Adaptive zoom floor: allow zooming in until the body nearly fills the
    // view (a fixed floor of 1 kept small moons stuck ~3 radii away). Use the
    // body's own sphere radius, NOT visualRadius — that comes from a Box3 that
    // includes children, so for planets it would swallow their moons' orbits
    // and block zooming (OrbitControls enforces minDistance every frame).
    controls.minDistance = Math.max(ownRadius * 1.4, camera.near * 2.5);
    if (tinyBody) controls.minDistance = ownRadius * 1.3; // until it nearly fills the view
    // Spacecraft models: right up to the hardware (pan onto a part, then zoom),
    // a metre or two at the model's scale; the near plane shrinks to match
    if (body.type === 'satellite') controls.minDistance = ownRadius * 0.01;
    
    // Calculate target camera position
    let offset;
    let issCamOffsetLocal = null;
    let issTargetOffsetLocal = null;
    let targetLookAtPosition = null;

    // For solar system objects (not distant stars), approach from the sunlit side
    if (name === 'ISS') {
        target.updateWorldMatrix(true, false);
        const issWorldQuat = new THREE.Quaternion();
        target.getWorldQuaternion(issWorldQuat);

        // Above and behind the ISS, pointing at it but up a bit to capture sky/background
        // Local axes: +Z = travel direction (forward), +Y = radial up (away from Earth), +X = truss
        // Camera offset relative to target: above (+Y) and behind (-Z)
        issCamOffsetLocal = ISS_CAM_OFFSET.clone();
        // Look target slightly above (+Y) and forward (+Z) so the ISS sits in the lower view
        issTargetOffsetLocal = ISS_TARGET_OFFSET.clone();

        targetLookAtPosition = worldPosition.clone().add(
            issTargetOffsetLocal.clone().applyQuaternion(issWorldQuat)
        );
        offset = issCamOffsetLocal.clone().applyQuaternion(issWorldQuat);
    } else if (body.type === 'exoplanet' && body.parent) {
        const hostPosition = new THREE.Vector3();
        body.parent.getWorldPosition(hostPosition);
        const starToPlanet = worldPosition.clone().sub(hostPosition).normalize();
        const viewDirection = new THREE.Vector3().crossVectors(starToPlanet, _animYAxis);
        if (viewDirection.lengthSq() < 0.001) viewDirection.set(0, 0, 1);
        viewDirection.normalize();
        offset = viewDirection.multiplyScalar(distance);
        offset.y += distance * 0.25;
        offset.setLength(distance * 1.1);
    } else if (name === 'Sun') {
        // Match the aligned planets' sunward viewing angle so the row recedes
        // toward the upper right instead of using the distant-star portrait.
        offset = new THREE.Vector3(-1, 0, 0)
            .applyAxisAngle(_animYAxis, Math.PI * 0.19);
        offset.y = 0.3;
        offset.normalize().multiplyScalar(distance);
    } else if (!body.isDistant && body.type !== 'star' && body.data.type !== 'star') {
        // Start from the direction pointing from the body back toward the Sun
        // (origin), then swing ~35° around and lift above the ecliptic so a
        // sliver of the night side stays visible for depth.
        const sunward = worldPosition.lengthSq() > 0.001
            ? worldPosition.clone().negate().normalize()
            : new THREE.Vector3(1, 0, 0);
        offset = sunward.multiplyScalar(distance)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.19); // ~35°
        offset.y += distance * 0.3;
        offset.setLength(distance * 1.3);
    } else {
        // Stars and distant objects: finish just beyond the object, looking
        // back past it toward home, turned ~20° to the side and a little above.
        // Home (and its "You" label / home arrow) then sits in frame beside
        // the object, a few tens of degrees off centre, so you always see
        // where you came from.
        offset = homeInViewOffset(worldPosition, distance);
    }

    const targetCameraPosition = (targetLookAtPosition ? targetLookAtPosition.clone() : worldPosition.clone()).add(offset);

    // Calculate travel distance to determine animation duration
    // Slower, smoother animations for better visual flow
    const travelDistance = camera.position.distanceTo(worldPosition);
    const duration = Math.min(Math.max(travelDistance / 150, 2000), 4000); // 2-4 seconds based on distance

    // Start smooth fly-to animation
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();

    // Update zoom level BEFORE animation
    if (body.isDistant) {
        // For distant stars, use STELLAR zoom
        currentZoomLevel = 'STELLAR';
        updateZoomLevel();
        updateUI();
    } else {
        // For solar system objects, update zoom level based on distance
        // This ensures other solar system objects become visible when jumping from stellar view
        updateZoomLevelFromDistance(distance);
        updateZoomLevel();
        updateUI();
    }

    // Ensure the target body is visible immediately
    target.visible = true;

    // If it's a parent with children, make those visible too
    if (body.data.children) {
        body.data.children.forEach(childData => {
            const childBody = celestialBodies.get(childData.name);
            if (childBody && childBody.mesh) {
                childBody.mesh.visible = true;
            }
        });
    }

    const isInterstellarFlight = body.isDistant
        && travelDistance > Math.max(distance * 4, 50000);
    const isHomewardInterstellarFlight = !body.isDistant
        && travelDistance > 50000;

    flyToAnimation = body.isDistant && name !== 'ISS'
        ? createOrbitApproach(worldPosition, offset, travelDistance)
        : isInterstellarFlight || isHomewardInterstellarFlight
        ? createInterstellarFlight(
            targetCameraPosition,
            worldPosition,
            name,
            {
                duration: isHomewardInterstellarFlight ? 5400 : duration,
                isReturn: isHomewardInterstellarFlight
            }
        )
        : name === 'ISS'
        ? {
            startPos: startPos,
            startTarget: startTarget,
            startUp: camera.up.clone(),
            endPos: targetCameraPosition,
            endTarget: targetLookAtPosition,
            offsetLocal: issCamOffsetLocal,
            targetOffsetLocal: issTargetOffsetLocal,
            startTime: Date.now(),
            duration: travelDistance < 1 ? 1200 : duration,
            bodyName: 'ISS'
        }
        : {
            startPos: startPos,
            startTarget: startTarget,
            endPos: targetCameraPosition,
            endTarget: worldPosition.clone(),
            offset: targetCameraPosition.clone().sub(worldPosition),
            startTime: Date.now(),
            duration: duration,
            bodyName: name
        };

    // Adjust control sensitivity based on object size and distance
    // For massive stars, reduce rotation and pan speed for smoother control
    if (isMassiveStar) {
        controls.rotateSpeed = 0.25; // Slower rotation for massive stars
        controls.panSpeed = 0.3;
        controls.zoomSpeed = 0.8;
    } else if (visualRadius > 10) {
        controls.rotateSpeed = 0.35;
        controls.panSpeed = 0.4;
        controls.zoomSpeed = 0.9;
    } else {
        // Normal sized objects - default speed
        controls.rotateSpeed = 0.5;
        controls.panSpeed = 0.5;
        controls.zoomSpeed = 1.0;
    }

    showBodyInfo(body.data);
}

function updateZoomLevelFromDistance(distance) {
    // Set zoom level based on camera distance to target
    let nextZoomLevel;
    if (distance < 100) {
        nextZoomLevel = 'EARTH_MOON';
    } else if (distance < 500) {
        nextZoomLevel = 'INNER_SOLAR';
    } else if (distance < 2000) {
        nextZoomLevel = 'FULL_SOLAR';
    } else {
        nextZoomLevel = 'STELLAR';
    }
    if (nextZoomLevel !== currentZoomLevel) {
        currentZoomLevel = nextZoomLevel;
        updateZoomLevel();
    }
    updateUI();
}

let lastScrollTime = 0;

// Move to the adjacent object in the size-comparison lineup.
// direction +1 = next bigger (right), -1 = next smaller (left).
// Shared by desktop scroll, mobile pinch/flick, and the edge arrows.
function stepSizeComparison(direction) {
    const now = Date.now();
    if (now - lastScrollTime < 300) return;
    lastScrollTime = now;

    // If mid-animation, step from the current destination (bodyName), not
    // currentFocusedBody, so the next target is always one step further.
    const baseName = flyToAnimation ? flyToAnimation.bodyName : currentFocusedBody;
    let currentIndex = sizeComparisonCatalog.findIndex(item => item.name === baseName);
    if (currentIndex === -1) currentIndex = 0;

    const nextIndex = currentIndex + direction;
    if (nextIndex >= 0 && nextIndex < sizeComparisonCatalog.length) {
        // The focus function inherits an in-progress transition's current
        // velocity before replacing its destination.
        focusOnSizeComparisonObject(sizeComparisonCatalog[nextIndex].name);
    }
}

function onWheel(event) {
    if (viewMode === 'sizeCompare') {
        event.preventDefault();
        stepSizeComparison(event.deltaY > 0 ? 1 : -1);
    }
    // Map-mode wheel and pinch zoom are owned by OrbitControls. Its change
    // event marks the zoom/UI state dirty, avoiding a second zoom here.
}

function updateZoomLevel() {
    // If we are in size comparison mode, do NOT mess with visibility based on zoom logic
    if (viewMode === 'sizeCompare') return;

    // Get the focused body's position if it exists
    let focusedBody = null;
    let focusedPosition = null;
    if (currentFocusedBody) {
        focusedBody = celestialBodies.get(currentFocusedBody);
        if (focusedBody && focusedBody.mesh) {
            focusedPosition = new THREE.Vector3();
            focusedBody.mesh.getWorldPosition(focusedPosition);
        }
    }

    celestialBodies.forEach((body, name) => {
        if (body.isDistant) {
            // Check visibility for distant objects
            // 1. If Show Stars is enabled, show all stars/blackholes etc (but not markers/exoplanets)
            // 2. If focused, always show
            // 3. If at Stellar zoom, show
            // 4. If near the focused star, show
            
            const isStarType = ['star', 'blackhole', 'neutronstar', 'galaxy', 'nebula', 'cluster'].includes(body.type);
            
            if (showBigStars && isStarType) {
                body.mesh.visible = true;
                
                // Ensure parent system is visible if applicable
                if (body.mesh.parent && body.mesh.parent.type === 'Group') {
                    body.mesh.parent.visible = true;
                }
            } else if (name === currentFocusedBody) {
                body.mesh.visible = true;
                // Also make sure the parent's system container is visible for exoplanets
                if (body.mesh.parent && body.mesh.parent.type === 'Group') {
                    body.mesh.parent.visible = true;
                }
            } else if (currentZoomLevel === 'STELLAR') {
                // Show distant stars at stellar zoom
                body.mesh.visible = true;
            } else if (focusedBody && focusedBody.isDistant && body.mesh) {
                // If viewing a distant star, check if this star is nearby
                const bodyPosition = new THREE.Vector3();
                body.mesh.getWorldPosition(bodyPosition);
                const distance = focusedPosition.distanceTo(bodyPosition);

                // Show stars that are within reasonable viewing distance
                // Use camera distance as a threshold - if the star is closer than the camera, show it
                const cameraDistance = camera.position.distanceTo(focusedPosition);
                body.mesh.visible = (distance < cameraDistance * 1.5);
            } else {
                body.mesh.visible = false;
            }
        } else if (body.type === 'exoplanet') {
            // Exoplanets are visible if:
            // 1. The exoplanet itself is focused, OR
            // 2. Its parent star is focused, OR
            // 3. We're at stellar zoom level
            const parent = body.parent;
            const parentBody = Array.from(celestialBodies.values()).find(b => b.mesh === parent);
            let parentName = null;
            if (parentBody) {
                parentName = Array.from(celestialBodies.entries()).find(([n, b]) => b === parentBody)?.[0];
            }
            
            // Check if exoplanet or its parent is focused
            const isFocused = (name === currentFocusedBody) || (parentName === currentFocusedBody);
            
            if (isFocused) {
                body.mesh.visible = true;
            } else {
                body.mesh.visible = (currentZoomLevel === 'STELLAR');
            }
        } else if (['star', 'blackhole', 'neutronstar', 'galaxy', 'nebula', 'cluster'].includes(body.type) && body.isDistant) {
            // These are distant objects outside solar system
            if (showBigStars) {
                // If Big stars is on, always show them
                body.mesh.visible = true;
            } else if (name === currentFocusedBody) {
                body.mesh.visible = true;
            } else if (currentZoomLevel === 'STELLAR') {
                body.mesh.visible = true;
            } else if (focusedBody && focusedBody.isDistant && body.mesh) {
                // If viewing a distant object, check if this object is nearby
                const bodyPosition = new THREE.Vector3();
                body.mesh.getWorldPosition(bodyPosition);
                const distance = focusedPosition.distanceTo(bodyPosition);
                const cameraDistance = camera.position.distanceTo(focusedPosition);
                body.mesh.visible = (distance < cameraDistance * 1.5);
            } else {
                body.mesh.visible = false;
            }
        } else if (body.type === 'system') {
            // Solar system marker - visible at stellar zoom
            body.mesh.visible = (currentZoomLevel === 'STELLAR');
        } else if (body.type === 'smallbody') {
            // visibility set each frame by smallBodies.js (menu toggles, dates)
        } else {
            // Solar system objects: visible at solar zoom levels
            body.mesh.visible = (currentZoomLevel !== 'STELLAR');
        }
    });
}

function findNearestBodyOnScreen(clientX, clientY, bodyMap, radiusPx) {
    const projected = new THREE.Vector3();
    const radiusSq = radiusPx * radiusPx;
    let nearestName = null;
    let nearestDistanceSq = radiusSq;

    bodyMap.forEach((body, name) => {
        if (!body.mesh.visible) return;

        // A child can be locally visible while an ancestor system is hidden.
        let ancestor = body.mesh.parent;
        while (ancestor) {
            if (!ancestor.visible) return;
            ancestor = ancestor.parent;
        }

        body.mesh.getWorldPosition(projected);
        projected.project(camera);
        if (projected.z < -1 || projected.z > 1) return;

        const screenX = (projected.x * 0.5 + 0.5) * window.innerWidth;
        const screenY = (-projected.y * 0.5 + 0.5) * window.innerHeight;
        const dx = clientX - screenX;
        const dy = clientY - screenY;
        const distanceSq = dx * dx + dy * dy;

        if (distanceSq <= nearestDistanceSq) {
            nearestDistanceSq = distanceSq;
            nearestName = name;
        }
    });

    return nearestName;
}

// Tiny objects (the ISS, small bodies) are a few pixels across or less, so a
// ray through them usually hits what's behind (Earth) and the screen-space
// fallback never ran. Check them first — but only if they're nearer than the
// ray's hit, so the ISS behind Earth isn't picked through the planet.
const _tinyPickPos = new THREE.Vector3();
function findTinyBodyInFront(clientX, clientY, radiusPx, intersects) {
    if (viewMode === 'sizeCompare') return null;
    const hitDistance = intersects.length ? intersects[0].distance : Infinity;
    const candidates = new Map();
    celestialBodies.forEach((body, name) => {
        if (body.type !== 'satellite' && body.type !== 'smallbody') return;
        body.mesh.getWorldPosition(_tinyPickPos);
        if (camera.position.distanceTo(_tinyPickPos) < hitDistance) candidates.set(name, body);
    });
    return candidates.size ? findNearestBodyOnScreen(clientX, clientY, candidates, radiusPx) : null;
}

function getBodyNameFromIntersection(intersection) {
    let current = intersection && intersection.object;
    while (current) {
        if (current.userData && current.userData.name) {
            return current.userData.name;
        }
        current = current.parent;
    }
    return null;
}

function isCoarsePointerEvent(event) {
    return COARSE_POINTER_MQ.matches
        || event.pointerType === 'touch'
        || event.pointerType === 'pen';
}

function onClick(event) {

    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Get all visible meshes
    const visibleMeshes = [];
    
    if (viewMode === 'sizeCompare') {
        // In size comparison mode, only check size comparison objects
        sizeComparisonObjects.forEach(body => {
            if (body.mesh.visible) {
                visibleMeshes.push(body.mesh);
            }
        });
    } else {
        // In map mode, check celestial bodies
        celestialBodies.forEach(body => {
            if (body.mesh.visible) {
                visibleMeshes.push(body.mesh);
            }
        });
    }

    const intersects = raycaster.intersectObjects(visibleMeshes, true);

    // Easter egg: clicking the cheese wedge on the Moon's south pole
    if (intersects[0]?.object.userData.isCheeseWedge && cheeseMoon) {
        cheeseMoon.trigger(simDate);
        startCheeseTour();
        return;
    }

    let bodyName = findTinyBodyInFront(event.clientX, event.clientY,
        isCoarsePointerEvent(event) ? TOUCH_BODY_HIT_RADIUS_PX : MOUSE_BODY_HIT_RADIUS_PX, intersects)
        || (intersects.length > 0 ? getBodyNameFromIntersection(intersects[0]) : null);

    // Geometry can be sub-pixel at stellar distances. Use a screen-space target
    // as a fallback for every pointer, with a finger-sized radius on touch.
    if (!bodyName) {
        const bodies = viewMode === 'sizeCompare' ? sizeComparisonObjects : celestialBodies;
        const hitRadius = isCoarsePointerEvent(event)
            ? TOUCH_BODY_HIT_RADIUS_PX
            : MOUSE_BODY_HIT_RADIUS_PX;
        bodyName = findNearestBodyOnScreen(
            event.clientX,
            event.clientY,
            bodies,
            hitRadius
        );
    }

    if (bodyName) {
        if (viewMode === 'sizeCompare') {
            focusOnSizeComparisonObject(bodyName);
        } else if (bodyName === 'Earth' && intersects.length > 0 && (isEarthLargeOnScreen()
            || celestialBodies.get(currentFocusedBody)?.type === 'satellite')) {
            // Zoomed in on Earth: fly down to the spot that was clicked
            const spot = earthSpotUnderPointer(event.clientX, event.clientY);
            if (spot) flyToEarthSpot(spot); else focusOnBody(bodyName);
        } else {
            focusOnBody(bodyName);
        }
        return;
    }

    // Only check for orbit line clicks (focus on the body) as a fallback if no actual body mesh was clicked
    if (viewMode !== 'sizeCompare') {
        const hitTargets = showOrbitLines ? Array.from(orbitLines.values()).map(obj => obj.hitTarget) : [];
        const orbitIntersects = raycaster.intersectObjects(hitTargets);
        if (orbitIntersects.length > 0) {
            const hitTarget = orbitIntersects[0].object;
            const planetName = hitTarget.userData.planetName;
            focusOnBody(planetName);
            return;
        }
    }
}

function showBodyInfo(data) {
    // If the data object is missing rich properties (e.g. if it came from sizeComparison mode),
    // try to find the full data object from the main datasets and merge them.
    if (!data.mass || !data.distance) {
        let fullData = null;
        
        // Helper to recursively search through an object and its children
        const findInChildren = (obj, targetName) => {
            if (obj.name === targetName) return obj;
            if (obj.children) {
                for (let child of obj.children) {
                    let result = findInChildren(child, targetName);
                    if (result) return result;
                }
            }
            return null;
        };

        // Try searching in nearbyStars array
        if (!fullData && nearbyStars) {
            for (let starSys of nearbyStars) {
                fullData = findInChildren(starSys, data.name);
                if (fullData) break;
            }
        }
        
        // Try searching in solarSystem tree
        if (!fullData && solarSystem) {
            fullData = findInChildren(solarSystem, data.name);
        }
        
        if (fullData) {
            // Merge backwards so missing properties like mass/distance fill in, but current UI 
            // properties on 'data' don't get overwritten unexpectedly
            data = Object.assign({}, fullData, data);
        }
    }

    const exoplanetHostName = data.hostName
        || mappedExoplanetHostsByName.get(data.name);
    const exoplanetHostData = exoplanetHostName
        ? nearbyStars.find(host => host.name === exoplanetHostName)
        : null;

    const panel = document.getElementById('body-info');
    const nameEl = document.getElementById('body-name');
    const detailsEl = document.getElementById('body-details');

    nameEl.textContent = data.name;
    
    const subtitleEl = document.getElementById('body-size-subtitle');
    if (subtitleEl) {
        let sizeText = '';
        if (data.radius) {
            sizeText = data.radius > 100000 
                ? `${(data.radius / 696340).toFixed(2)} R☉`
                : `${data.radius.toLocaleString()} km`;
        }
        subtitleEl.textContent = sizeText ? `(${sizeText})` : '';
    }
    
    let html = '';
    if (data.type) {
        let displayType = capitalize(data.type);
        if (data.subtype) {
            displayType += ` (${capitalize(data.subtype)})`;
        }
        html += `<div class="detail-row"><span class="detail-label">Type:</span><span class="detail-value">${displayType}</span></div>`;
    }
    if (data.spectralClass) {
        html += `<div class="detail-row"><span class="detail-label">Spectral Class:</span><span class="detail-value">${data.spectralClass}</span></div>`;
    }
    if (data.radius) {
        const radiusText = data.radius > 100000 
            ? `${(data.radius / 696340).toFixed(2)} Solar radii`
            : `${data.radius.toLocaleString()} km`;
        html += `<div class="detail-row"><span class="detail-label">Radius:</span><span class="detail-value">${radiusText}</span></div>`;
    }
    if (data.temperature) {
        // Change label based on content if it's describing the object state rather than an actual temperature
        const isDescription = data.temperature.includes('quasar') || data.temperature.includes('Quasar') || 
                              data.temperature.includes('horizon') || data.temperature.includes('binary') ||
                              data.temperature.includes('Remnant');
        
        const label = isDescription ? "Status:" : "Temperature:";
        html += `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${data.temperature}</span></div>`;
    }
    if (data.mass) {
        html += `<div class="detail-row"><span class="detail-label">Mass:</span><span class="detail-value">${data.mass}</span></div>`;
    }
    if (data.orbitalPeriod) {
        html += `<div class="detail-row"><span class="detail-label">Orbital Period:</span><span class="detail-value">${data.orbitalPeriod.toLocaleString()} days</span></div>`;
    }
    if (data.distance && exoplanetHostData) {
        const distanceFromEarth = formatDistance(exoplanetHostData.distance, false);
        const orbitalDistanceAu = data.distance / AU_IN_KM;
        const orbitalDistance = `${orbitalDistanceAu.toFixed(
            orbitalDistanceAu < 1 ? 4 : 2
        )} AU (${formatDistance(data.distance, true)})`;
        html += `<div class="detail-row"><span class="detail-label">Distance from Earth:</span><span class="detail-value">${distanceFromEarth}</span></div>`;
        html += `<div class="detail-row"><span class="detail-label">Orbital distance:</span><span class="detail-value">${orbitalDistance}</span></div>`;
    } else if (data.distance) {
        const actualDist = getCurrentDistanceToEarth(data);
        const isSolarSys = !['star', 'blackhole', 'galaxy', 'nebula', 'cluster'].includes(data.type);
        const distText = formatDistance(actualDist, isSolarSys);
        html += `<div class="detail-row"><span class="detail-label">Distance:</span><span class="detail-value">${distText}</span></div>`;
    }
    if (data.description) {
        html += `<div class="detail-row detail-block" style="flex-direction:column;gap:5px;margin-top:10px;"><span class="detail-label">Description:</span><span style="color:#ccc;font-size:0.85rem;line-height:1.4;">${data.description}</span></div>`;
    }

    // Add educational facts block
    let hasFacts = false;
    let factsHtml = `<div class="detail-row detail-block" style="flex-direction:column;gap:5px;margin-top:15px;border-top:1px solid rgba(74,158,255,0.3);padding-top:15px;">
                        <span class="detail-label" style="color:#FFAA33;margin-bottom:5px;">Fun Facts:</span>`;
                        
    // 1. Rotation period formatting (length of day)
    if (data.rotationPeriod) {
        hasFacts = true;
        const hours = data.rotationPeriod;
        let dayText = `${hours.toLocaleString()} hours`;
        if (hours > 48) {
            dayText += ` (${(hours / 24).toFixed(1)} Earth days)`;
        } else if (hours < 1) {
            dayText += ` (${(hours * 60).toFixed(0)} minutes)`;
        }
        factsHtml += `<div style="font-size:0.8rem;color:#ccc;line-height:1.3;margin-bottom:4px;">• <b>Length of Day:</b> A single rotation takes ${dayText}.</div>`;
    }

    // 2. Volume/Scale compared to Earth
    if (data.radius && data.name !== 'Earth' && !['system', 'galaxy', 'nebula', 'cluster', 'blackhole'].includes(data.type)) {
        const earthRadii = data.radius / 6371;
        const earthVol = Math.pow(earthRadii, 3);
        if (earthVol > 1.5) {
            hasFacts = true;
            factsHtml += `<div style="font-size:0.8rem;color:#ccc;line-height:1.3;margin-bottom:4px;">• <b>Volume:</b> You could fit approx <b>${Math.floor(earthVol).toLocaleString()}</b> Earths inside ${data.name}.</div>`;
        } else if (earthVol < 0.8 && earthVol > 0.001) {
            hasFacts = true;
            factsHtml += `<div style="font-size:0.8rem;color:#ccc;line-height:1.3;margin-bottom:4px;">• <b>Volume:</b> ${data.name} is about <b>${(1/earthVol).toFixed(0)}</b> times smaller than Earth's volume.</div>`;
        }
    }
    
    // 3. Mass
    if (data.mass && data.name !== 'Earth') {
        let earthMasses = null;
        let massStr = typeof data.mass === 'string' ? data.mass : '';
        
        let multiplier = 1;
        if (massStr.includes('10⁶')) multiplier = 1000000;
        else if (massStr.includes('10⁹')) multiplier = 1000000000;
        else if (massStr.includes('10^23')) multiplier = 100000000000000000000000;
        else if (massStr.includes('10^24')) multiplier = 1000000000000000000000000;
        else if (massStr.includes('10^25')) multiplier = 10000000000000000000000000;
        else if (massStr.includes('10^26')) multiplier = 100000000000000000000000000;
        else if (massStr.includes('10^27')) multiplier = 1000000000000000000000000000;
        
        // First number (the low end of a range like "7-10"; stripping the
        // hyphen read that as 710)
        let match = massStr.replace(/[~≈]/g, '').trim().match(/^([0-9.]+)/);
        
        if (match) {
            let val = parseFloat(match[1]);
            if (massStr.includes('Solar masses')) {
                earthMasses = val * multiplier * 333000; // 1 Solar mass = ~333,000 Earths
            } else if (massStr.includes('10³⁰ kg')) {
                earthMasses = (val * multiplier * Math.pow(10, 30)) / (5.97 * Math.pow(10, 24));
            } else if (massStr.includes('kg') && massStr.includes('10^')) {
               // Normal scientific notation mass, e.g. "1.898 x 10^27 kg"
               earthMasses = (val * multiplier) / (5.97 * Math.pow(10, 24));
            }
        }
        
        if (earthMasses && earthMasses > 1.5) {
            hasFacts = true;
            let formattedMass = "";
            if (earthMasses >= 1000000000) {
                formattedMass = (earthMasses / 1000000000).toFixed(1) + " billion";
            } else if (earthMasses >= 1000000) {
                formattedMass = (earthMasses / 1000000).toFixed(1) + " million";
            } else {
                formattedMass = Math.floor(earthMasses).toLocaleString();
            }
            factsHtml += `<div style="font-size:0.8rem;color:#ccc;line-height:1.3;margin-bottom:4px;">• <b>Mass:</b> It has roughly <b>${formattedMass}</b> times the mass of Earth.</div>`;
        }
    }
    
    // 4. Travel times
    if (data.distance && data.name !== 'Sun' && data.name !== 'Solar System') {
        hasFacts = true;
        const actualDist = exoplanetHostData
            ? exoplanetHostData.distance
            : getCurrentDistanceToEarth(data);
        // Light travel time
        const lightSeconds = actualDist / 299792.458;
        let timeText = "";
        if (lightSeconds < 60) {
            timeText = `${Math.max(0.1, lightSeconds).toFixed(1)} seconds`;
        } else if (lightSeconds < 3600) {
            timeText = `${(lightSeconds / 60).toFixed(1)} minutes`;
        } else if (lightSeconds < 86400) {
            timeText = `${(lightSeconds / 3600).toFixed(1)} hours`;
        } else if (lightSeconds < 31536000) {
            timeText = `${(lightSeconds / 86400).toFixed(1)} days`;
        } else {
            timeText = `${(lightSeconds / 31536000).toFixed(2)} years`;
        }
        
        let originText;
        if (exoplanetHostData
            || data.type === 'star'
            || data.type === 'galaxy'
            || data.type === 'nebula'
            || data.type === 'cluster'
            || data.type === 'blackhole') {
            originText = "Earth";
        } else if (data.type === 'moon') {
            originText = "its host planet";
        } else {
            originText = "the Sun";
        }
        factsHtml += `<div style="font-size:0.8rem;color:#ccc;line-height:1.3;margin-bottom:4px;">• <b>Light Speed:</b> Light from ${originText} takes <b>${timeText}</b> to reach it.</div>`;
        
        // Passenger jet time (only if we're dealing with distances within the galaxy and not totally incomprehensible scales, limit to < 1000 LY to avoid giant numbers)
        const lightYears = lightSeconds / 31536000;
        if (lightYears < 100) {
            const jetSpeed = 900; // km/h
            const jetHours = actualDist / jetSpeed;
            if (jetHours > 1) {
                let flyingText = "";
                if (jetHours < 24) flyingText = `${jetHours.toFixed(1)} hours`;
                else if (jetHours < 24 * 365) flyingText = `${(jetHours / 24).toLocaleString(undefined, {maximumFractionDigits:0})} days`;
                else flyingText = `${(jetHours / (24 * 365)).toLocaleString(undefined, {maximumFractionDigits: 0})} years`;
                
                factsHtml += `<div style="font-size:0.8rem;color:#ccc;line-height:1.3;margin-bottom:4px;">• <b>Road Trip:</b> A commercial jet (900 km/h) would take <b>${flyingText}</b> to fly there.</div>`;
            }
        }
    }
    
    factsHtml += `</div>`;
    
    if (hasFacts) {
        html += factsHtml;
    }
    
    // Add scale comparison visualization
    if (data.radius) {
        html += createScaleComparison(data);
    }

    detailsEl.innerHTML = html;
    panel.classList.remove('hidden');
    peekBodyInfo();
    
    // If there's a scale comparison canvas, draw it
    const scaleCanvas = document.getElementById('scale-comparison');
    if (scaleCanvas && data.radius) {
        drawScaleComparison(scaleCanvas, data);
    }
}

function hideBodyInfo() {
    clearTimeout(infoTuckTimer);
    document.getElementById('body-info').classList.add('hidden');
}

// Desktop: the info panel slides in when something is selected, then tucks
// away to a tab at the right edge after INFO_PEEK_MS. Hovering keeps it open
// (or pulls it back out, even mid-slide); leaving tucks it again after the
// same delay; clicking the tab opens it. Phones keep their own bottom card.
const INFO_PEEK_MS = 2000;
let infoTuckTimer = null;

// The tab (::before) lives in the panel's scroll area, so tuck from the top
function tuckBodyInfo(panel) {
    panel.scrollTop = 0;
    panel.classList.add('tucked');
}

function peekBodyInfo() {
    const panel = document.getElementById('body-info');
    clearTimeout(infoTuckTimer);
    panel.classList.remove('tucked');
    if (isMobileLayout()) return;
    if (!panel.matches(':hover')) infoTuckTimer = setTimeout(() => tuckBodyInfo(panel), INFO_PEEK_MS);
}

function setupBodyInfoPeek() {
    const panel = document.getElementById('body-info');
    if (!panel) return;
    panel.addEventListener('mouseenter', () => {
        clearTimeout(infoTuckTimer);
        panel.classList.remove('tucked');
    });
    panel.addEventListener('mouseleave', () => {
        if (panel.classList.contains('hidden') || isMobileLayout()) return;
        clearTimeout(infoTuckTimer);
        infoTuckTimer = setTimeout(() => tuckBodyInfo(panel), INFO_PEEK_MS);
    });
    // Touch screens/pens have no hover: tapping the tab opens it
    panel.addEventListener('click', (e) => {
        if (!panel.classList.contains('tucked')) return;
        e.stopPropagation();
        peekBodyInfo();
    });
}

// Object list drawer (desktop): hovering the tab slides it out without a
// click and it slides away SIDEBAR_PEEK_MS after the mouse leaves; clicking
// the tab pins it open or shut. Touch/pen (no hover) just toggle on tap.
const SIDEBAR_PEEK_MS = 2000;
const sidebarPeek = { state: 'closed', timer: null }; // 'closed' | 'peek' | 'pinned'

function scheduleSidebarTuck() {
    const sidebar = document.getElementById('sidebar');
    clearTimeout(sidebarPeek.timer);
    sidebarPeek.timer = setTimeout(() => {
        if (sidebarPeek.state !== 'peek' || sidebar.matches(':hover')) return;
        sidebar.classList.add('collapsed');
        sidebarPeek.state = 'closed';
    }, SIDEBAR_PEEK_MS);
}

function setupSidebarPeek() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    if (!sidebar || !toggle) return;
    toggle.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse' || isMobileLayout() || sidebarPeek.state !== 'closed') return;
        sidebar.classList.remove('collapsed');
        sidebarPeek.state = 'peek';
    });
    sidebar.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') clearTimeout(sidebarPeek.timer);
    });
    sidebar.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse' && sidebarPeek.state === 'peek') scheduleSidebarTuck();
    });
    toggle.addEventListener('click', () => {
        clearTimeout(sidebarPeek.timer);
        // Opened by hovering → a click keeps it open; otherwise flip it
        if (sidebarPeek.state === 'peek') {
            sidebarPeek.state = 'pinned';
            return;
        }
        const open = sidebar.classList.toggle('collapsed') === false;
        sidebarPeek.state = open ? 'pinned' : 'closed';
    });
}

function createGuideLineCanvas() {
    guideLineCanvas = document.createElement('canvas');
    guideLineCanvas.id = 'guide-line-canvas';
    guideLineCanvas.style.position = 'fixed';
    guideLineCanvas.style.top = '0';
    guideLineCanvas.style.left = '0';
    guideLineCanvas.style.width = '100%';
    guideLineCanvas.style.height = '100%';
    guideLineCanvas.style.pointerEvents = 'none';
    guideLineCanvas.style.zIndex = '1000';
    document.body.appendChild(guideLineCanvas);
    guideLineCtx = guideLineCanvas.getContext('2d');
    resizeGuideLineCanvas();
    window.addEventListener('resize', resizeGuideLineCanvas);
}

function resizeGuideLineCanvas() {
    if (guideLineCanvas) {
        guideLineCanvas.width = window.innerWidth;
        guideLineCanvas.height = window.innerHeight;
    }
}

function drawGuideLine() {
    if (!guideLineCtx || !guideLineCanvas || !hoveredObjectName) {
        if (guideLineCtx) guideLineCtx.clearRect(0, 0, guideLineCanvas.width, guideLineCanvas.height);
        return;
    }
    
    const body = celestialBodies.get(hoveredObjectName);
    if (!body || !body.mesh) {
        guideLineCtx.clearRect(0, 0, guideLineCanvas.width, guideLineCanvas.height);
        return;
    }
    
    // Get the sidebar item position
    const sidebarItem = document.querySelector(`[data-name="${hoveredObjectName}"]`);
    if (!sidebarItem) {
        guideLineCtx.clearRect(0, 0, guideLineCanvas.width, guideLineCanvas.height);
        return;
    }
    
    const itemRect = sidebarItem.getBoundingClientRect();
    const startX = itemRect.right;
    const startY = itemRect.top + itemRect.height / 2;
    
    // Get the object's 3D position in screen space
    const worldPosition = new THREE.Vector3();
    body.mesh.getWorldPosition(worldPosition);
    worldPosition.project(camera);
    
    // Check if object is behind the camera
    if (worldPosition.z > 1) {
        guideLineCtx.clearRect(0, 0, guideLineCanvas.width, guideLineCanvas.height);
        return;
    }
    
    const endX = (worldPosition.x * 0.5 + 0.5) * window.innerWidth;
    const endY = (-worldPosition.y * 0.5 + 0.5) * window.innerHeight;
    
    // Clear canvas
    guideLineCtx.clearRect(0, 0, guideLineCanvas.width, guideLineCanvas.height);
    
    // Draw dashed animated line
    guideLineCtx.save();
    guideLineCtx.strokeStyle = '#4a9eff';
    guideLineCtx.lineWidth = 2;
    guideLineCtx.setLineDash([10, 5]);
    guideLineCtx.lineDashOffset = -(Date.now() / 20) % 15; // Animate the dash
    
    // Draw curved line with horizontal start
    guideLineCtx.beginPath();
    guideLineCtx.moveTo(startX, startY);
    
    const midX = (startX + endX) / 2;
    
    // First segment: straight out horizontally
    const straightDistance = 50; // Length of straight segment
    const firstPointX = startX + straightDistance;
    
    guideLineCtx.lineTo(firstPointX, startY);
    
    // Second segment: curve to target
    // Use two control points for smooth bezier curve from horizontal start
    const cp1x = firstPointX + (endX - firstPointX) * 0.5;
    const cp1y = startY;
    const cp2x = firstPointX + (endX - firstPointX) * 0.5;
    const cp2y = endY;
    
    guideLineCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
    guideLineCtx.stroke();
    
    // Draw arrow at the end
    // Calculate angle at the end of the bezier curve
    // Derivative of bezier at t=1
    // B'(t) = 3(1-t)^2(P1-P0) + 6(1-t)t(P2-P1) + 3t^2(P3-P2)
    // At t=1: 3(P3-P2)
    // P2 is cp2, P3 is end point
    const dx = endX - cp2x;
    const dy = endY - cp2y;
    const angle = Math.atan2(dy, dx);
    const arrowLength = 15;
    const arrowAngle = Math.PI / 6;
    
    guideLineCtx.setLineDash([]);
    guideLineCtx.beginPath();
    guideLineCtx.moveTo(endX, endY);
    guideLineCtx.lineTo(
        endX - arrowLength * Math.cos(angle - arrowAngle),
        endY - arrowLength * Math.sin(angle - arrowAngle)
    );
    guideLineCtx.moveTo(endX, endY);
    guideLineCtx.lineTo(
        endX - arrowLength * Math.cos(angle + arrowAngle),
        endY - arrowLength * Math.sin(angle + arrowAngle)
    );
    guideLineCtx.stroke();
    
    // Draw pulsing circle at object location
    const pulse = (Math.sin(Date.now() / 200) + 1) / 2; // 0 to 1
    guideLineCtx.beginPath();
    guideLineCtx.arc(endX, endY, 8 + pulse * 4, 0, Math.PI * 2);
    guideLineCtx.fillStyle = `rgba(74, 158, 255, ${0.5 + pulse * 0.3})`;
    guideLineCtx.fill();
    
    guideLineCtx.restore();
}

function createScaleComparison(data) {
    const sunRadius = 696340; // km
    const betelgeuseRadius = 617100000; // km ~887 solar radii
    const stephensonRadius = 1497131000; // km
    
    const objectRadius = data.radius;
    const maxRadius = 200 * 0.4; // canvas width * 0.4
    
    let compareName = "Sun";
    let compareColor = "FFDD44";
    
    // Check if Sun would be smaller than 1.5 pixels (Rigel forces scale up)
    // scale = maxRadius / objectRadius
    // sunVisualRadius = sunRadius * scale
    // If sunVisualRadius < 1.5, use Betelgeuse
    if (sunRadius * (maxRadius / objectRadius) < 1.5) {
        compareName = "Betelgeuse";
        compareColor = "FF6633"; // Red supergiant color
        
        // Check if Betelgeuse would be smaller than 1 pixel
        if (betelgeuseRadius * (maxRadius / objectRadius) < 1) {
            compareName = "Stephenson 2-18";
            compareColor = "FF3311";
        }
    }

    return `
        <div class="detail-row detail-block" style="flex-direction:column;gap:10px;margin-top:15px;border-top:1px solid rgba(74,158,255,0.3);padding-top:15px;">
            <span class="detail-label">Scale Comparison (vs ${compareName}):</span>
            <canvas id="scale-comparison" width="200" height="200" style="background:rgba(0,0,0,0.5);border-radius:8px;border:1px solid rgba(74,158,255,0.3);"></canvas>
            <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:#88aaff;">
                <span><span style="color:#${compareColor};">●</span> ${compareName}</span>
                <span><span style="color:#${data.color.toString(16).padStart(6,'0')};">●</span> ${data.name}</span>
            </div>
        </div>
    `;
}

function drawScaleComparison(canvas, data) {
    const ctx = canvas.getContext('2d');
    const sunRadius = 696340; // km
    const betelgeuseRadius = 617100000; // km
    const stephensonRadius = 1497131000; // km
    
    const objectRadius = data.radius;
    const maxRadius = canvas.width * 0.4;
    
    let compareRadius = sunRadius;
    let compareName = "Sun";
    let compareColor = "FFDD44";
    
    if (sunRadius * (maxRadius / objectRadius) < 1.5) {
        compareRadius = betelgeuseRadius;
        compareName = "Betelgeuse";
        compareColor = "FF6633";
        
        if (betelgeuseRadius * (maxRadius / objectRadius) < 1) {
            compareRadius = stephensonRadius;
            compareName = "Stephenson 2-18";
            compareColor = "FF3311";
        }
    }
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Determine which is larger
    const isObjectLarger = objectRadius > compareRadius;
    const largerRadius = Math.max(objectRadius, compareRadius);
    const smallerRadius = Math.min(objectRadius, compareRadius);
    
    // Scale factor to fit the larger object
    const scale = maxRadius / largerRadius;
    
    // Draw the larger object first (fills the space)
    const largerVisualRadius = largerRadius * scale;
    const smallerVisualRadius = Math.max(smallerRadius * scale, 2); // Min 2px visibility
    
    if (isObjectLarger) {
        // Object is larger, draw it filling the space
        ctx.beginPath();
        ctx.arc(centerX, centerY, largerVisualRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#' + data.color.toString(16).padStart(6, '0');
        ctx.fill();
        
        // Draw comparison object as small overlay
        if (smallerVisualRadius >= 2) {
            ctx.beginPath();
            ctx.arc(centerX - largerVisualRadius * 0.3, centerY - largerVisualRadius * 0.3, smallerVisualRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#' + compareColor;
            ctx.fill();
        } else {
            // Comparison object is tiny, draw as a bright pixel
            ctx.fillStyle = '#' + compareColor;
            ctx.fillRect(centerX - largerVisualRadius * 0.3 - 1, centerY - largerVisualRadius * 0.3 - 1, 3, 3);
        }
    } else {
        // Comparison object is larger, draw it filling the space
        ctx.beginPath();
        ctx.arc(centerX, centerY, largerVisualRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#' + compareColor;
        ctx.fill();
        
        // Add glow effect for comparison object
        const gradient = ctx.createRadialGradient(centerX, centerY, largerVisualRadius * 0.8, centerX, centerY, largerVisualRadius);
        gradient.addColorStop(0, '#' + compareColor);
        // Convert hex to rgba for gradient
        const r = parseInt(compareColor.substring(0,2), 16);
        const g = parseInt(compareColor.substring(2,4), 16);
        const b = parseInt(compareColor.substring(4,6), 16);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.3)`);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Draw object as overlay
        ctx.beginPath();
        ctx.arc(centerX + largerVisualRadius * 0.3, centerY - largerVisualRadius * 0.3, smallerVisualRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#' + data.color.toString(16).padStart(6, '0');
        ctx.fill();
    }
    
    // Add size ratio text with black outline for visibility
    const ratio = (objectRadius / compareRadius).toFixed(2);
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const text = `${ratio}x ${compareName}`;
    const textY = canvas.height - 15;
    
    // Draw black outline/stroke
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, centerX, textY);
    
    // Draw white fill
    ctx.fillStyle = '#fff';
    ctx.fillText(text, centerX, textY);
}

function formatScaleValue(val) {
    if (val >= 100) return Math.round(val).toLocaleString();
    if (val >= 10) return val.toFixed(1);
    return val.toFixed(2);
}

function updateUI() {
    // Handle size comparison mode display
    if (viewMode === 'sizeCompare') {
        document.getElementById('zoom-level').textContent = 'Size Comparison';
        document.getElementById('scale-indicator').style.display = 'none';
        return;
    } else {
        document.getElementById('scale-indicator').style.display = 'block';
    }
    
    const zoomData = ZOOM_LEVELS[currentZoomLevel];
    document.getElementById('zoom-level').textContent = zoomData.name;
    
    // Dynamic scale calculation based on camera distance
    // Calculate world width visible at target distance
    const dist = camera.position.distanceTo(controls.target);
    const vFOV = camera.fov * Math.PI / 180;
    const height = 2 * Math.tan(vFOV / 2) * dist;
    const aspect = window.innerWidth / window.innerHeight;
    const width = height * aspect;
    
    // Scale bar is 100px wide
    const scaleBarWidthWorld = (width * 100) / window.innerWidth;
    
    // Live scale (continuous Scale slider): AU and light-year sizes in units
    let label;
    if (dist > currentUnitsPerAU * 100) { // deep space (beyond ~100 AU); Solar System views stay in AU
        // Pulled-in star distances are logarithmic: no single light-year scale
        label = starsPulledInNow ? 'Not to scale' : formatScaleValue(scaleBarWidthWorld / currentStarUnitsPerLy) + " Light Years";
    } else {
        const au = scaleBarWidthWorld / currentUnitsPerAU;
        if (au < 0.1) {
            const km = au * 149597870;
            label = km > 1000000 ? formatScaleValue(km / 1000000) + " Million km" : formatScaleValue(km) + " km";
        } else {
            label = formatScaleValue(au) + " AU";
        }
    }

    document.getElementById('scale-label').textContent = label;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function onMouseDown(event) {
    activeTapPointerId = null;
    if (event.target.closest('#ui-container') || event.isPrimary === false) return;

    activeTapPointerId = event.pointerId;
    mouseDownPos.x = event.clientX;
    mouseDownPos.y = event.clientY;
    isDragging = false;

    // Detect panning intent: Shift (Left), Middle Button, or Right Button
    // Note: We include Right Button (button 2) as it is configured for Panning in init()
    // We must release the focus to allow panning, otherwise animate() will tick the target back to the body
    const isPanning = event.shiftKey || event.button === 1 || event.button === 2;

    // Following a satellite (the ISS): a pan just shifts the view and stays
    // locked on (see satPan); unfollowing would leave it behind in a second
    const focused = currentFocusedBody && celestialBodies.get(currentFocusedBody);
    if (isPanning && viewMode === 'map' && focused?.type === 'satellite') return;

    if (isPanning && (isCameraLocked || currentFocusedBody)) {
        if (isCameraLocked) {
            isCameraLocked = false;
            cameraAngleLock = false;
            document.getElementById('camera-lock-mode').textContent = 'Off';
        }
        // Always clear the focused body when panning to prevent the update loop from fighting the controls
        currentFocusedBody = null;
    }
}

function onMouseUp(event) {
    if (event.pointerId !== activeTapPointerId) return;
    activeTapPointerId = null;
    if (event.target.closest('#ui-container')) return;
    
    const dx = event.clientX - mouseDownPos.x;
    const dy = event.clientY - mouseDownPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Allow normal finger jitter without turning deliberate drags into taps.
    const tapTolerance = isCoarsePointerEvent(event) ? TOUCH_TAP_MOVE_TOLERANCE_PX : 5;
    if (distance < tapTolerance) {
        onClick(event);
    }
}

function onPointerCancel(event) {
    if (event.pointerId === activeTapPointerId) {
        activeTapPointerId = null;
    }
}

let lastMouseX = -1;
let lastMouseY = -1;
let isMouseOverUI = false;

function updateHoverState(clientX, clientY) {
    if (customOrbitDrag) return;
    // If the mouse is currently over a UI element, don't show object tooltips
    if (isMouseOverUI) {
        if (hoveredBody || hoveredOrbit || hoveredConstellation) {
            hoveredBody = null;
            hoveredOrbit = null;
            hoveredConstellation = null;
            orbitLines.forEach(obj => {
                obj.visible.material.opacity = 0.2;
            });
            hideTooltip();
        }
        return;
    }

    // Update mouse coordinates
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Get all visible meshes
    const visibleMeshes = [];
    
    if (viewMode === 'sizeCompare') {
        // In size comparison mode, only check size comparison objects
        sizeComparisonObjects.forEach(body => {
            if (body.mesh.visible) {
                visibleMeshes.push(body.mesh);
            }
        });
    } else {
        // In map mode, check celestial bodies
        celestialBodies.forEach(body => {
            if (body.mesh.visible) {
                visibleMeshes.push(body.mesh);
            }
        });
    }

    const intersects = raycaster.intersectObjects(visibleMeshes, true);
    const bodies = viewMode === 'sizeCompare' ? sizeComparisonObjects : celestialBodies;
    const exactBodyName = findTinyBodyInFront(clientX, clientY, MOUSE_BODY_HIT_RADIUS_PX, intersects)
        || (intersects.length > 0 ? getBodyNameFromIntersection(intersects[0]) : null);
    const nearbyBodyName = exactBodyName || findNearestBodyOnScreen(
        clientX,
        clientY,
        bodies,
        MOUSE_BODY_HIT_RADIUS_PX
    );
    
    // Also check for orbit line intersections (using hit targets)
    const hitTargets = showOrbitLines ? Array.from(orbitLines.values()).map(obj => obj.hitTarget) : [];
    const orbitIntersects = raycaster.intersectObjects(hitTargets);

    // Check for constellation label intersections
    let constellationIntersects = [];
    if (showConstellations && constellationsGroup && constellationsGroup.visible) {
        constellationIntersects = raycaster.intersectObjects(constellationSprites);
    }

    if (nearbyBodyName) {
        const body = viewMode === 'sizeCompare'
            ? sizeComparisonObjects.get(nearbyBodyName)
            : celestialBodies.get(nearbyBodyName);
        if (body && body !== hoveredBody) {
            hoveredBody = body;
            hoveredOrbit = null;
            hoveredConstellation = null;
            showTooltip(body.data, clientX, clientY);
        } else if (body) {
            updateTooltipPosition(clientX, clientY);
        }
    } else if (orbitIntersects.length > 0 && viewMode !== 'sizeCompare') {
        // Hovering over an orbit line (only in map mode)
        const orbitLine = orbitIntersects[0].object;
        const planetName = orbitLine.userData.planetName;
        
        if (hoveredOrbit !== orbitLine) {
            hoveredOrbit = orbitLine;
            hoveredBody = null;
            hoveredConstellation = null;
            // Highlight the orbit line
            orbitLines.forEach(obj => {
                obj.visible.material.opacity = 0.2;
            });
            const orbitObj = orbitLines.get(planetName);
            if (orbitObj) {
                orbitObj.visible.material.opacity = 0.6;
            }
            showOrbitTooltip(planetName, clientX, clientY);
        } else {
            updateTooltipPosition(clientX, clientY);
        }
    } else if (constellationIntersects.length > 0) {
        // Hovering over a constellation label
        const hitSprite = constellationIntersects[0].object;
        const constName = hitSprite.userData.name;
        const constId = hitSprite.userData.id;
        
        if (hoveredConstellation !== hitSprite) {
            hoveredConstellation = hitSprite;
            hoveredBody = null;
            hoveredOrbit = null;
            // Reset orbit line highlighting
            orbitLines.forEach(obj => {
                obj.visible.material.opacity = 0.2;
            });
            showConstellationTooltip(constName, constId, clientX, clientY);
        } else {
            updateTooltipPosition(clientX, clientY);
        }
    } else {
        if (hoveredBody || hoveredOrbit || hoveredConstellation) {
            hoveredBody = null;
            hoveredOrbit = null;
            hoveredConstellation = null;
            // Reset orbit line highlighting
            orbitLines.forEach(obj => {
                obj.visible.material.opacity = 0.2;
            });
            hideTooltip();
        }
    }
}

function onMouseMove(event) {
    // Track if mouse is moving (dragging)
    const dx = event.clientX - mouseDownPos.x;
    const dy = event.clientY - mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 3) {
        isDragging = true;
    }
    
    isMouseOverUI = !!event.target.closest('#ui-container');
    mouseButtonsHeld = event.buttons;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    hoverStateDirty = true;

    // Touch devices fire synthetic mousemove on tap; skip hover effects there
    // (tap-to-focus still works via the click path)
    if (HOVER_NONE_MQ.matches) return;
}

function showTooltip(data, x, y) {
    const tooltip = document.getElementById('hover-tooltip');
    const nameEl = document.getElementById('tooltip-name');
    const contentEl = document.getElementById('tooltip-content');

    nameEl.textContent = data.name;
    
    let html = '';
    if (data.type) {
        let displayType = capitalize(data.type);
        if (data.subtype) {
            displayType = capitalize(data.subtype);
        }
        html += `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-value">${displayType}</span></div>`;
    }
    if (data.radius) {
        const radiusText = data.radius > 100000 
            ? `${(data.radius / 696340).toFixed(2)} R☉`
            : `${data.radius.toLocaleString()} km`;
        html += `<div class="tooltip-row"><span class="tooltip-label">Radius:</span><span class="tooltip-value">${radiusText}</span></div>`;
    }
    if (data.mass) {
        html += `<div class="tooltip-row"><span class="tooltip-label">Mass:</span><span class="tooltip-value">${data.mass}</span></div>`;
    }
    if (data.distance && ['planet', 'moon', 'exoplanet'].includes(data.type)) {
        const actualDist = getCurrentDistanceToEarth(data);
        const distText = formatDistance(actualDist, true);
        html += `<div class="tooltip-row"><span class="tooltip-label">Distance:</span><span class="tooltip-value">${distText}</span></div>`;
    } else if (data.distance && data.distance < LY * 0.05) {
        // Comets, dwarf planets, spacecraft, the ISS: km / AU, not "0.00 ly"
        html += `<div class="tooltip-row"><span class="tooltip-label">Distance:</span><span class="tooltip-value">${formatDistance(data.distance, true)}</span></div>`;
    } else if (data.distance) {
        const ly = data.distance / LY;
        if (ly > 1000) {
            html += `<div class="tooltip-row"><span class="tooltip-label">Distance:</span><span class="tooltip-value">${(ly/1000).toFixed(2)}k ly</span></div>`;
        } else {
            html += `<div class="tooltip-row"><span class="tooltip-label">Distance:</span><span class="tooltip-value">${ly.toFixed(2)} ly</span></div>`;
        }
    }
    
    // Add light-travel time to tooltip for an educational flair
    if (data.distance && data.name !== 'Sun') {
        const actualDist = getCurrentDistanceToEarth(data);
        const lightSeconds = actualDist / 299792.458;
        let timeText = "";
        if (lightSeconds < 60) timeText = `${Math.max(0.1, lightSeconds).toFixed(1)}s`;
        else if (lightSeconds < 3600) timeText = `${(lightSeconds / 60).toFixed(1)}m`;
        else if (lightSeconds < 86400) timeText = `${(lightSeconds / 3600).toFixed(1)}h`;
        else if (lightSeconds < 31536000) timeText = `${(lightSeconds / 86400).toFixed(1)}d`;
        else timeText = `${(lightSeconds / 31536000).toFixed(1)}y`;
        
        html += `<div class="tooltip-row"><span class="tooltip-label" style="color:#FFAA33;">Light Time:</span><span class="tooltip-value" style="color:#FFAA33;">${timeText}</span></div>`;
    }
    
    // Count children/orbiting bodies
    const childCount = data.children ? data.children.length : 0;
    if (childCount > 0) {
        html += `<div class="tooltip-row"><span class="tooltip-label">Bodies:</span><span class="tooltip-value">${childCount}</span></div>`;
    }

    contentEl.innerHTML = html;
    
    // Position tooltip, forcing update because content size may have changed
    updateTooltipPosition(x, y, true);
    
    tooltip.classList.remove('hidden');
}

function showConstellationTooltip(constName, constId, x, y) {
    const tooltip = document.getElementById('hover-tooltip');
    const nameEl = document.getElementById('tooltip-name');
    const contentEl = document.getElementById('tooltip-content');

    nameEl.textContent = constName;
    
    // Get info from our database
    const info = CONSTELLATION_INFO[constId] || {
        meaning: "Celestial Constellation",
        brightestStar: "Varies",
        features: "Stargazing figure",
        desc: "One of the 88 official modern constellations designated by the International Astronomical Union (IAU)."
    };
    
    let html = '';
    html += `<div class="tooltip-row"><span class="tooltip-label">Latin Meaning:</span><span class="tooltip-value">${info.meaning}</span></div>`;
    html += `<div class="tooltip-row"><span class="tooltip-label">Brightest Star:</span><span class="tooltip-value">${info.brightestStar}</span></div>`;
    if (info.features) {
        html += `<div class="tooltip-row"><span class="tooltip-label">Key Features:</span><span class="tooltip-value">${info.features}</span></div>`;
    }
    html += `<div class="tooltip-row" style="flex-direction:column;gap:4px;margin-top:8px;align-items:flex-start;">`;
    html += `<span class="tooltip-label">About:</span>`;
    html += `<span style="color:#ccc;font-size:0.85rem;line-height:1.3;display:block;">${info.desc}</span>`;
    html += `</div>`;
    
    contentEl.innerHTML = html;
    
    // Position tooltip, forcing update because content size may have changed
    updateTooltipPosition(x, y, true);
    
    tooltip.classList.remove('hidden');
}

let lastTooltipX = -1;
let lastTooltipY = -1;

function updateTooltipPosition(x, y, forceUpdate = false) {
    if (!forceUpdate && lastTooltipX === x && lastTooltipY === y) {
        return; // Skip if position hasn't changed
    }
    lastTooltipX = x;
    lastTooltipY = y;

    const tooltip = document.getElementById('hover-tooltip');
    const offset = 15;
    
    let left = x + offset;
    let top = y + offset;
    
    // Keep tooltip within viewport
    const rect = tooltip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) {
        left = x - rect.width - offset;
    }
    if (top + rect.height > window.innerHeight) {
        top = y - rect.height - offset;
    }
    
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function hideTooltip() {
    const tooltip = document.getElementById('hover-tooltip');
    tooltip.classList.add('hidden');
}

function showOrbitTooltip(planetName, x, y) {
    const tooltip = document.getElementById('hover-tooltip');
    const nameEl = document.getElementById('tooltip-name');
    const contentEl = document.getElementById('tooltip-content');

    nameEl.textContent = `${planetName} Orbit`;
    contentEl.innerHTML = `<div class="tooltip-row"><span class="tooltip-label">Click to pan to ${planetName}</span></div>`;
    
    updateTooltipPosition(x, y, true);
    tooltip.classList.remove('hidden');
}

const _layoutVec = new THREE.Vector3();
let starLayoutInfo = null; // cached per star: { body, posLy, distLy, ext }
let starPairFloor = 0;
let sunExtent = null; // measured once, like the stars

// Largest extent of a star system's solid parts (star, corona, accretion disk,
// pulsar beams, exoplanets) — sprites/points/lines (glows, orbits) excluded
function starSystemExtent(body) {
    let ext = 0;
    body.mesh.updateMatrixWorld(true);
    const origin = body.mesh.getWorldPosition(new THREE.Vector3());
    body.mesh.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const bs = o.geometry.boundingSphere;
        const scale = o.getWorldScale(_layoutVec).x;
        const c = o.localToWorld(bs.center.clone()).sub(origin).length();
        ext = Math.max(ext, c + bs.radius * scale);
    });
    return ext || 10;
}

function getStarLayoutInfo() {
    if (starLayoutInfo) return starLayoutInfo;
    starLayoutInfo = [];
    nearbyStars.forEach(starData => {
        const body = celestialBodies.get(starData.name);
        if (!body || !body.isDistant) return;
        const p = calculateStarPosition(starData);
        const posLy = new THREE.Vector3(p.x, p.y, p.z);
        const distLy = posLy.length();
        const dir = distLy > 1e-9 ? posLy.clone().divideScalar(distLy) : new THREE.Vector3(1, 0, 0);
        starLayoutInfo.push({ body, posLy, distLy, dir, ext: starSystemExtent(body) });
    });
    // Binary companions share their primary's catalogue position, which drew
    // the smaller star inside the bigger one (hovering Procyon B showed
    // Procyon A). Set each one just beside its primary, sideways to the line
    // of sight so both are seen from home. Display only, in scene units
    starLayoutInfo.forEach((st, i) => {
        const primary = starLayoutInfo.slice(0, i).find(o => o.posLy.distanceToSquared(st.posLy) < 1e-8);
        if (!primary) return;
        const side = new THREE.Vector3(0, 1, 0).cross(st.dir);
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        st.companionOffset = side.normalize().multiplyScalar(1.3 * (primary.ext + st.ext));
    });
    // "Pull far objects in": logarithmic distances beyond the nearest star, so
    // every ×10 in true distance adds the same step (TON 618 at 18 billion ly
    // lands ~25× further than Proxima instead of ~4 billion×). Order and
    // direction are kept; nearer than the nearest star is unchanged.
    const d0 = Math.min(...starLayoutInfo.filter(st => st.distLy > 1e-6).map(st => st.distLy));
    starLayoutInfo.forEach(st => {
        st.logLy = st.distLy <= d0 ? st.distLy : d0 * (1 + Math.log(st.distLy / d0));
    });
    // Pairwise floor: two stars' systems plus a gap must fit between them
    for (let i = 0; i < starLayoutInfo.length; i++) {
        for (let j = i + 1; j < starLayoutInfo.length; j++) {
            const a2 = starLayoutInfo[i], b2 = starLayoutInfo[j];
            const d = a2.posLy.distanceTo(b2.posLy);
            if (d > 1e-6) starPairFloor = Math.max(starPairFloor, (a2.ext + b2.ext) * 1.2 / d);
        }
    }
    return starLayoutInfo;
}

// Target distances for a scale value. Each body glides geometrically between
// its no-clip layout at Max (sv 0) and its true layout at Realistic (sv 1), so
// everything starts and stops moving together (inner bodies just move less).
// Using "true distance × scale, clamped to a floor" directly left inner planets
// and moons parked on their floors for much of the slider while the outer
// system kept moving. Gaps between neighbours are log-concave along this path,
// so they're never smaller than at the two (clip-free) ends.
function computeScaleLayout(sv) {
    const a = computeRawScaleLayout(0, false), b = computeRawScaleLayout(1, false);
    const geo = (x, y) => x * Math.pow(y / x, sv);
    const layout = { k: geo(a.k, b.k), planets: new Map(), moons: new Map(), starU: geo(a.starU, b.starU),
        systemEdge: geo(a.systemEdge, b.systemEdge), starBlend: starPullAt(sv), sv };
    b.planets.forEach((r, n) => layout.planets.set(n, geo(a.planets.get(n) ?? r, r)));
    b.moons.forEach((r, n) => layout.moons.set(n, geo(a.moons.get(n) ?? r, r)));
    return layout;
}

// Layout from "true distance × scale" with no-clip floors; used for the two
// ends of the slider (see SCALE_PRESETS)
function computeRawScaleLayout(sv, pulled = false) {
    const lerpLog = ([lo, hi], t) => lo * Math.pow(hi / lo, t);
    const k = lerpLog(PLANET_UNITS_PER_AU, sv);
    const km = lerpLog(MOON_SCALE, sv);
    const layout = { k, planets: new Map(), moons: new Map(), starU: STAR_UNITS_PER_LY_REALISTIC };
    // Clear the Sun's whole visible body (corona included), not just its core
    const sun = celestialBodies.get('Sun');
    sunExtent ??= sun ? starSystemExtent(sun) : 14;

    let prevOrbit = 0, prevExt = sunExtent;
    const planets = solarSystem.children
        .filter(pd => celestialBodies.get(pd.name)?.orbitGroup)
        .sort((x, y) => x.distance - y.distance);
    for (const pd of planets) {
        const planetR = celestialBodies.get(pd.name).mesh.userData.visualRadius || 1;
        const outer = pd.hasRings ? planetR * 2.5 : planetR;
        // Moons: nested orbits spaced by more than the two bodies' sizes
        let prevMoon = outer, prevMoonR = 0, edge = outer;
        const moons = (pd.children || []).filter(md => celestialBodies.get(md.name)).sort((x, y) => x.distance - y.distance);
        for (const md of moons) {
            const moonR = celestialBodies.get(md.name).mesh.userData.visualRadius || 0.3;
            const floor = prevMoon + prevMoonR + moonR + Math.max(0.15, (prevMoonR + moonR) * 0.5);
            const r = Math.max(km * md.distance / 5000, floor);
            layout.moons.set(md.name, r);
            prevMoon = r;
            prevMoonR = moonR;
            edge = r + moonR;
        }
        // Planet: clear the Sun / previous planet's system plus its own
        const floor = prevOrbit + prevExt + edge + Math.max(1, (prevExt + edge) * 0.25);
        const r = Math.max(k * pd.distance / AU, floor);
        layout.planets.set(pd.name, r);
        prevOrbit = r;
        prevExt = edge;
    }
    const systemEdge = prevOrbit + prevExt;
    // For readouts/scale bar/overview framing, measure "units per AU" from the
    // outermost planet: when compressed, inner orbits sit on their spacing
    // floors and the nominal factor would understate the system's size
    const outermost = planets[planets.length - 1];
    if (outermost) layout.k = Math.max(k, prevOrbit / (outermost.distance / AU));

    layout.systemEdge = systemEdge;
    layout.pulled = pulled;
    if (pulled) {
        // Distances are log-compressed (not to scale anyway). The field scales
        // only enough for every star system to clear the Solar System; tight
        // pairs are then nudged apart locally (layoutPulledInStars) so one
        // close pair doesn't push the whole field back out.
        // The field's scale comes from the 90th percentile of what each object
        // needs to clear the Solar System, not the maximum: a black hole
        // hundreds of times bigger than any star (Phoenix A*) would otherwise
        // push every star far away. Those few outliers are pushed outward
        // individually in layoutPulledInStars, like close pairs.
        const needs = getStarLayoutInfo()
            .filter(st => st.logLy > 1e-6)
            .map(st => (systemEdge + st.ext) * 1.2 / st.logLy)
            .sort((x, y) => x - y);
        const p90 = needs.length ? needs[Math.floor((needs.length - 1) * 0.9)] : 0;
        layout.starU = Math.max(lerpLog([STAR_UNITS_PER_LY_MIN, STAR_UNITS_PER_LY_REALISTIC], sv), p90);
    } else if (sv < 0.999 && starScaleMode !== 'realistic') {
        let u = lerpLog([STAR_UNITS_PER_LY_MIN, STAR_UNITS_PER_LY_REALISTIC], sv) * (starScaleMode === 'far' ? 5 : 1);
        u = Math.min(u, STAR_UNITS_PER_LY_REALISTIC);
        const info = getStarLayoutInfo();
        let floor = starPairFloor;
        for (const st of info) {
            if (st.distLy > 1e-6) floor = Math.max(floor, (systemEdge + st.ext) * 1.2 / st.distLy);
        }
        layout.starU = Math.max(u, floor);
    }
    return layout;
}

function captureCurrentLayout() {
    const layout = { k: currentUnitsPerAU, planets: new Map(), moons: new Map(), starU: currentStarUnitsPerLy,
        systemEdge: currentSystemEdge, starBlend: currentStarBlend, sv: currentSv };
    solarSystem.children.forEach(pd => {
        const body = celestialBodies.get(pd.name);
        if (body?.orbitGroup) layout.planets.set(pd.name, body.orbitRadius);
        (pd.children || []).forEach(md => {
            const moon = celestialBodies.get(md.name);
            if (moon) layout.moons.set(md.name, moon.orbitRadius);
        });
    });
    return layout;
}

function applyLayout(layout) {
    layout.planets.forEach((r, name) => {
        const body = celestialBodies.get(name);
        body.orbitRadius = r;
        const orbitObj = orbitLines.get(name);
        if (orbitObj?.baseRadius) {
            // Realistic mode draws true ellipses in scene units (updateOrbitLineShapes)
            if (!orbitObj.visible.userData.ellipse) orbitObj.visible.scale.setScalar(r / orbitObj.baseRadius);
            orbitObj.hitTarget.scale.setScalar(r / orbitObj.baseRadius);
        }
    });
    if (orbitalMode === 'realistic') {
        refreshAUAnchors();
        const d = (simDate - J2000) / MS_PER_DAY;
        layout.planets.forEach((r, name) => placeRealisticPlanet(celestialBodies.get(name), d));
    }
    layout.moons.forEach((r, name) => { celestialBodies.get(name).orbitRadius = r; });
    // Stars: true-distance layout, pulled-in layout, or a blend between them
    // (distance geometric, direction interpolated) set by the slider position
    const blend = layout.starBlend || 0;
    const pulledTargets = blend > 0 ? pulledPositions(layout.sv ?? scaleValue, layout.systemEdge) : null;
    getStarLayoutInfo().forEach((st, i) => {
        const pos = st.body.mesh.position;
        _starLinear.copy(st.posLy).multiplyScalar(layout.starU);
        if (!pulledTargets) pos.copy(_starLinear);
        else if (blend >= 1) pos.copy(pulledTargets[i]);
        else blendRadial(_starLinear, pulledTargets[i], blend, pos);
        if (st.companionOffset) pos.add(st.companionOffset);
    });
    starsPulledInNow = blend > 0.01;
    currentStarBlend = blend;
    currentSv = layout.sv ?? scaleValue;
    currentUnitsPerAU = layout.k;
    currentStarUnitsPerLy = layout.starU;
    currentSystemEdge = layout.systemEdge;
    realisticMoonPositionsDirty = true; // moons re-placed even while paused
}

// Pulled-in star positions (scene units): log distance × starU, each star at
// least clear of the Solar System, then any two systems closer than their
// sizes (plus 20%) nudged apart along the line between them. Log compression
// can bring stars that are far apart in reality close together (two LMC stars
// a few degrees apart), and fixing those locally keeps the rest of the field
// in close. Pairs at the same spot (binaries) are skipped, as in the linear
// layout. ~77 stars → a few thousand pair checks per pass, converging in a
// handful of passes.
function layoutPulledInStars(starU, systemEdge) {
    const info = getStarLayoutInfo();
    // Distances along each object's true direction (directions never change)
    const R = info.map(st => Math.max(st.logLy * starU, 1.2 * (systemEdge + st.ext)));
    // Close pairs: push the farther one straight outward along its own line
    // from the Sun until the two clear. Pushing in any direction sent some
    // stars up to 150° off their real direction (Arcturus), which then swung
    // across the sky while blending back to true positions. Outward-only moves
    // keep every direction exact and always converge.
    const order = info.map((_, i) => i).sort((a, b) => R[a] - R[b]);
    for (let pass = 0; pass < 40; pass++) {
        let moved = false;
        for (let oi = 0; oi < order.length; oi++) {
            const j = order[oi];
            for (let oj = 0; oj < oi; oj++) {
                const i = order[oj];
                if (info[i].posLy.distanceToSquared(info[j].posLy) < 1e-12) continue;
                const need = 1.2 * (info[i].ext + info[j].ext);
                const near = R[i] <= R[j] ? i : j, far = near === i ? j : i;
                // Solve |far·dirF·t − near| = need for the smallest t ≥ R[far]
                const cosA = info[far].dir.dot(info[near].dir);
                const rn = R[near];
                const b = rn * cosA, c = rn * rn - need * need;
                const disc = b * b - c;
                if (disc <= 0) continue; // the line never comes that close
                const tExit = b + Math.sqrt(disc);
                if (R[far] < tExit && R[far] > b - Math.sqrt(disc)) { R[far] = tExit + 1e-3; moved = true; }
            }
        }
        if (!moved) break;
        order.sort((a, b) => R[a] - R[b]);
    }
    return info.map((st, i) => st.dir.clone().multiplyScalar(R[i]));
}

// Blend two positions seen from the Sun: distance geometric (so a star 10⁶×
// further moves evenly on a log scale), direction interpolated
const _starLinear = new THREE.Vector3(), _blendA = new THREE.Vector3(), _blendB = new THREE.Vector3();
function blendRadial(a, b, t, out) {
    const ra = Math.max(a.length(), 1e-6), rb = Math.max(b.length(), 1e-6);
    _blendA.copy(a).divideScalar(ra);
    _blendB.copy(b).divideScalar(rb);
    return out.copy(_blendA.lerp(_blendB, t).normalize()).multiplyScalar(ra * Math.pow(rb / ra, t));
}

function setPullFarStars(on) {
    if (on === pullFarStars) return;
    pullFarStars = on;
    setScaleValue(scaleValue, true);
}

// Change the scale; animate for presets (1.6 s, geometric so a 10× change
// looks even), apply directly while the slider is dragged.
const SCALE_TRANSITION_MS = 1600;
let scaleTransition = null;

// W / S: hold to glide the scale. Speed eases toward the target and back to
// zero on release, so moves start and stop smoothly (a tap is a small nudge).
const SCALE_KEY_RATE = 0.2;   // slider units per second at full speed (0→1 in ~5 s)
const SCALE_KEY_EASE = 0.2;   // time constant of each of two smoothing stages
const scaleKeys = { KeyW: false, KeyS: false };
let scaleKeyDrive = 0, scaleKeyVelocity = 0, scaleKeyLastTime = 0;
function updateScaleKeys() {
    const now = performance.now();
    const dt = Math.min((now - scaleKeyLastTime) / 1000, 0.1);
    scaleKeyLastTime = now;
    const input = viewMode === 'map' ? (scaleKeys.KeyW ? 1 : 0) - (scaleKeys.KeyS ? 1 : 0) : 0;
    // Two first-order stages in series: speed follows an S-curve, so the
    // acceleration eases in too (one stage lurches into motion)
    const blend = 1 - Math.exp(-dt / SCALE_KEY_EASE);
    scaleKeyDrive += (input * SCALE_KEY_RATE - scaleKeyDrive) * blend;
    scaleKeyVelocity += (scaleKeyDrive - scaleKeyVelocity) * blend;
    if (Math.abs(scaleKeyVelocity) < 1e-4 && Math.abs(scaleKeyDrive) < 1e-4 && !input) {
        scaleKeyDrive = scaleKeyVelocity = 0;
        return;
    }
    const next = THREE.MathUtils.clamp(scaleValue + scaleKeyVelocity * dt, 0, 1);
    if (next === scaleValue) { scaleKeyDrive = scaleKeyVelocity = 0; return; } // at an end
    setScaleValue(next, false);
}

function setScaleValue(sv, animate) {
    scaleValue = THREE.MathUtils.clamp(sv, 0, 1);
    scaleMode = scaleValue >= 0.999 ? 'realistic' : 'compressed';
    const target = computeScaleLayout(scaleValue);
    if (animate) {
        scaleTransition = { start: performance.now(), from: captureCurrentLayout(), to: target };
    } else {
        scaleTransition = null;
        applyLayout(target);
    }
    // Follow off normally keeps turning the camera toward the selected body;
    // here that would swing the view as bodies move. Release the lock (as
    // panning does); follow on rides along with the body at the same angle.
    if (!isCameraLocked && currentFocusedBody) currentFocusedBody = null;
    syncScaleMenu();
    syncStarsMenu();
}

function applyScaleTransition() {
    if (!scaleTransition) return;
    const t = Math.min(1, (performance.now() - scaleTransition.start) / SCALE_TRANSITION_MS);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease in-out
    const { from, to } = scaleTransition;
    const geo = (a2, b2) => a2 * Math.pow(b2 / a2, e);
    // Pull-in weight eases between the two ends; the pulled arrangement's
    // scale is recomputed for the in-between Solar System size
    const midEdge = geo(from.systemEdge ?? to.systemEdge, to.systemEdge);
    const midBlend = THREE.MathUtils.lerp(from.starBlend || 0, to.starBlend || 0, e);
    const mid = { k: geo(from.k, to.k), planets: new Map(), moons: new Map(), starU: geo(from.starU, to.starU),
        systemEdge: midEdge, starBlend: midBlend,
        sv: THREE.MathUtils.lerp(from.sv ?? to.sv, to.sv, e) };
    to.planets.forEach((r, n) => mid.planets.set(n, geo(from.planets.get(n) ?? r, r)));
    to.moons.forEach((r, n) => mid.moons.set(n, geo(from.moons.get(n) ?? r, r)));
    applyLayout(mid);
    if (t >= 1) scaleTransition = null;
}

// Stars menu near/far/realistic choice: re-lay out the stars (animated)
function setStarScale(mode) {
    if (!STAR_SCALES[mode] || mode === starScaleMode) return;
    starScaleMode = mode;
    setScaleValue(scaleValue, true);
}

// True distance from the Sun (AU) → scene units, following the planets'
// current orbit radii (piecewise linear between them), so small bodies sit in
// the right place relative to the planets at any Scale setting. Inside
// Mercury it keeps clear of the Sun; beyond Neptune it continues at
// Neptune's units per AU.
let auAnchors = null;
function refreshAUAnchors() {
    auAnchors = solarSystem.children
        .filter(pd => celestialBodies.get(pd.name)?.orbitGroup)
        .map(pd => [pd.distance / AU, celestialBodies.get(pd.name).orbitRadius])
        .sort((x, y) => x[0] - y[0]);
}
function mapAUToScene(rAU) {
    const a = auAnchors;
    if (!a || !a.length) return rAU * currentUnitsPerAU;
    const sunEdge = sunExtent ?? (celestialBodies.get('Sun')?.mesh.userData.visualRadius || 14);
    if (rAU <= a[0][0]) return sunEdge + (a[0][1] - sunEdge) * (rAU / a[0][0]);
    for (let k = 1; k < a.length; k++) {
        if (rAU <= a[k][0]) {
            const t = (rAU - a[k - 1][0]) / (a[k][0] - a[k - 1][0]);
            return a[k - 1][1] + (a[k][1] - a[k - 1][1]) * t;
        }
    }
    const [aN, rN] = a[a.length - 1];
    return rN + (rAU - aN) * (rN / aN);
}

// ── Small bodies menu (bottom bar) ──────────────────────────────────────
function setupSmallBodiesMenu() {
    document.querySelectorAll('input[data-small-group]').forEach(cb =>
        cb.addEventListener('change', () => setSmallBodyGroupVisible(cb.dataset.smallGroup, cb.checked)));
    document.getElementById('menu-small-orbits')?.addEventListener('change', e => setSmallBodyOrbitsVisible(e.target.checked));
    document.getElementById('menu-small-true-size')?.addEventListener('change', e => {
        setSmallBodyTrueSize(e.target.checked);
        // Let the zoom floor follow the new size if one is focused
        const body = currentFocusedBody && celestialBodies.get(currentFocusedBody);
        if (body?.type === 'smallbody') controls.minDistance = body.mesh.userData.visualRadius * 1.3;
    });
}

// ── Weather menu (bottom bar) ───────────────────────────────────────────
const WEATHER_CLOUDS_KEY = 'weather:clouds:v1';
function setupWeatherMenu() {
    const box = document.getElementById('menu-weather-clouds');
    const status = document.getElementById('weather-clouds-status');
    if (!box) return;
    const apply = on => {
        box.checked = on;
        setCloudLayer(on, celestialBodies.get('Earth')?.mesh, { sunDirView: earthNightUniforms.uSunDirView });
    };
    // Off by default (it costs GPU time on big screens); remember the choice
    apply(localStorage.getItem(WEATHER_CLOUDS_KEY) === 'on');
    box.addEventListener('change', () => {
        apply(box.checked);
        try { localStorage.setItem(WEATHER_CLOUDS_KEY, box.checked ? 'on' : 'off'); } catch { /* private mode */ }
    });
    // Reflect load failures in the menu
    setInterval(() => {
        if (status) status.textContent = cloudLayerStatus() === 'unavailable' ? 'unavailable right now' : 'live, every 3 h';
    }, 5000);
}

// ── Scale menu (bottom bar) ─────────────────────────────────────────────
function syncScaleMenu() {
    const slider = document.getElementById('scale-slider');
    if (slider && document.activeElement !== slider) slider.value = Math.round(scaleValue * 1000);
    const label = document.getElementById('scale-mode');
    if (label) {
        const near = (v) => Math.abs(scaleValue - v) < 0.004;
        label.textContent = near(SCALE_PRESETS.realistic) ? 'Realistic'
            : near(SCALE_PRESETS.compressed) ? 'Compressed'
            : near(SCALE_PRESETS.max) ? 'Max compressed'
            : `Custom (${Math.round(scaleValue * 100)}%)`;
    }
    document.querySelectorAll('.scale-preset').forEach(b =>
        b.classList.toggle('active', Math.abs(scaleValue - SCALE_PRESETS[b.dataset.scale]) < 0.004));
}

function setupScaleMenu() {
    const slider = document.getElementById('scale-slider');
    slider?.addEventListener('input', () => setScaleValue(slider.value / 1000, false));
    document.querySelectorAll('.scale-preset').forEach(b =>
        b.addEventListener('click', () => setScaleValue(SCALE_PRESETS[b.dataset.scale], true)));
    syncScaleMenu();
}

function setFollowMode(mode) {           // 'off' | 'on' | 'angle'
    isCameraLocked = mode !== 'off';
    cameraAngleLock = mode === 'angle';
    chaseCam.hasOffset = false;          // lock on from the current view next frame
    document.getElementById('camera-lock-mode').textContent =
        !isCameraLocked ? 'Off' : cameraAngleLock ? 'On + angle' : 'On';
}

// ── Cheese Moon tour ──────────────────────────────────────────────────
// After the wedge is clicked the story plays itself: the camera settles
// beside the Moon (Earth in view to the right) in chase mode, time races
// between the story's turning points and slows at each, cuts to Earth for
// the two heaviest bombardments, and once the last piece has fallen the
// Moon is put back. A drag or zoom hands the camera back to the user;
// changing the speed hands back the clock. R ends it at any time.
const TOUR_FAST = 20 * 86400, TOUR_SLOW = 86400;              // sim-seconds per second
const TOUR_EARTH = 6 * 3600, TOUR_LOOKBACK = 2 * 86400, TOUR_ISS = 78;   // ISS ride at 1.3 min/s
const TOUR_EVENTS = [0, 30, 120, 160, 260, 560, 700];         // days after the click
// The clock eases toward the speed it should be at (log scale, this time
// constant in real seconds), so slow-downs and speed-ups never snap
const TOUR_SPEED_EASE = 0.45;
const ISS_SLOWDOWN_MS = 2600;   // wind Earth's spin down before arcing to the ISS
const TOUR_SHOT_BODY = { moon: 'Moon', lookback: 'Moon', earth: 'Earth' };
const cheeseTour = { active: false, camera: false, clock: false, shot: null, lastSps: 0, windows: null, finale: null };

function tourSpeed(day) {
    let slow = 0;
    // (wide enough that the eased clock has slowed by the time each beat arrives)
    for (const e of TOUR_EVENTS) slow = Math.max(slow, Math.exp(-(((day - e) / 7) ** 2)));
    let lr = Math.log(TOUR_FAST) + (Math.log(TOUR_SLOW) - Math.log(TOUR_FAST)) * slow;
    for (const w of cheeseTour.windows || []) {
        const rampIn = w.ramp ?? 2, rampOut = w.rampOut ?? rampIn;   // days to ease in and out
        const k = THREE.MathUtils.smoothstep(day, w.a - rampIn, w.a) * (1 - THREE.MathUtils.smoothstep(day, w.b, w.b + rampOut));
        lr += (Math.log(w.sps) - lr) * k;
    }
    return Math.exp(lr);
}

// The busiest stretch of impacts in [from, to]: [start, end] days
function busiestImpacts(hitDays, from, to, span = 2) {
    let best = null, bestN = 0;
    for (const s of hitDays) {
        if (s < from || s > to) continue;
        const n = hitDays.filter(h => h >= s && h < s + span).length;
        if (n > bestN) { bestN = n; best = s; }
    }
    return best === null ? null : [best - 1.5, best + span + 0.5];
}

// One cut away from the Moon when the impacts peak (once the flights are
// planned): from beside Earth looking back at the broken Moon with the
// chunks streaming across, then straight on to riding the ISS for ~30 s
// while big chunks come down around it (Earth instead if the ISS isn't loaded)
function planTourShots() {
    const hits = cheeseMoon.hitDays, end = cheeseMoon.endDay;
    const peak = busiestImpacts(hits, 450, end - 120, 0.25);
    const a = peak ? peak[0] + 1.45 : 700;
    cheeseTour.windows = [
        { a: a - 20, b: a, shot: 'lookback', sps: TOUR_LOOKBACK },
        { a, b: a + 0.03, shot: 'iss', sps: TOUR_ISS, ramp: 0.05, rampOut: 0.002 }   // (the eased clock smooths both ends in real time)
    ];
}

// Big chunks dropped just off the ISS's upcoming ground track, landing a
// little before it passes, so the ride shows them streak in and strike
const ISS_PERIOD_S = 5560, EARTH_DAY_S = 86164;
function scheduleIssShowcase(day) {
    const iss = celestialBodies.get('ISS')?.mesh, earth = celestialBodies.get('Earth')?.mesh;
    if (!iss || !earth) return;
    const RE = earth.userData.visualRadius || 1;
    const P = iss.position.clone().normalize();                          // Earth's frame
    const travel = new THREE.Vector3(0, 0, 1).applyQuaternion(iss.quaternion).normalize();
    const normal = P.clone().cross(travel).normalize();                  // orbit's pole
    const w = 2 * Math.PI / ISS_PERIOD_S, wE = 2 * Math.PI / EARTH_DAY_S;
    const list = [5, 10, 15, 20, 25].map((secs, k) => {
        const t = secs * TOUR_ISS;                                       // sim seconds from now
        // Where the ISS will be a couple of minutes after the impact (Earth turns under the orbit)
        const ground = P.clone().applyAxisAngle(normal, w * (t + 150)).applyAxisAngle(_tourUp, -wE * t);
        const along = normal.clone().applyAxisAngle(_tourUp, -wE * t).cross(ground).normalize();
        const target = ground.applyAxisAngle(along, (k % 2 ? 1 : -1) * (0.07 + 0.02 * k)).multiplyScalar(RE);
        const up = target.clone().normalize();
        const start = target.clone().addScaledVector(up, RE * 0.9).addScaledVector(along, -RE * 0.35);
        return { day: day + t / 86400, fallDays: 420 / 86400, start, target };
    });
    cheeseMoon.showcase(list);
}

// Where each tour shot puts the camera, from the bodies' current positions:
//   moon      beside the Moon, Earth off to the right
//   earth     behind Earth, a little to the side, so the Moon sits just past
//             Earth's edge with the chunks streaming in between
//   lookback  beside Earth, looking at the Moon with Earth to the left
const _tourF = new THREE.Vector3(), _tourO = new THREE.Vector3(), _tourUp = new THREE.Vector3(0, 1, 0);
function tourShotPose(shot) {
    const earth = celestialBodies.get('Earth'), moon = celestialBodies.get('Moon');
    const E = earth.mesh.getWorldPosition(new THREE.Vector3()), M = moon.mesh.getWorldPosition(new THREE.Vector3());
    const RE = earth.mesh.userData.visualRadius || 1, RM = moon.mesh.userData.visualRadius || 0.35;
    const toMoon = M.clone().sub(E).normalize();
    const side = toMoon.clone().cross(_tourUp).normalize();
    if (shot === 'lookback') {
        // Off to the side of the Earth–Moon line: the Moon in the middle,
        // Earth ~20° to its left, the chunks crossing the gap between
        let best = null;
        for (const sgn of [1, -1]) {
            const pos = E.clone().addScaledVector(toMoon, -RE * 6).addScaledVector(side, sgn * RE * 3.5).addScaledVector(_tourUp, RE * 0.8);
            const right = M.clone().sub(pos).cross(_tourUp);
            const score = -E.clone().sub(pos).dot(right);                // Earth on the left
            if (!best || score > best.score) best = { pos, score };
        }
        return { pos: best.pos, target: M };
    }
    if (shot === 'earth') {
        return { pos: E.clone().addScaledVector(toMoon, -RE * 5).addScaledVector(side, RE * 2).addScaledVector(_tourUp, RE), target: E };
    }
    const [F, O, dist, sideAngle, elevation] = [M, E, RM * 8, 0.52, 0.2];
    const away = F.clone().sub(O).normalize();          // from the other body, through the focus
    let best = null;
    for (const a of [sideAngle, -sideAngle]) {
        const dir = away.clone().applyAxisAngle(_tourUp, a).addScaledVector(_tourUp, Math.tan(elevation)).normalize();
        const cam = F.clone().addScaledVector(dir, dist);
        const score = O.clone().sub(cam).dot(F.clone().sub(cam).cross(_tourUp));
        if (!best || score > best.score) best = { cam, score };
    }
    return { pos: best.cam, target: F };
}

// Smooth moves between shots: the camera swings round the body it's heading
// for (direction turned along a great circle, distance blended
// geometrically), tracking it the whole way even while time races; applied
// after the follow code each frame. At the end the follow mode locks on
// from exactly there, so nothing jumps
let tourGlide = null;
function startTourGlide(shot, ms) {
    const name = TOUR_SHOT_BODY[shot], body = celestialBodies.get(name);
    if (!body) return;
    body.mesh.getWorldPosition(_tourF);
    tourGlide = {
        shot, name, start: performance.now(), ms,
        fromOff: camera.position.clone().sub(_tourF),
        fromTarget: controls.target.clone().sub(_tourF),
        fromUp: camera.up.clone()
    };
    flyToAnimation = null;
    focusRetarget = null;
    earthSpotFlight = null;
    if (currentFocusedBody !== name) {
        currentFocusedBody = name;
        updateSidebarSelection(name);
        showBodyInfo(body.data);
    }
    cameraOffsetFromTarget = null;
    setFollowMode('on');
    controls.minDistance = 1e-6;
}

// Fly to the ISS by arcing round Earth (a straight flight from beside the
// Moon went right through the planet): the direction from Earth's centre turns
// along a great circle while the height eases from where the camera is down
// to the ISS view, lifted in the middle so the path rides high over the
// globe, catching up with the station as it moves. Lands in its chase view
function startIssArcGlide(ms, showcase) {
    const earth = celestialBodies.get('Earth'), iss = celestialBodies.get('ISS');
    if (!earth || !iss) return false;
    earth.mesh.getWorldPosition(_tourF);
    tourGlide = {
        kind: 'issArc', shot: 'iss', name: 'ISS', start: performance.now(), ms, showcase,
        fromPos: camera.position.clone().sub(_tourF),
        fromTarget: controls.target.clone().sub(_tourF),
        fromUp: camera.up.clone()
    };
    flyToAnimation = null;
    focusRetarget = null;
    earthSpotFlight = null;
    if (currentFocusedBody !== 'ISS') {
        currentFocusedBody = 'ISS';
        updateSidebarSelection('ISS');
        showBodyInfo(iss.data);
    }
    cameraOffsetFromTarget = null;
    setFollowMode('on');
    controls.minDistance = 1e-6;
    return true;
}
const _arcQuat = new THREE.Quaternion(), _arcEnd = new THREE.Vector3(), _arcTarget = new THREE.Vector3(), _arcUp = new THREE.Vector3();
function applyIssArcGlide(g) {
    const t = Math.min(1, (performance.now() - g.start) / g.ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const earth = celestialBodies.get('Earth'), iss = celestialBodies.get('ISS');
    const RE = earth.mesh.userData.visualRadius || 1;
    earth.mesh.getWorldPosition(_tourF);
    iss.mesh.getWorldPosition(_tourO);
    iss.mesh.getWorldQuaternion(_arcQuat);
    // (the chase view puts the camera at look-at point + camera offset)
    _arcTarget.copy(ISS_TARGET_OFFSET).applyQuaternion(_arcQuat).add(_tourO);
    _arcEnd.copy(ISS_CAM_OFFSET).applyQuaternion(_arcQuat).add(_arcTarget).sub(_tourF);   // Earth-relative
    _arcUp.set(0, 1, 0).applyQuaternion(_arcQuat);
    const d0 = g.fromPos.clone().normalize(), d1 = _arcEnd.clone().normalize();
    const axis = d0.clone().cross(d1);
    if (axis.lengthSq() < 1e-10) axis.copy(_tourUp);
    const dir = d0.applyAxisAngle(axis.normalize(), d0.angleTo(d1) * e);
    const r0 = g.fromPos.length(), r1 = _arcEnd.length();
    const r = Math.pow(r0, 1 - e) * Math.pow(r1, e) + RE * 0.6 * Math.sin(Math.PI * e) * Math.min(1, d0.angleTo(d1));
    camera.position.copy(_tourF).addScaledVector(dir, Math.max(r, RE * 1.02));
    controls.target.copy(g.fromTarget).add(_tourF).lerp(_arcTarget, e);
    camera.up.copy(g.fromUp).lerp(_arcUp, e).normalize();
    if (t >= 1) {
        // Hand over to the ISS chase view, as a normal flight to it ends
        tourGlide = null;
        isCameraLocked = true;
        cameraAngleLock = true;
        chaseCam.bodyName = 'ISS';
        chaseCam.offsetLocal.copy(ISS_CAM_OFFSET);
        chaseCam.targetOffsetLocal.copy(ISS_TARGET_OFFSET);
        chaseCam.upLocal.set(0, 1, 0);
        chaseCam.hasOffset = true;
        document.getElementById('camera-lock-mode').textContent = 'On + angle';
        controls.minDistance = (iss.mesh.userData.visualRadius || 0.022) * 0.01;
        cheeseTour.issFlight = false;
        cheeseTour.shot = 'iss';
        if (g.showcase && cheeseMoon?.active) scheduleIssShowcase((simDate.getTime() - cheeseMoon.triggeredAt) / MS_PER_DAY);
    }
}

function applyTourGlide() {
    const g = tourGlide;
    if (g?.kind === 'issArc') { applyIssArcGlide(g); return; }
    if (!g) {
        // Earth shot: keep re-framing as the Moon moves round (Earth spins,
        // so an Earth-locked angle wouldn't hold the Moon in view)
        if (cheeseTour.active && cheeseTour.camera && cheeseTour.shot === 'earth' && !cheeseTour.finale) {
            const pose = tourShotPose('earth');
            camera.position.copy(pose.pos);
            controls.target.copy(pose.target);
        }
        return;
    }
    const t = Math.min(1, (performance.now() - g.start) / g.ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const body = celestialBodies.get(g.name);
    body.mesh.getWorldPosition(_tourF);
    const pose = tourShotPose(g.shot);
    const toOff = pose.pos.sub(_tourF);
    const d0 = g.fromOff.clone().normalize(), d1 = toOff.clone().normalize();
    const axis = d0.clone().cross(d1);
    if (axis.lengthSq() < 1e-10) axis.copy(_tourUp);
    const dir = d0.applyAxisAngle(axis.normalize(), d0.angleTo(d1) * e);
    const len = Math.pow(g.fromOff.length(), 1 - e) * Math.pow(toOff.length(), e);
    camera.position.copy(_tourF).addScaledVector(dir, len);
    controls.target.copy(_tourF).add(g.fromTarget).lerp(pose.target, e);
    camera.up.copy(g.fromUp).lerp(_tourUp, e).normalize();
    if (t >= 1) {
        tourGlide = null;
        cheeseTour.shot = g.shot;
        controls.minDistance = (body.mesh.userData.visualRadius || 1) * 1.4;
        setFollowMode(g.shot === 'earth' ? 'on' : 'angle');   // Moon-locked shots hold as it goes round
    }
}

function startCheeseTour() {
    Object.assign(cheeseTour, {
        active: true, camera: true, clock: true, shot: null, windows: null, finale: null, issTry: null, issFlight: false,
        issSlowing: null, logSps: null, logVel: 0, lastClockAt: null
    });
    startTourGlide('moon', 6000);
    setSimRateSps(tourSpeed(0));
    cheeseTour.lastSps = currentSimSps();
}

function stopCheeseTour() {
    Object.assign(cheeseTour, { active: false, camera: false, clock: false, finale: null, issFlight: false, issSlowing: null, logSps: null, logVel: 0, lastClockAt: null });
    tourGlide = null;
}

// Put the Moon back. R also returns to the present at the normal speed; when
// the story finishes by itself the clock is already at today, and the view
// (riding the ISS) and speed carry on as they are
function endCheeseMoon(finished) {
    stopCheeseTour();
    const wasActive = cheeseMoon?.active;
    cheeseMoon?.reset();
    if (finished && wasActive) {
        cheeseMoon.say('And just like that, the Moon is back.', false);
        return;
    }
    document.getElementById('tl-goto-now')?.click();
    setSimRateSps(DEFAULT_SIM_SPS);
}

// Finale, once everything has come down: bring the clock back to today
// (aftermath kept), glide down over Earth's day side and let the ground turn
// past, then ride along with the ISS over the craters, then put the Moon back
const FINALE = { flyMs: 6500, turnUntil: 24, issFor: 26, turnRate: 0.035 };   // s, rad/s
function startCheeseFinale(day) {
    cheeseTour.finale = { start: performance.now(), last: performance.now(), step: 'aim', frames: 0, issStart: 0, issLocked: false };
    tourGlide = null;
    cheeseTour.clock = false;
    document.getElementById('tl-goto-now')?.click();
    cheeseMoon.rebase(simDate.getTime(), day);
    setSimRateSps(600);                                  // 10 min/s: Earth turns slowly
}

// Aim a little north and west of the point under the Sun, so the ground
// turns into the light (a couple of frames after the date jump, once Earth
// has been turned to today's orientation)
function flyFinaleToEarth() {
    const earth = celestialBodies.get('Earth');
    if (!earth || !cheeseTour.camera) return;
    setFollowMode('on');
    earth.mesh.getWorldPosition(_tourF);
    const q = earth.mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
    const spot = _tourF.clone().negate().normalize().applyQuaternion(q);
    spot.applyAxisAngle(_tourUp, -0.35).add(new THREE.Vector3(0, 0.45, 0)).normalize();
    flyToEarthSpot(spot, FINALE.flyMs, 3500);
}

function updateCheeseFinale() {
    const f = cheeseTour.finale;
    const now = performance.now(), t = (now - f.start) / 1000, dt = Math.min(0.1, (now - f.last) / 1000);
    f.last = now;
    const earth = celestialBodies.get('Earth'), iss = celestialBodies.get('ISS');
    if (f.step === 'aim' && ++f.frames > 2) {
        flyFinaleToEarth();
        f.step = 'fly';
        f.start = now;
    }
    if (f.step === 'fly' && t > FINALE.flyMs / 1000 + 0.3) f.step = 'turn';
    if (f.step === 'turn') {
        // The close-up camera rides Earth's spin; swing it back a little each
        // frame so the ground slides past underneath
        if (cheeseTour.camera && earth && currentFocusedBody === 'Earth') {
            earth.mesh.getWorldPosition(_tourF);
            const axis = _tourO.set(0, 1, 0).applyQuaternion(earth.mesh.getWorldQuaternion(new THREE.Quaternion()));
            camera.position.sub(_tourF).applyAxisAngle(axis, -FINALE.turnRate * dt).add(_tourF);
            camera.up.applyAxisAngle(axis, -FINALE.turnRate * dt);
        }
        if (t > FINALE.turnUntil) {
            if (iss?.mesh.visible) {
                f.step = 'iss';
                f.issStart = t;
                setSimRateSps(60);
                if (cheeseTour.camera) startIssArcGlide(5000, false);
            } else {
                f.step = 'done';
            }
        }
    }
    if (f.step === 'iss') {
        if (!tourGlide) f.issLocked = true;           // (the arc lands in the chase view)
        if (t > f.issStart + FINALE.issFor) f.step = 'done';
    }
    if (f.step === 'done') endCheeseMoon(true);
}

function updateCheeseTour() {
    if (!cheeseMoon?.active) { if (cheeseTour.active) stopCheeseTour(); return; }
    if (cheeseTour.finale) { updateCheeseFinale(); return; }
    const day = (simDate.getTime() - cheeseMoon.triggeredAt) / MS_PER_DAY;
    if (cheeseMoon.ready && day > cheeseMoon.endDay + 3 && cheeseTour.active && cheeseTour.camera && viewMode === 'map') {
        startCheeseFinale(day);
        return;
    }
    if (cheeseMoon.ready && day > cheeseMoon.endDay + 20) { endCheeseMoon(true); return; }   // all fallen
    if (!cheeseTour.active || viewMode !== 'map') return;
    if (!cheeseTour.windows && cheeseMoon.ready) planTourShots();
    if (cheeseTour.camera && !tourGlide) {
        const windows = cheeseTour.windows || [];
        const issWin = windows.find(w => w.shot === 'iss');
        // The ISS ride is short: one fast frame can step right over it, so
        // once its start has passed it always plays, from its start
        let want = (issWin && !issWin.started && day >= issWin.a) || cheeseTour.issSlowing ? 'iss'
            : windows.find(w => day >= w.a && day < w.b)?.shot || 'moon';
        if (want === 'iss' && cheeseTour.shot !== 'iss' && !cheeseTour.issFlight && !cheeseTour.issTry
            && (!cheeseTour.issSlowing || performance.now() - cheeseTour.issSlowing < ISS_SLOWDOWN_MS)) {
            // Earth was spinning fast: hold this shot while the clock winds
            // down to the ride's speed, then go
            cheeseTour.issSlowing ??= performance.now();
            issWin.started = true;
            want = cheeseTour.shot;
        } else if (want === 'iss' && cheeseTour.shot !== 'iss' && !cheeseTour.issFlight) {
            cheeseTour.issSlowing = null;
            if (!cheeseTour.issTry) {
                cheeseTour.issTry = { frames: 0 };
                issWin.started = true;
                // ISS positions only exist near today: bring the clock back to
                // today (story kept), and the story back to the ride's start
                document.getElementById('tl-goto-now')?.click();
                cheeseMoon.rebase(simDate.getTime(), Math.min(day, issWin.a + 0.01));
            }
            if (celestialBodies.get('ISS')?.mesh.visible && startIssArcGlide(5000, true)) {
                cheeseTour.issFlight = true;
            } else {
                // Give it a moment to appear (its orbit may still be loading);
                // 30 frames was too short at high frame rates and the ride was skipped
                cheeseTour.issTry.t0 ??= performance.now();
                want = performance.now() - cheeseTour.issTry.t0 < 4000 ? cheeseTour.shot : 'earth';
            }
        }
        if (cheeseTour.issFlight) {
            // (arcing in: applyIssArcGlide finishes it)
        } else if (want !== cheeseTour.shot && want !== 'iss') {
            startTourGlide(want, 4500);
        }
    }
    if (cheeseTour.clock) {
        const now = currentSimSps();
        if (Math.abs(now - cheeseTour.lastSps) > Math.abs(cheeseTour.lastSps) * 0.01 + 1) {
            cheeseTour.clock = false;                 // the user changed the speed
        } else {
            // Ease toward the speed the story wants (the ride's while winding
            // down for the ISS), in real time
            const target = cheeseTour.issSlowing ? TOUR_ISS : tourSpeed(day);
            const t = performance.now();
            const dt = Math.min(0.1, (t - (cheeseTour.lastClockAt ?? t)) / 1000);
            cheeseTour.lastClockAt = t;
            // Critically damped spring on log speed: starts gently, no lurch
            // (a plain exponential ease did most of its change in the first frames)
            cheeseTour.logSps ??= Math.log(Math.max(Math.abs(now), 1));
            cheeseTour.logVel ??= 0;
            const w = 1 / TOUR_SPEED_EASE;
            cheeseTour.logVel += (w * w * (Math.log(target) - cheeseTour.logSps) - 2 * w * cheeseTour.logVel) * dt;
            cheeseTour.logSps += cheeseTour.logVel * dt;
            const sps = Math.exp(cheeseTour.logSps);
            if (Math.abs(sps - now) > now * 0.02) setSimRateSps(sps);
            cheeseTour.lastSps = currentSimSps();
        }
    }
}

function toggleCameraLock() {
    // Cycle Off → On → On + angle
    if (!isCameraLocked) {
        isCameraLocked = true;
        cameraAngleLock = false;
    } else if (!cameraAngleLock) {
        cameraAngleLock = true;
    } else {
        isCameraLocked = false;
        cameraAngleLock = false;
    }
    chaseCam.hasOffset = false; // lock on from the current view next frame
    document.getElementById('camera-lock-mode').textContent =
        !isCameraLocked ? 'Off' : cameraAngleLock ? 'On + angle' : 'On';

    // If turning on lock and we have a focused body, make sure we're tracking it
    if (isCameraLocked && currentFocusedBody) {
        const body = celestialBodies.get(currentFocusedBody);
        if (body && body.mesh) {
            const worldPosition = new THREE.Vector3();
            body.mesh.getWorldPosition(worldPosition);
            controls.target.copy(worldPosition);
        }
    }
}

// Realistic mode: the orbit group turns to the planet's true longitude and the
// planet sits out along its +X at its true distance (mapped through the
// current scale, so perihelion/aphelion follow the planets' spacing) and
// height above the ecliptic. Always sets the position: Aligned mode moves
// planets around their circles, and switching modes used to leave them there.
function placeRealisticPlanet(body, daysSinceJ2000) {
    const name = body.data.name;
    if (!planetHelioAU(name, daysSinceJ2000, _keplerPos)) {
        body.orbitGroup.rotation.y = calculatePlanetAngle(body.data, daysSinceJ2000);
        body.mesh.position.set(body.orbitRadius, 0, 0);
        return;
    }
    const r = _keplerPos.length();
    const flat = Math.hypot(_keplerPos.x, _keplerPos.y);
    const R = mapAUToScene(r);
    body.orbitGroup.rotation.y = Math.atan2(_keplerPos.y, _keplerPos.x);
    body.mesh.position.set(R * flat / r, R * _keplerPos.z / r, 0);
}

let orbitShapeSignature = '';
function updateOrbitLineShapes() {
    const realistic = orbitalMode === 'realistic';
    const d = (simDate - J2000) / MS_PER_DAY;
    // Rebuild when the mode or the scale mapping changes, or every ~5 years
    // as the elements drift
    const sig = realistic
        ? [0.3, 0.7, 1, 1.5, 5, 9.5, 19, 30].map(r => mapAUToScene(r).toFixed(2)).join(',') + ':' + Math.round(d / 1826)
        : 'aligned';
    if (sig === orbitShapeSignature) return;
    orbitShapeSignature = sig;
    orbitLines.forEach((orbitObj, name) => {
        const line = orbitObj.visible;
        const el = realistic ? planetElements(name, d) : null;
        if (!line.userData.circleGeometry) line.userData.circleGeometry = line.geometry;
        if (!el) {
            if (line.userData.ellipse) {
                line.geometry = line.userData.circleGeometry;
                line.userData.ellipse = false;
            }
            const body = celestialBodies.get(name);
            if (body?.orbitRadius && orbitObj.baseRadius) line.scale.setScalar(body.orbitRadius / orbitObj.baseRadius);
            return;
        }
        const N = 256, pts = new Float32Array((N + 1) * 3), p = new THREE.Vector3();
        for (let i = 0; i <= N; i++) {
            orbitPointAU(el, (i / N) * Math.PI * 2, p);
            const r = p.length(), R = mapAUToScene(r) / r;
            pts[i * 3] = p.x * R; pts[i * 3 + 1] = p.z * R; pts[i * 3 + 2] = -p.y * R; // ecliptic → app
        }
        if (line.userData.ellipse) line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pts, 3));
        line.userData.ellipse = true;
        line.scale.setScalar(1);
    });
}

function updateRealisticPositions(date, phase = 'all') {
    const daysSinceJ2000 = (date - J2000) / MS_PER_DAY;
    refreshAUAnchors();

    if (phase === 'all' || phase === 'planets') {
        realisticMoonPositionsDirty = true;
        solarSystem.children.forEach(planetData => {
            const body = celestialBodies.get(planetData.name);
            if (body && body.orbitGroup && planetData.orbitalPeriod) placeRealisticPlanet(body, daysSinceJ2000);
        });
    }

    if (phase === 'all' || phase === 'moons') {
        solarSystem.children.forEach(planetData => {
            const body = celestialBodies.get(planetData.name);
            if (body && planetData.children) {
                planetData.children.forEach(moonData => {
                    const moonBody = celestialBodies.get(moonData.name);
                    if (moonBody && moonData.orbitalPeriod) {
                        // Earth's Moon: use geocentric ecliptic longitude relative to Sun direction
                        // Other moons: fall back to fractional orbit (no precise epoch data)
                        const moonAngle = moonData.name === 'Moon'
                            ? calculateMoonAngle(daysSinceJ2000)
                            : calculatePlanetAngle(moonData, daysSinceJ2000);
                        const moonDist = moonBody.orbitRadius ?? scaleDistance(moonData.distance, true);
                        const moonLat = moonData.name === 'Moon' ? calculateMoonLatitude(daysSinceJ2000) : 0;
                        placeMoon(moonBody, moonAngle, moonDist, moonLat);
                    }
                });
            }
        });
        if (phase === 'moons') realisticMoonPositionsDirty = false;
    }
}


// Sample the same placement functions used by rendering, including the parent's
// tilt/spin for moons. Restore the mesh so this calculation has no scene effects.
function customOrbitFrame(body) {
    const mesh = body.mesh;
    const position = mesh.position.clone(), quaternion = mesh.quaternion.clone();
    const point = angle => {
        if (body.parent) placeMoon(body, angle, body.orbitRadius);
        else orbitOffset(angle, body.orbitRadius, mesh.position);
        return mesh.parent.localToWorld(mesh.position.clone());
    };
    const a = point(0), b = point(Math.PI), c = point(Math.PI / 2);
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    const center = a.clone().add(b).multiplyScalar(0.5);
    return { center, x: a.sub(center), y: c.sub(center) };
}

function finishCustomOrbitDrag(cancel = false) {
    const drag = customOrbitDrag;
    if (!drag) return;
    customOrbitDrag = null;
    if (cancel) customOrbitAngles[drag.name] = drag.original;
    else if (drag.moved) saveCustomOrbits();
    controls.enabled = drag.controlsEnabled;
    renderer.domElement.style.cursor = '';
    if (renderer.domElement.hasPointerCapture(drag.pointerId)) renderer.domElement.releasePointerCapture(drag.pointerId);
}

function setupCustomOrbitDrag(canvas) {
    canvas.addEventListener('pointerdown', event => {
        if (customOrbitDrag || orbitalMode !== 'custom' || viewMode !== 'map'
            || event.button !== 0 || event.isPrimary === false || event.ctrlKey || event.shiftKey || event.metaKey) return;
        scene.updateMatrixWorld(true);
        const pointer = new THREE.Vector2(event.clientX / window.innerWidth * 2 - 1, 1 - event.clientY / window.innerHeight * 2);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(pointer, camera);
        const meshes = Array.from(celestialBodies.values()).filter(b => b.mesh.visible).map(b => b.mesh);
        const hits = ray.intersectObjects(meshes, true);
        const radius = isCoarsePointerEvent(event) ? TOUCH_BODY_HIT_RADIUS_PX : MOUSE_BODY_HIT_RADIUS_PX;
        const name = findTinyBodyInFront(event.clientX, event.clientY, radius, hits)
            || (hits.length ? getBodyNameFromIntersection(hits[0]) : null)
            || findNearestBodyOnScreen(event.clientX, event.clientY, celestialBodies, radius);
        const body = celestialBodies.get(name);
        if (!body || body.isDistant || !body.orbitRadius || !['planet', 'moon'].includes(body.data.type)) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        customOrbitDrag = { name, body, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
            original: customOrbitAngles[name] ?? 0, moved: false, controlsEnabled: controls.enabled };
        controls.enabled = false;
        activeTapPointerId = null;
        canvas.setPointerCapture(event.pointerId);
    }, { capture: true });
    canvas.addEventListener('pointermove', event => {
        const drag = customOrbitDrag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        if (orbitalMode !== 'custom' || viewMode !== 'map') { finishCustomOrbitDrag(true); return; }
        if (!drag.moved) {
            if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < (isCoarsePointerEvent(event) ? TOUCH_TAP_MOVE_TOLERANCE_PX : 5)) return;
            drag.moved = true;
            // Stop following the edited body so it can move across the screen.
            currentFocusedBody = null;
            flyToAnimation = null;
            focusRetarget = null;
            earthSpotFlight = null;
            isCameraLocked = false;
            cameraAngleLock = false;
            document.getElementById('camera-lock-mode').textContent = 'Off';
            hideTooltip();
            canvas.style.cursor = 'grabbing';
        }
        const frame = customOrbitFrame(drag.body);
        const previous = customOrbitAngles[drag.name];
        const projected = new THREE.Vector3();
        const distance = angle => {
            projected.copy(frame.center).addScaledVector(frame.x, Math.cos(angle)).addScaledVector(frame.y, Math.sin(angle)).project(camera);
            if (projected.z < -1 || projected.z > 1) return Infinity;
            const dx = (projected.x + 1) * window.innerWidth / 2 - event.clientX;
            const dy = (1 - projected.y) * window.innerHeight / 2 - event.clientY;
            // Resolve overlapping front/back arcs in favour of the current angle.
            const delta = Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
            return dx * dx + dy * dy + delta * delta * 0.1;
        };
        let angle = previous, best = distance(angle), step = Math.PI * 2 / 180;
        for (let i = 0; i < 180; i++) {
            const candidate = previous + i * step, score = distance(candidate);
            if (score < best) { best = score; angle = candidate; }
        }
        for (let i = 0; i < 12; i++) {
            const left = distance(angle - step), right = distance(angle + step);
            if (left < best && left <= right) { angle -= step; best = left; }
            else if (right < best) { angle += step; best = right; }
            step /= 2;
        }
        customOrbitAngles[drag.name] = Math.atan2(Math.sin(angle), Math.cos(angle));
    }, { capture: true });
    canvas.addEventListener('pointerup', event => {
        const drag = customOrbitDrag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.stopImmediatePropagation();
        finishCustomOrbitDrag();
        if (!drag.moved) onClick(event);
    }, { capture: true });
    for (const type of ['pointercancel', 'lostpointercapture']) {
        canvas.addEventListener(type, event => {
            if (customOrbitDrag?.pointerId === event.pointerId) finishCustomOrbitDrag(true);
        });
    }
    window.addEventListener('blur', () => finishCustomOrbitDrag(true));
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') finishCustomOrbitDrag(true);
    });
}

function toggleOrbitalMode() {
    finishCustomOrbitDrag(true);
    const next = { aligned: 'realistic', realistic: 'custom', custom: 'aligned' }[orbitalMode];
    if (next === 'custom') {
        const d = (simDate - J2000) / MS_PER_DAY;
        solarSystem.children.forEach(pd => {
            if (!Number.isFinite(customOrbitAngles[pd.name])) {
                const body = celestialBodies.get(pd.name);
                customOrbitAngles[pd.name] = body?.orbitGroup?.rotation.y ?? 0;
            }
            (pd.children || []).forEach(md => {
                if (!Number.isFinite(customOrbitAngles[md.name])) {
                    customOrbitAngles[md.name] = md.name === 'Moon' ? calculateMoonAngle(d) : calculatePlanetAngle(md, d);
                }
            });
        });
        saveCustomOrbits();
    }
    orbitalMode = next;
    document.getElementById('custom-orbit-hint').hidden = next !== 'custom';
    document.getElementById('orbital-toggle').title = next === 'custom'
        ? 'Drag planets and moons along their orbits. Click to switch to Aligned.'
        : 'Cycle Aligned, Realistic, Custom';
    document.getElementById('orbital-mode').textContent = capitalize(orbitalMode);

    if (orbitalMode === 'realistic') {
        // Start paused at today's date so positions are visible before anything moves
        simDate = new Date();
        simPaused = true;
        setSimRateSps(DEFAULT_SIM_SPS); // ready for when the user hits play
        simPaused = true;
        syncTimelineUI();
        updateRealisticPositions(simDate);
    } else {
        // Circular modes use local orbital angles with unrotated orbit groups.
        simPaused = true;
        alignedStartDate = new Date(simDate.getTime());
        solarSystem.children.forEach(planetData => {
            const body = celestialBodies.get(planetData.name);
            if (body && body.orbitGroup) {
                body.orbitGroup.rotation.y = 0;
            }
        });
    }

    // Sync speed labels/modes
    syncTimelineUI();

    // Custom editing keeps the current camera framing.
    if (orbitalMode !== 'custom' && currentFocusedBody) {
        focusOnBody(currentFocusedBody);
    }
}

function showTimelinePanel() {
    const panel = document.getElementById('timeline-panel');
    if (panel) {
        if (isMobileLayout()) {
            panel.classList.add('hidden');
            panel.classList.remove('mobile-open');
        } else {
            panel.classList.remove('hidden');
        }
    }
    // Timeline is available again, so re-enable its mobile nav button
    const timeBtn = document.getElementById('mnav-time');
    if (timeBtn) timeBtn.classList.remove('hidden');
    updateTimelineDisplay();
    syncTimelineUI();
}

function hideTimelinePanel() {
    const panel = document.getElementById('timeline-panel');
    if (panel) {
        panel.classList.add('hidden');
        panel.classList.remove('mobile-open');
    }
    const timeBtn = document.getElementById('mnav-time');
    if (timeBtn) {
        timeBtn.classList.add('hidden');
        timeBtn.classList.remove('active');
    }
}

function updateTimelineDisplay(force = false) {
    const el = document.getElementById('tl-date-display');
    if (!el) return;
    const d = simDate;
    const displayedMinute = Math.floor(d.getTime() / 60000);
    if (!force && displayedMinute === lastTimelineDisplayMinute) return;
    lastTimelineDisplayMinute = displayedMinute;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    el.textContent = `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

function syncTimelineUI() {
    if (orbitalMode === 'custom') simPaused = true;
    document.querySelectorAll('#tl-controls-slider-row button, #tl-speed-slider, #tl-presets button').forEach(el => {
        el.disabled = orbitalMode === 'custom';
    });
    updateSpeedPresetHighlight();
    // Sync play/pause button
    const playBtn = document.getElementById('tl-play-pause');
    if (playBtn) playBtn.textContent = simPaused ? '▶' : '⏸';

    // Sync speed label
    const speedLabel = document.getElementById('tl-speed-label');
    if (speedLabel) {
        if (simPaused) {
            speedLabel.textContent = orbitalMode === 'custom' ? 'Custom · fixed orbits' : 'Paused';
        } else {
            speedLabel.textContent = formatSimRate(getSimulationRate() / MS_PER_DAY);
        }
    }

    // Sync date picker
    const picker = document.getElementById('tl-date-picker');
    if (picker) {
        // datetime-local requires local ISO format: YYYY-MM-DDTHH:mm
        const offset = simDate.getTimezoneOffset() * 60000;
        const localISO = new Date(simDate.getTime() - offset).toISOString().slice(0, 16);
        picker.value = localISO;
    }
}

function toggleHomeIndicator() {
    showHomeIndicator = !showHomeIndicator;
    document.getElementById('home-indicator-mode').textContent = showHomeIndicator ? 'On' : 'Off';

    const indicator = document.getElementById('home-indicator');
    if (!showHomeIndicator) {
        indicator.classList.add('hidden');
    }
}

function toggleShowStars() {
    showStars = !showStars;
    if (starField) starField.visible = showStars; // background real-sky starfield
    syncStarsMenu();
}

function toggleBigStars() {
    showBigStars = !showBigStars;
    updateZoomLevel(); // re-evaluate visibility of the named star systems
    syncStarsMenu();
}

function toggleConstellations() {
    showConstellations = !showConstellations;
    constellationIntro = null; // the user's choice wins over the intro
    setConstellationOpacity(showConstellations ? 1 : 0);
    syncStarsMenu();
}

// Fade constellation lines and labels (1 = normal look, 0 = hidden)
function setConstellationOpacity(f) {
    if (!constellationsGroup) return;
    constellationsGroup.visible = f > 0.001;
    constellationsGroup.traverse(o => {
        if (!o.material) return;
        o.material.userData.baseOpacity ??= o.material.opacity;
        o.material.opacity = o.material.userData.baseOpacity * f;
    });
}

function updateConstellationIntro() {
    if (!constellationIntro || !constellationsGroup) return;
    // Start timing when the scene is up and the constellations have loaded,
    // not at script load (slow connections would eat into the 3 s delay)
    constellationIntro.start ??= performance.now();
    const { delay, fadeIn, fadeOut } = CONSTELLATION_INTRO;
    const t = performance.now() - constellationIntro.start - delay;
    let f = 0;
    if (t > 0 && t < fadeIn) f = t / fadeIn;
    else if (t >= fadeIn) f = 1 - Math.min(1, (t - fadeIn) / fadeOut);
    setConstellationOpacity(f * f * (3 - 2 * f));
    if (t >= fadeIn + fadeOut) constellationIntro = null; // ends off
}

// ── Stars menu (bottom bar) ─────────────────────────────────────────────
function syncStarsMenu() {
    const set = (id, on) => { const el = document.getElementById(id); if (el) el.checked = on; };
    set('menu-background-stars', showStars);
    set('menu-big-stars', showBigStars);
    set('menu-constellations', showConstellations);
    set('menu-pull-far-stars', pullFarStars);
    const pullBox = document.getElementById('menu-pull-far-stars');
    if (pullBox) {
        pullBox.disabled = scaleMode === 'realistic';
        pullBox.closest('.popup-row')?.classList.toggle('disabled', pullBox.disabled);
    }
    const pullNote = document.getElementById('pull-far-note');
    if (pullNote) pullNote.textContent = scaleMode === 'realistic'
        ? 'Realistic scale always shows true distances; pick Compressed or Max to pull far objects in'
        : 'Brings giant stars, galaxies and quasars in close for comparing (distances squeezed logarithmically; nothing overlaps)';
    // Pulling far objects in replaces the star-scale choice
    const locked = scaleMode === 'realistic' || starsPulledInNow;
    document.querySelectorAll('input[name="star-scale"]').forEach(r => {
        r.checked = r.value === effectiveStarScale();
        r.disabled = locked;
        r.closest('.popup-row')?.classList.toggle('disabled', locked);
    });
    const note = document.getElementById('star-scale-note');
    if (note) note.hidden = !(scaleMode === 'realistic');
    const summary = document.getElementById('stars-menu-summary');
    if (summary) summary.textContent = starsPulledInNow
        ? 'pulled in'
        : STAR_SCALES[effectiveStarScale()].label.replace('Compressed ', '').replace(/[()]/g, '');
}

// Hover opens on devices with a mouse; click/tap toggles everywhere (phones)
function setupPopupMenus() {
    document.querySelectorAll('.popup-menu').forEach(menu => {
        const button = menu.querySelector('.popup-menu-button');
        const panel = menu.querySelector('.popup-menu-panel');
        const setOpen = open => {
            menu.classList.toggle('open', open);
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        button.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!menu.classList.contains('open')); });
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            let closeTimer = null;
            menu.addEventListener('mouseenter', () => { clearTimeout(closeTimer); setOpen(true); });
            menu.addEventListener('mouseleave', () => { closeTimer = setTimeout(() => setOpen(false), 250); });
        }
        panel.addEventListener('click', e => e.stopPropagation());
        document.addEventListener('click', () => setOpen(false));
    });
    document.getElementById('menu-background-stars')?.addEventListener('change', toggleShowStars);
    document.getElementById('menu-big-stars')?.addEventListener('change', toggleBigStars);
    document.getElementById('menu-constellations')?.addEventListener('change', toggleConstellations);
    document.querySelectorAll('input[name="star-scale"]').forEach(r =>
        r.addEventListener('change', () => { if (r.checked) setStarScale(r.value); }));
    document.getElementById('menu-pull-far-stars')?.addEventListener('change', e => {
        setPullFarStars(e.target.checked);
        syncStarsMenu();
    });
    syncStarsMenu();
}



function applyViewModeFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const requestedMode = urlParams.get('mode') === 'sizeCompare' ? 'sizeCompare' : 'map';
    if (requestedMode !== viewMode) toggleViewMode(null, false);

    const target = urlParams.get('target');
    if (requestedMode === 'sizeCompare' && target) {
        focusOnSizeComparisonObject(target);
    }
}

function toggleViewMode(e, updateHistory = true) {
    finishCustomOrbitDrag(true);
    if (e && e.preventDefault) {
        e.preventDefault();
    }

    viewMode = viewMode === 'map' ? 'sizeCompare' : 'map';
    
    // Safely update label if it exists
    const viewModeLabel = document.getElementById('view-mode');
    if (viewModeLabel) {
        viewModeLabel.textContent = viewMode === 'map' ? 'Map' : 'Size Compare';
    }
    
    // Update Toggle Button HREF and Browser URL
    const toggleBtn = document.getElementById('view-mode-toggle');
    const headerBtn = document.getElementById('size-compare-btn');
    const panControlHint = document.getElementById('pan-control-hint');
    const url = new URL(window.location);
    
    if (viewMode === 'sizeCompare') {
        // Disable zoom/pan (handled manually via scroll) but allow horizontal
        // orbit. Clamp polar angle so the user can't flip under or over objects.
        controls.enableZoom = false;
        controls.enablePan = false;
        controls.enableRotate = true;
        controls.minPolarAngle = Math.PI * 0.25; // 45° from top
        controls.maxPolarAngle = Math.PI * 0.75; // 45° from bottom
        
        // Hide pan instructions
        if (panControlHint) panControlHint.style.display = 'none';

        // Switch to size comparison view
        hideMapView();
        createSizeComparisonView();
        populateObjectList(); // Refresh sidebar with comparison objects
        
        // Update URL to reflect Size Compare mode
        url.searchParams.set('mode', 'sizeCompare');
        if (updateHistory) window.history.pushState({mode: 'sizeCompare'}, '', url);
        
        // Update buttons to link back to Map
        if (toggleBtn) toggleBtn.setAttribute('href', '?mode=map');
        if (headerBtn) {
            headerBtn.setAttribute('href', '?mode=map');
            const textSpan = headerBtn.querySelector('.text');
            const iconSpan = headerBtn.querySelector('.icon');
            if (textSpan) textSpan.textContent = 'Map View';
            if (iconSpan) iconSpan.textContent = '🗺️';
        }
        updateMobileCompareButton('🗺️', 'Map');
        const arrows = document.getElementById('compare-arrows');
        if (arrows) arrows.classList.remove('hidden');
        
    } else {
        // Re-enable full OrbitControls for map view and remove polar clamp
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.enableRotate = true;
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = Math.PI;

        // Reset target panning when returning to map
        controls.target.set(0, 0, 0);

        // Show pan instructions
        if (panControlHint) panControlHint.style.display = 'block';

        // Switch back to map view
        hideSizeComparisonView();
        showMapView();
        populateObjectList(); // Refresh sidebar with normal objects
        
        // Update URL to reflect Map mode (default)
        url.searchParams.delete('mode');
        url.searchParams.delete('target'); // Clear target too
        if (updateHistory) window.history.pushState({mode: 'map'}, '', url);
        
        // Update buttons to link to Size Compare
        if (toggleBtn) toggleBtn.setAttribute('href', '?mode=sizeCompare');
        if (headerBtn) {
            headerBtn.setAttribute('href', '?mode=sizeCompare');
            const textSpan = headerBtn.querySelector('.text');
            const iconSpan = headerBtn.querySelector('.icon');
            if (textSpan) textSpan.textContent = 'Size Comparison';
            if (iconSpan) iconSpan.textContent = '📏';
        }
        updateMobileCompareButton('📏', 'Compare');
        const arrows = document.getElementById('compare-arrows');
        if (arrows) arrows.classList.add('hidden');
    }

    updateUI();
}

function updateMobileCompareButton(icon, label) {
    const btn = document.getElementById('mnav-compare');
    if (!btn) return;
    const iconSpan = btn.querySelector('.mnav-icon');
    const labelSpan = btn.querySelector('.mnav-label');
    if (iconSpan) iconSpan.textContent = icon;
    if (labelSpan) labelSpan.textContent = label;
}

function hideMapView() {
    // Hide solar system objects
    celestialBodies.forEach((body, name) => {
        if (body.mesh) {
            body.mesh.visible = false;
        }
    });

    // Build a set of valid active meshes to check against
    const validMeshes = new Set();
    celestialBodies.forEach(body => {
        if (body.mesh) validMeshes.add(body.mesh);
        if (body.visualMesh) validMeshes.add(body.visualMesh);
        if (body.orbitGroup) validMeshes.add(body.orbitGroup);
    });

    // Also look for and hide any objects in the scene that look like celestial bodies but aren't in the map
    // (potential orphans from previous bugs)
    scene.children.forEach(child => {
        // If it's a Group or Mesh, and not part of our known structures
        const isKnown = 
            child === starField || 
            child === sizeComparisonGroup || 
            child.isLight || 
            child.type === 'CameraHelper' || // Don't hide helpers if they exist
            validMeshes.has(child); // Strict reference check!
            
        // Check if it's one of the known heavy hitters that isn't light/camera/helper
        if (!isKnown && (child.type === 'Group' || child.type === 'Mesh')) {
            child.visible = false;
        }
    });
    
    // Hide orbit lines
    orbitLines.forEach((orbit, name) => {
        if (orbit.visible) orbit.visible.visible = false;
        if (orbit.hitTarget) orbit.hitTarget.visible = false;
    });
    
    // Star field remains visible in all modes
    if (starField) {
        starField.visible = showStars;
    }
    
    // Hide timeline panel when exiting map view
    hideTimelinePanel();
}

function showMapView() {
    // Hide size comparison view
    hideSizeComparisonView();
    
    // Show solar system objects
    celestialBodies.forEach((body, name) => {
        if (body.mesh) {
            // Visibility depends on zoom level, handled by updateZoomLevel
            body.mesh.visible = true;
        }
    });

    // We don't restore visibility of orphans - they stay hidden forever (good riddance)
    
    // Show orbit lines
    orbitLines.forEach((orbit, name) => {
        if (orbit.visible) orbit.visible.visible = true;
        if (orbit.hitTarget) orbit.hitTarget.visible = true;
    });
    
    // Show star field based on toggle
    if (starField) {
        starField.visible = showStars;
    }
    
    // Show timeline panel when entering map view
    showTimelinePanel();
    
    // Reset camera to Earth view
    flyToEarth();
    
    // Update visibility based on current zoom level
    updateZoomLevel();
}

function hideSizeComparisonView() {
    if (sizeComparisonGroup) {
        sizeComparisonGroup.visible = false;
    }
}

function disposeDetachedObject(root) {
    root.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.filter(Boolean).forEach(material => {
            Object.values(material).forEach(value => {
                if (value && value.isTexture) value.dispose();
            });
            material.dispose();
        });
    });
}

function focusSizeComparisonStart() {
    const startObjName = 'Gaia BH1';
    const startObj = sizeComparisonObjects.get(startObjName);
    if (!startObj) {
        camera.position.set(0, 0, 5000);
        controls.target.set(0, 0, 0);
        return;
    }

    scene.updateMatrixWorld(true);
    focusOnSizeComparisonObject(startObjName);

    // The comparison view intentionally opens at its starting object rather
    // than replaying a long transition from the map's coordinate scale.
    if (flyToAnimation) {
        camera.position.copy(flyToAnimation.endPos);
        controls.target.copy(flyToAnimation.endTarget);
        if (flyToAnimation.endMinDistance !== undefined) {
            controls.minDistance = flyToAnimation.endMinDistance;
        }
        controls.update();
        flyToAnimation = null;
    }
}

function createSizeComparisonView() {
    // This scene is expensive to build; retain and reuse it across view toggles.
    if (sizeComparisonGroup) {
        sizeComparisonGroup.visible = true;
        focusSizeComparisonStart();
        return;
    }
    
    // Create a new group for size comparison objects
    sizeComparisonGroup = new THREE.Group();
    
    let currentX = 0;
    const spacing = 300; // Increased spacing between objects to prevent crowding
    
    // Track added names to prevent duplicates
    const addedNames = new Set();

    sizeComparisonCatalog.forEach((data, index) => {
        // Skip if we already added an object with this name
        if (addedNames.has(data.name)) return;
        addedNames.add(data.name);

        // Try to merge full data from the map so we have colors
        let fullData = data;
        const mainBody = celestialBodies.get(data.name);
        if (mainBody && mainBody.data) {
            fullData = { ...mainBody.data, ...data };
        }

        // Create mesh for this object
        const mesh = createBodyMesh(fullData);
        
        // Strip atmosphere/cloud/glow children — we only want the solid sphere,
        // rings and a star's limb plasma.
        for (let i = mesh.children.length - 1; i >= 0; i--) {
            const child = mesh.children[i];
            if ((child.geometry && child.geometry.type === 'RingGeometry') || child.name === 'stellarLimb') {
                continue;
            }
            mesh.remove(child);
            disposeDetachedObject(child);
        }

        // Calculate the actual radius used by createBodyMesh to generate the geometry
        let actualGeoRadius;
        if (data.type === 'star') {
            actualGeoRadius = Math.max(data.radius / 50000, 5);
        } else if (data.type === 'moon') {
            actualGeoRadius = Math.max(data.radius / 5000, 0.3);
        } else if (data.type === 'blackhole') {
            actualGeoRadius = Math.max(data.radius / 5000, 1);
        } else {
            actualGeoRadius = Math.max(data.radius / 5000, 1);
        }

        // TRUE SCALE MODE: Use a linear scale where we simply divide the km by a constant.
        // 1 unit = 2000 km.
        // Earth (6371) -> ~3.18 units.
        // Sun (696340) -> ~348 units.
        // Stephenson (2.15B) -> ~1,075,000 units.
        // This makes Stephenson about 337,000x wider than Earth visually.
        const scaleFactor = 2000; 
        const targetRadius = data.radius / scaleFactor;
        
        // Apply scaling to the mesh to match the target visual radius
        if (actualGeoRadius > 0) {
            const scale = targetRadius / actualGeoRadius;
            mesh.scale.set(scale, scale, scale);
        }

        // Black holes: ray-traced disk and shadow in local space (scales with the mesh)
        if (data.type === 'blackhole') {
            mesh.add(createBlackHoleVisual(actualGeoRadius, data.accretionColor || 0xFF7A30, data.name.length, stellarTime));
        }
        
        // Black holes' disks and lensed arcs reach ~9 Rs, so space by that
        const renderRadius = data.type === 'blackhole' ? targetRadius * BLACK_HOLE_REACH : targetRadius;

        // Position object - add spacing based on size to prevent overlap,
        // using renderRadius so halos don't overlap previous objects.
        const positionX = currentX + renderRadius;
        mesh.position.set(positionX, 0, 0);
        
        // Add to group
        sizeComparisonGroup.add(mesh);
        
        // Store reference
        sizeComparisonObjects.set(data.name, {
            mesh: mesh,
            data: data,
            type: data.type
        });
        
        // Advance currentX past this object's right edge, plus a proportional gap.
        // A standard 15% gap is used (minimum 2.0 units to keep small objects closer together).
        const gap = Math.max(renderRadius * 0.15, 2.0);
        const nextSpacing = renderRadius + gap;
        currentX = positionX + nextSpacing;
    });
    
    // Keep the small end of the lineup near the scene origin. Centering the
    // complete lineup (including hundred-million-unit black holes) pushed the
    // planets and ordinary stars to roughly -424 million units, where float32
    // GPU coordinates quantized otherwise-smooth camera moves into visible
    // jumps. Giant objects remain precise because their own scale is enormous.
    sizeComparisonGroup.position.x = 0;
    
    // Add to scene
    scene.add(sizeComparisonGroup);
    
    // Position camera to see all objects? NO.
    // Seeing all objects in loose linear scale is impossible (Earth becomes sub-pixel).
    // Instead, start at the BEGINNING (Earth) so the user can scroll/pan right.
    // Place camera near Earth but back enough to see the first few objects.
    
    // All focus and navigation calculations use each mesh's world position, so
    // anchoring instead of centering does not change lineup behavior.
    
    focusSizeComparisonStart();
    
    // Clear any focused body
    // currentFocusedBody = null; // Keep it focused on Earth per logic above
}

function detectUserLocation() {
    fetch('https://ipapi.co/json/')
        .then(response => {
            if (!response.ok) throw new Error('HTTP error ' + response.status);
            return response.json();
        })
        .then(data => {
            if (data.latitude && data.longitude) {
                applyLocation(data.latitude, data.longitude, data.city, data.country_name);
            } else {
                throw new Error('No lat/lon in response');
            }
        })
        .catch(err => {
            console.warn('Primary geo API failed, trying fallback:', err);
            fetch('https://freeipapi.com/api/json')
                .then(r => {
                    if (!r.ok) throw new Error('HTTP error ' + r.status);
                    return r.json();
                })
                .then(data => {
                    if (data.latitude && data.longitude) {
                        applyLocation(data.latitude, data.longitude, data.cityName, data.countryName);
                    }
                })
                .catch(err2 => {
                    console.warn('Fallback geo API also failed:', err2);
                });
        });
}

function applyLocation(lat, lon, city, country) {
    userLatitude = parseFloat(lat);
    userLongitude = parseFloat(lon);
    userCity = city || 'your location';
    userCountry = country || '';
    console.log(`Detected location: ${userCity}, ${userCountry} (${userLatitude}, ${userLongitude})`);
}

function updateUserMarker(earthMesh) {
    if (!earthMesh) return;
    
    // If marker doesn't exist, create it
    if (!userMarker) {
        // A small glowing red target dot
        const markerGeo = new THREE.SphereGeometry(0.02, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({
            color: 0xff3344, // Bright glowing red-pink
            transparent: true,
            opacity: 0.95
        });
        userMarker = new THREE.Mesh(markerGeo, markerMat);
        
        // Add a little target ring around it
        const ringGeo = new THREE.RingGeometry(0.035, 0.05, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff3344,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.65
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        userMarker.add(ring);
    }
    
    // Position it locally on the Earth's surface
    const radius = earthMesh.geometry && earthMesh.geometry.parameters 
        ? earthMesh.geometry.parameters.radius 
        : 1.0;
        
    const latRad = THREE.MathUtils.degToRad(userLatitude);
    const lonRad = THREE.MathUtils.degToRad(userLongitude);
    
    const localPos = new THREE.Vector3(
        radius * Math.cos(latRad) * Math.cos(lonRad),
        radius * Math.sin(latRad),
        -radius * Math.cos(latRad) * Math.sin(lonRad)
    );
    
    userMarker.position.copy(localPos);
    
    // Align target ring with the surface normal vector (localPos)
    userMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localPos.clone().normalize());
    
    // Ensure it is added as a child of the Earth mesh so it rotates dynamically
    if (userMarker.parent !== earthMesh) {
        earthMesh.add(userMarker);
    }

    // Shrink with camera distance in close-ups: at full size the ring is
    // ~250 km across and would blanket the satellite imagery
    userMarker.getWorldPosition(_markerWorldPos);
    userMarker.scale.setScalar(Math.min(1, camera.position.distanceTo(_markerWorldPos) / (radius * 2)));
}

const STAR_SPIKE_FADE_PX = [4, 18];
const _starWorldScale = new THREE.Vector3();
function updateStarMeshEffects(starMesh, time) {
    if (!starMesh) return;
    
    // Pulsing texture effect
    if (starMesh.material && starMesh.material.map) {
        const pulse = 1 + Math.sin(time * 2 + starMesh.position.x) * 0.02;
        starMesh.material.color.setScalar(pulse);
    }
    
    // Fade out glare spikes and outer corona up close
    const visualRadius = starMesh.userData.visualRadius || 5;
    
    starMesh.getWorldPosition(_animWorldPosition);
    
    const dist = camera.position.distanceTo(_animWorldPosition);

    // The physical sprite scale used to make distant interactive stars collapse
    // down to the same few pixels as the non-clickable sky. Expand only the
    // existing glint enough to hold a small screen-space footprint. Larger and
    // nearby stars keep their normal scale, and the close-range fade below still
    // removes the photographic glare when the viewer approaches the surface.
    let minimumGlintScale = 0;
    if (viewMode === 'map' && camera.isPerspectiveCamera) {
        const viewportHeight = Math.max(window.innerHeight, 1);
        const projectionScale = camera.projectionMatrix.elements[5];
        minimumGlintScale = (MIN_INTERACTIVE_STAR_GLINT_PX * 2 * dist)
            / (viewportHeight * projectionScale);
    }
    
    // Diffraction spikes belong to unresolved points of light: fade them out
    // as the disc grows on screen (radius STAR_SPIKE_FADE_PX[0] → [1] pixels)
    starMesh.getWorldScale(_starWorldScale);
    const pixelRadius = camera.isPerspectiveCamera
        ? (visualRadius * _starWorldScale.x / Math.max(dist, 1e-9))
            * camera.projectionMatrix.elements[5] * Math.max(window.innerHeight, 1) / 2
        : Infinity;
    const [spikeFull, spikeGone] = STAR_SPIKE_FADE_PX;
    const fadeFactor = 1 - THREE.MathUtils.smoothstep(pixelRadius, spikeFull, spikeGone);
    // The limb plasma is invisible (and wasted fill) on a star a few pixels across
    starMesh.children.forEach(child => {
        if (child.name === 'stellarLimb') child.visible = pixelRadius > 4;
    });
    
    starMesh.children.forEach(child => {
        if (child.name === 'starSpike' && child.material) {
            const baseScale = child.userData.baseScale || visualRadius * 5;
            child.scale.setScalar(Math.max(baseScale, minimumGlintScale));
            child.material.opacity = fadeFactor;
            child.visible = fadeFactor > 0.001;
        } else if (child.name === 'starGlow3' && child.material) {
            child.material.opacity = 0.05 * fadeFactor;
            child.visible = fadeFactor > 0.001;
        } else if (child.name === 'starGlow2' && child.material) {
            child.material.opacity = 0.15 * fadeFactor;
            child.visible = fadeFactor > 0.001;
        } else if (child.name === 'starGlow1' && child.material) {
            child.material.opacity = 0.05 + 0.25 * fadeFactor;
        }
    });
}

function updateHomeIndicator() {
    const indicator = document.getElementById('home-indicator');
    const homeLabel = document.getElementById('home-label');

    if (!showHomeIndicator) {
        if (!indicator.classList.contains('hidden')) {
             indicator.classList.add('hidden');
        }
        return;
    }

    let homePosition = new THREE.Vector3(0, 0, 0);
    let homeObjectFound = false;
    let earthMesh = null;

    // Get Earth's position based on view mode
    if (viewMode === 'sizeCompare') {
        const earthObj = sizeComparisonObjects.get('Earth');
        if (earthObj && earthObj.mesh) {
            earthMesh = earthObj.mesh;
        }
    } else {
        const earthBody = celestialBodies.get('Earth');
        if (earthBody && earthBody.mesh) {
            earthMesh = earthBody.mesh;
        }
    }
    
    if (earthMesh) {
        // Ensure world matrix is up to date
        earthMesh.updateWorldMatrix(true, false);
        
        // Earth's visual radius in the scene
        const radius = earthMesh.geometry && earthMesh.geometry.parameters 
            ? earthMesh.geometry.parameters.radius 
            : 1.0;
            
        // Convert lat/lon to radians
        const latRad = THREE.MathUtils.degToRad(userLatitude);
        const lonRad = THREE.MathUtils.degToRad(userLongitude);
        
        // Convert to Cartesian local coordinates mapping SphereGeometry:
        // x = R * cos(lat) * sin(lon)
        // y = R * sin(lat)
        // z = R * cos(lat) * cos(lon)
        const localPos = new THREE.Vector3(
            radius * Math.cos(latRad) * Math.cos(lonRad),
            radius * Math.sin(latRad),
            -radius * Math.cos(latRad) * Math.sin(lonRad)
        );
        
        // Transform local position to world coordinates (updates as Earth rotates)
        homePosition.copy(localPos).applyMatrix4(earthMesh.matrixWorld);
        homeObjectFound = true;
        
        // Update the 3D pin/ring marker on Earth
        updateUserMarker(earthMesh);
    }
    
    // If we can't find Earth, hide the indicator
    if (!homeObjectFound) {
        indicator.classList.add('hidden');
        return;
    }

    // Update camera matrices before projection
    camera.updateMatrixWorld();
    const homeScreenPos = homePosition.clone().project(camera);

    // Calculate distance
    let distanceKm = 0;
    // (AU imported from celestialData.js)
    
    if (viewMode === 'sizeCompare') {
        // In size compare mode, 1 unit = 2000 km
        const distanceUnits = camera.position.distanceTo(homePosition);
        distanceKm = distanceUnits * 2000;
    } else {
        // Map mode calculations
        if (currentFocusedBody === 'Earth' || !currentFocusedBody) {
            const rawDist = camera.position.distanceTo(homePosition);
            const radiusUnits = earthMesh.geometry && earthMesh.geometry.parameters 
                ? earthMesh.geometry.parameters.radius 
                : 1.0;
            const distRatio = rawDist / radiusUnits;
            
            if (distRatio < 50.0) {
                // Close to Earth: calculate height relative to Earth's radius (6371 km)
                // This accounts for the planet scale exaggeration in compressed mode
                distanceKm = distRatio * 6371;
            } else {
                // Far from Earth: use orbital scale
                const unitToKm = AU / currentUnitsPerAU;
                distanceKm = rawDist * unitToKm;
            }
        } else {
            const focusedBody = celestialBodies.get(currentFocusedBody);
            if (focusedBody) {
                if (focusedBody.isDistant && focusedBody.data && focusedBody.data.distance) {
                    distanceKm = focusedBody.data.distance;
                } else {
                    // Solar system bodies: use precise dynamic geocentric distance helper
                    distanceKm = getCurrentDistanceToEarth(focusedBody.data);
                }
            }
            // Nothing selected, or no distance of its own (e.g. the "Solar
            // System" marker): measure from the camera instead of showing NaN
            if (!focusedBody || !Number.isFinite(distanceKm)) {
                distanceKm = camera.position.distanceTo(homePosition) * (AU / currentUnitsPerAU);
            }
        }
    }

    // Format distance appropriately
    let distanceText;
    const isSolarSystemView = !(currentFocusedBody && celestialBodies.get(currentFocusedBody) && celestialBodies.get(currentFocusedBody).isDistant);
    
    if (isSolarSystemView && distanceKm < 0.1 * LY) {
        distanceText = formatDistance(distanceKm, true);
    } else {
        const distanceLy = distanceKm / LY;
        if (distanceLy < 10) {
            distanceText = `${distanceLy.toFixed(1)} Ly`;
        } else if (distanceLy < 1000) {
            distanceText = `${Math.round(distanceLy)} Ly`;
        } else {
            distanceText = `${(distanceLy / 1000).toFixed(1)}k Ly`;
        }
    }

    homeLabel.textContent = `You (${userCity}) - ${distanceText}`;

    // Transform home position to camera space to check if it's in front
    const homeInCameraSpace = homePosition.clone().applyMatrix4(camera.matrixWorldInverse);
    const isInFront = homeInCameraSpace.z < 0;

    let x, y;

    if (isInFront) {
        // Home is in front of camera - use normal projection
        x = (homeScreenPos.x * 0.5 + 0.5) * window.innerWidth;
        y = ((-homeScreenPos.y) * 0.5 + 0.5) * window.innerHeight;
    } else {
        // Home is behind camera - calculate direction in camera space
        // Get direction from camera to home in world space
        const directionToHome = homePosition.clone().sub(camera.position).normalize();

        // Transform to camera space
        const cameraDirection = directionToHome.clone().applyQuaternion(camera.quaternion.clone().invert());

        // Project the direction onto screen
        // In camera space: +X is right, +Y is up, -Z is forward
        // Since home is behind us (cameraDirection.z > 0), we need to point to where it would appear
        
        // We want to force the indicator to the edge of the screen in the direction of the object
        // Normalize the x/y components to push it reliably off-screen to be clamped later
        
        const dirX = cameraDirection.x;
        const dirY = cameraDirection.y;
        
        // Calculate length of the 2D vector in the view plane
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        
        let normalizedX, normalizedY;
        
        if (len < 0.001) {
            // Directly behind - default to bottom
            normalizedX = 0;
            normalizedY = -1;
        } else {
            normalizedX = dirX / len;
            normalizedY = dirY / len;
        }
        
        // Push well outside screen bounds so clamping takes effect
        // Note: +X is Right so we add to 0.5
        // Note: +Y is Up, but screen Y is Down, so we subtract (invert sign mechanism)
        const scale = 2.0; 
        
        x = (normalizedX * scale * 0.5 + 0.5) * window.innerWidth;
        y = ((-normalizedY) * scale * 0.5 + 0.5) * window.innerHeight;
    }

    const margin = 40; // Distance from edge
    
    // Check if sidebar is visible to adjust minX
    const sidebar = document.getElementById('sidebar');
    const isCollapsed = sidebar && sidebar.classList.contains('collapsed');
    const sidebarWidth = sidebar && window.innerWidth > 768 && !isCollapsed ? sidebar.offsetWidth : 0;
    
    const minX = margin + sidebarWidth;
    const maxX = window.innerWidth - margin;
    const minY = margin;
    const maxY = window.innerHeight - margin;

    // If home is in front and within safe screen bounds, position indicator at home's location
    if (isInFront && x >= minX && x <= maxX && y >= minY && y <= maxY) {
        indicator.style.left = x + 'px';
        indicator.style.top = y + 'px';
        indicator.style.transform = `translate(-50%, -4px)`;
        indicator.classList.remove('hidden');
    } else {
        // Home is off-screen or behind UI - position indicator at edge pointing toward home
        
        // Center of screen (visual center accounting for sidebar)
        const cx = sidebarWidth + (window.innerWidth - sidebarWidth) / 2;
        const cy = window.innerHeight / 2;
        
        // Direction from center to target
        const dx = x - cx;
        const dy = y - cy;
        
        let edgeX = x;
        let edgeY = y;
        
        // If target is exactly at center, default to bottom
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
            edgeX = cx;
            edgeY = maxY;
        } else {
            // Calculate intersections with all 4 edges
            // t is the parameter along the ray from center to target
            let t = Infinity;
            
            if (dx > 0) {
                t = Math.min(t, (maxX - cx) / dx);
            } else if (dx < 0) {
                t = Math.min(t, (minX - cx) / dx);
            }
            
            if (dy > 0) {
                t = Math.min(t, (maxY - cy) / dy);
            } else if (dy < 0) {
                t = Math.min(t, (minY - cy) / dy);
            }
            
            // Apply the smallest positive t to get the intersection point
            edgeX = cx + dx * t;
            edgeY = cy + dy * t;
        }

        indicator.style.left = edgeX + 'px';
        indicator.style.top = edgeY + 'px';
        indicator.style.transform = `translate(-50%, -4px)`;
        indicator.classList.remove('hidden');
    }
}

function toggleCategorySortMode(categoryName) {
    const currentMode = categorySortModes[categoryName];

    // Cycle through: name -> size -> distance -> name
    if (currentMode === 'name') {
        categorySortModes[categoryName] = 'size';
    } else if (currentMode === 'size') {
        categorySortModes[categoryName] = 'distance';
    } else {
        categorySortModes[categoryName] = 'name';
    }

    // Re-populate the list with new sorting
    populateObjectList();
}

function setupTravelStreaks() {
    travelStreakCanvas = document.getElementById('travel-streaks');
    if (!travelStreakCanvas) return;
    travelStreakContext = travelStreakCanvas.getContext('2d');
    resizeTravelStreaks();
}

function setupStellarComparison() {
    stellarComparisonOverlay = document.getElementById('stellar-comparison');
    const sunElement = document.getElementById('sun-hologram');
    const earthElement = document.getElementById('earth-hologram');
    if (!stellarComparisonOverlay || !sunElement || !earthElement) return;

    sunHologram = {
        element: sunElement,
        ratioLabel: sunElement.querySelector('.hologram-ratio')
    };
    earthHologram = {
        element: earthElement,
        ratioLabel: earthElement.querySelector('.hologram-ratio')
    };

    const toggleSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'];
    let sequenceIndex = 0;
    let statusTimer = null;
    window.addEventListener('keydown', event => {
        const target = event.target;
        const isTyping = target instanceof HTMLElement
            && (target.isContentEditable
                || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
        if (isTyping || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;

        if (event.key === toggleSequence[sequenceIndex]) {
            sequenceIndex += 1;
        } else {
            sequenceIndex = event.key === toggleSequence[0] ? 1 : 0;
        }
        if (sequenceIndex !== toggleSequence.length) return;

        sequenceIndex = 0;
        // ↑↑↓↓ is also the opening of the Konami code, so defer the toggle long
        // enough for setupKonamiCode() to cancel it if the sequence continues.
        clearTimeout(hologramToggleTimer);
        hologramToggleTimer = setTimeout(() => applyHologramToggle(), 900);
    });

    function applyHologramToggle() {
        stellarComparisonEnabled = !stellarComparisonEnabled;
        if (!stellarComparisonEnabled) {
            stellarComparisonOpacity = 0;
            stellarComparisonOverlay.style.opacity = '0';
            stellarComparisonOverlay.setAttribute('aria-hidden', 'true');
        }

        let status = document.getElementById('secret-hologram-status');
        if (!status) {
            status = document.createElement('div');
            status.id = 'secret-hologram-status';
            Object.assign(status.style, {
                position: 'fixed',
                left: '50%',
                top: '18px',
                transform: 'translateX(-50%)',
                zIndex: '10000',
                padding: '7px 12px',
                border: '1px solid rgba(82, 199, 255, 0.6)',
                borderRadius: '5px',
                background: 'rgba(0, 18, 38, 0.92)',
                color: '#8de3ff',
                font: '11px monospace',
                letterSpacing: '0.08em',
                pointerEvents: 'none'
            });
            document.body.appendChild(status);
        }
        status.textContent = `LEGACY HOLOGRAMS ${stellarComparisonEnabled ? 'ENABLED' : 'DISABLED'}`;
        status.style.display = 'block';
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => {
            status.style.display = 'none';
        }, 1800);
        console.info(`Stellar comparison holograms ${stellarComparisonEnabled ? 'enabled' : 'disabled'}`);
    }
}

// Konami code: ↑↑↓↓←→←→BA — flies the map to Uranus and pins a CodeMiko arrow
// on it, styled like the "You" home arrow.
function setupKonamiCode() {
    const konami = [
        'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
        'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
        'b', 'a'
    ];
    let index = 0;

    window.addEventListener('keydown', event => {
        const target = event.target;
        const isTyping = target instanceof HTMLElement
            && (target.isContentEditable
                || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
        if (isTyping || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;

        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        if (key === konami[index]) {
            index += 1;
        } else {
            index = key === konami[0] ? 1 : 0;
        }

        // Past the shared ↑↑↓↓ prefix: this is the Konami code, not the
        // legacy-hologram toggle, so drop that pending toggle.
        if (index > 4) clearTimeout(hologramToggleTimer);

        if (index !== konami.length) return;
        index = 0;
        activateMikoMode();
    });
}

function activateMikoMode() {
    mikoIndicatorActive = true;
    if (viewMode !== 'map') {
        toggleViewMode(); // size-compare has no Uranus orbit to fly to
    }
    focusOnBody('Uranus');
    updateMikoIndicator();
    console.info('Konami code accepted — CodeMiko is on Uranus.');
}

// Mirrors updateHomeIndicator(): projects Uranus to screen space and clamps the
// marker to the viewport edge, pointing toward it when it is off-screen.
function updateMikoIndicator() {
    const indicator = document.getElementById('miko-indicator');
    if (!indicator) return;

    if (!mikoIndicatorActive || viewMode !== 'map') {
        indicator.classList.add('hidden');
        return;
    }

    const uranus = celestialBodies.get('Uranus');
    if (!uranus || !uranus.mesh) {
        indicator.classList.add('hidden');
        return;
    }

    const targetPosition = new THREE.Vector3();
    uranus.mesh.updateWorldMatrix(true, false);
    uranus.mesh.getWorldPosition(targetPosition);

    camera.updateMatrixWorld();
    const screenPos = targetPosition.clone().project(camera);
    const inCameraSpace = targetPosition.clone().applyMatrix4(camera.matrixWorldInverse);
    const isInFront = inCameraSpace.z < 0;

    let x, y;
    if (isInFront) {
        x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
        y = ((-screenPos.y) * 0.5 + 0.5) * window.innerHeight;
    } else {
        const direction = targetPosition.clone().sub(camera.position).normalize()
            .applyQuaternion(camera.quaternion.clone().invert());
        const len = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
        const normalizedX = len < 0.001 ? 0 : direction.x / len;
        const normalizedY = len < 0.001 ? -1 : direction.y / len;
        const scale = 2.0;
        x = (normalizedX * scale * 0.5 + 0.5) * window.innerWidth;
        y = ((-normalizedY) * scale * 0.5 + 0.5) * window.innerHeight;
    }

    const margin = 40;
    const sidebar = document.getElementById('sidebar');
    const isCollapsed = sidebar && sidebar.classList.contains('collapsed');
    const sidebarWidth = sidebar && window.innerWidth > 768 && !isCollapsed ? sidebar.offsetWidth : 0;
    const minX = margin + sidebarWidth;
    const maxX = window.innerWidth - margin;
    const minY = margin;
    const maxY = window.innerHeight - margin;

    if (!(isInFront && x >= minX && x <= maxX && y >= minY && y <= maxY)) {
        const cx = sidebarWidth + (window.innerWidth - sidebarWidth) / 2;
        const cy = window.innerHeight / 2;
        const dx = x - cx;
        const dy = y - cy;

        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
            x = cx;
            y = maxY;
        } else {
            let t = Infinity;
            if (dx > 0) t = Math.min(t, (maxX - cx) / dx);
            else if (dx < 0) t = Math.min(t, (minX - cx) / dx);
            if (dy > 0) t = Math.min(t, (maxY - cy) / dy);
            else if (dy < 0) t = Math.min(t, (minY - cy) / dy);
            x = cx + dx * t;
            y = cy + dy * t;
        }
    }

    indicator.style.left = x + 'px';
    indicator.style.top = y + 'px';
    indicator.style.transform = 'translate(-50%, -4px)';
    indicator.classList.remove('hidden');
}

function setupStellarReferenceMeshes() {
    const sunSource = celestialBodies.get('Sun')?.mesh;
    const earthSource = celestialBodies.get('Earth')?.mesh;
    if (!sunSource?.material || !earthSource?.material) return;

    // Unit spheres share one inexpensive geometry. Their scales are set from
    // the focused star's rendered radius, preserving the physical ratios while
    // adding only two small WebGL draw calls.
    const geometry = new THREE.SphereGeometry(1, 32, 20);
    const sunMaterial = sunSource.material.clone();
    sunMaterial.transparent = true;
    sunMaterial.opacity = 0;
    sunMaterial.depthWrite = false;

    const earthMaterial = new THREE.MeshBasicMaterial({
        map: earthSource.material.map || null,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false
    });

    stellarReferenceSun = new THREE.Mesh(geometry, sunMaterial);
    stellarReferenceEarth = new THREE.Mesh(geometry, earthMaterial);
    stellarReferenceSun.name = 'SunSizeReference';
    stellarReferenceEarth.name = 'EarthSizeReference';
    stellarReferenceSun.visible = false;
    stellarReferenceEarth.visible = false;
    stellarReferenceSun.raycast = function() {};
    stellarReferenceEarth.raycast = function() {};
    scene.add(stellarReferenceSun, stellarReferenceEarth);
}

function updateStellarReferenceMeshes(frameScale) {
    if (!stellarReferenceSun || !stellarReferenceEarth) return;

    let desiredOpacity = 0;
    let comparisonBody = null;
    // The secret toggle swaps in the legacy DOM holograms for testing instead
    // of drawing both comparison systems on top of one another.
    if (!stellarComparisonEnabled && viewMode === 'map' && !flyToAnimation && currentFocusedBody) {
        const focused = celestialBodies.get(currentFocusedBody);
        const isAnotherStar = focused
            && focused.isDistant
            && focused.data?.type === 'star'
            && focused.data.name !== 'Sun'
            && Number.isFinite(focused.data.radius)
            && focused.data.radius > 0;
        if (isAnotherStar) comparisonBody = focused;
    }

    if (comparisonBody) {
        const visualMesh = comparisonBody.visualMesh || comparisonBody.mesh;
        const visualRadius = visualMesh.userData.visualRadius
            || visualMesh.geometry?.parameters?.radius
            || 0;
        comparisonBody.mesh.getWorldPosition(_animWorldPosition);
        _comparisonDirection.copy(_animWorldPosition).sub(camera.position);
        const cameraDistance = _comparisonDirection.length();

        if (visualRadius > 0 && cameraDistance > visualRadius) {
            _comparisonDirection.normalize();
            camera.getWorldDirection(_comparisonCameraForward);
            const alignment = _comparisonCameraForward.dot(_comparisonDirection);
            const distanceInRadii = cameraDistance / visualRadius;
            const proximityFade = 1 - THREE.MathUtils.smoothstep(distanceInRadii, 7.5, 12);
            const alignmentFade = THREE.MathUtils.smoothstep(
                alignment,
                Math.cos(THREE.MathUtils.degToRad(18)),
                Math.cos(THREE.MathUtils.degToRad(5))
            );
            desiredOpacity = proximityFade * alignmentFade;

            if (desiredOpacity > 0.001) {
                const sunRadius = visualRadius
                    * (SUN_REFERENCE_RADIUS_KM / comparisonBody.data.radius);
                const earthRadius = visualRadius
                    * (EARTH_REFERENCE_RADIUS_KM / comparisonBody.data.radius);
                const clearance = visualRadius * 0.55
                    + Math.max(sunRadius, earthRadius) * 0.08;
                _comparisonCameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();

                stellarReferenceSun.scale.setScalar(sunRadius);
                stellarReferenceEarth.scale.setScalar(earthRadius);
                stellarReferenceSun.position.copy(_animWorldPosition).addScaledVector(
                    _comparisonCameraRight,
                    -(visualRadius + sunRadius + clearance)
                );
                stellarReferenceEarth.position.copy(_animWorldPosition).addScaledVector(
                    _comparisonCameraRight,
                    visualRadius + earthRadius + clearance
                );
            }
        }
    }

    const fadeBlend = REDUCED_MOTION_MQ.matches
        ? 1
        : 1 - Math.exp(-Math.max(frameScale, 0.01) * 0.12);
    stellarReferenceOpacity = THREE.MathUtils.lerp(
        stellarReferenceOpacity,
        desiredOpacity,
        fadeBlend
    );
    if (stellarReferenceOpacity < 0.001) stellarReferenceOpacity = 0;

    stellarReferenceSun.material.opacity = stellarReferenceOpacity;
    stellarReferenceEarth.material.opacity = stellarReferenceOpacity;
    const referencesVisible = stellarReferenceOpacity > 0;
    stellarReferenceSun.visible = referencesVisible;
    stellarReferenceEarth.visible = referencesVisible;
    if (referencesVisible) {
        stellarReferenceSun.rotation.y += 0.00035 * frameScale;
        stellarReferenceEarth.rotation.y += 0.0007 * frameScale;
    }
}

function formatHologramRatio(ratio) {
    if (ratio >= 1000) return `${Math.round(ratio).toLocaleString()}× target`;
    if (ratio >= 10) return `${ratio.toFixed(1)}× target`;
    if (ratio >= 1) return `${ratio.toFixed(2)}× target`;

    const inverse = 1 / Math.max(ratio, Number.EPSILON);
    if (inverse >= 1000) return `1 / ${Math.round(inverse).toLocaleString()} target`;
    if (inverse >= 10) return `1 / ${inverse.toFixed(1)} target`;
    return `${ratio.toFixed(2)}× target`;
}

function layoutStellarHologram(hologram, x, y, trueCoreDiameter, maxCoreDiameter, ratio) {
    const coreDiameter = THREE.MathUtils.clamp(trueCoreDiameter, 1, maxCoreDiameter);
    const markerDiameter = Math.max(44, coreDiameter + 14);
    const halfMarker = markerDiameter * 0.5;
    const horizontalMargin = halfMarker + 10;
    const verticalTopMargin = halfMarker + 10;
    const verticalBottomMargin = halfMarker + 58;

    hologram.element.style.setProperty('--core-size', `${coreDiameter.toFixed(2)}px`);
    hologram.element.style.setProperty('--marker-size', `${markerDiameter.toFixed(2)}px`);
    hologram.element.style.left = `${THREE.MathUtils.clamp(
        x,
        horizontalMargin,
        window.innerWidth - horizontalMargin
    ).toFixed(1)}px`;
    hologram.element.style.top = `${THREE.MathUtils.clamp(
        y,
        verticalTopMargin,
        window.innerHeight - verticalBottomMargin
    ).toFixed(1)}px`;
    hologram.ratioLabel.textContent = formatHologramRatio(ratio);

    return markerDiameter;
}

function updateStellarComparison(frameScale) {
    updateStellarReferenceMeshes(frameScale);
    if (!stellarComparisonEnabled) return;
    if (!stellarComparisonOverlay || !sunHologram || !earthHologram) return;

    let desiredOpacity = 0;
    let comparisonBody = null;
    if (viewMode === 'map' && !flyToAnimation && currentFocusedBody) {
        const focused = celestialBodies.get(currentFocusedBody);
        const isAnotherStar = focused
            && focused.isDistant
            && focused.data
            && focused.data.type === 'star'
            && focused.data.name !== 'Sun'
            && Number.isFinite(focused.data.radius)
            && focused.data.radius > 0;
        if (isAnotherStar) comparisonBody = focused;
    }

    if (comparisonBody) {
        const visualMesh = comparisonBody.visualMesh || comparisonBody.mesh;
        const visualRadius = visualMesh.userData.visualRadius
            || visualMesh.geometry?.parameters?.radius
            || 0;
        comparisonBody.mesh.getWorldPosition(_animWorldPosition);
        _comparisonDirection.copy(_animWorldPosition).sub(camera.position);
        const cameraDistance = _comparisonDirection.length();

        if (visualRadius > 0 && cameraDistance > visualRadius) {
            _comparisonDirection.normalize();
            camera.getWorldDirection(_comparisonCameraForward);
            const alignment = _comparisonCameraForward.dot(_comparisonDirection);
            const distanceInRadii = cameraDistance / visualRadius;
            const proximityFade = 1 - THREE.MathUtils.smoothstep(
                distanceInRadii,
                7.5,
                12
            );
            const alignmentFade = THREE.MathUtils.smoothstep(
                alignment,
                Math.cos(THREE.MathUtils.degToRad(18)),
                Math.cos(THREE.MathUtils.degToRad(5))
            );
            desiredOpacity = proximityFade * alignmentFade;

            if (desiredOpacity > 0.001) {
                _comparisonProjectedPosition.copy(_animWorldPosition).project(camera);
                const targetX = (_comparisonProjectedPosition.x * 0.5 + 0.5)
                    * window.innerWidth;
                const targetY = (-_comparisonProjectedPosition.y * 0.5 + 0.5)
                    * window.innerHeight;
                const focalLengthPixels = window.innerHeight
                    / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
                const angularRadius = Math.asin(THREE.MathUtils.clamp(
                    visualRadius / cameraDistance,
                    0,
                    0.99
                ));
                const targetRadiusPixels = Math.tan(angularRadius) * focalLengthPixels;
                const sunRatio = SUN_REFERENCE_RADIUS_KM / comparisonBody.data.radius;
                const earthRatio = EARTH_REFERENCE_RADIUS_KM / comparisonBody.data.radius;
                const maxCoreDiameter = Math.min(
                    window.innerWidth * 0.25,
                    window.innerHeight * 0.34,
                    260
                );
                const sunCoreDiameter = targetRadiusPixels * 2 * sunRatio;
                const earthCoreDiameter = targetRadiusPixels * 2 * earthRatio;
                const estimatedSunMarker = Math.max(
                    44,
                    Math.min(sunCoreDiameter, maxCoreDiameter) + 14
                );
                const estimatedEarthMarker = Math.max(
                    44,
                    Math.min(earthCoreDiameter, maxCoreDiameter) + 14
                );
                // Giant stars need substantially more clearance because their
                // visible corona extends far beyond the solid sphere. Use the
                // Sun-to-target ratio to widen that gap aggressively, while
                // retaining a modestly larger baseline for ordinary stars.
                const giantStarSpacing = 1 - THREE.MathUtils.smoothstep(
                    sunRatio,
                    0.002,
                    0.08
                );
                const clearanceFactor = THREE.MathUtils.lerp(
                    0.45,
                    1.05,
                    giantStarSpacing
                );
                const comparisonClearance = THREE.MathUtils.clamp(
                    targetRadiusPixels * clearanceFactor,
                    64,
                    Math.min(240, window.innerWidth * 0.28)
                );
                const sunGap = targetRadiusPixels
                    + estimatedSunMarker * 0.5
                    + comparisonClearance;
                const earthGap = targetRadiusPixels
                    + estimatedEarthMarker * 0.5
                    + comparisonClearance;

                layoutStellarHologram(
                    sunHologram,
                    targetX - sunGap,
                    targetY,
                    sunCoreDiameter,
                    maxCoreDiameter,
                    sunRatio
                );
                layoutStellarHologram(
                    earthHologram,
                    targetX + earthGap,
                    targetY,
                    earthCoreDiameter,
                    maxCoreDiameter,
                    earthRatio
                );
            }
        }
    }

    const fadeBlend = REDUCED_MOTION_MQ.matches
        ? 1
        : 1 - Math.exp(-Math.max(frameScale, 0.01) * 0.12);
    stellarComparisonOpacity = THREE.MathUtils.lerp(
        stellarComparisonOpacity,
        desiredOpacity,
        fadeBlend
    );
    if (stellarComparisonOpacity < 0.001) stellarComparisonOpacity = 0;
    stellarComparisonOverlay.style.opacity = stellarComparisonOpacity.toFixed(3);
    stellarComparisonOverlay.setAttribute(
        'aria-hidden',
        stellarComparisonOpacity > 0.01 ? 'false' : 'true'
    );
}

function resizeTravelStreaks() {
    if (!travelStreakCanvas || !travelStreakContext) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    travelStreakCanvas.width = Math.round(window.innerWidth * pixelRatio);
    travelStreakCanvas.height = Math.round(window.innerHeight * pixelRatio);
    travelStreakContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const maxRadius = Math.hypot(window.innerWidth, window.innerHeight) * 0.55;
    const particleCount = COARSE_POINTER_MQ.matches ? 65 : 110;
    travelStreakParticles = Array.from({ length: particleCount }, () => ({
        angle: Math.random() * Math.PI * 2,
        radius: Math.pow(Math.random(), 1.6) * maxRadius,
        speed: 2.2 + Math.random() * 5.2,
        alpha: 0.22 + Math.random() * 0.58,
        blue: Math.random() > 0.38
    }));
}

function updateTravelStreaks(animation, frameScale) {
    if (!travelStreakContext || !travelStreakCanvas) return;

    const shouldDraw = animation
        && animation.isInterstellarFlight
        && !REDUCED_MOTION_MQ.matches;

    if (!shouldDraw) {
        if (travelStreaksWereVisible) {
            travelStreakContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
            travelStreaksWereVisible = false;
        }
        return;
    }

    const progress = THREE.MathUtils.clamp(
        (Date.now() - animation.startTime) / animation.duration,
        0,
        1
    );
    // Let the first streaks appear near the end of the pullback/turn, then keep
    // them through more of the direct flight. They still finish comfortably
    // before the destination settles at roughly 92-94% progress.
    const fadeIn = THREE.MathUtils.smoothstep(progress, 0.12, 0.25);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.62, 0.74);
    const intensity = Math.min(fadeIn, fadeOut);

    const ctx = travelStreakContext;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const maxRadius = Math.hypot(width, height) * 0.55;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    travelStreakParticles.forEach((particle) => {
        particle.radius += particle.speed * (0.55 + intensity * 2.8) * frameScale;
        if (particle.radius > maxRadius) {
            particle.radius = Math.random() * maxRadius * 0.06;
            particle.angle = Math.random() * Math.PI * 2;
        }

        const tailLength = 2 + particle.radius * 0.085 * intensity;
        const tailRadius = Math.max(0, particle.radius - tailLength);
        const cos = Math.cos(particle.angle);
        const sin = Math.sin(particle.angle);
        const alpha = particle.alpha * intensity
            * Math.min(1, particle.radius / (maxRadius * 0.16));

        ctx.beginPath();
        ctx.moveTo(centerX + cos * tailRadius, centerY + sin * tailRadius);
        ctx.lineTo(centerX + cos * particle.radius, centerY + sin * particle.radius);
        ctx.lineWidth = 0.6 + intensity * 1.25;
        ctx.strokeStyle = particle.blue
            ? `rgba(135, 195, 255, ${alpha})`
            : `rgba(255, 255, 255, ${alpha * 0.9})`;
        ctx.stroke();
    });

    ctx.restore();
    travelStreaksWereVisible = true;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    resizeTravelStreaks();
}

function formatDistance(distance, isSolarSystem = false) {
    if (distance === undefined || distance === null) return '-';
    
    // Special case for exactly 1 AU (often Earth's orbit radius)
    if (Math.abs(distance - 149597870.7) < 1) {
        return '1.0 AU';
    }
    
    if (isSolarSystem) {
        // For solar system objects, show Million km or km instead of 'k km'
        if (distance >= 1000000) {
            return (distance / 1000000).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) + ' Million km';
        } else {
            return distance.toLocaleString(undefined, {maximumFractionDigits: 0}) + ' km';
        }
    } else {
        // For distant objects, show light years from Earth
        const ly = distance / 9460730472580;
        if (ly >= 1000000) {
            return (ly / 1000000).toFixed(1) + 'M ly';
        } else if (ly >= 1000) {
            return (ly / 1000).toFixed(1) + 'k ly';
        }
        return ly.toFixed(1) + ' ly';
    }
}

// Find the largest single object (for OMG rating)
const OMG_THRESHOLD = 2000000000; // ~2 billion km (largest known stars)

function getSizeCategory(radius, type) {
    // For galaxies, nebulae, clusters - return comparative size
    if (['galaxy', 'nebula', 'cluster'].includes(type)) {
        return null; // Will be handled separately
    }
    
    // Radius in km for stars/planets
    if (radius < 100) return 'Puny';
    if (radius < 500) return 'Tiny';
    if (radius < 2000) return 'Small';
    if (radius < 7000) return 'Medium';
    if (radius < 30000) return 'Large';
    if (radius < 70000) return 'Huge';
    if (radius < 200000) return 'Massive';
    if (radius < OMG_THRESHOLD) return 'Colossal';
    return 'OMG'; // Only the absolute largest
}

function getComparativeSize(radius) {
    // Compare to largest object (Betelgeuse scale)
    const sunRadius = 696340; // km
    const betelgeuseRadius = 617100000; // ~887 solar radii
    const ratio = radius / betelgeuseRadius;
    const ratioSun = radius / sunRadius;
    
    if (ratio >= 1000000) {
        return 'OMG×' + (ratio / 1000000).toFixed(0) + 'M';
    } else if (ratio >= 1000) {
        return 'OMG×' + (ratio / 1000).toFixed(0) + 'k';
    } else if (ratio >= 1) {
        return 'OMG×' + ratio.toFixed(1);
    } else if (ratioSun >= 75) {
        // If it's more than 75x the Sun (like Rigel ~79x, Deneb, Pistol Star), compare to Betelgeuse
        return 'Betel×' + (1/ratio).toFixed(0);
    } else {
        // Smaller stars still compare to the Sun
        return 'Sun×' + ratioSun.toFixed(0);
    }
}

let hoverPanTimeout = null;
let isHoverPanning = false;
let hoverPanStartTime = 0;
let hoverPanStartTarget = new THREE.Vector3();
let hoverPanEndTarget = new THREE.Vector3();
let hoverPanStartDir = new THREE.Vector3();
let hoverPanEndDir = new THREE.Vector3();
let hoverPanStartDist = 0;
let hoverPanEndDist = 0;
// const HOVER_PAN_DURATION = 1500; // Deprecated in favor of dynamic duration

let guideLineCanvas = null;
let guideLineCtx = null;
let hoveredObjectName = null;

function populateSizeComparisonList(listContainer) {
    // Build HTML for size comparison objects
    let html = '';
    
    // Find max radius for relative sizing
    const maxRadius = Math.max(...sizeComparisonCatalog.map(obj => obj.radius || 0));
    
    html += `
        <div class="object-category">
            <div class="category-header">
                <span class="category-name">Size Comparison</span>
                <span class="category-count">${sizeComparisonCatalog.length} objects</span>
            </div>
            <div class="category-items">
    `;
    
    sizeComparisonCatalog.forEach(data => {
        const radius = data.radius || 0;
        const relativeSize = maxRadius > 0 ? (radius / maxRadius) * 100 : 50;
        
        // Find distance from celestialBodies map if available
        let distText = 'From Earth: -';
        const mainBody = celestialBodies.get(data.name);
        const hostBody = data.type === 'exoplanet' && data.hostName
            ? celestialBodies.get(data.hostName)
            : null;
        if (hostBody && hostBody.data && hostBody.data.distance) {
             const actualDist = getCurrentDistanceToEarth(hostBody.data);
             distText = 'From Earth: ' + formatDistance(actualDist, false);
        } else if (mainBody && mainBody.data && mainBody.data.distance) {
             const actualDist = getCurrentDistanceToEarth(mainBody.data);
             const isSolarSystem = !mainBody.isDistant && mainBody.data.type !== 'star' && mainBody.data.type !== 'blackhole' && mainBody.data.type !== 'galaxy' && mainBody.data.type !== 'cluster' && mainBody.data.type !== 'nebula';
             distText = 'From Earth: ' + formatDistance(actualDist, isSolarSystem);
        } else if (data.name === 'Earth') {
             distText = 'From Earth: 0 km';
        } else if (data.name === 'Sun') {
             distText = 'From Earth: 1.0 AU';
        }

        // Format diameter ("Width") for display
        const diameter = radius * 2;
        let widthText;
        if (diameter > 1000000) {
            widthText = 'Width: ' + (diameter / 1000000).toFixed(1) + 'M km';
        } else if (diameter > 1000) {
            widthText = 'Width: ' + (diameter / 1000).toFixed(1) + 'k km';
        } else {
            widthText = 'Width: ' + diameter.toFixed(0) + ' km';
        }
        
        // Calculate solar radii for stars
        // const solarRadii = (radius / 696340).toFixed(1);
        // const solarText = data.type === 'star' ? ` (${solarRadii} R☉)` : '';
        
        // Use object's color for the bar, but dimmed
        const barColor = data.color ? '#' + data.color.toString(16).padStart(6, '0') : '#4a9eff';

        html += `
            <div class="object-item" data-name="${data.name}" style="flex-direction: column; align-items: stretch; padding: 10px 12px; position: relative; overflow: hidden; gap: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 4px;">
                    <div class="object-name" style="font-weight: bold; font-size: 1.1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 50%;" title="${data.name}">
                        <span style="display:inline-block; width:10px; height:10px; background:${barColor}; border-radius:50%; margin-right:6px;"></span>
                        ${data.name}
                    </div>
                    
                    <div class="object-details" style="display: flex; flex-direction: column; align-items: flex-end; font-size: 0.85em; color: #aaa; line-height: 1.3;">
                        <span style="white-space: nowrap;">${distText}</span>
                        <span style="white-space: nowrap;">${widthText}</span>
                    </div>
                </div>
                
                <!-- Bottom size bar -->
                <div style="height: 3px; background-color: ${barColor}; width: ${Math.max(relativeSize, 1)}%; position: absolute; bottom: 0; left: 0; opacity: 0.8; box-shadow: 0 0 5px ${barColor}; transition: width 0.3s ease;"></div>
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
    `;
    
    listContainer.innerHTML = html;
    
    // Add click handlers
    listContainer.querySelectorAll('.object-item').forEach(item => {
        item.addEventListener('click', () => {
            const name = item.getAttribute('data-name');
            focusOnSizeComparisonObject(name);
        });
    });

    // Initial highlight if something is already focused
    updateSidebarSelection(currentFocusedBody);
}

function updateSidebarSelection(name) {
    if (!name) return;
    const items = document.querySelectorAll('.object-item');
    items.forEach(item => {
        if (item.getAttribute('data-name') === name) {
            item.classList.add('active');
            // Scroll neatly into view without causing page jump
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

function getSizeComparisonMotion(animation, now = Date.now()) {
    if (!animation || !animation.isSizeCompare) return null;

    const p = THREE.MathUtils.clamp(
        (now - animation.startTime) / animation.duration,
        0,
        1
    );
    if (animation.logarithmicApproachRatio) {
        const ratio = animation.logarithmicApproachRatio;
        const ratioAtProgress = Math.pow(ratio, p);
        const durationSeconds = animation.duration / 1000;
        const progressVelocity = (-Math.log(ratio) * ratioAtProgress)
            / ((1 - ratio) * durationSeconds);
        return {
            cameraVelocity: animation.endPos.clone()
                .sub(animation.startPos)
                .multiplyScalar(progressVelocity),
            targetVelocity: animation.endTarget.clone()
                .sub(animation.startTarget)
                .multiplyScalar(progressVelocity)
        };
    }

    const p2 = p * p;
    const dh00 = 6 * p2 - 6 * p;
    const dh10 = 3 * p2 - 4 * p + 1;
    const dh01 = -dh00;
    const durationSeconds = animation.duration / 1000;

    const calculateVelocity = (start, end, startVelocity) => new THREE.Vector3(
        (dh00 * start.x
            + dh10 * durationSeconds * startVelocity.x
            + dh01 * end.x) / durationSeconds,
        (dh00 * start.y
            + dh10 * durationSeconds * startVelocity.y
            + dh01 * end.y) / durationSeconds,
        (dh00 * start.z
            + dh10 * durationSeconds * startVelocity.z
            + dh01 * end.z) / durationSeconds
    );

    return {
        cameraVelocity: calculateVelocity(
            animation.startPos,
            animation.endPos,
            animation.startVelocity
        ),
        targetVelocity: calculateVelocity(
            animation.startTarget,
            animation.endTarget,
            animation.startTargetVelocity
        )
    };
}

function limitSizeComparisonVelocity(velocity, start, end, duration) {
    const limited = velocity ? velocity.clone() : new THREE.Vector3();
    const distance = start.distanceTo(end);
    const maxSpeed = distance > 0
        ? (distance / Math.max(duration / 1000, 0.001)) * 1.75
        : 0;
    if (limited.length() > maxSpeed) limited.setLength(maxSpeed);
    return limited;
}

function focusOnSizeComparisonObject(name) {
    const body = sizeComparisonObjects.get(name);
    if (!body || !body.mesh) return;

    const inheritedMotion = getSizeComparisonMotion(flyToAnimation);
    
    currentFocusedBody = name;
    updateSidebarSelection(name);
    
    const worldPosition = new THREE.Vector3();
    body.mesh.getWorldPosition(worldPosition);
    
    // Get visual radius for camera distance.
    // Use the actual sphere radius from data (divided by scaleFactor = 2000)
    // to prevent rings (like Saturn's) or other child decorations from inflating the size
    // and pushing the camera way too far out.
    const visualRadius = body.data.radius ? (body.data.radius / 2000) : 1.0;

    // Lower floors can be adopted immediately. A larger destination floor must
    // wait until arrival; applying it now makes OrbitControls shove the camera
    // outward once before the smooth transition begins.
    const targetMinDistance = Math.max(visualRadius * 1.2, 0.25);
    controls.minDistance = Math.min(controls.minDistance, targetMinDistance);

    // Calculate camera distance - make it dynamic but relative
    // We want to see the "next" star, so we look slightly to the right (+X)
    const distance = Math.max(visualRadius * 4, 20);
    
    // Position camera: 
    // - Back along X (negative) relative to center to see "down the line"
    // - Up along Y for perspective
    // - Back along Z to see the face of the sphere
    
    // Angled slightly to show next star:
    // Move slightly left (-X) of the object center, so we look right (+X) towards the lineup
    
    // Keep neighboring objects on one continuous radius-based framing curve.
    let zoomFactor = 1.0;

    if (visualRadius > 1000000) {
        // For incredibly massive objects (like supermassive black holes > 2 billion km),
        // pull the camera in relatively closer. This prevents pulling so far back that 
        // the lineup becomes horizontal, and emphasizes their staggering scale.
        const excess = visualRadius - 1000000;
        zoomFactor = Math.max(0.45, 1.0 - (excess / 20000000));
    }
    
    const offsetY = visualRadius * 2.0 * zoomFactor;  // Above the object for perspective
    const offsetZ = visualRadius * 3.5 * zoomFactor; // Back along Z

    let targetCameraPosition = worldPosition.clone().add(new THREE.Vector3(0, offsetY, offsetZ));

    // Look at the object center initially
    let lookAtTarget = worldPosition.clone();
    
    // Apply cinematic angle specifically for Gaia BH1 (Size comparison lineup start sequence)
    if (name === 'Gaia BH1') {
        // Place camera very close to the center axis so Gaia visually overlaps Proxima/Sun
        // Camera is slightly back (-X), and just barely off-center (+Y, +Z)
        targetCameraPosition.set(worldPosition.x - 0.8, worldPosition.y + 0.03, worldPosition.z + 0.35);
        // Look down the array
        lookAtTarget.set(worldPosition.x + 10, worldPosition.y, worldPosition.z);
    }
    
    // Rotate view to keep Earth ("You") in frame on the left edge if possible
    const earthObj = sizeComparisonObjects.get('Earth');
    if (earthObj && earthObj.mesh) {
        const earthPos = new THREE.Vector3();
        earthObj.mesh.getWorldPosition(earthPos);
        
        let camX = targetCameraPosition.x;
        let camZ = targetCameraPosition.z;
        const earthX = earthPos.x;
        
        // Angle from straight ahead (-Z) to Earth (left is positive)
        let angleToEarth = Math.atan2(camX - earthX, camZ);
        
        // Calculate safe viewing angles
        const aspect = window.innerWidth / window.innerHeight;
        const hFov = 2 * Math.atan(Math.tan((camera.fov * Math.PI / 180) / 2) * aspect);
        
        const sidebar = document.getElementById('sidebar');
        const isCollapsed = sidebar && sidebar.classList.contains('collapsed');
        const sidebarWidth = sidebar && window.innerWidth > 768 && !isCollapsed ? sidebar.offsetWidth : 0;
        
        // Left half of screen in pixels
        const leftHalf = window.innerWidth / 2;
        // The safe space starts after the sidebar + a padding of ~50px
        const safeLeftPixels = Math.max(10, leftHalf - sidebarWidth - 50);
        const safeLeftRatio = safeLeftPixels / leftHalf;
        
        // Exact mathematical projection for perspective camera
        const maxAngle = Math.atan(safeLeftRatio * Math.tan(hFov / 2));
        
        // Remove aggressive left pan for Gaia BH1 to allow pure startup rendering hook
        // Only run for other objects where Earth might fall off screen
        if (name !== 'Gaia BH1' && angleToEarth > maxAngle) {
            // To prevent Earth from sliding behind the UI, and to prevent the target object 
            // from being pulled completely off the screen, we'll split the difference:
            // zoom out slightly (increase Z) to widen the view, and pan left with the remainder.
            const excessAngle = angleToEarth - maxAngle;
            
            // Step 1: Zoom out to cover half the required angular adjustment
            const targetAngleForZ = maxAngle + (excessAngle * 0.4); 
            const newZ = (camX - earthX) / Math.tan(targetAngleForZ);
            if (newZ > camZ) {
                targetCameraPosition.z = newZ;
                camZ = newZ;
            }
            
            // Step 2: Recalculate remaining angle and pan left
            angleToEarth = Math.atan2(camX - earthX, camZ);
            let rotationNeeded = angleToEarth - maxAngle;
            if (rotationNeeded > 0) {
                // Keep focused object inside the right edge by capping rotation.
                // Subtract visual angular radius and a small safety padding (0.08 rad ≈ 4.5 degrees)
                const objAngularRadius = Math.atan(visualRadius / camZ);
                const maxSafeRotation = Math.max(0, (hFov / 2) - objAngularRadius - 0.08);
                rotationNeeded = Math.min(rotationNeeded, maxSafeRotation);
                
                if (rotationNeeded > 0) {
                    lookAtTarget.x = camX - camZ * Math.tan(rotationNeeded); 
                }
            }
        }
    }
    
    const camStartZ = Math.max(camera.position.z, 0.1);
    const camEndZ   = Math.max(targetCameraPosition.z, 0.1);
    const scaleRatio = Math.max(camStartZ, camEndZ) / Math.min(camStartZ, camEndZ);
    const logFactor  = Math.log10(Math.max(scaleRatio, 1.1));

    // Duration: 2.5 s for adjacent objects, up to 10 s for large scale jumps.
    const calculatedDuration = Math.min(Math.max(2500, logFactor * 1600), 10000);

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    // A direct jump from the giant end of the lineup to Earth spans many
    // orders of magnitude. Linear world-space interpolation spends almost the
    // whole animation among the giants, then flashes through the familiar
    // scales at the end. A logarithmic remaining-distance curve gives each
    // order of magnitude a share of the journey: brisk departure, increasingly
    // gentle approach, and no last-second arrival snap.
    const isLongEarthReturn = name === 'Earth'
        && targetCameraPosition.x < startPos.x
        && scaleRatio > 1000;
    const logarithmicApproachRatio = isLongEarthReturn
        ? THREE.MathUtils.clamp(camEndZ / camStartZ, 1e-9, 0.05)
        : null;
    const startVelocity = limitSizeComparisonVelocity(
        inheritedMotion?.cameraVelocity,
        startPos,
        targetCameraPosition,
        calculatedDuration
    );
    const startTargetVelocity = limitSizeComparisonVelocity(
        inheritedMotion?.targetVelocity,
        startTarget,
        lookAtTarget,
        calculatedDuration
    );

    // Skip animation if we're already practically at the destination
    if (startPos.distanceTo(targetCameraPosition) < 0.1 && startTarget.distanceTo(lookAtTarget) < 0.1) {
        camera.position.copy(targetCameraPosition);
        controls.target.copy(lookAtTarget);
        controls.minDistance = targetMinDistance;
        controls.update();
        
        // Update URL with target
        const url = new URL(window.location);
        url.searchParams.set('target', name);
        window.history.replaceState({mode: 'sizeCompare', target: name}, '', url);
        return;
    }

    flyToAnimation = {
        startPos: startPos,
        startTarget: startTarget,
        endPos: targetCameraPosition,
        endTarget: lookAtTarget,
        offset: targetCameraPosition.clone().sub(lookAtTarget),
        startTime: Date.now(),
        duration: calculatedDuration,
        bodyName: name,
        isSizeCompare: true,
        logarithmicApproachRatio,
        startVelocity,
        startTargetVelocity,
        endMinDistance: targetMinDistance
    };
    
    // Update URL with target
    const url = new URL(window.location);
    url.searchParams.set('mode', 'sizeCompare');
    url.searchParams.set('target', name);
    window.history.replaceState({mode: 'sizeCompare', target: name}, '', url);
    
    showBodyInfo(body.data);
}

function populateObjectList() {
    const listContainer = document.getElementById('object-list');
    if (!listContainer) return;

    // Handle size comparison view
    if (viewMode === 'sizeCompare') {
        populateSizeComparisonList(listContainer);
        return;
    }

    const categories = {
        'Solar System': [],
        'Exoplanets': [],
        'Stars': [],
        'Black Holes': [],
        'Small Bodies': []
    };

    // Exoplanet data stores orbital separation in `distance`; the object list's
    // distance column is Earth-centric, so use the host system's distance.
    const getListDistance = (body) => {
        if (body.type === 'exoplanet' && body.parent) {
            for (const host of celestialBodies.values()) {
                if (host.mesh === body.parent) {
                    return host.data.distance ? getCurrentDistanceToEarth(host.data) : 0;
                }
            }
        }
        return body.data.distance ? getCurrentDistanceToEarth(body.data) : 0;
    };

    // Sort objects into categories, separating planets/stars from moons
    const planets = [];
    const moons = new Map(); // Map of planet name -> array of moons
    let sun = null;

    celestialBodies.forEach((body, name) => {
        if (name === 'Solar System') return; // Skip the marker

        const type = body.type;
        const isSolar = !body.isDistant && type !== 'star' && type !== 'blackhole' &&
                       type !== 'neutronstar' && type !== 'galaxy' && type !== 'nebula' &&
                       type !== 'cluster';

        if (name === 'Sun') {
            // Save the Sun to add at the top
            sun = { name, body };
        } else if (type === 'moon' || type === 'satellite') {
            // Find parent planet name
            let parentName = null;
            celestialBodies.forEach((b, n) => {
                if (b.mesh === body.parent) {
                    parentName = n;
                }
            });
            if (parentName) {
                if (!moons.has(parentName)) {
                    moons.set(parentName, []);
                }
                moons.get(parentName).push({ name, body });
            }
        } else if (type === 'smallbody') {
            categories['Small Bodies'].push({ name, body });
        } else if (isSolar) {
            planets.push({ name, body });
        } else if (type === 'blackhole') {
            categories['Black Holes'].push({ name, body });
        } else if (type === 'exoplanet') {
            categories['Exoplanets'].push({ name, body });
        } else if (type === 'star' || type === 'neutronstar') {
            categories['Stars'].push({ name, body });
        }
    });

    // Helper function to sort array based on sort mode
    const sortByMode = (array, mode) => {
        if (mode === 'name') {
            array.sort((a, b) => a.name.localeCompare(b.name));
        } else if (mode === 'size') {
            array.sort((a, b) => {
                const sizeA = a.body.data.radius || 0;
                const sizeB = b.body.data.radius || 0;
                return sizeB - sizeA; // Largest first
            });
        } else if (mode === 'distance') {
            array.sort((a, b) => {
                const distA = getListDistance(a.body);
                const distB = getListDistance(b.body);
                return distA - distB; // Closest first
            });
        }
    };

    // Sort planets based on Solar System sort mode
    sortByMode(planets, categorySortModes['Solar System']);

    // Add Sun at the top if it exists
    if (sun) {
        categories['Solar System'] = [sun, ...planets];
    } else {
        categories['Solar System'] = planets;
    }

    // Sort each category based on its own sort mode
    Object.keys(categories).forEach(cat => {
        if (cat !== 'Solar System') {
            sortByMode(categories[cat], categorySortModes[cat]);
        }
    });

    // Build HTML
    let html = '';
    Object.entries(categories).forEach(([catName, items]) => {
        if (items.length === 0) return;

        // Get current sort mode for this category
        const sortMode = categorySortModes[catName];
        const sortModeText = sortMode.charAt(0).toUpperCase() + sortMode.slice(1);

        // Get expansion state for this category
        const isExpanded = categoryExpansionState[catName] !== false; // Default to expanded if not set
        const collapsedClass = isExpanded ? '' : 'collapsed';

        // Find max radius in this category for relative sizing
        const maxRadius = Math.max(...items.map(item => item.body.data.radius || 0));

        html += `
            <div class="object-category">
                <div class="category-header ${collapsedClass}">
                    <div class="category-title" onclick="toggleCategory(this.parentElement)">${catName}</div>
                    <button class="category-sort-btn" onclick="event.stopPropagation(); toggleCategorySortMode('${catName}')" title="Sort by">
                        ${sortModeText}
                    </button>
                </div>
                <div class="category-items ${collapsedClass}">
        `;

        items.forEach(({ name, body }) => {
            const itemClass = body.type || 'star';

            // Get size category or comparative size
            let sizeLabel = '';
            if (body.data.radius) {
                if (['galaxy', 'nebula', 'cluster'].includes(body.type)) {
                    sizeLabel = getComparativeSize(body.data.radius);
                } else {
                    sizeLabel = getSizeCategory(body.data.radius, body.type);
                }
            }

            // Calculate distance from Earth dynamically
            const actualDist = getListDistance(body);

            const isSolarSystem = !body.isDistant;
            const distance = actualDist ? formatDistance(actualDist, isSolarSystem) : '-';

            // Calculate relative size percentage for size indicator bar
            const radius = body.data.radius || 0;
            const sizePercentage = maxRadius > 0 ? (radius / maxRadius) * 100 : 0;

            html += `<div class="object-item ${itemClass}" onclick="focusOnBody(this.dataset.name)" onmouseenter="startHoverGuide(this.dataset.name)" onmouseleave="cancelHoverGuide()" data-name="${name}">
                <div class="object-info">
                    <span>${name}${sizeLabel ? ` (${sizeLabel})` : ''}</span>
                </div>
                <span class="object-distance">${distance}</span>
                <div class="size-indicator" style="width: ${sizePercentage}%"></div>
            </div>`;

            // Add moons beneath this planet if it has any
            if (moons.has(name)) {
                const planetMoons = moons.get(name);
                planetMoons.sort((a, b) => a.name.localeCompare(b.name));

                planetMoons.forEach(({ name: moonName, body: moonBody }) => {
                    // Get size category for moon
                    let moonSizeLabel = '';
                    if (moonBody.data.radius) {
                        moonSizeLabel = getSizeCategory(moonBody.data.radius, moonBody.type);
                    }

                    let actualMoonDist = moonBody.data.distance ? getCurrentDistanceToEarth(moonBody.data) : null;
                    const moonDistance = actualMoonDist ? formatDistance(actualMoonDist, true) : '-';

                    // Calculate relative size percentage for moon
                    const moonRadius = moonBody.data.radius || 0;
                    const moonSizePercentage = maxRadius > 0 ? (moonRadius / maxRadius) * 100 : 0;

                    html += `<div class="object-item moon" style="margin-left: 20px;" onclick="focusOnBody(this.dataset.name)" onmouseenter="startHoverGuide(this.dataset.name)" onmouseleave="cancelHoverGuide()" data-name="${moonName}">
                        <div class="object-info">
                            <span>${moonName}${moonSizeLabel ? ` (${moonSizeLabel})` : ''}</span>
                        </div>
                        <span class="object-distance">${moonDistance}</span>
                        <div class="size-indicator" style="width: ${moonSizePercentage}%"></div>
                    </div>`;
                });
            }
        });

        html += '</div></div>';
    });
    
    listContainer.innerHTML = html;
}

 let hoverPanTimer = null;

function startHoverGuide(name) {
    // No hover on touch devices; a tap already focuses the object directly
    if (HOVER_NONE_MQ.matches) return;

    // Just show the guide line initially
    hoveredObjectName = name;
    
    // Clear any existing timer
    if (hoverPanTimer) {
        clearTimeout(hoverPanTimer);
    }
    
    // Start timer for camera rotation (2 seconds)
    hoverPanTimer = setTimeout(() => {
        if (hoveredObjectName === name) {
            smoothPanToBody(name);
        }
    }, 2000);
}

function cancelHoverGuide() {
    hoveredObjectName = null;
    
    // Clear timer if it's running
    if (hoverPanTimer) {
        clearTimeout(hoverPanTimer);
        hoverPanTimer = null;
    }
    
    // Clear guide line
    if (guideLineCtx && guideLineCanvas) {
        guideLineCtx.clearRect(0, 0, guideLineCanvas.width, guideLineCanvas.height);
    }
}

function smoothPanToBody(name) {
    if (viewMode === 'sizeCompare') {
        const body = sizeComparisonObjects.get(name);
        if (!body) return;
        
        // In size compare mode, we can't just pan the target, we need to move the camera too
        // because the objects are so far apart (unlike solar system orbits).
        // So we trigger the full focus function.
        
        // Check if we are already focused on this object or flying to it to avoid jerky restarts
        if (currentFocusedBody === name && !flyToAnimation) {
             return;
        }

        // Existing comparison flights are retargeted with their current
        // velocity, avoiding a stop/restart jolt.
        if (flyToAnimation) {
            if (flyToAnimation.bodyName === name) return;
        }
        
        focusOnSizeComparisonObject(name);
        return;
    }

    const body = celestialBodies.get(name);
    if (!body) return;

    if (currentFocusedBody === name && !isHoverPanning) return;

    const target = body.mesh;
    const worldPosition = new THREE.Vector3();
    target.getWorldPosition(worldPosition);

    // Start smooth pan
    isHoverPanning = true;
    currentFocusedBody = name; // Update focused body
    hoverPanStartTime = performance.now();
    
    // Direction-based interpolation setup to avoid "snap" when targets are far away
    hoverPanStartTarget.copy(controls.target);
    hoverPanEndTarget.copy(worldPosition);
    
    // Calculate direction vectors from camera
    hoverPanStartDir.subVectors(controls.target, camera.position).normalize();
    hoverPanEndDir.subVectors(worldPosition, camera.position).normalize();
    
    // Calculate distances
    hoverPanStartDist = camera.position.distanceTo(controls.target);
    hoverPanEndDist = camera.position.distanceTo(worldPosition);
}

function updateHoverPan() {
    if (!isHoverPanning) return;

    const now = performance.now();
    const elapsed = now - hoverPanStartTime;
    // Increase duration for smoother feel
    const duration = 2000; 
    const progress = Math.min(elapsed / duration, 1);

    // Ease-out-cubic for smooth deceleration
    const ease = 1 - Math.pow(1 - progress, 3);

    // SPHERICAL INTERPOLATION
    // Instead of lerping the target (which causes snap if target is far),
    // we interpolate the relative direction vector from the camera.
    
    // Interpolate direction
    const currentDir = new THREE.Vector3().copy(hoverPanStartDir).lerp(hoverPanEndDir, ease).normalize();
    
    // Interpolate distance
    const currentDist = hoverPanStartDist + (hoverPanEndDist - hoverPanStartDist) * ease;
    
    // Set new target
    const newTarget = new THREE.Vector3().copy(camera.position).add(currentDir.multiplyScalar(currentDist));
    controls.target.copy(newTarget);

    if (progress >= 1) {
        isHoverPanning = false;
    }
}

function toggleCategory(header) {
    header.classList.toggle('collapsed');
    const items = header.nextElementSibling;
    items.classList.toggle('collapsed');

    // Find category name from the header
    const categoryTitle = header.querySelector('.category-title');
    if (categoryTitle) {
        const categoryName = categoryTitle.textContent.trim();

        // Update state
        categoryExpansionState[categoryName] = !header.classList.contains('collapsed');

        // Save to localStorage
        try {
            localStorage.setItem('categoryExpansionState', JSON.stringify(categoryExpansionState));
        } catch (e) {
            // If localStorage fails, continue without saving
        }
    }
}

function createInterstellarFlight(
    endPos,
    endTarget,
    bodyName,
    { duration = 4000, isReturn = false } = {}
) {
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const currentForward = startTarget.clone().sub(startPos);
    if (currentForward.lengthSq() < 0.001) {
        currentForward.copy(endTarget).sub(startPos);
    }
    if (currentForward.lengthSq() < 0.001) currentForward.set(0, 0, -1);
    currentForward.normalize();

    const currentViewDistance = startPos.distanceTo(startTarget);
    const travelDistance = startPos.distanceTo(endPos);
    const naturalPullback = Math.max(currentViewDistance * 0.45, 80);
    const maximumPullback = Math.max(travelDistance * 0.015, 80);
    const pullbackDistance = Math.min(naturalPullback, maximumPullback);
    const pullbackPos = startPos.clone()
        .addScaledVector(currentForward, -pullbackDistance);

    const destinationDirection = endTarget.clone().sub(pullbackPos);
    if (destinationDirection.lengthSq() < 0.001) {
        destinationDirection.copy(endPos).sub(pullbackPos);
    }
    destinationDirection.normalize();

    return {
        startPos,
        startTarget,
        endPos: endPos.clone(),
        endTarget: endTarget.clone(),
        offset: endPos.clone().sub(endTarget),
        startTime: Date.now(),
        duration,
        bodyName,
        isInterstellarFlight: true,
        isInterstellarReturn: isReturn,
        travelTurn: {
            startDirection: currentForward.clone(),
            endDirection: destinationDirection,
            lookDistance: Math.max(pullbackPos.distanceTo(endTarget), 300),
            pullbackPos,
            fraction: 0.20
        },
        startDistanceToTarget: Math.max(pullbackPos.distanceTo(endTarget), 0.001),
        endDistanceToTarget: Math.max(endPos.distanceTo(endTarget), 0.001)
    };
}

// Camera offset from a distant object that keeps home in view: along the
// home → object line past the object, swung STAR_VIEW_SIDE around the vertical
// and raised STAR_VIEW_UP. Seen from there, home lies about that far off the
// view centre (well inside a 60° field of view).
const STAR_VIEW_SIDE = THREE.MathUtils.degToRad(20);
const STAR_VIEW_UP = THREE.MathUtils.degToRad(10);
function homeInViewOffset(objectPos, distance) {
    const away = objectPos.clone();
    if (away.lengthSq() < 1e-6) away.set(0.35, 0.15, 1);
    away.normalize();
    const az = Math.atan2(away.x, away.z) + STAR_VIEW_SIDE;
    const el = Math.asin(THREE.MathUtils.clamp(away.y, -1, 1)) + STAR_VIEW_UP;
    return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
        .multiplyScalar(distance);
}

// Orbit-in flight to a distant object: the view turns to face the object over
// the first ~25%, the distance closes on a log curve (steady apparent growth
// instead of a dot until the last moment), and from ~30% the camera swings
// around the object (azimuth/elevation) to its home-in-view spot. The object
// stays centred and nothing snaps at the end. The replaced straight-line
// flight aimed at a point beside the object, so the view whipped around as the
// camera passed it.
function createOrbitApproach(objectPos, endOffset, travelDistance) {
    const startPos = camera.position.clone();
    const rel = startPos.clone().sub(objectPos);
    const rStart = Math.max(rel.length(), 1e-6);
    const toSpherical = v => {
        const n = v.clone().normalize();
        return { az: Math.atan2(n.x, n.z), el: Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) };
    };
    const a = toSpherical(rel), b = toSpherical(endOffset);
    let dAz = b.az - a.az;
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz)); // shortest way round
    const ratio = Math.max(rStart / Math.max(endOffset.length(), 1e-6), 1);
    return {
        orbitApproach: true,
        startPos,
        startTarget: controls.target.clone(),
        endPos: objectPos.clone().add(endOffset),
        endTarget: objectPos.clone(),
        offset: endOffset.clone(), // the wheel scales this during the flight
        startTime: Date.now(),
        duration: THREE.MathUtils.clamp(2400 + 900 * Math.log10(ratio), 2400, 7000),
        rStart,
        az0: a.az, dAz,
        el0: a.el, el1: b.el
    };
}

function createInterstellarReturnFlight(endPos, endTarget, bodyName) {
    return createInterstellarFlight(endPos, endTarget, bodyName, {
        duration: 5400,
        isReturn: true
    });
}

function flyToEarth(showEarthInfo = false) {
    // If in size comparison mode, switch back to map view first
    // toggleViewMode calls showMapView which calls flyToEarth, so we can just return after toggling
    if (viewMode === 'sizeCompare') {
        toggleViewMode();
        return;
    }

    // Force calculate planet positions for map mode so Earth has its correct 3D coordinates
    if (orbitalMode === 'realistic') {
        updateRealisticPositions(simDate, 'planets');
        updateRealisticPositions(simDate, 'moons');
    } else {
        // Aligned mode: update all planets and moons based on the orbital formulas
        celestialBodies.forEach((body, name) => {
            if (body.orbitGroup && body.orbitSpeed) {
                orbitOffset(calculateAlignedOrbitAngle(body.data), body.orbitRadius, body.mesh.position);
            }
            if (body.parent && body.orbitSpeed) {
                placeMoon(body, calculateAlignedOrbitAngle(body.data), body.orbitRadius);
            }
        });
    }
    scene.updateMatrixWorld(true);

    // Fly to Earth-centered view, zoomed out to show Sun and neighboring planets
    const earthBody = celestialBodies.get('Earth');
    if (!earthBody) return;

    const earthMesh = earthBody.mesh;
    
    // Reset minDistance to Earth's sizing bounds to prevent zoom locks from prior objects
    const ownRadius = (earthMesh.geometry && earthMesh.geometry.parameters
        && earthMesh.geometry.parameters.radius) || 1.0;
    controls.minDistance = Math.max(ownRadius * 1.4, camera.near * 2.5);

    const earthPosition = new THREE.Vector3();
    earthMesh.getWorldPosition(earthPosition);

    // On mobile portrait, zoom in closer and adjust the angle to rotate the line steeply upward
    const isMobilePortrait = window.innerWidth < 768 && window.innerHeight > window.innerWidth;
    // Tuned for Earth's orbit at 100 units; follow the current distance scale
    const orbitScale = Math.max((earthBody.orbitRadius || 100) / 100, 0.3);
    const wideViewDistance = (isMobilePortrait ? 230 : 250) * orbitScale;

    // On mobile portrait, we look from closer to the Z=0 plane (Z multiplier = 0.18)
    // and further left (X multiplier = -0.85) to rotate the lineup of planets steeply
    // upward (angled upward) so they all fit in the narrow mobile screen height.
    const cameraOffset = isMobilePortrait
        ? new THREE.Vector3(-wideViewDistance * 0.85, wideViewDistance * 0.45, wideViewDistance * 0.18)
        : new THREE.Vector3(-wideViewDistance * 0.65, wideViewDistance * 0.4, wideViewDistance * 0.7);

    const targetCameraPos = earthPosition.clone().add(cameraOffset);

    // Calculate travel distance for animation duration
    const travelDistance = camera.position.distanceTo(targetCameraPos);
    const duration = Math.min(Math.max(travelDistance / 150, 2000), 5000);

    // Start fly-to animation
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();

    flyToAnimation = travelDistance > 50000
        ? createInterstellarReturnFlight(
            targetCameraPos,
            earthPosition,
            'Earth (Wide View)'
        )
        : {
            startPos: startPos,
            startTarget: startTarget,
            endPos: targetCameraPos,
            endTarget: earthPosition.clone(),
            offset: targetCameraPos.clone().sub(earthPosition),
            startTime: Date.now(),
            duration: duration,
            bodyName: 'Earth (Wide View)'
        };

    // Set focused body to Earth but don't show the info panel for home view
    currentFocusedBody = 'Earth';

    // Update zoom level to ensure planets are visible
    currentZoomLevel = 'INNER_SOLAR';
    updateZoomLevel();
    updateUI();

    if (showEarthInfo) {
        showBodyInfo(earthBody.data);
        updateSidebarSelection('Earth');
    } else {
        hideBodyInfo();
    }
}

// Bump the version suffix to re-show the notice to everyone after a big change
const BETA_NOTICE_KEY = 'betaNoticeDismissed:v1';
const CONTROLS_INFO_VISIBLE_MS = 8000;

function setupControlsInfo() {
    const panel = document.getElementById('controls-info');
    const showButton = document.getElementById('controls-info-button');
    if (!panel || !showButton || isMobileLayout()) return;

    let minimizeTimer = null;

    function minimizeControls() {
        panel.classList.add('minimized');
        panel.setAttribute('aria-hidden', 'true');
        showButton.hidden = false;
        showButton.setAttribute('aria-expanded', 'false');
    }

    function showControls() {
        clearTimeout(minimizeTimer);
        panel.classList.remove('minimized');
        panel.setAttribute('aria-hidden', 'false');
        showButton.hidden = true;
        showButton.setAttribute('aria-expanded', 'true');
        minimizeTimer = setTimeout(minimizeControls, CONTROLS_INFO_VISIBLE_MS);
    }

    showButton.addEventListener('click', (event) => {
        event.stopPropagation();
        showControls();
    });

    showControls();
}

function setupInfoPopup() {
    const popup = document.getElementById('info-popup');
    const closeBtn = document.getElementById('info-popup-close');
    const infoButton = document.getElementById('info-button');

    let alreadyDismissed = false;
    try {
        alreadyDismissed = !!localStorage.getItem(BETA_NOTICE_KEY);
    } catch (e) {
        // localStorage unavailable (private mode) - fall back to showing the popup
    }

    let autoDismissTimer = null;

    function minimizePopup() {
        popup.classList.add('hidden');
        infoButton.classList.remove('hidden');
        try {
            localStorage.setItem(BETA_NOTICE_KEY, '1');
        } catch (e) {
            // Ignore - popup will just reappear next visit
        }
    }

    if (alreadyDismissed) {
        // Returning visitor: skip the popup, just show the info button
        popup.classList.add('hidden');
        infoButton.classList.remove('hidden');
    } else {
        // First visit: auto-dismiss after 5 seconds
        autoDismissTimer = setTimeout(minimizePopup, 5000);
    }

    closeBtn.addEventListener('click', () => {
        clearTimeout(autoDismissTimer);
        minimizePopup();
    });

    // Info button reopens the popup
    infoButton.addEventListener('click', (e) => {
        e.stopPropagation();
        popup.classList.remove('hidden');
        infoButton.classList.add('hidden');
    });
}

// ── Mobile navigation (bottom bar + slide-up sheets) ──────────────────
// Keep in sync with the media query in css/styles.css
const MOBILE_LAYOUT_MQ = window.matchMedia(
    '(max-width: 768px), (max-width: 950px) and (max-height: 500px) and (orientation: landscape)'
);
const LARGE_DESKTOP_LAYOUT_MQ = window.matchMedia(
    '(min-width: 1500px) and (min-height: 800px)'
);
// Touch-only devices: hover tooltips and hover-to-pan don't apply
const HOVER_NONE_MQ = window.matchMedia('(hover: none)');

function isMobileLayout() {
    return MOBILE_LAYOUT_MQ.matches;
}

function setupMobileNav() {
    const sidebar = document.getElementById('sidebar');
    const settings = document.getElementById('scale-toggle-container');
    const timeline = document.getElementById('timeline-panel');
    const popup = document.getElementById('info-popup');
    const infoButton = document.getElementById('info-button');

    // The sidebar sheet reuses the desktop drawer's .collapsed state;
    // the other two panels get a mobile-open class that only mobile CSS reads.
    const sheets = {
        objects: {
            isOpen: () => !sidebar.classList.contains('collapsed'),
            set: (open) => sidebar.classList.toggle('collapsed', !open)
        },
        settings: {
            isOpen: () => settings.classList.contains('mobile-open'),
            set: (open) => settings.classList.toggle('mobile-open', open)
        },
        time: {
            isOpen: () => !timeline.classList.contains('hidden') && timeline.classList.contains('mobile-open'),
            set: (open) => {
                timeline.classList.toggle('mobile-open', open);
                timeline.classList.toggle('hidden', !open);
            }
        }
    };

    function closeAllSheets(except) {
        Object.keys(sheets).forEach((key) => {
            if (key !== except) sheets[key].set(false);
        });
        syncMobileNavActive();
    }

    function toggleSheet(key) {
        const wasOpen = sheets[key].isOpen();
        closeAllSheets(key);
        sheets[key].set(!wasOpen);
        syncMobileNavActive();
    }

    function syncMobileNavActive() {
        document.getElementById('mnav-objects').classList.toggle('active', sheets.objects.isOpen());
        document.getElementById('mnav-settings').classList.toggle('active', sheets.settings.isOpen());
        document.getElementById('mnav-time').classList.toggle('active', sheets.time.isOpen());
    }

    document.getElementById('mnav-objects').addEventListener('click', () => toggleSheet('objects'));
    document.getElementById('mnav-settings').addEventListener('click', () => toggleSheet('settings'));
    document.getElementById('mnav-time').addEventListener('click', () => toggleSheet('time'));

    document.getElementById('mnav-home').addEventListener('click', () => {
        closeAllSheets();
        flyToEarth();
    });

    // Toggles between map and size-comparison mode; label is swapped in toggleViewMode
    document.getElementById('mnav-compare').addEventListener('click', () => {
        closeAllSheets();
        toggleViewMode();
    });

    document.getElementById('mnav-info').addEventListener('click', () => {
        closeAllSheets();
        popup.classList.remove('hidden');
        infoButton.classList.add('hidden');
    });

    document.getElementById('sidebar-close').addEventListener('click', () => {
        sheets.objects.set(false);
        syncMobileNavActive();
    });
    document.getElementById('settings-close').addEventListener('click', () => {
        sheets.settings.set(false);
        syncMobileNavActive();
    });



    // Tapping the map dismisses any open sheet
    renderer.domElement.addEventListener('pointerdown', () => {
        if (isMobileLayout()) closeAllSheets();
    });

    // Picking an object closes the list so the map is visible
    document.getElementById('object-list').addEventListener('click', (e) => {
        if (isMobileLayout() && e.target.closest('.object-item')) {
            sheets.objects.set(false);
            syncMobileNavActive();
        }
    });

    // Desktop keeps the drawer open state; make sure sheets start closed on mobile
    if (isMobileLayout()) closeAllSheets();
}

// Touch navigation for size-comparison mode. Desktop steps through the lineup
// with the scroll wheel (OrbitControls zoom is disabled there); on touch we
// map pinch-in → next bigger, pinch-out → next smaller, quick horizontal
// flick → step left/right, and show edge arrow buttons as a visible fallback.
function setupCompareTouchNav() {
    const canvas = renderer.domElement;

    document.getElementById('compare-prev').addEventListener('click', () => stepSizeComparison(-1));
    document.getElementById('compare-next').addEventListener('click', () => stepSizeComparison(1));

    let pinchDist = null;
    let swipeStart = null;

    const touchDist = (touches) =>
        Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    canvas.addEventListener('touchstart', (e) => {
        if (viewMode !== 'sizeCompare') return;
        if (e.touches.length === 2) {
            pinchDist = touchDist(e.touches);
            swipeStart = null;
        } else if (e.touches.length === 1) {
            swipeStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (viewMode !== 'sizeCompare' || e.touches.length !== 2 || pinchDist === null) return;
        const d = touchDist(e.touches);
        const ratio = d / pinchDist;
        // Re-baseline after each step so a long continuous pinch keeps stepping
        if (ratio < 0.75) {
            stepSizeComparison(1); // pinch in ("zoom out") → next bigger, like scroll-out
            pinchDist = d;
        } else if (ratio > 1.33) {
            stepSizeComparison(-1);
            pinchDist = d;
        }
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) pinchDist = null;
        if (viewMode !== 'sizeCompare') {
            swipeStart = null;
            return;
        }
        if (swipeStart && e.touches.length === 0) {
            const t = e.changedTouches[0];
            const dx = t.clientX - swipeStart.x;
            const dy = t.clientY - swipeStart.y;
            const dt = Date.now() - swipeStart.t;
            // Quick horizontal flick steps through the lineup; slow drags still rotate
            if (dt < 350 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
                stepSizeComparison(dx < 0 ? 1 : -1); // content follows the finger
            }
        }
        swipeStart = null;
    });
}

    // Expose functions to global scope for HTML onclick handlers
    window.focusOnBody = focusOnBody;
    window.toggleCategory = toggleCategory;
    window.toggleCategorySortMode = toggleCategorySortMode;
    window.formatDistance = formatDistance;
    window.getSizeCategory = getSizeCategory;
    window.getComparativeSize = getComparativeSize;
    window.startHoverGuide = startHoverGuide;
    window.cancelHoverGuide = cancelHoverGuide;
    window.toggleCameraLock = toggleCameraLock;
    window.drawGuideLine = drawGuideLine;

// Pulse "Size Comparison" button on initial load for 10 seconds
window.addEventListener('DOMContentLoaded', () => {
    const sizeCompareBtn = document.getElementById('size-compare-btn');
    if (sizeCompareBtn) {
        sizeCompareBtn.classList.add('pulse-border');
        setTimeout(() => {
            sizeCompareBtn.classList.remove('pulse-border');
        }, 10000);
    }
});

// Start the application
init();
