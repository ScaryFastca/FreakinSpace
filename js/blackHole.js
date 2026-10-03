// Black holes, drawn by tracing light rays through curved space.
//
// A camera-facing square around the hole runs a small ray marcher per pixel:
// each ray starts a little in front of the hole, bends toward it (photon
// paths in the Schwarzschild metric: d²x/dλ² = −1.5 h² x / r⁵, units of the
// Schwarzschild radius Rs), and is checked against a thin accretion disk
// every time it crosses the disk plane. That gives the "Interstellar" look
// for free: the far side of the disk lensed into arcs over the top and under
// the bottom, a black shadow ~2.6 Rs across edged by a photon ring, and the
// side spinning toward you brighter and bluer (Doppler beaming).
//
// Only the disk is lensed (background stars aren't: that needs the whole sky
// rendered to a texture first). Rays that miss everything leave the pixel
// transparent; rays that fall in make it opaque black.
import * as THREE from 'three';

const DISK_INNER = 3.0;        // innermost stable orbit, Rs
const DISK_OUTER = 9.0;        // Rs
// How far the visible disk and arcs reach, Rs (for spacing objects apart)
export const BLACK_HOLE_REACH = 9.5;
const MARCH_START = 40.0;      // rays start this far in front of the square, Rs
const STEPS = 90;
const MISS_RADIUS = 13.0;      // bounding sphere (Rs): rays passing further out can't reach the disk or bend visibly

const vertexShader = /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    // Local -> disk space, combined on the CPU in doubles. Going through world
    // space on the GPU (float32) fell apart far from home: at Gargantua's
    // 2.9e11 units a float only resolves ~30,000 units, about its own size
    uniform mat4 uLocalToDisk;
    varying vec3 vDiskPos;
    void main() {
        vDiskPos = (uLocalToDisk * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
    }
`;

const fragmentShader = /* glsl */`
    #include <logdepthbuf_pars_fragment>
    uniform vec3 uCamDisk;      // camera position in disk space (Rs units)
    uniform vec3 uDiskColor;    // outer disk tint
    uniform float uTime;
    varying vec3 vDiskPos;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    // Value noise that repeats every \`period\` along x, so the swirl pattern
    // (x = angle around the hole) joins up where the angle wraps at ±180°
    // instead of leaving a seam across the disk
    float vnoise(vec2 p, float period) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float x0 = mod(i.x, period), x1 = mod(i.x + 1.0, period);
        return mix(mix(hash(vec2(x0, i.y)), hash(vec2(x1, i.y)), f.x),
                   mix(hash(vec2(x0, i.y + 1.0)), hash(vec2(x1, i.y + 1.0)), f.x), f.y);
    }
    float fbm(vec2 p, float period) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 3; i++) { v += a * vnoise(p, period); p *= 2.0; period *= 2.0; a *= 0.5; }
        return v;
    }

    // Disk emission where a ray crosses the plane: hot white inside, the
    // hole's tint outside, turbulent streaks sheared by orbital speed, and
    // relativistic beaming from the gas's motion along the ray
    vec4 diskColor(vec3 hit, vec3 rayDir) {
        float r = length(hit.xz);
        float x = (r - ${DISK_INNER.toFixed(1)}) / (${DISK_OUTER.toFixed(1)} - ${DISK_INNER.toFixed(1)});
        float ang = atan(hit.z, hit.x);
        float omega = 3.0 * pow(r, -1.5);               // inner gas laps faster
        float a = ang + uTime * omega;
        // 24 noise cells around the circle (a wraps every 2π)
        float streaks = fbm(vec2(a * 24.0 / 6.28318531, r * 2.2), 24.0);
        float density = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.55, 1.0, x));
        density *= 0.55 + 0.9 * streaks;
        vec3 hot = vec3(1.0, 0.95, 0.85);
        vec3 col = mix(hot, uDiskColor, smoothstep(0.0, 0.75, x));
        // Beaming: orbital velocity (counter-clockwise seen from +Y), β ≈ √(Rs/2r)
        vec3 vOrb = normalize(vec3(-hit.z, 0.0, hit.x));
        float beta = sqrt(0.5 / r);
        float gamma = 1.0 / sqrt(1.0 - beta * beta);
        float cosT = dot(vOrb, -rayDir);                 // toward the viewer
        float g = 1.0 / (gamma * (1.0 - beta * cosT));
        float boost = clamp(g * g * g, 0.2, 2.2);
        col *= boost;
        col = mix(col, col * vec3(0.8, 0.9, 1.25), clamp(g - 1.0, 0.0, 1.0)); // approaching side bluer
        return vec4(col * (0.75 + 0.45 * (1.0 - x)), clamp(density * 0.9, 0.0, 1.0));
    }

    void main() {
        #include <logdepthbuf_fragment>
        // vDiskPos is where this pixel's ray leaves the bounding sphere (we draw
        // its inside), so every ray that can reach the disk is covered from any
        // viewpoint, the camera inside the sphere included
        vec3 toPix = vDiskPos - uCamDisk;
        float camDist = length(toPix);
        vec3 dir = toPix / camDist;
        // Start where the ray enters a wider sphere (≤ ${(MISS_RADIUS + MARCH_START).toFixed(0)} Rs back from
        // the exit point), or at the camera if it's closer
        vec3 pos = vDiskPos - dir * min(${(MISS_RADIUS + MARCH_START).toFixed(1)}, camDist);
        vec3 vel = dir;
        vec3 hcross = cross(pos, vel);
        float h2 = dot(hcross, hcross);
        vec4 acc = vec4(0.0);
        bool captured = false;
        for (int i = 0; i < ${STEPS}; i++) {
            float r2 = dot(pos, pos);
            float r = sqrt(r2);
            // Inside the photon sphere (1.5 Rs) and heading inward: it can't
            // escape, so stop here instead of creeping to the horizon
            if (r < 1.0 || (r < 1.5 && dot(pos, vel) < 0.0)) { captured = true; break; }
            float dt = clamp(0.11 * r, 0.03, 3.0);
            vel += (-1.5 * h2 * pos / (r2 * r2 * r)) * dt;
            vec3 npos = pos + vel * dt;
            if (pos.y * npos.y < 0.0) {
                vec3 hit = mix(pos, npos, pos.y / (pos.y - npos.y));
                float hr = length(hit.xz);
                if (hr > ${DISK_INNER.toFixed(1)} && hr < ${DISK_OUTER.toFixed(1)}) {
                    vec4 c = diskColor(hit, normalize(vel));
                    acc.rgb += (1.0 - acc.a) * c.rgb * c.a;
                    acc.a += (1.0 - acc.a) * c.a;
                    if (acc.a > 0.97) break;
                }
            }
            pos = npos;
            if (r > ${(MARCH_START + 5).toFixed(1)} && dot(pos, vel) > 0.0) break; // escaped
            if (r > ${(MISS_RADIUS + 1).toFixed(1)} && dot(pos, vel) > 0.0 && i > 4) break; // left the lensing region
        }
        if (captured) acc.a = 1.0;   // the shadow: opaque black behind any disk light
        if (acc.a < 0.003) discard;
        gl_FragColor = acc;          // premultiplied
    }
`;

// Build the visual for a hole of Schwarzschild radius `radius` (scene units).
// Returns a group: the ray-marched square plus an invisible pick sphere.
// `timeUniform` is main.js's shared stellarTime (imported there with the
// cache-busting ?v=, so passing it avoids a second module copy with its own
// clock). `faceDir` (unit vector, in the parent's frame) is where the disk is
// shown nearly edge-on to — the Solar System on the map, the viewer in size
// comparison — tipped ~11° toward it: the "Interstellar" view. Real disk
// orientations are mostly unknown, so this is a viewing choice.
const DISK_VIEW_TIP = 0.2; // radians
export function createBlackHoleVisual(radius, diskColor = 0xff7a30, tiltSeed = 0, timeUniform = { value: 0 },
    faceDir = new THREE.Vector3(0, 0, 1)) {
    const group = new THREE.Group();
    group.name = 'blackHoleVisual';

    // Disk frame: scaled so one unit = Rs, tilted a little per hole
    const diskFrame = new THREE.Object3D();
    diskFrame.scale.setScalar(radius);
    const f = faceDir.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(f, -f.y);
    if (up.lengthSq() < 1e-6) up.set(1, 0, 0).addScaledVector(f, -f.x);
    up.normalize();
    // Small per-hole variety in how the disk is rolled, so they don't all match
    up.applyAxisAngle(f, 0.35 * Math.sin(tiltSeed * 12.9898));
    const normal = up.multiplyScalar(Math.cos(DISK_VIEW_TIP)).addScaledVector(f, Math.sin(DISK_VIEW_TIP)).normalize();
    const xAxis = new THREE.Vector3().crossVectors(normal, f).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, normal);
    diskFrame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, normal, zAxis));
    group.add(diskFrame);

    const uniforms = {
        uLocalToDisk: { value: new THREE.Matrix4() },
        uCamDisk: { value: new THREE.Vector3() },
        uDiskColor: { value: new THREE.Color(diskColor) },
        uTime: timeUniform
    };
    const material = new THREE.ShaderMaterial({
        uniforms, vertexShader, fragmentShader,
        transparent: true, depthWrite: false, side: THREE.BackSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor
    });
    // Drawn on the inside of a sphere just past the lensing region: no square
    // edge to clip the disk when the camera is close (perspective spilled the
    // near side of the disk past a camera-facing square)
    const billboard = new THREE.Mesh(new THREE.SphereGeometry(MISS_RADIUS * radius, 48, 32), material);
    billboard.name = 'blackHoleLensing';
    billboard.raycast = () => {};
    const camPos = new THREE.Vector3();
    const worldToDisk = new THREE.Matrix4();
    billboard.onBeforeRender = (_renderer, _scene, camera) => {
        camera.getWorldPosition(camPos);
        diskFrame.updateMatrixWorld(true);
        worldToDisk.copy(diskFrame.matrixWorld).invert();
        uniforms.uLocalToDisk.value.multiplyMatrices(worldToDisk, billboard.matrixWorld);
        uniforms.uCamDisk.value.copy(camPos).applyMatrix4(worldToDisk);
    };
    group.add(billboard);

    // Clicks/hover land on the shadow (not drawn: the shader draws it)
    const pick = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 2.6, 16, 12),
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    );
    pick.name = 'blackHolePick';
    group.add(pick);
    return group;
}
