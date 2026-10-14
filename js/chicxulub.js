import * as THREE from 'three';

// Educational replay: normalized Earth radii, compressed stages, modern geography.
export const IMPACT_DURATION = 40;
export const IMPACT_DIRECTION = new THREE.Vector3(
    Math.cos(21.4 * Math.PI / 180) * Math.cos(-89.5 * Math.PI / 180),
    Math.sin(21.4 * Math.PI / 180),
    -Math.cos(21.4 * Math.PI / 180) * Math.sin(-89.5 * Math.PI / 180)
);
export function impactStage(t) {
    return t < 8 ? 'Approach · seconds before impact' : t < 11 ? 'Impact · flash and excavation'
        : t < 23 ? 'Aftermath · ejecta and expanding wave' : 'Atmospheric dust · sunlight obscured';
}

export function createChicxulub({ earth, onStart, onEnd }) {
    const panel = document.getElementById('impact-panel');
    const slider = document.getElementById('impact-time');
    const play = document.getElementById('impact-play');
    const stage = document.getElementById('impact-stage');
    const root = new THREE.Group();
    earth.add(root);
    const site = new THREE.Group();
    site.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), IMPACT_DIRECTION);
    root.add(site);
    function sphere(radius, color, opacity = 1) {
        return new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    }
    const asteroid = sphere(0.006, 0x9e7860); // Enlarged to remain legible from orbit.
    site.add(asteroid);
    const flash = sphere(1, 0xffd090);
    site.add(flash);
    flash.position.y = 1.003;
    const crater = new THREE.Mesh(new THREE.CircleGeometry(90 / 6371, 64),
        new THREE.MeshBasicMaterial({ color: 0x37231b, side: THREE.DoubleSide }));
    crater.rotation.x = -Math.PI / 2;
    crater.position.y = 1.0002;
    site.add(crater);
    const wave = new THREE.LineLoop(new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0xffad63, transparent: true, depthWrite: false }));
    site.add(wave);
    const wavePositions = new Float32Array(129 * 3);
    wave.geometry.setAttribute('position', new THREE.BufferAttribute(wavePositions, 3));
    const dust = sphere(1.014, 0x796858, 0);
    root.add(dust);
    const debrisPositions = new Float32Array(240 * 3);
    const debris = new THREE.Points(new THREE.BufferGeometry(),
        new THREE.PointsMaterial({ color: 0xffbc72, size: 0.004, transparent: true, depthWrite: false }));
    debris.geometry.setAttribute('position', new THREE.BufferAttribute(debrisPositions, 3));
    debris.frustumCulled = false;
    site.add(debris);
    let active = false, playing = false, time = 0;
    function draw() {
        root.scale.setScalar(earth.userData.visualRadius);
        root.visible = active;
        const after = Math.max(0, time - 8);
        asteroid.visible = time < 8;
        asteroid.position.set((8 - time) * 0.085, 1.006 + (8 - time) * 0.12, 0);
        flash.visible = time >= 8 && time < 13;
        flash.scale.setScalar(0.008 + Math.min(after, 2) * 0.075);
        flash.material.opacity = Math.max(0, 1 - after / 5);
        crater.visible = time >= 8;
        wave.visible = time >= 8 && time < 28;
        const angle = Math.min(after / 20, 1) * Math.PI;
        for (let i = 0; i < 129; i++) {
            const a = i / 129 * Math.PI * 2;
            wavePositions.set([Math.sin(angle) * Math.cos(a) * 1.006,
                Math.cos(angle) * 1.006, Math.sin(angle) * Math.sin(a) * 1.006], i * 3);
        }
        wave.geometry.attributes.position.needsUpdate = true;
        wave.geometry.computeBoundingSphere();
        wave.material.opacity = Math.max(0, 1 - after / 20);
        debris.visible = time >= 8 && time < 25;
        for (let i = 0; i < 240; i++) {
            const a = i * 2.39996323;
            const age = after * 0.11;
            const speed = 0.045 + (i % 17) * 0.006;
            debrisPositions.set([Math.cos(a) * speed * age,
                1.002 + Math.max(0, speed * 2.8 * age - 0.065 * age * age),
                Math.sin(a) * speed * age], i * 3);
        }
        debris.geometry.attributes.position.needsUpdate = true;
        debris.material.opacity = Math.max(0, 1 - after / 17);
        dust.material.opacity = THREE.MathUtils.clamp((time - 20) / 20, 0, 0.65);
        slider.value = time;
        stage.textContent = impactStage(time);
        play.textContent = playing ? 'Pause' : time >= IMPACT_DURATION ? 'Replay' : 'Play';
    }
    function stop() {
        if (!active) return;
        active = playing = false;
        panel.hidden = true;
        root.visible = false;
        onEnd();
    }
    document.getElementById('impact-launch').addEventListener('click', () => {
        if (!active) onStart(IMPACT_DIRECTION.clone());
        active = playing = true;
        time = 0;
        panel.hidden = false;
        draw();
    });
    document.getElementById('impact-close').addEventListener('click', stop);
    document.getElementById('impact-reset').addEventListener('click', () => { time = 0; playing = true; draw(); });
    play.addEventListener('click', () => {
        if (time >= IMPACT_DURATION) time = 0;
        playing = !playing;
        draw();
    });
    slider.addEventListener('input', () => { time = Number(slider.value); playing = false; draw(); });
    draw();
    return { stop, update(delta, mapVisible) {
        if (!active) return;
        if (!mapVisible) { stop(); return; }
        if (playing) time = Math.min(IMPACT_DURATION, time + Math.min(delta, 0.1));
        if (time >= IMPACT_DURATION) playing = false;
        draw();
    } };
}
