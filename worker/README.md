# FreakinSpace API (Cloudflare Worker)

A small server piece beside the static site. Right now it keeps a cached copy
of CelesTrak's satellite data, refreshed every 3 hours, so visitors don't each
count against CelesTrak's download limit. Rocket launches and active missions
come next.

| Endpoint | What |
|---|---|
| `GET /tle/<group>` | TLE text for `stations`, `gps-ops`, `geo`, `starlink` |
| `GET /health` | What's cached, how old it is, and the last error |

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
