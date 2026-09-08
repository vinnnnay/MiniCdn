/**
 * CDN path: hit the routing layer (which forwards to the nearest healthy
 * edge node), repeatedly requesting the same small set of assets so the
 * cache warms up. Reports latency split by X-MiniCDN-Cache (MISS/HIT) via
 * custom trends, and prints an overall hit ratio at the end.
 *
 * Run: k6 run load-tests/cdn-path.js
 * Config via env: ROUTING_URL (default http://localhost:5000), CLIENT_LOC
 * (default new-york — see shared/src/nodes.ts for valid keys)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const ROUTING_URL = __ENV.ROUTING_URL || 'http://localhost:5000';
const CLIENT_LOC = __ENV.CLIENT_LOC || 'new-york';

// Small, fixed asset set repeated for 2 minutes — deliberately narrow so
// the cache reaches steady-state hit ratio quickly (mirrors §8.3's "20
// assets repeatedly for 2 minutes" plan, using the assets seed.ts creates).
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

export const hitLatency = new Trend('cdn_hit_latency_ms', true);
export const missLatency = new Trend('cdn_miss_latency_ms', true);
export const hits = new Counter('cdn_hits');
export const misses = new Counter('cdn_misses');

export const options = {
  vus: 10,
  duration: '2m',
};

export default function () {
  const asset = ASSETS[Math.floor(Math.random() * ASSETS.length)];
  const res = http.get(`${ROUTING_URL}/assets/${asset}?loc=${CLIENT_LOC}`);
  check(res, { 'status is 200': (r) => r.status === 200 });

  const cacheStatus = res.headers['X-Minicdn-Cache'] || res.headers['X-MiniCDN-Cache'];
  if (cacheStatus === 'HIT' || cacheStatus === 'REVALIDATED') {
    hits.add(1);
    hitLatency.add(res.timings.duration);
  } else {
    misses.add(1);
    missLatency.add(res.timings.duration);
  }

  sleep(0.1);
}

export function handleSummary(data) {
  const h = data.metrics.cdn_hits ? data.metrics.cdn_hits.values.count : 0;
  const m = data.metrics.cdn_misses ? data.metrics.cdn_misses.values.count : 0;
  const total = h + m;
  const hitRatio = total > 0 ? ((h / total) * 100).toFixed(1) : '0.0';

  console.log(`\n=== CDN path summary ===`);
  console.log(`Hits: ${h}  Misses: ${m}  Hit ratio: ${hitRatio}%`);
  if (data.metrics.cdn_hit_latency_ms) {
    console.log(`Avg HIT latency: ${data.metrics.cdn_hit_latency_ms.values.avg.toFixed(1)}ms`);
  }
  if (data.metrics.cdn_miss_latency_ms) {
    console.log(`Avg MISS latency: ${data.metrics.cdn_miss_latency_ms.values.avg.toFixed(1)}ms`);
  }

  return {
    stdout: '', // suppress default text summary duplication; console.log above is enough
    'load-tests/results/cdn-path-summary.json': JSON.stringify(data, null, 2),
  };
}
