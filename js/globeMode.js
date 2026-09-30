// Globe mode: dress Earth up as a desktop globe — a latitude/longitude grid
// with a glowing equator on the planet itself, plus a stand: a pole-to-pole
// meridian arc with pins, a neck and a round base, in dark metal with a
// glowing blue rim.
//
// The stand stands "upright" against Earth's orbital plane (ecliptic north),
// so the arc leans by Earth's real 23.4° axial tilt, which is exactly why
// desktop globes are tilted. The grid is a child of the Earth mesh and turns
// with it; the stand follows the tilt but not the spin.
import * as THREE from 'three';

const GRID_STEP_DEG = 15;
const GRID_LIFT = 1.0015;          // radius factor: above imagery tiles (~10 km)
const ARC_RADIUS = 1.14;           // meridian arc, in Earth radii
const ARC_EXTRA_TOP = 0.22;        // arc continues a little past the north pole (radians)
const BLUE = new THREE.Color(0x4a9eff);

let grid = null;       // child of the Earth mesh
let stand = null;      // scene-level group
let enabled = false;

export function isGlobeMode() { return enabled; }

// Dark metal whose edges glow blue (Fresnel rim added to the emissive term)
function rimMaterial(base = 0x10151f) {
    const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.35, metalness: 0.8 });
    mat.onBeforeCompile = shader => {
        shader.uniforms.uRimColor = { value: BLUE };
        shader.fragmentShader = 'uniform vec3 uRimColor;\n' + shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
            totalEmissiveRadiance += uRimColor * (0.015 + 1.1 * pow(rim, 3.5));`
        );
    };
    mat.customProgramCacheKey = () => 'globe-rim';
    return mat;
}

function noPick(obj) {
    obj.traverse(o => { o.raycast = () => {}; });
    return obj;
}

function buildGrid(R) {
    const group = new THREE.Group();
    group.name = 'globe grid';
    const r = R * GRID_LIFT;
    const pts = [];
    const dir = (lat, lon) => {
        // Same convention as updateUserMarker / iss.js: lon 0 on +X, east toward −Z
        const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
        return new THREE.Vector3(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r);
    };
    // Parallels (the equator gets its own glowing band)
    for (let lat = -90 + GRID_STEP_DEG; lat < 90; lat += GRID_STEP_DEG) {
        if (lat === 0) continue;
        for (let lon = 0; lon < 360; lon += 3) pts.push(dir(lat, lon), dir(lat, lon + 3));
    }
    // Meridians
    for (let lon = 0; lon < 360; lon += GRID_STEP_DEG) {
        for (let lat = -90; lat < 90; lat += 3) pts.push(dir(lat, lon), dir(lat + 3, lon));
    }
    const lines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    lines.name = 'globe graticule';
    group.add(lines);

    // Tropics and polar circles, fainter
    const special = [];
    for (const lat of [23.44, -23.44, 66.56, -66.56]) {
        for (let lon = 0; lon < 360; lon += 4) if ((lon / 4) % 2 === 0) special.push(dir(lat, lon), dir(lat, lon + 4));
    }
    group.add(new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(special),
        new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })
    ));

    // Glowing equator band
    const equator = new THREE.Mesh(
        new THREE.TorusGeometry(R * 1.002, R * 0.0045, 6, 256),
        new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    equator.rotation.x = Math.PI / 2; // torus lies in XY; the equator is the XZ plane
    equator.name = 'globe equator';
    group.add(equator);
    return noPick(group);
}

function buildStand(R) {
    const group = new THREE.Group();
    group.name = 'globe stand';
    const metal = rimMaterial();

    // Meridian arc in the plane of the axis, on the side the north pole leans
    // toward (+X), like a real desktop globe: from just past the north pole,
    // down that side and under the globe — where the neck holds it, straight
    // below Earth — with a short tail curving on to the south pole pin
    const tilted = new THREE.Group();
    tilted.name = 'globe arc';
    const arcAngle = Math.PI + ARC_EXTRA_TOP;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R * ARC_RADIUS, R * 0.035, 12, 160, arcAngle), metal);
    arc.rotation.z = -Math.PI / 2; // start at the south pole, sweep over +X to past the north pole
    tilted.add(arc);
    // Pole pins where the axis meets the arc
    const pinGeo = new THREE.CylinderGeometry(R * 0.018, R * 0.018, R * (ARC_RADIUS - 0.98), 10);
    for (const s of [1, -1]) {
        const pin = new THREE.Mesh(pinGeo, metal);
        pin.position.y = s * R * (ARC_RADIUS + 0.98) / 2;
        tilted.add(pin);
    }
    group.add(tilted);
    group.userData.tilted = tilted;

    // Neck and base, straight down (ecliptic south). The arc's lower end is
    // joined to the top of the neck by a short swivel collar at the arc's
    // lowest point (which the tilt puts between the +X side and the south pole).
    const neckTop = -R * (ARC_RADIUS + 0.03), baseY = -R * 1.95;
    const collar = new THREE.Mesh(new THREE.SphereGeometry(R * 0.07, 16, 12), metal);
    collar.position.y = neckTop;
    group.add(collar);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.05, R * 0.11, neckTop - baseY, 24), metal);
    neck.position.y = (neckTop + baseY) / 2;
    group.add(neck);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.72, R * 0.14, 64), metal);
    base.position.y = baseY - R * 0.07;
    group.add(base);
    // Glowing trim ring around the base
    const trim = new THREE.Mesh(
        new THREE.TorusGeometry(R * 0.72, R * 0.012, 8, 128),
        new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = baseY - R * 0.07;
    group.add(trim);
    return noPick(group);
}

export function setGlobeMode(on, earthMesh, scene) {
    enabled = on;
    if (!earthMesh) return;
    const R = earthMesh.userData.visualRadius || 1;
    if (on && !grid) {
        grid = buildGrid(R);
        stand = buildStand(R);
        earthMesh.add(grid);
        scene.add(stand);
    }
    if (grid) grid.visible = on;
    if (stand) stand.visible = on;
}

const _earthPos = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _lean = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3();

// Per frame: keep the stand under Earth, upright to the ecliptic, with the
// arc leaning along Earth's axis; fade it out when the camera comes close
export function updateGlobeMode(earthMesh, camera, visible) {
    if (!stand || !grid) return;
    const show = enabled && visible && earthMesh?.visible !== false;
    grid.visible = show;
    if (!show) { stand.visible = false; return; }

    const R = earthMesh.userData.visualRadius || 1;
    earthMesh.getWorldPosition(_earthPos);
    _pole.set(0, 1, 0).applyQuaternion(earthMesh.getWorldQuaternion(_q));
    // Stand frame: +Y ecliptic north, +X the horizontal direction the pole leans toward
    _lean.copy(_pole).addScaledVector(_up, -_pole.dot(_up));
    if (_lean.lengthSq() < 1e-8) _lean.set(1, 0, 0);
    _lean.normalize();
    _z.crossVectors(_lean, _up);
    stand.quaternion.setFromRotationMatrix(_m.makeBasis(_lean, _up, _z));
    stand.position.copy(_earthPos);
    // Arc tilts from vertical toward +X by the axial tilt
    const tilt = Math.acos(THREE.MathUtils.clamp(_pole.dot(_up), -1, 1));
    stand.userData.tilted.rotation.z = -tilt;

    // Out of the way when zoomed in near the surface (the arc sits at 1.14 R)
    const dist = camera.position.distanceTo(_earthPos) / R;
    stand.visible = dist > 2.2;
    const fade = THREE.MathUtils.smoothstep(dist, 1.2, 1.6);
    grid.children.forEach(c => { if (c.material) c.material.opacity = (c.userData.baseOpacity ??= c.material.opacity) * fade; });
}
