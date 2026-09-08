/**
 * Baseline: hit the origin directly (no cache, no routing layer), repeatedly
 * requesting the same set of assets. This is the "before" number the
 * benchmarking section (§8) compares the CDN path against.
 *
 * Run: k6 run load-tests/baseline-origin.js
 * Config via env: ORIGIN_URL (default http://localhost:4000)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const ORIGIN_URL = __ENV.ORIGIN_URL || 'http://localhost:4000';
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

export const originLatency = new Trend('origin_latency_ms', true);

export const options = {
  vus: 10,
  duration: '2m',
};

export default function () {
  const asset = ASSETS[Math.floor(Math.random() * ASSETS.length)];
  const res = http.get(`${ORIGIN_URL}/assets/${asset}`);
  originLatency.add(res.timings.duration);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.1);
}
