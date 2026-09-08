# Load tests

All of these need the full stack running (`docker compose up`, or `./run-local.sh`).

## Quickest path — no extra tooling

`benchmark.js` and `invalidation-latency.js` are plain Node scripts with no dependencies, so
they work without installing anything:

```bash
node load-tests/benchmark.js             # baseline vs CDN latency + hit ratio
node load-tests/invalidation-latency.js  # purge propagation across all edges
```

`benchmark.js` prints a paste-ready markdown table for the README. It covers the same ground as
the two k6 scripts below (which remain if you prefer k6's reporting or want to push heavier
load). Options via env vars: `REQUESTS`, `CONCURRENCY`, `CLIENT_LOC`, `ORIGIN_URL`, `ROUTING_URL`.

> If you change `CLIENT_LOC`, also set the origin's `SIMULATED_CLIENT_LATENCY_MS` to that
> region's edge value (40 US / 70 EU / 110 Asia) so the baseline models the same distance the
> chosen edge does — otherwise the comparison is skewed. See `.env.example`.

---

## k6 variants

The scripts below require [k6](https://k6.io/docs/get-started/installation/) installed locally.

## 1. Baseline — direct to origin

```bash
mkdir -p load-tests/results
k6 run --summary-export=load-tests/results/baseline-summary.json load-tests/baseline-origin.js
```

## 2. CDN path — via routing layer (cold + warm)

```bash
k6 run --summary-export=load-tests/results/cdn-path-summary.json load-tests/cdn-path.js
```

Prints a hit/miss breakdown and per-status average latency at the end. Try `CLIENT_LOC=singapore
k6 run ...` to exercise a different nearest-node choice (see `shared/src/nodes.ts` for valid
location keys: `new-york`, `london`, `frankfurt`, `singapore`, `tokyo`, `mumbai`, `sao-paulo`,
`sydney`).

## 3. Invalidation propagation latency

```bash
node load-tests/invalidation-latency.js
```

Warms all 3 edge nodes for one key, purges it at the origin, then polls each node until it
reflects the purge — reporting per-node and overall propagation time.

## 4. Compute headline benchmark numbers

After running steps 1 and 2:

```bash
node load-tests/compute-benchmarks.js
```

This prints the `latency_reduction %` and `hit_ratio %` numbers referenced in the plan
(`docs/implementation.md` §8) and in the README's benchmark results table — copy them over once
you have a real run.
