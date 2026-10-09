# FreakinSpace API (Cloudflare Worker)

A small server piece beside the static site. Right now it keeps a cached copy
of CelesTrak's satellite data, refreshed every 3 hours, so visitors don't each
count against CelesTrak's download limit. Rocket launches and active missions
come next.

| Endpoint | What |
|---|---|
| `GET /tle/<group>` | TLE text for `stations`, `gps-ops`, `geo`, `starlink` |
| `GET /health` | What's cached, how old it is, and the last error |
| `POST /contact` | The site's contact form (see below) |

## First deploy (one time)

Run these from this `worker` folder:

```
npm install
npx wrangler login
```
`login` opens a browser window to sign in to your Cloudflare account.

```
npx wrangler kv namespace create DATA
```
This prints an `id`. Paste it into `wrangler.toml` in place of
`REPLACE_WITH_KV_NAMESPACE_ID`.

```
npx wrangler deploy
```
This prints the Worker's address, like
`https://freakinspace-api.<your-subdomain>.workers.dev`.

Then in `js/satellites.js` set `SPACE_API` to that address (no trailing
slash), bump the `?v=` version as usual, and upload the site.

The first scheduled refresh runs within 3 hours. To fill the cache straight
away, open `<address>/tle/stations` (and the other groups) once in a browser.
Check it any time at `<address>/health`.

## Later deploys

```
npx wrangler deploy
```

## Running it locally

`npx wrangler dev --test-scheduled` serves it at http://localhost:8787 with a
local copy of the KV store. Open `/__scheduled` to run the refresh job.

## Contact form

The site's **Send a message** form posts here. Every message is saved in KV
for 90 days (Cloudflare dashboard → Storage & Databases → KV → DATA, keys
starting `msg:`), and emailed to you once Resend is set up. Spam checks are
listed at the top of `src/contact.js`.

Secrets (each command asks for the value; run from this `worker` folder):

| Secret | What |
|---|---|
| `TURNSTILE_SECRET` | Secret key of the Turnstile widget. Its *site* key goes in `js/contact.js` (`TURNSTILE_SITE_KEY`). Set both together: with only the secret, every message is refused |
| `RESEND_API_KEY` | API key from resend.com |
| `CONTACT_TO` | Where messages go (the address you signed up to Resend with) |

```
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put CONTACT_TO
```

Turnstile: Cloudflare dashboard → Turnstile → Add widget, hostname
`freakinspace.com` (add `localhost` too for testing), mode Managed.

Testing locally: put `TURNSTILE_SECRET=1x0000000000000000000000000000000AA`
(Cloudflare's always-pass test key) in `worker/.dev.vars`, run the worker
locally, set `TURNSTILE_SITE_KEY` to `1x00000000000000000000AA`, and open the
site at `http://localhost:3000/?localapi`.
