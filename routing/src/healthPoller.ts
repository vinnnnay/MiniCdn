import fetch from 'node-fetch';
import { EDGE_NODES, EdgeNodeConfig } from '@minicdn/shared';

export interface HealthState {
  healthy: boolean;
  lastCheckedAt: number;
  consecutiveFailures: number;
}

/**
 * Polls each edge node's /health endpoint on an interval and keeps the last
 * known state in memory. This is the "health-check cache" from Section 4.3
 * — routing decisions read from this cache rather than health-checking
 * synchronously on every request, which would add latency to the hot path
 * and hammer edge nodes with health traffic proportional to client traffic.
 *
 * Tradeoff worth noting in interviews: this means routing can briefly send
 * traffic to a node that just died (stale health data), bounded by the
 * poll interval. A production system would combine this with fast
   circuit-breaking on the request path itself (e.g. retry-next-node on
 * connection failure) rather than relying on the poller alone.
 */
export class HealthPoller {
  private state = new Map<string, HealthState>();

  constructor(
    private nodes: EdgeNodeConfig[] = EDGE_NODES,
    private intervalMs: number = Number(process.env.HEALTH_POLL_INTERVAL_MS || 5000),
    private timeoutMs: number = 2000,
  ) {
    for (const node of nodes) {
      this.state.set(node.id, { healthy: true, lastCheckedAt: 0, consecutiveFailures: 0 });
    }
  }

  start() {
    this.pollAll();
    setInterval(() => this.pollAll(), this.intervalMs);
  }

  private async pollAll() {
    await Promise.all(this.nodes.map((node) => this.pollOne(node)));
  }

  private async pollOne(node: EdgeNodeConfig) {
    const prev = this.state.get(node.id)!;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await fetch(`${node.url}/health`, { signal: controller.signal as any });
      clearTimeout(timer);

      if (res.ok) {
        this.state.set(node.id, { healthy: true, lastCheckedAt: Date.now(), consecutiveFailures: 0 });
      } else {
        this.markFailure(node.id, prev);
      }
    } catch {
      this.markFailure(node.id, prev);
    }
  }

  private markFailure(nodeId: string, prev: HealthState) {
    const failures = prev.consecutiveFailures + 1;
    // Require 2 consecutive failures before marking unhealthy, to avoid
    // flapping on a single transient blip.
    const healthy = failures < 2;
    this.state.set(nodeId, { healthy, lastCheckedAt: Date.now(), consecutiveFailures: failures });
  }

  isHealthy(nodeId: string): boolean {
    return this.state.get(nodeId)?.healthy ?? false;
  }

  snapshot(): Record<string, HealthState> {
    return Object.fromEntries(this.state.entries());
  }
}
