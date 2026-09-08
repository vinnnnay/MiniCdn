import { EdgeMetricsSnapshot } from '@minicdn/shared';

/**
 * In-memory rolling metrics for one edge node. Kept intentionally simple
 * (no external time-series store) — good enough to drive the dashboard and
 * compute hit ratio / latency numbers for the benchmarking section.
 */
export class EdgeMetrics {
  private hits = 0;
  private misses = 0;
  private hitLatencyTotalMs = 0;
  private missLatencyTotalMs = 0;
  private startedAt = Date.now();
  private lastInvalidation: EdgeMetricsSnapshot['lastInvalidation'] = null;

  recordHit(latencyMs: number) {
    this.hits += 1;
    this.hitLatencyTotalMs += latencyMs;
  }

  recordMiss(latencyMs: number) {
    this.misses += 1;
    this.missLatencyTotalMs += latencyMs;
  }

  recordInvalidation(key: string, propagationMs: number) {
    this.lastInvalidation = { key, propagationMs, at: new Date().toISOString() };
  }

  snapshot(nodeId: string, region: string, cacheSize: number, cacheMax: number): EdgeMetricsSnapshot {
    const totalRequests = this.hits + this.misses;
    return {
      nodeId,
      region,
      hits: this.hits,
      misses: this.misses,
      hitRatio: totalRequests > 0 ? this.hits / totalRequests : 0,
      totalRequests,
      avgHitLatencyMs: this.hits > 0 ? this.hitLatencyTotalMs / this.hits : 0,
      avgMissLatencyMs: this.misses > 0 ? this.missLatencyTotalMs / this.misses : 0,
      cacheEntryCount: cacheSize,
      cacheMaxEntries: cacheMax,
      lastInvalidation: this.lastInvalidation,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      healthy: true,
    };
  }
}
