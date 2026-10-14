// Mars rovers: where Perseverance and Curiosity are now.
//
// NASA's "Where is the rover" maps read small GeoJSON files holding each
// rover's latest localized waypoint. NASA sends no CORS header, so browsers
// can't read them directly; the cron copies them into KV and /mars/rovers
// serves both as one short JSON.

const FEEDS = {
    Perseverance: 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints_current.json',
    Curiosity: 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints_current.json'
};
const KEY = 'mars:rovers';
const FAIL_KEY = 'failed:mars:rovers';
const RETRY_AFTER_FAIL_S = 30 * 60;

// One rover's latest waypoint, trimmed to what the site shows
async function fetchRover(name, url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'FreakinSpace (https://freakinspace.com)' },
        signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const p = (await res.json())?.features?.at(-1)?.properties;
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) throw new Error(`${name}: no position`);
    return {
        name,
        sol: p.sol,
        lat: p.lat,
        lon: p.lon,
        elevM: Number.isFinite(p.elev_geoid) ? p.elev_geoid : null,
        heading: Number.isFinite(p.yaw) ? p.yaw : null,
        totalKm: Number.isFinite(p.dist_total_m) ? p.dist_total_m / 1000 : null
    };
}

// Fetch both rovers and store them. A rover that fails keeps its last copy
export async function refreshRovers(env) {
    const old = await env.DATA.get(KEY, 'json');
    const rovers = [];
    const errors = [];
    for (const [name, url] of Object.entries(FEEDS)) {
        try { rovers.push(await fetchRover(name, url)); }
        catch (err) {
            errors.push(err.name === 'TimeoutError' ? `${name}: no answer in 20 s` : String(err.message));
            const kept = old?.rovers?.find(r => r.name === name);
            if (kept) rovers.push(kept);
        }
    }
    if (!rovers.length) {
        await env.DATA.put(FAIL_KEY, errors.join('; '), { expirationTtl: RETRY_AFTER_FAIL_S });
        throw new Error(`Mars rovers: ${errors.join('; ')}`);
    }
    const record = { fetchedAt: Date.now(), rovers };
    await env.DATA.put(KEY, JSON.stringify(record));
    if (errors.length) console.warn(`Mars rovers: ${errors.join('; ')}`);
    return record;
}

export async function rovers(env, json) {
    let record = await env.DATA.get(KEY, 'json');
    if (!record) {
        if (await env.DATA.get(FAIL_KEY)) return json({ error: 'Not available yet, try again later' }, 503);
        try { record = await refreshRovers(env); }
        catch (err) { return json({ error: String(err.message) }, 502); }
    }
    return json({ fetchedAt: new Date(record.fetchedAt).toISOString(), rovers: record.rovers }, 200,
        { 'Cache-Control': 'public, max-age=3600' });
}

export async function roverHealth(env) {
    const record = await env.DATA.get(KEY, 'json');
    return record
        ? { ageMinutes: Math.round((Date.now() - record.fetchedAt) / 60000), rovers: record.rovers.map(r => `${r.name} sol ${r.sol}`) }
        : { cached: false, lastFailure: await env.DATA.get(FAIL_KEY) };
}
