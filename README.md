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
No cloud account, no API keys, no credentials needed to try it.

<div align="center">

[Quick Start](#quick-start) •
[Try It](#try-it) •
[Architecture](#architecture) •
[Deploying It](#deploying-it) •
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

No `.env` file is required — every setting has a working default. Want to override ports,
cache size/TTL, or simulated latency instead? Copy [`.env.example`](.env.example) to `.env` and
edit it; `docker-compose.yml` picks up a `.env` in the repo root automatically.

This starts, on localhost:

| Service | URL |
|---|---|
| 🌍 **Dashboard** | http://localhost:5173 |
| Routing layer | http://localhost:5000 |
| Origin server | http://localhost:4000 |
| Edge — US (Virginia) | http://localhost:4001 |
| Edge — EU (Frankfurt) | http://localhost:4002 |
| Edge — Asia (Singapore) | http://localhost:4003 |
| Redis | localhost:6379 |

Open **http://localhost:5173** for the live dashboard.

<details>
<summary><strong>Running without Docker</strong></summary>

<br>

Each service is a plain Node/TypeScript app and can run directly:

```bash
npm install
npm run build                      # builds shared + origin + edge + routing
redis-server --daemonize yes       # or your own Redis instance

npm run seed --workspace=origin    # populate origin/data/assets/ (first time only)

# in separate terminals:
PORT=4000 node origin/dist/server.js
PORT=4001 NODE_ID=us   REGION=iad ORIGIN_URL=http://localhost:4000 node edge/dist/server.js
PORT=4002 NODE_ID=eu   REGION=fra ORIGIN_URL=http://localhost:4000 node edge/dist/server.js
PORT=4003 NODE_ID=asia REGION=sin ORIGIN_URL=http://localhost:4000 node edge/dist/server.js
EDGE_US_URL=http://localhost:4001 EDGE_EU_URL=http://localhost:4002 EDGE_ASIA_URL=http://localhost:4003 \
  PORT=5000 node routing/dist/server.js

cd dashboard && npm install && npm run dev   # http://localhost:5173
```

Or just run [`./run-local.sh`](run-local.sh), which does all of the above for you.

</details>

## Try it

```bash
# Request an asset — routed to the nearest simulated region for "singapore"
curl -i "http://localhost:5000/assets/api/config.json?loc=singapore"
# first request: X-MiniCDN-Cache: MISS
# repeat it:      X-MiniCDN-Cache: HIT

# See the raw routing decision (candidates, distances, health, any fallback)
curl "http://localhost:5000/route-info?loc=london"

# Update content at the origin, then purge it
curl -X POST http://localhost:4000/admin/purge/api/config.json
# watch the dashboard's "Last invalidation" field update on each node within ~100ms
```

Valid `?loc=` values (see [`shared/src/nodes.ts`](shared/src/nodes.ts)): `new-york`, `london`,
`frankfurt`, `singapore`, `tokyo`, `mumbai`, `sao-paulo`, `sydney`.

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
- ✅ k6 + Node load-test scripts, including a benchmark-number calculator

**Explicitly out of scope for now** (see [`docs/implementation.md`](docs/implementation.md) §2 and
§10 for the full list and rationale): TLS termination, DDoS protection, video-chunking
optimizations, real anycast DNS routing, real IP-based geolocation (a start exists in
[`routing/src/geolocation.ts`](routing/src/geolocation.ts), unwired by default), image resizing
at the edge, and origin shielding.

## Deploying it

By default (`docker compose up` / `run-local.sh`) all three "regions" run as separate
processes/containers on one machine — there's no real network distance between them. Each edge
node applies a `SIMULATED_ORIGIN_LATENCY_MS` (40ms US, 70ms EU, 110ms Asia) on cache misses,
standing in for the real cross-region latency you'd see hitting an actual origin from Fly.io's
`iad`/`fra`/`sin` regions.

Deployment configs exist for two platforms:

| | [Railway](docs/deployment-railway.md) | [Fly.io](docs/deployment.md) |
|---|---|---|
| **Setup** | Simplest — deploys from a GitHub repo, no CLI | More setup — CLI-driven, 6 apps deployed in order |
| **Regions** | Single-region only | Real multi-region (`iad`/`fra`/`sin`) |
| **Redis** | One-click plugin | `fly redis create` |
| **Best for** | Quick shareable demo / portfolio link | "Nearest edge node" as an actual infrastructure fact |

Both guides share the same caveats: no auth on `/admin/purge/:key`, `?loc=` is still required per
request since real IP geolocation isn't wired in by default, and every service gets its own
public URL rather than being hidden behind the routing layer.

## Benchmark results

Run these yourself — numbers depend on your machine and the simulated-latency settings above:

```bash
mkdir -p load-tests/results
k6 run --summary-export=load-tests/results/baseline-summary.json load-tests/baseline-origin.js
k6 run --summary-export=load-tests/results/cdn-path-summary.json load-tests/cdn-path.js
node load-tests/compute-benchmarks.js
node load-tests/invalidation-latency.js
```

| Metric | Result |
|---|---|
| Baseline (direct-to-origin) avg latency | _run the benchmark and fill in_ |
| CDN path avg latency (cache HIT) | _run the benchmark and fill in_ |
| Latency reduction | _run the benchmark and fill in_ |
| Cache hit ratio (repeated-request load) | _run the benchmark and fill in_ |
| Invalidation propagation (purge → all nodes reflect it) | _run the benchmark and fill in_ |

See [`load-tests/README.md`](load-tests/README.md) for full details on each script.

> **Reference run** (single-machine, default `SIMULATED_ORIGIN_LATENCY_MS` settings, manual smoke
> test during development — not a formal load test): cold MISS through routing → US edge ≈ 50ms,
> warm HIT ≈ 0–2ms; full purge propagation across all 3 nodes ≈ 120ms. Replace with your own k6
> run before using these numbers anywhere real.

## Repository structure

```
minicdn/
├── origin/             # Origin server (Express + TS)
├── edge/                # Edge node — cache-first reverse proxy
├── routing/              # Geo-aware routing layer
├── shared/                # Shared types, node registry, cache-key & haversine logic
├── dashboard/               # React + Chart.js live metrics dashboard
├── load-tests/                # k6 scripts + invalidation-latency + benchmark calculator
├── docs/
│   ├── implementation.md      # design doc, tradeoffs, interview talking points
│   ├── deployment.md          # Fly.io deploy guide (real multi-region)
│   └── deployment-railway.md  # Railway deploy guide (simplest path)
├── docker-compose.yml
├── run-local.sh                # run everything without Docker
├── .env.example
└── README.md
```

## Tech stack

Node.js + TypeScript throughout — Express for origin/edge/routing, React + Vite + Chart.js for
the dashboard, in-memory LRU caching (`lru-cache`) at each edge, Redis for Pub/Sub invalidation,
k6 for load testing, Docker Compose for local orchestration.

## License

MIT — see [LICENSE](LICENSE).
