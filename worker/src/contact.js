// Contact form: POST /contact from the site's info popup.
//
// Spam defences, cheapest first:
//   - only the site's own pages may post (Origin check; browsers send it)
//   - a hidden "website" field people never see; bots fill it in
//   - sent less than 3 s after the form opened: a script, not a person
//   - length limits and at most 3 links
//   - Cloudflare Turnstile (when TURNSTILE_SECRET is set)
//   - 3 messages per hour per visitor, 30 per day overall
// Trapped bots get a normal "sent" reply so they don't learn what tripped them.
//
// Every message is kept in KV for 90 days (keys msg:<time>), and emailed
// through Resend when RESEND_API_KEY and CONTACT_TO are set (worker secrets).

const ALLOWED_ORIGINS = ['https://freakinspace.com', 'https://www.freakinspace.com'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;   // testing with wrangler dev
const MIN_FILL_MS = 3000;
const LIMITS = { name: 100, email: 200, message: 4000, minMessage: 10, links: 3 };
const PER_VISITOR_PER_HOUR = 3;
const PER_DAY = 30;
const KEEP_S = 90 * 24 * 3600;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactCors(request) {
    const origin = request.headers.get('Origin') || '';
    const ok = ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
    return ok ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin'
    } : null;
}

function answer(cors, obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' }
    });
}

// One line of plain text (no line breaks, so nothing can be smuggled into a subject)
const oneLine = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

async function hashVisitor(ip, env) {
    // Rate limiting needs to tell visitors apart, not know who they are: keep
    // a salted hash, never the address
    const data = new TextEncoder().encode(`${env.RATE_SALT || 'freakinspace'}:${ip}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bump(env, key, ttl) {
    const n = Number(await env.DATA.get(key)) || 0;
    await env.DATA.put(key, String(n + 1), { expirationTtl: ttl });
    return n;
}

async function turnstileOk(env, token, ip) {
    if (!env.TURNSTILE_SECRET) return true;            // not set up yet
    if (!token) return false;
    const body = new FormData();
    body.append('secret', env.TURNSTILE_SECRET);
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    try {
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
        return (await res.json()).success === true;
    } catch {
        return false;
    }
}

async function sendEmail(env, msg) {
    if (!env.RESEND_API_KEY || !env.CONTACT_TO) return 'not set up';
    const lines = [
        msg.message,
        '',
        '—',
        `From: ${msg.name || '(no name)'}${msg.email ? ` <${msg.email}>` : ' (no email given)'}`,
        `Sent: ${msg.at}`,
        `Page: ${msg.page || '?'}`
    ];
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: env.CONTACT_FROM || 'FreakinSpace <onboarding@resend.dev>',
            to: [env.CONTACT_TO],
            reply_to: msg.email || undefined,
            subject: `FreakinSpace: message from ${msg.name || msg.email || 'a visitor'}`,
            text: lines.join('\n')
        })
    });
    return res.ok ? 'sent' : `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
}

export async function contact(request, env) {
    const cors = contactCors(request);
    if (!cors) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return answer(cors, { ok: false, error: 'Method not allowed' }, 405);

    let form;
    try { form = await request.json(); } catch { return answer(cors, { ok: false, error: 'Bad request' }, 400); }

    // Bot traps: pretend it worked
    if (form.website || !(Number(form.elapsed) >= MIN_FILL_MS)) return answer(cors, { ok: true });

    const name = oneLine(form.name, LIMITS.name);
    const email = oneLine(form.email, LIMITS.email);
    const message = String(form.message ?? '').trim();
    if (message.length < LIMITS.minMessage) return answer(cors, { ok: false, error: 'Please write a little more.' }, 400);
    if (message.length > LIMITS.message) return answer(cors, { ok: false, error: `Please keep it under ${LIMITS.message} characters.` }, 400);
    if (email && !EMAIL_RE.test(email)) return answer(cors, { ok: false, error: 'That email address doesn’t look right.' }, 400);
    if ((message.match(/https?:\/\/|www\./gi) || []).length > LIMITS.links) {
        return answer(cors, { ok: false, error: 'Too many links in the message.' }, 400);
    }

    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (!(await turnstileOk(env, form.token, ip))) {
        return answer(cors, { ok: false, error: 'The anti-spam check didn’t pass. Please try again.' }, 403);
    }

    const visitor = await hashVisitor(ip, env);
    if (await bump(env, `rl:contact:${visitor}`, 3600) >= PER_VISITOR_PER_HOUR) {
        return answer(cors, { ok: false, error: 'That’s a few messages already. Please try again in an hour.' }, 429);
    }
    const day = new Date().toISOString().slice(0, 10);
    if (await bump(env, `rl:contact-day:${day}`, 2 * 86400) >= PER_DAY) {
        return answer(cors, { ok: false, error: 'The inbox is full for today. Please try again tomorrow.' }, 429);
    }

    const at = new Date().toISOString();
    const msg = { at, name, email, message, page: oneLine(form.page, 200), country: request.cf?.country || '' };
    let delivery;
    try { delivery = await sendEmail(env, msg); } catch (err) { delivery = `error: ${err.message}`; }
    msg.delivery = delivery;
    await env.DATA.put(`msg:${at}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(msg), { expirationTtl: KEEP_S });
    if (delivery !== 'sent' && delivery !== 'not set up') console.warn('Contact email failed:', delivery);
    return answer(cors, { ok: true });
}
