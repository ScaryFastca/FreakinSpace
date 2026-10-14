// Robots on Mars: small markers on the planet where each one is.
//
// Perseverance and Curiosity come from NASA's "Where is the rover" waypoint
// feeds, through the FreakinSpace API (NASA sends no CORS header). If that
// can't be reached, the last positions known when this file was written are
// used. Ingenuity and Zhurong no longer move, so they're fixed here.

import * as THREE from 'three';
import { SPACE_API } from './satellites.js?v=351';

const MARS_RADIUS_KM = 3389.5;

// Fallbacks for the live rovers checked Oct 13 2026 (sol is the rover's own
// Mars-day count since landing)
const ROBOTS = [
    { name: 'Perseverance', kind: 'rover', live: true, lat: 18.43556, lon: 77.23281, sol: 2006, totalKm: 45.2 },
    { name: 'Curiosity', kind: 'rover', live: true, lat: -4.82459, lon: 137.38778, sol: 5041, totalKm: 38.5 },
    // NASA's helicopter waypoints, flight 72 (Jan 18 2024): rotor damaged on landing
    { name: 'Ingenuity', kind: 'helicopter', live: false, lat: 18.49727, lon: 77.32253, note: '72 flights, 18.1 km flown; grounded since Jan 2024' },
    // CNSA: went dormant for the Martian winter in May 2022 and never woke
    { name: 'Zhurong', kind: 'rover', live: false, lat: 25.066, lon: 109.925, note: 'Asleep since May 2022' }
];

const COLOR_ACTIVE = 0x66ddff;
const COLOR_IDLE = 0x9a9a9a;
const _world = new THREE.Vector3();
let group = null;
let radius = 1;

function noteFor(r) {
    if (!r.live) return r.note;
    const km = Number.isFinite(r.totalKm) ? ` · ${r.totalKm.toFixed(1)} km driven` : '';
    return `Sol ${r.sol}${km}`;
}

function surfacePoint(lat, lon, out) {
    const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
    // Same convention as the Earth home marker: east longitude, +Y north
    return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).multiplyScalar(radius * 1.001);
}

function makeMarker(r) {
    const color = r.live ? COLOR_ACTIVE : COLOR_IDLE;
    const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.008 * radius, 12, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.014 * radius, 0.02 * radius, 32),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
    );
    dot.add(ring);
    // Decorative: picking and the tooltip go through Mars itself
    dot.raycast = () => {};
    ring.raycast = () => {};
    return dot;
}

function place(marker, r) {
    surfacePoint(r.lat, r.lon, marker.position);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), marker.position.clone().normalize());
}

export function initMarsRovers(marsMesh) {
    if (!marsMesh || group) return;
    radius = marsMesh.geometry?.parameters?.radius || marsMesh.userData.visualRadius || 1;
    group = new THREE.Group();
    group.name = 'mars robots';
    for (const r of ROBOTS) {
        r.marker = makeMarker(r);
        place(r.marker, r);
        group.add(r.marker);
    }
    marsMesh.add(group);
    loadLivePositions();
}

async function loadLivePositions() {
    if (!SPACE_API) return;
    try {
        const res = await fetch(`${SPACE_API}/mars/rovers`);
        if (!res.ok) return;
        const { rovers } = await res.json();
        for (const live of rovers || []) {
            const r = ROBOTS.find(x => x.name === live.name);
            if (!r || !Number.isFinite(live.lat) || !Number.isFinite(live.lon)) continue;
            Object.assign(r, { lat: live.lat, lon: live.lon, sol: live.sol, totalKm: live.totalKm });
            place(r.marker, r);
        }
    } catch { /* offline: the built-in positions stay */ }
}

// Shrink in close-ups (like the home marker), so a marker doesn't blanket
// the crater its rover is in
export function updateMarsRovers(camera) {
    if (!group?.parent?.visible) return;
    for (const r of ROBOTS) {
        r.marker.getWorldPosition(_world);
        r.marker.scale.setScalar(Math.min(1, camera.position.distanceTo(_world) / (radius * 2)));
    }
}

// The robot within `km` of a spot (nearest first), for the hover tooltip
export function marsRobotNear(lat, lon, km) {
    const d2r = Math.PI / 180;
    let best = null, bestKm = km;
    for (const r of ROBOTS) {
        const c = Math.sin(lat * d2r) * Math.sin(r.lat * d2r)
            + Math.cos(lat * d2r) * Math.cos(r.lat * d2r) * Math.cos((lon - r.lon) * d2r);
        const d = Math.acos(Math.min(1, Math.max(-1, c))) * MARS_RADIUS_KM;
        if (d <= bestKm) { best = r; bestKm = d; }
    }
    return best && { name: `${best.name} ${best.kind}`, note: noteFor(best) };
}
