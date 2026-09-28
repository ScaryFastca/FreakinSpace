import * as THREE from 'three';

// Shared by every effect: one update per frame, no per-object animation work.
export const stellarTime = { value: 0 };

// Extend built-in materials so logarithmic depth and color management remain intact.
function shade(material, declarations, fragment, vertex = '') {
    material.onBeforeCompile = shader => {
        shader.uniforms.stellarTime = stellarTime;
        shader.vertexShader = `varying vec3 stellarPosition;\n${shader.vertexShader}`
            .replace('#include <begin_vertex>', `#include <begin_vertex>\nstellarPosition = position;\n${vertex}`);
        shader.fragmentShader = `uniform float stellarTime;\nvarying vec3 stellarPosition;\n${declarations}\n${shader.fragmentShader}`
            .replace('#include <color_fragment>', `#include <color_fragment>\n${fragment}`);
    };
    material.customProgramCacheKey = () => declarations + fragment + vertex;
    return material;
}

export function enhanceStarSurface(material) {
    return shade(material, '', `
        vec3 p = normalize(stellarPosition);
        float t = stellarTime * 0.035;
        float cells = sin(p.x * 95.0 + sin(p.z * 41.0 + t))
                    * sin(p.y * 89.0 + sin(p.x * 37.0 - t));
        float flow = sin(p.x * 18.0 + p.z * 13.0 + t) * sin(p.y * 23.0 - t);
        diffuseColor.rgb *= 0.88 + 0.15 * cells + 0.12 * flow;
    `);
}

export function createCorona(radius, color) {
    const material = shade(new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.65,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
    }), '', `
        float facing = abs(dot(normalize(stellarNormal), normalize(stellarViewPosition)));
        float rim = 6.0 * facing * exp(-8.0 * facing);
        vec3 p = normalize(stellarPosition);
        float rays = 0.75 + 0.25 * sin(atan(p.z, p.x) * 28.0 + p.y * 17.0 + stellarTime * 0.15);
        diffuseColor.a *= rim * rays;
    `);
    // Basic materials don't normally expose view normals; provide them explicitly.
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
        compile(shader);
        shader.vertexShader = 'varying vec3 stellarNormal; varying vec3 stellarViewPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
            '#include <project_vertex>\nstellarNormal = normalize(normalMatrix * normal);\nstellarViewPosition = -mvPosition.xyz;');
        shader.fragmentShader = 'varying vec3 stellarNormal; varying vec3 stellarViewPosition;\n' + shader.fragmentShader;
    };
    const corona = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.12, 32, 24), material);
    corona.name = 'stellarCorona';
    corona.raycast = () => {};
    return corona;
}

export function addBlackHoleEffects(parent, radius, color, outerRadius = 5) {
    const material = shade(new THREE.MeshBasicMaterial({
        color, transparent: true, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
    }), '', `
        float r = length(stellarPosition.xy) / ${radius.toFixed(8)};
        float radial = clamp((r - 1.25) / ${(outerRadius - 1.25).toFixed(8)}, 0.0, 1.0);
        float angle = atan(stellarPosition.y, stellarPosition.x);
        float bands = 0.72 + 0.28 * sin(r * 35.0 + sin(angle * 3.0 - stellarTime * 0.35));
        float spiral = 0.75 + 0.25 * sin(angle * 5.0 - r * 9.0 + stellarTime * 0.6);
        float hot = pow(1.0 - radial, 3.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.92, 0.72), hot);
        diffuseColor.rgb *= 0.8 + 0.5 * (0.5 + 0.5 * cos(angle));
        diffuseColor.a = smoothstep(0.0, 0.06, radial) * (1.0 - smoothstep(0.55, 1.0, radial)) * bands * spiral;
    `);
    const disk = new THREE.Mesh(new THREE.RingGeometry(radius * 1.25, radius * outerRadius, 128), material);
    disk.rotation.x = Math.PI * 0.32;
    disk.name = 'accretionDisk';
    disk.raycast = () => {};
    parent.add(disk);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.06, radius * 0.025, 8, 96),
        new THREE.MeshBasicMaterial({ color: 0xffe5bc, toneMapped: false }));
    ring.name = 'photonRing';
    ring.raycast = () => {};
    // Stylized lensing outline always faces the observer; the disk stays tilted.
    const worldRotation = new THREE.Quaternion();
    ring.onBeforeRender = (_renderer, _scene, camera) => {
        parent.getWorldQuaternion(worldRotation);
        ring.quaternion.copy(worldRotation.invert()).multiply(camera.quaternion);
        ring.updateMatrixWorld(true);
    };
    parent.add(ring);
}
