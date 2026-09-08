#!/usr/bin/env node
/**
 * MiniCDN benchmark — pure Node, no k6 or other tooling required.
 *
 * Produces the two headline numbers from docs/implementation.md §8:
 *   latency_reduction = (baseline_latency - cdn_hit_latency) / baseline_latency * 100
 *   hit_ratio         = hits / (hits + misses) * 100
 *
 * ...plus a ready-to-paste markdown table for the README.
 *
 * Prereq: the full stack must be running (docker compose up, or run-local.sh).
 *
 * Run:  node load-tests/benchmark.js
 *
 * Env overrides:
 *   ORIGIN_URL   (default http://localhost:4000)
 *   ROUTING_URL  (default http://localhost:5000)
 *   REQUESTS     (default 240)  total requests per phase
 *   CONCURRENCY  (default 10)   parallel in-flight requests
 *   CLIENT_LOC   (default singapore)
 */

const ORIGIN_URL = process.env.ORIGIN_URL || 'http://localhost:4000';
const ROUTING_URL = process.env.ROUTING_URL || 'http://localhost:5000';
const REQUESTS = Number(process.env.REQUESTS || 240);
const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const CLIENT_LOC = process.env.CLIENT_LOC || 'singapore';

// The assets origin/src/seed.ts creates. Deliberately a small, fixed set so
// the edge cache reaches a steady-state hit ratio quickly (see §8.3).
const ASSETS = [
  'hero-banner.svg',
  'logo.svg',
  'thumbnail-1.svg',
  'thumbnail-2.svg',
  'styles/main.css',
  'scripts/app.js',
  'api/config.json',
  'api/products.json',
];

if (typeof fetch !== 'function') {
  console.error('This script needs Node 18 or newer (for built-in fetch).');
  console.error('Your version: ' + process.version);
  process.exit(1);
}

function pct(n) {
  return `${n.toFixed(1)}%`;
}
function ms(n) {
  return `${n.toFixed(1)} ms`;
}
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Run `total` tasks with at most `concurrency` in flight at once. */
async function runPool(total, concurrency, taskFn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      await taskFn(i);
    }
  });
  await Promise.all(workers);
}

async function preflight() {
  const checks = [
    { name: 'origin', url: `${ORIGIN_URL}/health` },
    { name: 'routing layer', url: `${ROUTING_URL}/health` },
  ];

  for (const check of checks) {
    try {
      const res = await fetch(check.url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error(`\n✖ Cannot reach the ${check.name} at ${check.url}`);
      console.error(`  (${err.message})\n`);
      console.error('The whole stack needs to be running before benchmarking. Start it with:');
      console.error('  docker compose up');
      console.error('...or, without Docker:');
      console.error('  ./run-local.sh\n');
      process.exit(1);
    }
  }
}

async function phaseBaseline() {
  const latencies = [];
  let failures = 0;

  await runPool(REQUESTS, CONCURRENCY, async (i) => {
    const asset = ASSETS[i % ASSETS.length];
    const start = performance.now();
    try {
      const res = await fetch(`${ORIGIN_URL}/assets/${asset}`, { signal: AbortSignal.timeout(10000) });
      await res.arrayBuffer();
      if (!res.ok) {
        failures++;
        return;
      }
      latencies.push(performance.now() - start);
    } catch {
      failures++;
    }
  });

  return { latencies, failures };
}

async function phaseCdn() {
  const hitLatencies = [];
  const missLatencies = [];
  let failures = 0;
  let unknownCacheStatus = 0;

  await runPool(REQUESTS, CONCURRENCY, async (i) => {
    const asset = ASSETS[i % ASSETS.length];
    const url = `${ROUTING_URL}/assets/${asset}?loc=${encodeURIComponent(CLIENT_LOC)}`;
    const start = performance.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      await res.arrayBuffer();
      if (!res.ok) {
        failures++;
        return;
      }
      const elapsed = performance.now() - start;
      const status = res.headers.get('x-minicdn-cache');
      if (status === 'HIT' || status === 'REVALIDATED') {
        hitLatencies.push(elapsed);
      } else if (status === 'MISS') {
        missLatencies.push(elapsed);
      } else {
        unknownCacheStatus++;
      }
    } catch {
      failures++;
    }
  });

  return { hitLatencies, missLatencies, failures, unknownCacheStatus };
}

async function routingSanityCheck() {
  try {
    const res = await fetch(`${ROUTING_URL}/route-info?loc=${encodeURIComponent(CLIENT_LOC)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  console.log('MiniCDN benchmark');
  console.log('─'.repeat(60));
  console.log(`origin:      ${ORIGIN_URL}`);
  console.log(`routing:     ${ROUTING_URL}`);
  console.log(`requests:    ${REQUESTS} per phase (concurrency ${CONCURRENCY})`);
  console.log(`client loc:  ${CLIENT_LOC}`);
  console.log(`assets:      ${ASSETS.length} distinct`);
  console.log('─'.repeat(60));

  await preflight();

  const route = await routingSanityCheck();
  if (route) {
    console.log(`routing picks: ${route.chosenNodeId} (fellBack=${route.fellBack})\n`);
  }

  console.log('Phase 1/2 — baseline, direct to origin (no cache, no routing)...');
  const baseline = await phaseBaseline();
  const baselineAvg = avg(baseline.latencies);
  console.log(`  ${baseline.latencies.length} ok, ${baseline.failures} failed — avg ${ms(baselineAvg)}\n`);

  console.log('Phase 2/2 — CDN path, through routing to nearest edge...');
  const cdn = await phaseCdn();
  const hitAvg = avg(cdn.hitLatencies);
  const missAvg = avg(cdn.missLatencies);
  const hits = cdn.hitLatencies.length;
  const misses = cdn.missLatencies.length;
  const hitRatio = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;
  console.log(`  ${hits} hits, ${misses} misses, ${cdn.failures} failed`);
  if (cdn.unknownCacheStatus > 0) {
    console.log(`  (${cdn.unknownCacheStatus} responses had no X-MiniCDN-Cache header)`);
  }
  console.log('');

  if (baseline.latencies.length === 0 || hits === 0) {
    console.error('Not enough successful requests to compute results. Is the stack healthy?');
    process.exit(1);
  }

  const latencyReduction = ((baselineAvg - hitAvg) / baselineAvg) * 100;

  console.log('═'.repeat(60));
  console.log('RESULTS');
  console.log('═'.repeat(60));
  console.log(`Baseline (direct-to-origin) avg latency : ${ms(baselineAvg)}   (p95 ${ms(percentile(baseline.latencies, 95))})`);
  console.log(`CDN path avg latency (cache HIT)        : ${ms(hitAvg)}   (p95 ${ms(percentile(cdn.hitLatencies, 95))})`);
  if (misses > 0) {
    console.log(`CDN path avg latency (cache MISS)       : ${ms(missAvg)}`);
  }
  console.log('');
  console.log(`Latency reduction (warm cache vs baseline): ${pct(latencyReduction)}`);
  console.log(`Cache hit ratio                           : ${pct(hitRatio)}  (${hits} hits / ${misses} misses)`);
  console.log('');

  console.log('─'.repeat(60));
  console.log('Paste-ready README table:');
  console.log('─'.repeat(60));
  console.log('| Metric | Result |');
  console.log('|---|---|');
  console.log(`| Baseline (direct-to-origin) avg latency | ${ms(baselineAvg)} |`);
  console.log(`| CDN path avg latency (cache HIT) | ${ms(hitAvg)} |`);
  if (misses > 0) {
    console.log(`| CDN path avg latency (cache MISS) | ${ms(missAvg)} |`);
  }
  console.log(`| Latency reduction | ${pct(latencyReduction)} |`);
  console.log(`| Cache hit ratio (repeated-request load) | ${pct(hitRatio)} |`);
  console.log('');
  console.log('Next: run `node load-tests/invalidation-latency.js` for the purge-propagation row.');
  console.log('');
  console.log('Note: these numbers reflect this machine and the per-edge');
  console.log('SIMULATED_ORIGIN_LATENCY_MS settings standing in for real');
  console.log('cross-region distance — not a real multi-region deployment.');
}

main().catch((err) => {
  console.error('benchmark failed:', err);
  process.exit(1);
});
