# Deploying MiniCDN to Fly.io

This walks through taking MiniCDN from "runs on my machine" to real public URLs across 3 real
regions, using [Fly.io](https://fly.io) — the same regions (`iad`/`fra`/`sin`) this project's
docs have referenced from the start.

Nothing here is required to use MiniCDN locally — `docker compose up` and `run-local.sh` still
work exactly as before, untouched by any of this. This is only for when you want a live, shareable
deployment (e.g. a portfolio/resume link).

## Prerequisites

- A [Fly.io](https://fly.io) account (free to create; a card is required to activate billing
  even on their smallest tier, but small apps like these run cheaply).
- The `fly` CLI installed and logged in: `fly auth login`.
- A Redis instance reachable from Fly — easiest is `fly redis create` (Fly's own Upstash-backed
  Redis), which prints a `redis://...` connection string when it finishes. Any other Redis
  provider's connection string works too, as long as it's reachable from the public internet
  (or Fly's private network, if you keep everything on Fly).

All commands below are run from the **repo root** (`cd minicdn`), since every Dockerfile's build
context is the root — not the individual service directory.

## Order of operations

Deploy in this order — each later service needs the previous ones' real URLs:

**1. Origin**

```bash
fly launch --config origin/fly.toml --no-deploy
fly secrets set REDIS_URL="<your-redis-connection-string>" --config origin/fly.toml
fly deploy --config origin/fly.toml
```

Note the URL Fly gives you (`https://minicdn-origin.fly.dev`, or whatever you renamed the app to
in `origin/fly.toml`'s `app =` line — app names are global across all Fly users, so you may need
to pick something unique).

**2. The three edge nodes** (can be done in any order relative to each other)

```bash
fly launch --config edge/fly.us.toml --no-deploy
fly secrets set REDIS_URL="<your-redis-connection-string>" --config edge/fly.us.toml
fly secrets set ORIGIN_URL="https://minicdn-origin.fly.dev" --config edge/fly.us.toml
fly deploy --config edge/fly.us.toml

fly launch --config edge/fly.eu.toml --no-deploy
fly secrets set REDIS_URL="<your-redis-connection-string>" --config edge/fly.eu.toml
fly secrets set ORIGIN_URL="https://minicdn-origin.fly.dev" --config edge/fly.eu.toml
fly deploy --config edge/fly.eu.toml

fly launch --config edge/fly.asia.toml --no-deploy
fly secrets set REDIS_URL="<your-redis-connection-string>" --config edge/fly.asia.toml
fly secrets set ORIGIN_URL="https://minicdn-origin.fly.dev" --config edge/fly.asia.toml
fly deploy --config edge/fly.asia.toml
```

**3. Routing layer** (needs all 3 edge URLs)

```bash
fly launch --config routing/fly.toml --no-deploy
fly secrets set EDGE_US_URL="https://minicdn-edge-us.fly.dev" --config routing/fly.toml
fly secrets set EDGE_EU_URL="https://minicdn-edge-eu.fly.dev" --config routing/fly.toml
fly secrets set EDGE_ASIA_URL="https://minicdn-edge-asia.fly.dev" --config routing/fly.toml
fly deploy --config routing/fly.toml
```

**4. Dashboard** (deploy last — it's a static build that needs every other URL baked in)

```bash
fly launch --config dashboard/fly.toml --no-deploy
fly deploy --config dashboard/fly.toml \
  --build-arg VITE_ORIGIN_URL=https://minicdn-origin.fly.dev \
  --build-arg VITE_ROUTING_URL=https://minicdn-routing.fly.dev \
  --build-arg VITE_EDGE_US_URL=https://minicdn-edge-us.fly.dev \
  --build-arg VITE_EDGE_EU_URL=https://minicdn-edge-eu.fly.dev \
  --build-arg VITE_EDGE_ASIA_URL=https://minicdn-edge-asia.fly.dev
```

Open the dashboard's `https://minicdn-dashboard.fly.dev` URL — it should now show live metrics
from your real deployed services.

## Testing it once deployed

Same idea as local testing, just against real URLs instead of localhost:

```bash
curl -i "https://minicdn-routing.fly.dev/assets/api/config.json?loc=singapore"
curl -i "https://minicdn-routing.fly.dev/assets/api/config.json?loc=singapore"   # second call: HIT
curl "https://minicdn-routing.fly.dev/route-info?loc=frankfurt"
curl -X POST https://minicdn-origin.fly.dev/admin/purge/api/config.json
```

## Important caveats before you rely on this

- **`?loc=` is still required.** Real visitors' requests aren't automatically geolocated — every
  request must carry `?loc=<location>` for the routing layer to pick a "nearest" node at all
  (see `shared/src/nodes.ts` for the valid location keys). Without it, every request defaults to
  New York. Real IP-based geolocation is a separate, not-yet-built feature — ask if you want it
  added; `routing/src/geolocation.ts` has a start on this using ip-api.com's free tier.
- **Every service is publicly reachable directly**, not just through the routing layer — e.g.
  `https://minicdn-edge-us.fly.dev/assets/...` bypasses routing entirely. That's fine for a demo,
  but a production CDN would put these behind a private network / firewall so only the routing
  layer (or nothing — a real CDN often has clients hit edge nodes directly per DNS, with no
  separate routing layer at all) can reach them.
- **No auth on `/admin/purge/:key`.** Anyone who finds the origin's URL can purge any cache key.
  Fine for a personal demo; not fine if this were handling real traffic — add an API key check
  before exposing this beyond your own testing.
- **Cost**: 6 small always-on Fly machines (`auto_stop_machines = false` in each `fly.toml`, so
  the CDN behavior doesn't get muddied by cold starts) plus a small Redis instance will accrue
  some cost beyond Fly's free allowance — check Fly's current pricing before leaving this running
  long-term. Set `auto_stop_machines = true` in each `fly.toml` if you'd rather they scale to
  zero between demos, at the cost of a cold-start delay on the first request after idle.
- **Secrets vs. env vars**: this guide puts `REDIS_URL`, `ORIGIN_URL`, and the edge URLs in Fly
  secrets (`fly secrets set`) rather than each `fly.toml`'s `[env]` block, specifically so a real
  Redis connection string never ends up committed to git if you push this repo publicly. Don't
  move `REDIS_URL` into `[env]` in a public repo.
