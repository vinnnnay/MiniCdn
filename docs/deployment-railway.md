# Deploying MiniCDN to Railway

This is the simplest real deployment path for MiniCDN: one Railway project, one Redis plugin,
and 6 services built from this same repo's existing Dockerfiles — no infrastructure to manage,
free tier gets you started, and nothing sleeps/cold-starts the way some other free tiers do.

This is a **single-region** deployment — Railway doesn't offer picking a different physical
region per service the way Fly.io does, so all "3 edge nodes" run in the same datacenter. The
code and caching/routing/invalidation logic are exactly as real either way; only the "geographic
distance" part becomes simulated again (via `SIMULATED_ORIGIN_LATENCY_MS`, same as running
locally) rather than a true fact about where the bytes physically are. If that distinction
matters to you, see `docs/deployment.md` for the Fly.io (real multi-region) path instead.

Nothing here changes local usage — `docker compose up` and `run-local.sh` still work exactly as
before.

## Prerequisites

- A free [Railway](https://railway.app) account (GitHub login works, no card needed to start).
- This repo pushed to a GitHub repository Railway can access (Railway deploys from GitHub, not
  by uploading a local folder — see step 1).

## 1. Push this repo to GitHub

If you haven't already:

```bash
cd minicdn
git init
git add .
git commit -m "Initial commit"
```

Create a new (private or public — your call) repo on GitHub, then:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

**Before pushing**, double check `.gitignore` already excludes `.env`, `node_modules`, and `dist`
(it does, by default in this project) — you don't want secrets or build artifacts in git.

## 2. Create the Railway project + Redis

1. Go to [railway.app/new](https://railway.app/new), choose **"Deploy from GitHub repo"**, and
   pick the repo you just pushed. Railway will try to auto-detect a service — cancel/skip that
   for now; you'll add each of the 6 services explicitly below.
2. In the project, click **"+ New"** → **"Database"** → **"Add Redis"**. Railway provisions it
   and creates a `REDIS_URL`-style variable automatically — click into the Redis service's
   **Variables** tab to see the exact variable name it generated (usually `REDIS_URL` or
   `REDIS_PRIVATE_URL`).

## 3. Add each service

For each of the 6 services below: **"+ New"** → **"GitHub Repo"** → select the same repo again
(Railway lets you add the same repo multiple times as separate services). Then, for each one,
open its **Settings** tab and set:

- **Root Directory**: leave as `/` (repo root) — the Dockerfiles all expect a root build context.
- **Dockerfile Path**: set to the path shown below for that service (this is the one setting
  that's different per service).

| Service | Dockerfile Path | Notes |
|---|---|---|
| origin | `origin/Dockerfile` | |
| edge-us | `edge/Dockerfile` | |
| edge-eu | `edge/Dockerfile` | same Dockerfile as edge-us, different env vars (below) |
| edge-asia | `edge/Dockerfile` | same Dockerfile as edge-us, different env vars (below) |
| routing | `routing/Dockerfile` | deploy after all 3 edge services exist |
| dashboard | `dashboard/Dockerfile` | deploy last |

Rename each service in Railway's UI (click the service name) to match the table above, so you
can tell them apart.

## 4. Set each service's environment variables

Click into each service's **Variables** tab and add these. `${{Redis.REDIS_URL}}` is Railway's
syntax for referencing another service's variable — check the exact name Railway generated for
your Redis service in step 2 and adjust if it differs.

**origin**
```
PORT=4000
REDIS_URL=${{Redis.REDIS_URL}}
DEFAULT_MAX_AGE_SECONDS=30
```
After deploying, go to origin's **Settings → Networking** and click **"Generate Domain"** to get
its public URL (something like `origin-production-xxxx.up.railway.app`). You'll need this URL for
every edge service below.

**edge-us**
```
PORT=4001
NODE_ID=us
REGION=iad
ORIGIN_URL=<the origin public URL from above>
REDIS_URL=${{Redis.REDIS_URL}}
MAX_CACHE_ENTRIES=200
SIMULATED_ORIGIN_LATENCY_MS=40
```
Generate a public domain for this service too (Settings → Networking), and note the URL.

**edge-eu** — identical to edge-us except:
```
NODE_ID=eu
REGION=fra
SIMULATED_ORIGIN_LATENCY_MS=70
```
Generate its public domain, note the URL.

**edge-asia** — identical to edge-us except:
```
NODE_ID=asia
REGION=sin
SIMULATED_ORIGIN_LATENCY_MS=110
```
Generate its public domain, note the URL.

**routing** (needs all 3 edge URLs from above)
```
PORT=5000
ROUTING_MODE=proxy
HEALTH_POLL_INTERVAL_MS=5000
EDGE_US_URL=<edge-us public URL>
EDGE_EU_URL=<edge-eu public URL>
EDGE_ASIA_URL=<edge-asia public URL>
```
Generate its public domain, note the URL — this is the main URL you'll actually test against.

**dashboard** — this one is different: the dashboard is a static build, and its URLs must be
baked in at **build time**, not read at runtime (see `dashboard/src/config.ts`'s comment).
Railway supports this the same way as regular variables — add these as this service's variables
(Railway passes them to the Docker build as build args automatically when a Dockerfile declares
matching `ARG`s, which `dashboard/Dockerfile` already does):
```
VITE_ORIGIN_URL=<origin public URL>
VITE_ROUTING_URL=<routing public URL>
VITE_EDGE_US_URL=<edge-us public URL>
VITE_EDGE_EU_URL=<edge-eu public URL>
VITE_EDGE_ASIA_URL=<edge-asia public URL>
```
Generate its public domain — this is your dashboard link.

## 5. Redeploy

After setting variables, trigger a redeploy for each service (Railway usually does this
automatically on variable changes; if not, use the **"Redeploy"** button on each service).

## Testing it once deployed

```bash
curl -i "https://<routing-url>/assets/api/config.json?loc=singapore"
curl -i "https://<routing-url>/assets/api/config.json?loc=singapore"   # second call: HIT
curl "https://<routing-url>/route-info?loc=frankfurt"
curl -X POST https://<origin-url>/admin/purge/api/config.json
```

Open `https://<dashboard-url>` in a browser for the live dashboard.

## Caveats (same substance as the Fly.io path, worth repeating)

- **Single region**: as noted above, "nearest edge node" is simulated math here, not a physical
  fact — all 3 edge services run wherever Railway placed your project.
- **`?loc=` is still required** on every asset request — there's no real IP geolocation wired in
  yet (see `routing/src/geolocation.ts` for an unwired starting point using ip-api.com, if you
  want that added later).
- **No auth on `/admin/purge/:key`** — anyone with the origin's URL can purge any cache key. Fine
  for a personal demo, not for anything handling real traffic.
- **Every service has its own public URL** — nothing is hidden behind the routing layer. Fine for
  a demo; a real deployment would restrict direct access to the edge/origin services.
- **Cost**: Railway's free trial credit runs out; after that this is a small monthly cost for 6
  always-on services + Redis. Check Railway's current pricing page before leaving this running
  long-term, and consider removing services you're not actively demoing.
