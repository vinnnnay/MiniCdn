# Load tests

Requires [k6](https://k6.io/docs/get-started/installation/) installed locally, and the full
stack running (`docker compose up`, or each service via `npm run dev`).

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
