# MiniCDN — Implementation Plan

**A Distributed Content Delivery Network with Geo-Aware Routing and Cache Invalidation**

> This is the original design document this project was built from. See the root
> [README.md](../README.md) for how to actually run it and what's implemented vs. stretch goals.

---

## 1. Overview

MiniCDN is a simplified but functionally real CDN that caches static content at multiple
geographically distributed edge nodes, routes client requests to the nearest healthy edge,
and supports real-time cache invalidation pushed from the origin.

**Resume line this project supports:**

> Built a distributed CDN simulating edge caching, geo-based request routing, and real-time
> cache invalidation across multiple regions, reducing average response latency by X% and
> achieving Y% cache hit ratio under load testing.

---

## 2. Goals & Non-Goals

### Goals

- Real multi-region deployment (not just localhost containers)
- Working cache with TTL/ETag support
- Geo-aware routing with health-check fallback
- Push-based cache invalidation (purge API)
- Measurable before/after latency and hit-ratio metrics
- A dashboard to visualize the above

### Non-Goals (explicitly out of scope — future work)

- TLS termination / full HTTPS edge offload
- DDoS protection
- Video-specific optimizations (HLS/DASH chunking)
- Automatic global anycast DNS (routing logic is simulated instead)

---

## 3. High-Level Architecture

```
                         ┌───────────────────────┐
                         │      Origin Server      │
                         │  (source of truth data) │
                         └───────────┬─────────────┘
                                     │ purge / fetch-on-miss
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
      ┌───────▼──────┐      ┌────────▼───────┐     ┌────────▼───────┐
      │ Edge Node US  │      │ Edge Node EU    │     │ Edge Node ASIA │
      │ (cache+proxy) │      │ (cache+proxy)   │     │ (cache+proxy)  │
      └───────▲───────┘      └────────▲────────┘     └────────▲───────┘
              │                       │                       │
              └───────────────┬───────┴───────────┬───────────┘
                               │                   │
                       ┌───────▼───────────────────▼───────┐
                       │        Routing Layer               │
                       │ (geo-lookup + health check +       │
                       │  nearest-node selection)            │
                       └───────────────┬─────────────────────┘
                                       │
                               ┌───────▼───────┐
                               │    Client      │
                               └────────────────┘
                       ┌────────────────────────┐
                       │  Metrics/Dashboard      │
                       │ (hit ratio, latency,    │
                       │  node health)           │
                       └────────────────────────┘
```

---

## 4. Components

### 4.1 Origin Server

- **Responsibility:** Source of truth for all content (static assets: images, JS, CSS, JSON).
- **Tech:** Node.js + Express + TypeScript
- **Endpoints:**
  - `GET /assets/:key` — returns file + cache headers (`Cache-Control`, `ETag`, `Last-Modified`)
  - `POST /admin/purge/:key` — triggers invalidation broadcast to all edge nodes
- **Storage:** Local filesystem (`origin/data/assets/`), seeded via `npm run seed --workspace=origin`

### 4.2 Edge Nodes (3, one per simulated region)

- **Responsibility:** Cache-first reverse proxy in front of the origin.
- **Tech:** Node.js + TypeScript, in-memory LRU cache (`lru-cache`) with a size cap
- **Logic:**
  1. On request, compute cache key from URL (+ query params, sorted)
  2. Cache hit + not expired → serve directly, increment `hit` metric
  3. Cache miss/expired → fetch from origin, store with TTL from `Cache-Control`, serve, increment `miss` metric
  4. On invalidation message → delete key immediately regardless of TTL
- **Eviction policy:** LRU with a configurable max cache size (`MAX_CACHE_ENTRIES`)
- **Deployment targets (future work):** Fly.io regions (`iad` - US, `fra` - EU, `sin` - Asia)

### 4.3 Routing Layer

- **Responsibility:** Decide which edge node should serve a given client.
- **Tech:** Node.js + TypeScript
- **Logic:**
  1. Resolve client location — real deployment: geolocate client IP (MaxMind GeoLite2 or a
     hosted API). This build: simulated via `?loc=` query param / `X-MiniCDN-Client-Loc` header,
     see `shared/src/nodes.ts` for the location table.
  2. Compute nearest edge node via haversine distance between client and each node's known lat/lng
  3. Health-check cache, refreshed every `HEALTH_POLL_INTERVAL_MS` by polling each edge node's `/health`
  4. If nearest node is unhealthy, fall back to next-nearest healthy node
  5. Proxy the request to the chosen node (`ROUTING_MODE=proxy`, default) or issue a 302 redirect
     (`ROUTING_MODE=redirect`)
- **Why HTTP-redirect/proxy routing differs from real DNS-based (anycast) CDN routing:** DNS-based
  routing resolves once per DNS TTL and the client then talks directly to the edge for every
  subsequent request — no per-request routing hop. Our HTTP-layer routing adds a hop (and, in
  proxy mode, doubles the data transfer through the routing layer) but is far simpler to run
  without real anycast infrastructure, and makes the routing decision inspectable per-request
  (`GET /route-info`).

### 4.4 Cache Invalidation (Purge System)

- **Responsibility:** Ensure edge caches don't serve stale content after origin updates.
- **Tech:** Redis Pub/Sub
- **Flow:**
  1. Origin admin calls `POST /admin/purge/:key`
  2. Origin publishes `{action: "purge", key, publishedAt}` to `minicdn:purge`
  3. Each edge node subscribes and deletes the key from its local cache on receipt
  4. Each edge node logs `publishedAt → received` latency as `lastInvalidation.propagationMs`,
     surfaced via `/metrics` and the dashboard

### 4.5 Metrics & Dashboard

- **Responsibility:** Visualize the system behaving correctly.
- **Tech:** React + Chart.js (Vite), polling each service's `/metrics` directly from the browser
- **Metrics tracked:** cache hit/miss ratio (per node + aggregate), average hit vs. miss latency,
  requests per node, node health status, invalidation propagation time

---

## 5. Data Flow Examples

### Cache miss (cold request)

```
Client → Routing Layer → nearest Edge Node → (cache miss) → Origin
Origin → Edge Node (stores with TTL) → Edge Node → Client
```

### Cache hit

```
Client → Routing Layer → nearest Edge Node → (cache hit) → Client
```

### Invalidation

```
Admin → Origin (/admin/purge/:key) → Pub/Sub channel → all Edge Nodes (delete key)
```

---

## 6. Tech Stack Summary

| Layer            | Choice                                      |
|-------------------|----------------------------------------------|
| Origin server     | Node.js + Express + TypeScript                |
| Edge cache        | In-memory LRU (`lru-cache`) per node          |
| Edge proxy        | Node.js + TypeScript reverse proxy            |
| Routing layer     | Node.js + TypeScript + simulated geo-lookup   |
| Invalidation      | Redis Pub/Sub                                 |
| Deployment        | docker-compose (local); Fly.io/AWS = future work |
| Dashboard         | React + Chart.js (Vite)                       |
| Load testing      | k6 + a Node.js invalidation-latency script    |

---

## 7. Build Plan (as implemented)

| Milestone | Status |
|------|-----------|
| Origin server + single edge node with basic caching (TTL, ETag) working locally | ✅ Done |
| 3 edge nodes running (simulated regions via docker-compose), health checks | ✅ Done (localhost/docker-compose; real multi-region deploy is future work) |
| Routing layer (geo-lookup + nearest-node selection + fallback) | ✅ Done |
| Invalidation system (Pub/Sub), dashboard, load tests, benchmark numbers | ✅ Done — run `load-tests/` scripts yourself to fill in real numbers for your machine |

---

## 8. Benchmarking Plan (results measured)

**Measured results** (240 requests/phase, concurrency 10, `CLIENT_LOC=singapore`, Docker Compose
on one Windows machine):

| Metric | Result |
|---|---|
| Baseline (direct-to-origin) avg latency | 122.4 ms (p95 142.0) |
| CDN path avg latency (cache HIT) | 40.9 ms (p95 60.1) |
| CDN path avg latency (cache MISS) | 225.6 ms |
| Latency reduction (warm cache vs. baseline) | **66.6%** |
| Cache hit ratio | **95.8%** (230 hits / 10 misses) |
| Invalidation — purge → all nodes serving fresh content | 127 ms (us 49 / eu 80 / asia 117) |

The invalidation figure is end-to-end until each node serves fresh content, so it includes that
edge's simulated origin re-fetch — note how closely 49/80/117 tracks the 40/70/110
`SIMULATED_ORIGIN_LATENCY_MS` settings. Raw Redis Pub/Sub delivery is single-digit ms and is
reported separately as `lastInvalidation.propagationMs` on each edge's `/metrics`.

Run `node load-tests/benchmark.js` to reproduce (pure Node, no k6 required), then
`node load-tests/invalidation-latency.js` for the purge rows.

### A modelling correction worth understanding

The first version of this simulation only faked the **edge→origin** leg
(`SIMULATED_ORIGIN_LATENCY_MS`, applied on a cache miss). The baseline — a client hitting the
origin directly — paid *no* simulated distance, because everything runs on localhost.

That made the benchmark report a **negative** latency reduction — measured at −93.7% during
development, i.e. the "CDN" was ~2× slower than not using it. The CDN path was two hops
(client → routing → edge) against the origin's one, so it was pure overhead with none of the
modelled benefit. A CDN's entire advantage comes from the client being *far* from the origin and
*near* an edge; leaving the client→origin leg at zero measures the cost and discards the benefit.

The fix was to model that missing leg: `SIMULATED_CLIENT_LATENCY_MS` on the origin, applied only
to direct client requests. Edge fetches send an `X-MiniCDN-Edge` header and are exempt, since
they already applied their own region-specific delay for that same long-haul hop — charging both
would double-count it. Verified empirically: origin direct ≈ 113 ms, edge cold miss ≈ 122 ms (not
≈ 220 ms), edge warm hit ≈ 2 ms.

This is a modelling fix, not a thumb on the scale — it makes the simulation match the physical
situation it claims to represent. The distances are still simulated, and any honest presentation
of these numbers has to say so.

See [`load-tests/README.md`](../load-tests/README.md) for exact commands. Summary:

1. **Baseline:** `k6 run load-tests/baseline-origin.js` — average latency hitting the origin directly.
2. **CDN path:** `k6 run load-tests/cdn-path.js` — average latency through routing → nearest edge,
   split by cache HIT/MISS.
3. **Compute:** `node load-tests/compute-benchmarks.js` prints:
   - `latency_reduction = (baseline_latency - cdn_latency) / baseline_latency * 100`
   - `hit_ratio = hits / (hits + misses) * 100`
4. **Invalidation propagation:** `node load-tests/invalidation-latency.js` measures purge → all-nodes-reflect-it time.

Record your real results in the README's benchmark table — the numbers depend on your machine's
simulated origin latency settings (`SIMULATED_ORIGIN_LATENCY_MS` per edge node) and load pattern.

---

## 9. Interview Talking Points

- **Cache invalidation tradeoffs:** TTL-based vs push-based, and why push-based is faster but
  adds coordination complexity (what happens if a node misses the pub/sub message — Redis
  Pub/Sub has no delivery guarantee to offline subscribers, unlike a durable queue/stream).
- **Consistency model:** MiniCDN is eventually consistent — the invalidation propagation window
  is directly measurable via `load-tests/invalidation-latency.js`.
- **Failure handling:** health-check interval (`HEALTH_POLL_INTERVAL_MS`) creates a window where
  routing can send traffic to a node that just died — bounded by 2×interval given the
  consecutive-failure debounce in `routing/src/healthPoller.ts`.
- **Why HTTP proxy/redirect routing vs. real-world DNS-based (anycast) routing** — see §4.3.
- **Cache key design:** see the comment in `shared/src/cacheKey.ts` — query params are folded in
  (sorted), but `Accept-Encoding` variance is explicitly NOT handled in this simplified version
  (noted as a gap, not silently ignored).
- **How you validated the benchmark itself** (a strong answer to "how do you know your numbers
  are real?"): the first benchmark run showed a *negative* latency reduction, which surfaced that
  the simulation modelled only the edge→origin leg and left client→origin at zero — measuring the
  CDN's overhead without its benefit. See §8. Being able to say "my first result was −93.7%, here's
  the modelling flaw that caused it and how I fixed it" is more credible than a clean number with
  no story.
- **Why cache MISS is slower than no CDN at all** (225.6 ms vs 122.4 ms baseline): a miss pays the
  routing hop *plus* the edge→origin fetch. This is why hit ratio is the metric that matters — and
  why real CDNs invest heavily in cache warming, longer TTLs, and origin shielding (§10) to keep
  the miss path rare.
- **Scaling the routing layer itself:** currently a single instance — single point of failure.
  Real fix: run N stateless routing instances behind a plain round-robin LB (routing decisions
  don't depend on sticky state), with health-poll state either duplicated per instance or moved
  to shared Redis.

---

## 10. Stretch Goals (not implemented — future work)

- Gzip/Brotli compression at edge nodes
- On-the-fly image resizing at edge (query param driven, e.g. `?w=200`)
- Origin shielding (one edge node fetches on behalf of others on a shared miss)
- Real DNS-based routing using a custom subdomain + geo-DNS provider
- Chaos testing: randomly kill an edge node during load test and show graceful fallback
  (you can do this manually today — kill an edge container mid-`k6 run` and watch the dashboard)
- Real multi-region cloud deployment (Fly.io/AWS) — this build runs all "regions" via
  docker-compose on one machine, with per-node `SIMULATED_ORIGIN_LATENCY_MS` standing in for
  real network distance

---

## 11. Repository Structure (as implemented)

```
minicdn/
├── origin/                # Origin server (Express + TS)
│   ├── src/
│   ├── data/assets/       # seeded static files
│   └── package.json
├── edge/                  # Edge node (deployed 3x via docker-compose, different region env vars)
│   ├── src/
│   └── package.json
├── routing/               # Routing layer
│   ├── src/
│   └── package.json
├── shared/                # Shared types + node registry + cache-key + haversine logic
│   ├── src/
│   └── package.json
├── dashboard/             # React + Chart.js dashboard (Vite)
│   ├── src/
│   └── package.json
├── load-tests/            # k6 scripts + invalidation-latency + compute-benchmarks
├── docs/
│   └── implementation.md  # this file
├── docker-compose.yml
└── README.md
```
