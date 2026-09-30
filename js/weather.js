// Weather: live global cloud cover as a translucent shell just above Earth.
//
// Source: clouds.matteason.co.uk — a whole-planet equirectangular cloud map
// composited from geostationary weather satellites (EUMETSAT / NOAA / JMA),
// refreshed every 3 hours, CORS-enabled and keyless. Clouds are bright on a
// dark background (clear desert ≈ 67/255, thick cloud ≈ 240), so brightness
// becomes opacity through a threshold that drops clear sky and thin haze.
//
// It's a snapshot of "now": the shell fades out when the timeline is more
// than a few hours from the present. It sits in the Earth mesh, so it turns
// and tilts with Earth, and fades away when zoomed in to the ground so it
// doesn't blanket the imagery tiles.
import * as THREE from 'three';

const CLOUD_URL = size => `https://clouds.matteason.co.uk/images/${size}/clouds.jpg`;
const REFRESH_MS = 3 * 3600 * 1000;
const SHELL_LIFT = 1.006;            // ≈ 38 km above the surface at true scale (exaggerated so it reads)
const DATE_FADE_HOURS = [12, 48];    // full opacity within 12 h of now, gone past 48 h
const ALTITUDE_FADE = [0.25, 0.8];   // in Earth radii above the surface

let shell = null;
let material = null;
let enabled = false;
let loadedAt = 0;
let loading = false;
let failed = false;
const uniforms = { uCloudOpacity: { value: 0 } };

export function isCloudLayerOn() { return enabled; }
export function cloudLayerStatus() { return failed ? 'unavailable' : shell?.userData.loaded ? 'live' : 'loading'; }

// Cheap by design: an unlit material with its own day/night term from the
// Sun direction (view space, shared with Earth's night lights), instead of a
// full PBR light loop on every cloud pixel. Clouds cover the whole disc, so
// per-pixel cost is what matters at high resolution.
function buildShell(R, sunDirView) {
    uniforms.uSunDirView = sunDirView;
    material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = 'varying vec3 vCloudNormal;\n' + shader.vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\nvCloudNormal = normalize(normalMatrix * normal);'
        );
        shader.fragmentShader = 'uniform float uCloudOpacity;\nuniform vec3 uSunDirView;\nvarying vec3 vCloudNormal;\n' + shader.fragmentShader
            .replace('#include <alphamap_fragment>', `#ifdef USE_ALPHAMAP
                float cloud = texture2D(alphaMap, vAlphaMapUv).r; // single-channel map
                diffuseColor.a *= uCloudOpacity * smoothstep(0.34, 0.9, cloud);
            #endif`)
            // Sunlit white → soft terminator → dim blue-grey at night
            .replace('#include <color_fragment>', `#include <color_fragment>
                float sunUp = dot(normalize(vCloudNormal), uSunDirView);
                float day = smoothstep(-0.12, 0.25, sunUp);
                diffuseColor.rgb *= mix(vec3(0.05, 0.06, 0.09), vec3(1.0), day) * (0.75 + 0.25 * clamp(sunUp, 0.0, 1.0));`);
    };
    material.customProgramCacheKey = () => 'cloud-shell-lite';
    // Same UV layout as the Earth texture: longitude 0 on the mesh's +X
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(R * SHELL_LIFT, 96, 48), material);
    mesh.name = 'cloud shell';
    mesh.raycast = () => {};
    mesh.renderOrder = 1;
    mesh.visible = false;
    return mesh;
}

async function loadClouds(size) {
    if (loading) return;
    loading = true;
    try {
        // Bucketed query so a refresh isn't served from the browser cache
        const bucket = Math.floor(Date.now() / REFRESH_MS);
        const res = await fetch(`${CLOUD_URL(size)}?t=${bucket}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const bitmap = await createImageBitmap(await res.blob(), { imageOrientation: 'flipY' });
        // Only brightness matters: keep one channel (a quarter of the GPU
        // memory and texture bandwidth of RGBA). Flipped at decode, so row 0
        // is the south edge, which is where a DataTexture puts v = 0.
        const w = bitmap.width, h = bitmap.height;
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const rgba = ctx.getImageData(0, 0, w, h).data;
        const lum = new Uint8Array(w * h);
        for (let i = 0; i < lum.length; i++) lum[i] = rgba[i * 4];
        const tex = new THREE.DataTexture(lum, w, h, THREE.RedFormat, THREE.UnsignedByteType);
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = THREE.RepeatWrapping; // seamless at the date line
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.unpackAlignment = 1;
        tex.anisotropy = 2;
        tex.needsUpdate = true;
        material.alphaMap?.dispose();
        material.alphaMap = tex;
        material.needsUpdate = true;
        shell.userData.loaded = true;
        loadedAt = Date.now();
        failed = false;
    } catch (err) {
        console.warn('Cloud map unavailable:', err);
        failed = true;
        loadedAt = Date.now(); // retry at the next refresh, not every frame
    }
    loading = false;
}

export function setCloudLayer(on, earthMesh, { sunDirView } = {}) {
    enabled = on;
    if (!earthMesh) return;
    if (!shell) {
        shell = buildShell(earthMesh.userData.visualRadius || 1, sunDirView);
        // 2K is ample: the disc is rarely over ~2000 px wide, and the 4K map
        // is 32 MB of GPU memory (plus mipmaps) sampled on every cloud pixel
        shell.userData.size = '2048x1024';
        earthMesh.add(shell);
    }
    if (on && !shell.userData.loaded && !loading) loadClouds(shell.userData.size);
}

const _earthPos = new THREE.Vector3();

// Per frame: fade by distance from "now" and by camera altitude
export function updateWeather(earthMesh, camera, simDate, visible) {
    if (!shell) return;
    if (enabled && !loading && Date.now() - loadedAt > REFRESH_MS) loadClouds(shell.userData.size);
    const hoursFromNow = Math.abs(simDate.getTime() - Date.now()) / 3600000;
    const dateFade = 1 - THREE.MathUtils.smoothstep(hoursFromNow, DATE_FADE_HOURS[0], DATE_FADE_HOURS[1]);
    earthMesh.getWorldPosition(_earthPos);
    const R = earthMesh.userData.visualRadius || 1;
    const altitude = camera.position.distanceTo(_earthPos) / R - 1;
    const altFade = THREE.MathUtils.smoothstep(altitude, ALTITUDE_FADE[0], ALTITUDE_FADE[1]);
    const opacity = enabled && visible && shell.userData.loaded ? 0.95 * dateFade * altFade : 0;
    uniforms.uCloudOpacity.value = opacity;
    shell.visible = opacity > 0.002;
}
