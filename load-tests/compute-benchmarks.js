/**
 * Reads the k6 JSON summaries produced by baseline-origin.js and
 * cdn-path.js (run with --summary-export, see load-tests/README.md) and
 * computes the two headline numbers from §8 of the plan:
 *
 *   latency_reduction = (baseline_latency - cdn_latency) / baseline_latency * 100
 *   hit_ratio         = hits / (hits + misses) * 100
 *
 * Run: node load-tests/compute-benchmarks.js
 * (expects load-tests/results/baseline-summary.json and cdn-path-summary.json)
 */
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');

function loadJson(filename) {
  const filePath = path.join(RESULTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing ${filePath}.`);
    console.error(`Run: k6 run --summary-export=${filePath} load-tests/${filename.replace('-summary.json', '.js')}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

const baseline = loadJson('baseline-summary.json');
const cdn = loadJson('cdn-path-summary.json');

const baselineAvg = baseline.metrics.origin_latency_ms?.values?.avg;
const cdnHitAvg = cdn.metrics.cdn_hit_latency_ms?.values?.avg;
const cdnMissAvg = cdn.metrics.cdn_miss_latency_ms?.values?.avg;
const hits = cdn.metrics.cdn_hits?.values?.count || 0;
const misses = cdn.metrics.cdn_misses?.values?.count || 0;

if (baselineAvg === undefined || cdnHitAvg === undefined) {
  console.error('Expected metrics not found in summary files — did both k6 runs complete?');
  process.exit(1);
}

const latencyReductionHit = ((baselineAvg - cdnHitAvg) / baselineAvg) * 100;
const hitRatio = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;

console.log('=== MiniCDN Benchmark Results ===\n');
console.log(`Baseline (direct-to-origin) avg latency: ${baselineAvg.toFixed(1)}ms`);
console.log(`CDN path avg latency (cache HIT):        ${cdnHitAvg.toFixed(1)}ms`);
if (cdnMissAvg !== undefined) {
  console.log(`CDN path avg latency (cache MISS):       ${cdnMissAvg.toFixed(1)}ms`);
}
console.log(`\nLatency reduction (warm cache vs baseline): ${latencyReductionHit.toFixed(1)}%`);
console.log(`Cache hit ratio under repeated-request load: ${hitRatio.toFixed(1)}%  (${hits} hits / ${misses} misses)`);
console.log('\nPaste these numbers into README.md §Benchmark Results and the resume line.');
