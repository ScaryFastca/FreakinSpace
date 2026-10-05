// Spaceship-style flying: smooth curved paths that go round planets instead
// of through them, and a chase camera that rides along without lagging,
// jerking or flipping. Built for the UFO easter egg; meant for tours and any
// other scripted flight.
import * as THREE from 'three';

// ── Paths ────────────────────────────────────────────────────────────────
// A cubic Bézier from `from` to `to` that leaves along `leaveDir` (e.g. up off
// a surface) and arrives along `-arriveDir` (e.g. down onto a spot). Handle
// lengths are a share of the trip (`leave`, `arrive`), or absolute distances
// (`leaveDist`, `arriveDist`): leaving a planet a few of its radii is right;
// a share of a long trip sends you far off in the wrong direction first.
export function makePath(from, to, { leaveDir = null, arriveDir = null, leave = 0.3, arrive = 0.3,
    leaveDist = null, arriveDist = null, avoid = [] } = {}) {
    const span = from.distanceTo(to);
    const p0 = from.clone(), p3 = to.clone();
    const straight = to.clone().sub(from).normalize();
    const p1 = from.clone().addScaledVector(leaveDir ? leaveDir.clone().normalize() : straight, leaveDist ?? span * leave);
    const p2 = to.clone().addScaledVector(arriveDir ? arriveDir.clone().normalize() : straight.clone().negate(), arriveDist ?? span * arrive);
    const path = { p0, p1, p2, p3 };
    if (avoid.length) keepPathClear(path, avoid);
    return path;
}

export function pathPoint(path, t, out = new THREE.Vector3()) {
    const u = 1 - t;
    return out.set(0, 0, 0)
        .addScaledVector(path.p0, u * u * u)
        .addScaledVector(path.p1, 3 * u * u * t)
        .addScaledVector(path.p2, 3 * u * t * t)
        .addScaledVector(path.p3, t * t * t);
}

export function pathTangent(path, t, out = new THREE.Vector3()) {
    const u = 1 - t;
    out.set(0, 0, 0)
        .addScaledVector(path.p1.clone().sub(path.p0), 3 * u * u)
        .addScaledVector(path.p2.clone().sub(path.p1), 6 * u * t)
        .addScaledVector(path.p3.clone().sub(path.p2), 3 * t * t);
    return out.lengthSq() > 1e-30 ? out.normalize() : out.set(0, 0, 1);
}

// Push the two middle handles out until no sample of the curve passes inside
// a body (spheres: { center, radius } with some clearance). A few rounds are
// plenty for a planet or two in the way.
export function keepPathClear(path, bodies, clearance = 1.3) {
    const p = new THREE.Vector3();
    for (let round = 0; round < 8; round++) {
        let worst = null;
        for (let i = 1; i < 32; i++) {
            const t = i / 32;
            pathPoint(path, t, p);
            for (const b of bodies) {
                const need = b.radius * clearance;
                const d = p.distanceTo(b.center);
                if (d < need && (!worst || need - d > worst.depth)) worst = { t, b, depth: need - d, at: p.clone() };
            }
        }
        if (!worst) return path;
        // Shove the nearer handle outward from the body's centre
        const handle = worst.t < 0.5 ? path.p1 : path.p2;
        const out = worst.at.clone().sub(worst.b.center);
        if (out.lengthSq() < 1e-20) out.set(0, 1, 0);
        handle.addScaledVector(out.normalize(), (worst.depth + worst.b.radius * 0.5) * 2.5);
    }
    return path;
}

// ── Springs ──────────────────────────────────────────────────────────────
// Critically damped spring for vectors: follows a moving goal smoothly with
// no overshoot. `time` ≈ how long it takes to mostly catch up.
export function springVec(state, goal, dt, time = 0.35) {
    state.vel ??= new THREE.Vector3();
    const w = 2 / Math.max(time, 1e-3);
    const x = w * dt, k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = state.value.clone().sub(goal);
    const temp = state.vel.clone().addScaledVector(change, w).multiplyScalar(dt);
    state.vel.sub(temp.clone().multiplyScalar(w)).multiplyScalar(k);
    state.value.copy(goal).add(change.add(temp).multiplyScalar(k));
    return state.value;
}

// Blend two vectors measured from a centre by swinging round it: the
// direction turns along a great circle and the length changes geometrically.
// For moving round a subject or a planet (a straight blend can pass through
// it). `a`/`b` are relative to the centre; returns relative too.
export function swingVec(a, b, t, out = new THREE.Vector3()) {
    const la = Math.max(a.length(), 1e-12), lb = Math.max(b.length(), 1e-12);
    const da = a.clone().divideScalar(la), db = b.clone().divideScalar(lb);
    const angle = da.angleTo(db);
    let dir = db;
    if (angle > 1e-9) {
        const axis = new THREE.Vector3().crossVectors(da, db);
        if (axis.lengthSq() < 1e-20) axis.set(0, 1, 0).cross(da); // opposite: any perpendicular
        if (axis.lengthSq() < 1e-20) axis.set(1, 0, 0).cross(da);
        dir = da.applyAxisAngle(axis.normalize(), angle * t);
    }
    return out.copy(dir).multiplyScalar(la * Math.pow(lb / la, t));
}

// Blend two offsets round a centre like a turntable: swing round the `up`
// axis (shortest way), change elevation separately, length geometric. The
// camera goes round the side, never over the top, so the horizon stays level
// (swingVec between opposite offsets could pick a path straight overhead).
export function orbitBlend(a, b, t, up = new THREE.Vector3(0, 1, 0), out = new THREE.Vector3()) {
    const u = up.clone().normalize();
    const ref = Math.abs(u.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const e1 = ref.clone().addScaledVector(u, -ref.dot(u)).normalize();
    const e2 = new THREE.Vector3().crossVectors(u, e1);
    const sph = v => {
        const len = Math.max(v.length(), 1e-12);
        const h = v.dot(u) / len;
        return { len, el: Math.asin(THREE.MathUtils.clamp(h, -1, 1)), az: Math.atan2(v.dot(e2), v.dot(e1)) };
    };
    const A = sph(a), B = sph(b);
    let dAz = B.az - A.az;
    dAz -= Math.round(dAz / (Math.PI * 2)) * Math.PI * 2; // shortest way round
    const az = A.az + dAz * t, el = A.el + (B.el - A.el) * t;
    const len = A.len * Math.pow(B.len / A.len, t);
    return out.copy(e1).multiplyScalar(Math.cos(el) * Math.cos(az))
        .addScaledVector(e2, Math.cos(el) * Math.sin(az))
        .addScaledVector(u, Math.sin(el))
        .multiplyScalar(len);
}

// Keep a point outside spheres (camera never inside a planet)
export function pushOutside(point, bodies, clearance = 1.08) {
    for (const b of bodies) {
        const off = point.clone().sub(b.center);
        const need = b.radius * clearance;
        if (off.length() < need) point.copy(b.center).addScaledVector(off.lengthSq() > 1e-20 ? off.normalize() : new THREE.Vector3(0, 1, 0), need);
    }
    return point;
}

// ── Ship camera ──────────────────────────────────────────────────────────
// Rides along with a moving subject: the camera's OFFSET from the subject is
// smoothed (not its position), so it never falls behind however fast the
// subject goes, while changes of framing are gentle. "Up" is carried along
// from frame to frame (never rebuilt from a fixed world axis), so heading
// straight up or down can't flip the view.
export function createShipCamera(camera, target) {
    const fwd = target.clone().sub(camera.position);
    return {
        offset: { value: camera.position.clone().sub(target) },
        // (aim kept relative to the subject too, so it never lags a fast mover)
        aim: { value: new THREE.Vector3() },
        aimReady: false,
        fwd: fwd.lengthSq() > 1e-30 ? fwd.normalize() : new THREE.Vector3(0, 0, -1),
        up: camera.up.clone().normalize()
    };
}

// Turn `v` (unit) toward `goal` (unit) by at most `maxRad`
export function turnToward(v, goal, maxRad) {
    const angle = v.angleTo(goal);
    if (angle <= maxRad || angle < 1e-9) return v.copy(goal);
    const axis = new THREE.Vector3().crossVectors(v, goal);
    if (axis.lengthSq() < 1e-20) axis.set(0, 1, 0).cross(v); // opposite: any perpendicular
    return v.applyAxisAngle(axis.normalize(), maxRad).normalize();
}

// subject: where the action is; desiredOffset: where the camera should sit
// relative to it; aimAt: what to look at; upHint: preferred up (blended in
// gently); bodies: spheres to stay out of. maxTurnDeg: like a real ship, the
// view (and its roll) can't swing faster than this many degrees per second,
// however abruptly the goal moves
export function steerShipCamera(ship, camera, controls, { subject, desiredOffset, aimAt, upHint = null, upFollow = 0.04,
    bodies = [], dt = 1 / 60, offsetTime = 0.45, aimTime = 0.25, maxTurnDeg = 70, levelUp = null, maxRollDeg = 60 }) {
    springVec(ship.offset, desiredOffset, dt, offsetTime);
    // Aim as an offset from the subject: smoothed in world space it trailed
    // far behind a fast-moving subject and the camera looked back the way
    // it came
    const aimRel = aimAt.clone().sub(subject);
    if (!ship.aimReady) { ship.aim.value.copy(aimRel); ship.aimReady = true; }
    springVec(ship.aim, aimRel, dt, aimTime);
    const aimWorld = subject.clone().add(ship.aim.value);
    const pos = subject.clone().add(ship.offset.value);
    pushOutside(pos, bodies, 1); // (callers pad the radii themselves)
    camera.position.copy(pos);
    // Look direction, rate-limited
    const toAim = aimWorld.clone().sub(pos);
    const aimDist = toAim.length();
    const maxRad = THREE.MathUtils.degToRad(maxTurnDeg) * dt;
    if (aimDist > 1e-30) turnToward(ship.fwd, toAim.divideScalar(aimDist), maxRad);
    controls.target.copy(pos).addScaledVector(ship.fwd, Math.max(aimDist, 1e-9));
    // Up. With `levelUp`, keep the horizon level to it (like a plane), except
    // when looking nearly straight along it, where "level" means nothing and
    // the carried-over up is kept instead. The roll itself is rate-limited
    // (maxRollDeg), so the view rights itself smoothly rather than flipping
    const carried = ship.up.clone().addScaledVector(ship.fwd, -ship.up.dot(ship.fwd));
    if (carried.lengthSq() < 1e-8) carried.copy(camera.up).addScaledVector(ship.fwd, -camera.up.dot(ship.fwd));
    carried.normalize();
    let goalUp = carried;
    const hint = levelUp || upHint;
    if (hint) {
        const level = hint.clone().addScaledVector(ship.fwd, -hint.dot(ship.fwd));
        if (level.lengthSq() > 1e-8) {
            level.normalize();
            // 1 = level the horizon; 0 near the poles (looking along the hint)
            const along = Math.abs(ship.fwd.dot(hint.clone().normalize()));
            const w = levelUp ? 1 - THREE.MathUtils.smoothstep(along, 0.8, 0.97) : upFollow;
            goalUp = carried.clone().lerp(level, w).normalize();
        }
    }
    ship.up.copy(carried);
    turnToward(ship.up, goalUp, THREE.MathUtils.degToRad(maxRollDeg) * dt);
    ship.up.addScaledVector(ship.fwd, -ship.up.dot(ship.fwd)).normalize();
    camera.up.copy(ship.up);
    camera.lookAt(controls.target);
}
