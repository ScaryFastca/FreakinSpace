// Contact form (opened from the info popup). Posts to the API worker's
// /contact, which keeps and emails the message; see worker/src/contact.js
// for the spam checks. Nothing loads until the form is first opened.
import { SPACE_API } from './satellites.js?v=350';

// Cloudflare Turnstile site key (public). Empty: no challenge shown, and the
// worker skips that check unless TURNSTILE_SECRET is set there
const TURNSTILE_SITE_KEY = '0x4AAAAAAFR_vDo-4DHRV12T';
// (testing: ?localapi on localhost posts to `wrangler dev` instead)
const API = location.hostname === 'localhost' && new URLSearchParams(location.search).has('localapi')
    ? 'http://localhost:8787' : SPACE_API;

const state = { openedAt: 0, widget: null, turnstile: null, busy: false };

function loadTurnstile() {
    if (!TURNSTILE_SITE_KEY) return Promise.resolve(null);
    if (!state.turnstile) {
        state.turnstile = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            s.async = true;
            s.onload = () => resolve(window.turnstile);
            s.onerror = () => { state.turnstile = null; reject(new Error('Turnstile didn’t load')); };
            document.head.appendChild(s);
        });
    }
    return state.turnstile;
}

function setStatus(text, kind = '') {
    const el = document.getElementById('contact-status');
    el.textContent = text;
    el.className = kind;
}

export function openContactForm() {
    const dialog = document.getElementById('contact-dialog');
    dialog.hidden = false;
    state.openedAt = performance.now();
    setStatus('');
    document.getElementById('contact-message').focus();
    loadTurnstile().then(ts => {
        if (!ts || state.widget !== null) return;
        state.widget = ts.render('#contact-turnstile', { sitekey: TURNSTILE_SITE_KEY, theme: 'dark', size: 'flexible' });
    }).catch(() => setStatus('The anti-spam check couldn’t load. Check your connection or ad blocker.', 'error'));
}

function closeContactForm() {
    document.getElementById('contact-dialog').hidden = true;
}

async function submit(e) {
    e.preventDefault();
    if (state.busy) return;
    const form = e.target;
    const token = state.widget !== null ? window.turnstile?.getResponse(state.widget) : '';
    if (TURNSTILE_SITE_KEY && !token) { setStatus('One moment: the anti-spam check is still running.', 'error'); return; }
    state.busy = true;
    form.querySelector('button[type="submit"]').disabled = true;
    setStatus('Sending…');
    try {
        const res = await fetch(`${API}/contact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: form.elements.name.value,
                email: form.elements.email.value,
                message: form.elements.message.value,
                website: form.elements.website.value,       // (the hidden trap)
                elapsed: Math.round(performance.now() - state.openedAt),
                token,
                page: location.href
            })
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.ok) throw new Error(out.error || `Couldn’t send (HTTP ${res.status}).`);
        form.reset();
        setStatus('Thanks! Your message is on its way.', 'ok');
    } catch (err) {
        setStatus(err.message === 'Failed to fetch' ? 'Couldn’t reach the server. Please try again.' : err.message, 'error');
    } finally {
        state.busy = false;
        form.querySelector('button[type="submit"]').disabled = false;
        if (state.widget !== null) window.turnstile?.reset(state.widget);
    }
}

export function setupContactForm() {
    const dialog = document.getElementById('contact-dialog');
    if (!dialog) return;
    document.getElementById('contact-open')?.addEventListener('click', e => { e.preventDefault(); openContactForm(); });
    dialog.querySelector('.contact-close').addEventListener('click', closeContactForm);
    dialog.addEventListener('click', e => { if (e.target === dialog) closeContactForm(); });   // (the backdrop)
    dialog.addEventListener('keydown', e => { if (e.key === 'Escape') closeContactForm(); });
    document.getElementById('contact-form').addEventListener('submit', submit);
}
