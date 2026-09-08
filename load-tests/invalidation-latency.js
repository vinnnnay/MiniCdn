/**
 * Measures cache invalidation propagation time end-to-end:
 *   1. Warm all 3 edge nodes for one asset (via the routing layer, forcing
 *      each region with ?loc=).
 *   2. Trigger a purge on the origin.
 *   3. Poll each edge node directly until it reports a cache MISS again for
 *      that key (proving the purge was received and applied), and record
 *      how long that took per node.
 *
 * This is a plain Node script (not a k6 script) since it needs sequential
 * control flow across services rather than concurrent VUs.
 *
 * Run: node load-tests/invalidation-latency.js
 */
const ORIGIN_URL = process.env.ORIGIN_URL || 'http://localhost:4000';
const EDGE_URLS = {
  us: process.env.EDGE_US_URL || 'http://localhost:4001',
  eu: process.env.EDGE_EU_URL || 'http://localhost:4002',
  asia: process.env.EDGE_ASIA_URL || 'http://localhost:4003',
};
const TEST_KEY = 'api/config.json';
const POLL_INTERVAL_MS = 25;
const POLL_TIMEOUT_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function warmNode(edgeUrl) {
  const res = await fetch(`${edgeUrl}/assets/${TEST_KEY}`);
  await res.arrayBuffer();
  return res.headers.get('x-minicdn-cache');
}

async function pollUntilMiss(edgeUrl) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await fetch(`${edgeUrl}/assets/${TEST_KEY}`);
    await res.arrayBuffer();
    const status = res.headers.get('x-minicdn-cache');
    if (status === 'MISS') {
      return Date.now() - start;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null; // timed out
}

async function main() {
  console.log(`=== MiniCDN invalidation latency test ===`);
  console.log(`Test key: ${TEST_KEY}\n`);

  console.log('Step 1: warming all edge nodes...');
  for (const [region, url] of Object.entries(EDGE_URLS)) {
    const status = await warmNode(url);
    console.log(`  ${region}: ${status}`);
  }

  // Confirm warm (second read should be HIT everywhere).
  console.log('\nStep 2: confirming warm cache (expect HIT)...');
  for (const [region, url] of Object.entries(EDGE_URLS)) {
    const status = await warmNode(url);
    console.log(`  ${region}: ${status}`);
  }

  console.log('\nStep 3: triggering purge on origin...');
  const purgeStart = Date.now();
  const purgeRes = await fetch(`${ORIGIN_URL}/admin/purge/${TEST_KEY}`, { method: 'POST' });
  const purgeBody = await purgeRes.json();
  console.log(`  origin acknowledged purge, subscribers notified: ${purgeBody.subscribersNotified}`);

  console.log('\nStep 4: polling each edge node until it shows MISS again...');
  const results = {};
  await Promise.all(
    Object.entries(EDGE_URLS).map(async ([region, url]) => {
      const elapsed = await pollUntilMiss(url);
      results[region] = elapsed;
    }),
  );

  const totalElapsed = Date.now() - purgeStart;

  console.log('\n=== Results ===');
  for (const [region, elapsed] of Object.entries(results)) {
    console.log(`  ${region}: ${elapsed === null ? 'TIMED OUT' : `${elapsed}ms to reflect purge`}`);
  }
  console.log(`\nWall-clock time for ALL nodes to reflect purge: ${totalElapsed}ms`);
}

main().catch((err) => {
  console.error('invalidation-latency test failed:', err);
  process.exit(1);
});
