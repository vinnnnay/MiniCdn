<div align="center">

# MiniCDN

**A distributed content delivery network — geo-aware routing, edge caching, and real-time cache invalidation — that actually works.**

[![status](https://img.shields.io/badge/status-locally%20verified-brightgreen)](#benchmark-results)
[![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20TypeScript-3178c6)](#tech-stack)
[![docker](https://img.shields.io/badge/run%20with-docker%20compose-2496ED?logo=docker&logoColor=white)](#quick-start)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](#license)

</div>

Three cache-first edge nodes in front of an origin server, a routing layer that picks the
nearest healthy edge by real haversine distance, and push-based cache invalidation over Redis
Pub/Sub — all wired together with a live metrics dashboard. Runs entirely on your own machine.
No cloud account, no API keys, no credentials needed.

<div align="center">

[Quick Start](#quick-start) •
[Testing It Locally](#testing-it-locally) •
[Architecture](#architecture) •
[Benchmarks](#benchmark-results) •
[Repo Structure](#repository-structure)

</div>

---

## Quick start

**Requires:** Docker + Docker Compose.

```bash
git clone https://github.com/<your-username>/minicdn.git
cd minicdn
docker compose up --build
```

Then open **http://localhost:5173** for the live dashboard.

No `.env` file is required — every setting has a working default. To override ports, cache
size/TTL, or simulated latency, copy [`.env.example`](.env.example) to `.env` and edit it;
`docker-compose.yml` picks up a root `.env` automatically.

| Service | URL |
|---|---|
| 🌍 **Dashboard** | http://localhost:5173 |
| Routing layer | http://localhost:5000 |
| Origin server | http://localhost:4000 |
| Edge — US (Virginia) | http://localhost:4001 |
| Edge — EU (Frankfurt) | http://localhost:4002 |
| Edge — Asia (Singapore) | http://localhost:4003 |
| Redis | localhost:6379 |

---

## Testing it locally

A full walkthrough — every command, in order, with what you should see. Takes about five minutes.

> **Windows / PowerShell users:** PowerShell aliases `curl` to `Invoke-WebRequest`, which does
> **not** accept `-i` and will prompt you for a `Uri:` instead. Use **`curl.exe`** in every
> command below. On macOS and Linux, plain `curl` is correct.

### Step 1 — Start the stack

```bash
docker compose up --build
```

Leave this terminal running. Wait until the log settles and you see each service report ready:

```
origin-1     | [origin] listening on :4000
edge-us-1    | [edge:us] listening on :4001 (region=iad, ...)
edge-us-1    | [edge:us] subscribed to minicdn:purge
edge-eu-1    | [edge:eu] subscribed to minicdn:purge
edge-asia-1  | [edge:asia] subscribed to minicdn:purge
routing-1    | [routing] listening on :5000 (mode=proxy)
```

If you instead see repeated `[ioredis] ECONNREFUSED` from every service, you have an active
`REDIS_URL=redis://localhost:6379` line in your `.env`. Inside a container `localhost` means
*that container*, so nothing can reach Redis — comment that line out (Compose supplies
`redis://redis:6379` itself) and restart with `docker compose down && docker compose up`.

Open a **second terminal** for everything below.

### Step 2 — Confirm every service is healthy

```bash
curl.exe http://localhost:4000/health
curl.exe http://localhost:4001/health
curl.exe http://localhost:4002/health
curl.exe http://localhost:4003/health
curl.exe http://localhost:5000/health
```

Each returns JSON with `"status":"ok"`. The edge nodes also report their identity, e.g.
`{"status":"ok","service":"edge","nodeId":"asia","region":"sin"}`.

### Step 3 — See a cache MISS become a HIT

This is the core CDN behaviour. Run the *same* command twice:

```bash
curl.exe -i "http://localhost:5000/assets/api/config.json?loc=singapore"
curl.exe -i "http://localhost:5000/assets/api/config.json?loc=singapore"
```

Look at the response headers:

| Request | Header | Meaning |
|---|---|---|
| 1st | `X-MiniCDN-Cache: MISS` | Not cached yet — the edge fetched it from the origin and stored it |
| 2nd | `X-MiniCDN-Cache: HIT` | Served straight from the edge's cache, no origin round-trip |

Compare `X-MiniCDN-Latency-Ms` between the two — the HIT should be dramatically faster. You'll
also see `X-MiniCDN-Node: asia`, telling you which edge served it.

### Step 4 — Watch geo-routing pick different regions

The routing layer chooses the nearest edge by great-circle distance. `/route-info` shows its
reasoning without fetching anything:

```bash
curl.exe "http://localhost:5000/route-info?loc=singapore"
curl.exe "http://localhost:5000/route-info?loc=london"
curl.exe "http://localhost:5000/route-info?loc=new-york"
```

Each response lists every candidate node with its `distanceKm`, sorted nearest-first, plus the
`chosenNodeId`. Singapore → `asia`, London → `eu`, New York → `us`.

Check all eight locations at once:

```bash
# PowerShell
foreach ($loc in "new-york","london","frankfurt","singapore","tokyo","mumbai","sao-paulo","sydney") {
  $r = Invoke-RestMethod "http://localhost:5000/route-info?loc=$loc"
  Write-Host "$loc -> $($r.chosenNodeId)"
}
```

```bash
# macOS / Linux
for loc in new-york london frankfurt singapore tokyo mumbai sao-paulo sydney; do
  echo -n "$loc -> "; curl -s "http://localhost:5000/route-info?loc=$loc" | grep -o '"chosenNodeId":"[a-z]*"'
done
```

Valid `?loc=` values are defined in [`shared/src/nodes.ts`](shared/src/nodes.ts).

### Step 5 — Prove health-check failover works

Kill the Asia edge while the system is running:

```bash
docker compose stop edge-asia
```

Wait ~10 seconds (the routing layer polls `/health` every 5s and requires two consecutive
failures before marking a node down, to avoid flapping), then ask it to route a Singapore client:

```bash
curl.exe "http://localhost:5000/route-info?loc=singapore"
```

Now `asia` shows `"healthy": false`, `chosenNodeId` has fallen back to `eu` (the next-nearest
healthy node), and `"fellBack": true`. A real request confirms it end-to-end:

```bash
curl.exe -i "http://localhost:5000/assets/logo.svg?loc=singapore"
```

The headers show `X-MiniCDN-Routed-To: eu` and `X-MiniCDN-Fellback: true`. Bring it back:

```bash
docker compose start edge-asia
```

### Step 6 — Trigger cache invalidation

Warm all three edges, then purge from the origin and watch every node drop the key.

```bash
# 1. Warm each edge directly (first call MISS, second HIT)
curl.exe -i "http://localhost:4001/assets/api/config.json"
curl.exe -i "http://localhost:4001/assets/api/config.json"

# 2. Purge it at the origin — this publishes to Redis Pub/Sub
curl.exe -X POST "http://localhost:4000/admin/purge/api/config.json"

# 3. Same request is a MISS again — the purge really cleared the cache
curl.exe -i "http://localhost:4001/assets/api/config.json"
```

The purge response reports `"subscribersNotified": 3` — all three edges received it. Each edge's
`/metrics` then exposes `lastInvalidation.propagationMs`, the actual Pub/Sub delivery time:

```bash
curl.exe http://localhost:4001/metrics
```

The dashboard's **Last invalidation** field and **Purges issued** counter update too.

### Step 7 — Watch the dashboard live

With **http://localhost:5173** open, generate traffic and watch the numbers move:

```bash
# PowerShell — 20 requests to the same asset+region
1..20 | ForEach-Object { curl.exe -s "http://localhost:5000/assets/api/config.json?loc=singapore" | Out-Null }
```

```bash
# macOS / Linux
for i in $(seq 1 20); do curl -s "http://localhost:5000/assets/api/config.json?loc=singapore" > /dev/null; done
```

Hit ratio climbs toward ~95% as repeats become hits, requests-per-node shifts toward `asia`, and
avg hit latency stays near zero while avg miss latency reflects the simulated origin distance.

### Step 8 — Run the benchmarks

Both scripts are plain Node — nothing to install:

```bash
node load-tests/benchmark.js             # baseline vs CDN latency, hit ratio
node load-tests/invalidation-latency.js  # purge propagation across all edges
```

`benchmark.js` prints a paste-ready markdown table. See
[`load-tests/README.md`](load-tests/README.md) for options and the k6 variants.

### Step 9 — Shut down

```bash
docker compose down
```

<details>
<summary><strong>Running without Docker</strong></summary>

<br>

Every service is a plain Node/TypeScript app. You'll need Redis available locally.

```bash
npm install
npm run build                      # builds shared + origin + edge + routing
npm run seed --workspace=origin    # populate origin/data/assets/ (first time only)
redis-server --daemonize yes       # or point at your own Redis instance

# then, in separate terminals:
PORT=4000 node origin/dist/server.js
PORT=4001 NODE_ID=us   REGION=iad ORIGIN_URL=http://localhost:4000 node edge/dist/server.js
PORT=4002 NODE_ID=eu   REGION=fra ORIGIN_URL=http://localhost:4000 node edge/dist/server.js
PORT=4003 NODE_ID=asia REGION=sin ORIGIN_URL=http://localhost:4000 node edge/dist/server.js
EDGE_US_URL=http://localhost:4001 EDGE_EU_URL=http://localhost:4002 EDGE_ASIA_URL=http://localhost:4003 \
  PORT=5000 node routing/dist/server.js

cd dashboard && npm install && npm run dev   # http://localhost:5173
```

Or run [`./run-local.sh`](run-local.sh), which does all of the above in one command (bash — use
WSL or Git Bash on Windows). If you go this route, **uncomment** `REDIS_URL` in your `.env`,
since here `localhost` is correct.

</details>

---

## Architecture

```
                         ┌─────────────────────────┐
                         │       Origin Server      │
                         │  (source of truth data)  │
                         └────────────┬─────────────┘
                                      │ purge / fetch-on-miss
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
      ┌───────▼───────┐      ┌────────▼────────┐     ┌────────▼───────┐
      │  Edge Node US  │      │  Edge Node EU    │     │ Edge Node ASIA │
      │ (cache+proxy)  │      │  (cache+proxy)   │     │  (cache+proxy) │
      └───────▲───────┘      └────────▲────────┘     └────────▲───────┘
              │                       │                       │
              └───────────────┬───────┴───────────┬───────────┘
                               │                   │
                       ┌───────▼───────────────────▼───────┐
                       │          Routing Layer             │
                       │  (geo-lookup + health check +      │
                       │    nearest-node selection)          │
                       └───────────────┬─────────────────────┘
                                       │
                               ┌───────▼───────┐
                               │     Client     │
                               └────────────────┘
                       ┌─────────────────────────┐
                       │    Metrics / Dashboard    │
                       │ (hit ratio, latency,      │
                       │   node health)            │
                       └───────────────────────────┘
```

Full design rationale, tradeoffs, and interview talking points:
[`docs/implementation.md`](docs/implementation.md).

## What's implemented

- ✅ Origin server with `ETag` / `Cache-Control` / `Last-Modified` + conditional GETs
- ✅ 3 edge nodes with LRU + TTL caching and stale revalidation
- ✅ Geo-aware routing (real haversine nearest-node math) with health-check-based failover
- ✅ Redis Pub/Sub cache invalidation, with measured propagation latency
- ✅ A live React + Chart.js dashboard
- ✅ Node + k6 load-test scripts, including a benchmark calculator

**Explicitly out of scope** (see [`docs/implementation.md`](docs/implementation.md) §2 and §10 for
the full list and rationale): TLS termination, DDoS protection, video-chunking optimizations, real
anycast DNS routing, real IP-based geolocation (a start exists in
[`routing/src/geolocation.ts`](routing/src/geolocation.ts), unwired by default), image resizing at
the edge, origin shielding, and cloud deployment.

## How the "regions" work

This runs on one machine, so there is no real network distance between the three "regions". The
distance is **modelled**, in two places:

- Each edge node applies `SIMULATED_ORIGIN_LATENCY_MS` (40 ms US / 70 ms EU / 110 ms Asia) when it
  has to fetch from the origin on a cache miss — standing in for that region's distance to a
  US-hosted origin.
- The origin applies `SIMULATED_CLIENT_LATENCY_MS` (110 ms) to **direct client** requests, so the
  benchmark's baseline reflects a far-away client. Edge fetches send an `X-MiniCDN-Edge` header
  and skip it, since they already paid their own delay for that same hop.

The caching, routing, health-checking and invalidation logic is all real. Only the geography is
simulated — and any honest reading of the benchmark numbers has to account for that.

## Benchmark results

Reproduce with the stack running (`docker compose up`) — no extra tooling needed, just Node:

```bash
node load-tests/benchmark.js            # latency + hit ratio
node load-tests/invalidation-latency.js # purge propagation
```

| Metric | Result |
|---|---|
| Baseline (direct-to-origin) avg latency | 122.4 ms <sub>(p95 142.0)</sub> |
| CDN path avg latency (cache HIT) | 40.9 ms <sub>(p95 60.1)</sub> |
| CDN path avg latency (cache MISS) | 225.6 ms |
| **Latency reduction (warm cache vs. baseline)** | **66.6%** |
| **Cache hit ratio (repeated-request load)** | **95.8%** <sub>(230 hits / 10 misses)</sub> |
| Invalidation — purge → all 3 nodes serving fresh content | 127 ms <sub>(us 49 / eu 80 / asia 117)</sub> |

<sub>240 requests/phase, concurrency 10, 8 distinct assets, `CLIENT_LOC=singapore` (routes to the
Asia edge). Measured on one machine via Docker Compose on Windows, with
`SIMULATED_CLIENT_LATENCY_MS=110` and per-edge `SIMULATED_ORIGIN_LATENCY_MS` 40/70/110.</sub>

**How to read these honestly** — worth understanding before quoting them:

- **The distances are simulated, not real** — see [How the "regions" work](#how-the-regions-work)
  above. The latency win comes from modelled distance: a client pays a simulated 110 ms to reach
  the origin, but ~0 ms to reach its nearest edge.
- **Both the client→origin and edge→origin legs are modelled.** Faking only edge→origin (an
  earlier version of this project) makes the CDN measure as pure overhead — a *negative* latency
  reduction — because the baseline then pays no distance at all. See the comment on
  `SIMULATED_CLIENT_LATENCY_MS` in [`origin/src/server.ts`](origin/src/server.ts) and §8 of the
  implementation doc.
- **The 127 ms invalidation figure is not Pub/Sub latency.** It measures end-to-end time until
  every node is *serving fresh content again*, which includes each edge's simulated re-fetch from
  origin — which is why it tracks each region's delay so closely (us 49 / eu 80 / asia 117 ≈ their
  40/70/110 settings). Actual Redis Pub/Sub delivery is single-digit milliseconds; each edge
  reports it as `lastInvalidation.propagationMs` on its `/metrics` endpoint.
- **The MISS path is slower than no CDN at all (225.6 ms vs 122.4 ms baseline)**, and that's
  expected: a miss pays the routing hop *plus* the edge→origin fetch. CDNs win on hit ratio, which
  is why 95.8% matters as much as the latency figure — and why real CDNs invest in cache warming,
  long TTLs and origin shielding to keep misses rare.

## Repository structure

```
minicdn/
├── origin/          # Origin server (Express + TS) — source of truth, purge API
├── edge/            # Edge node — cache-first reverse proxy (runs 3x, different regions)
├── routing/         # Geo-aware routing layer — nearest-node selection + health checks
├── shared/          # Shared types, node registry, cache-key & haversine logic
├── dashboard/       # React + Chart.js live metrics dashboard
├── load-tests/      # benchmark.js, invalidation-latency.js, k6 scripts
├── docs/
│   └── implementation.md   # design doc, tradeoffs, interview talking points
├── docker-compose.yml
├── run-local.sh     # run everything without Docker
├── .env.example
└── README.md
```

## Tech stack

Node.js + TypeScript throughout — Express for origin/edge/routing, React + Vite + Chart.js for
the dashboard, in-memory LRU caching (`lru-cache`) at each edge, Redis for Pub/Sub invalidation,
Docker Compose for local orchestration, and plain Node (plus optional k6) for load testing.

## License

MIT — see [LICENSE](LICENSE).
