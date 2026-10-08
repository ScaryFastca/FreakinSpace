// FreakinSpace API: a small Cloudflare Worker beside the static site.
//
// Satellites: CelesTrak only lets each network download a group once every
// 2 hours (more gets HTTP 403), and every visitor's browser was its own
// download. Here a scheduled job fetches each group every 3 hours and keeps
// the copy in KV; visitors get that copy, so CelesTrak sees one download per
// group however many people visit.
//
//   GET /tle/<group>   TLE text (stations, gps-ops, geo, starlink)
//   GET /health        what's cached and how old it is

const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=';
const GROUPS = ['stations', 'gps-ops', 'geo', 'starlink'];
const RETRY_AFTER_FAIL_S = 30 * 60;   // after a failed fetch, don't hammer CelesTrak
const BROWSER_CACHE_S = 15 * 60;

const CORS = {
    'Access-Control-Allow-Origin': '*',          // public data
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400'
};

function reply(body, status = 200, headers = {}) {
    return new Response(body, { status, headers: { ...CORS, ...headers } });
}
const json = (obj, status = 200) =>
    reply(JSON.stringify(obj, null, 2), status, { 'Content-Type': 'application/json; charset=utf-8' });

// Fetch one group from CelesTrak and store it. Throws on failure (and notes
// the failure so nobody retries for a while)
async function refreshGroup(env, group) {
    const fail = async why => {
        await env.DATA.put(`failed:${group}`, why, { expirationTtl: RETRY_AFTER_FAIL_S });
        throw new Error(`CelesTrak ${group}: ${why}`);
    };
    let res;
    try {
        res = await fetch(CELESTRAK + group, {
            headers: { 'User-Agent': 'FreakinSpace (https://freakinspace.com)' },
            signal: AbortSignal.timeout(20000)
        });
    } catch (err) {
        return fail(err.name === 'TimeoutError' ? 'no answer in 20 s' : `network error: ${err.message}`);
    }
    const text = res.ok ? await res.text() : '';
    // A real TLE file has "1 " / "2 " line pairs; anything else is an error page
    // (CelesTrak sends CRLF line endings)
    if (!res.ok || !/^1 .*\r?\n2 /m.test(text)) return fail(res.ok ? 'not TLE data' : `HTTP ${res.status}`);
    const record = { fetchedAt: Date.now(), text };
    await env.DATA.put(`tle:${group}`, JSON.stringify(record));
    return record;
}

async function tle(env, group) {
    if (!GROUPS.includes(group)) return reply('Unknown group', 404);
    let record = await env.DATA.get(`tle:${group}`, 'json');
    if (!record) {
        // Nothing cached yet (first run): fetch once now, unless that just failed
        if (await env.DATA.get(`failed:${group}`)) return reply('Not available yet, try again later', 503, { 'Retry-After': '1800' });
        try { record = await refreshGroup(env, group); }
        catch (err) { return reply(String(err.message), 502); }
    }
    return reply(record.text, 200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': `public, max-age=${BROWSER_CACHE_S}`,
        'X-Fetched-At': new Date(record.fetchedAt).toISOString()
    });
}

async function health(env) {
    const out = {};
    for (const group of GROUPS) {
        const record = await env.DATA.get(`tle:${group}`, 'json');
        out[group] = record
            ? { ageMinutes: Math.round((Date.now() - record.fetchedAt) / 60000), bytes: record.text.length }
            : { cached: false, lastFailure: await env.DATA.get(`failed:${group}`) };
    }
    return json({ ok: true, tle: out });
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') return reply(null, 204);
        if (request.method !== 'GET') return reply('Method not allowed', 405);
        const path = new URL(request.url).pathname.replace(/\/+$/, '');
        const m = path.match(/^\/tle\/([a-z-]+)$/);
        if (m) return tle(env, m[1]);
        if (path === '/health') return health(env);
        return reply('FreakinSpace API', 200, { 'Content-Type': 'text/plain' });
    },

    // Cron (wrangler.toml): refresh every group, one at a time
    async scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
            for (const group of GROUPS) {
                try { await refreshGroup(env, group); }
                catch (err) { console.warn(String(err.message)); }
            }
        })());
    }
};
