import { useEffect, useRef, useState } from 'react';
import { NODES, ROUTING_METRICS_URL, ORIGIN_STATS_URL, POLL_INTERVAL_MS } from './config';

export interface EdgeMetricsSnapshot {
  nodeId: string;
  region: string;
  hits: number;
  misses: number;
  hitRatio: number;
  totalRequests: number;
  avgHitLatencyMs: number;
  avgMissLatencyMs: number;
  cacheEntryCount: number;
  cacheMaxEntries: number;
  lastInvalidation: { key: string; propagationMs: number; at: string } | null;
  uptimeSeconds: number;
}

export interface RoutingMetrics {
  requestsRouted: number;
  requestsPerNode: Record<string, number>;
  nodeHealth: Record<string, { healthy: boolean; lastCheckedAt: number; consecutiveFailures: number }>;
}

export interface DashboardState {
  edgeMetrics: Record<string, EdgeMetricsSnapshot | null>;
  edgeReachable: Record<string, boolean>;
  routing: RoutingMetrics | null;
  originPurges: number | null;
  history: Array<{ t: number; hitRatioByNode: Record<string, number> }>;
  lastUpdated: number | null;
}

const MAX_HISTORY_POINTS = 40;

export function useMetrics(): DashboardState {
  const [state, setState] = useState<DashboardState>({
    edgeMetrics: Object.fromEntries(NODES.map((n) => [n.id, null])),
    edgeReachable: Object.fromEntries(NODES.map((n) => [n.id, false])),
    routing: null,
    originPurges: null,
    history: [],
    lastUpdated: null,
  });

  const historyRef = useRef<DashboardState['history']>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const edgeResults = await Promise.all(
        NODES.map(async (node) => {
          try {
            const res = await fetch(node.metricsUrl, { cache: 'no-store' });
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as EdgeMetricsSnapshot;
            return { id: node.id, data, reachable: true as const };
          } catch {
            return { id: node.id, data: null, reachable: false as const };
          }
        }),
      );

      let routing: RoutingMetrics | null = null;
      try {
        const res = await fetch(ROUTING_METRICS_URL, { cache: 'no-store' });
        if (res.ok) routing = await res.json();
      } catch {
        routing = null;
      }

      let originPurges: number | null = null;
      try {
        const res = await fetch(ORIGIN_STATS_URL, { cache: 'no-store' });
        if (res.ok) originPurges = (await res.json()).purgesSent;
      } catch {
        originPurges = null;
      }

      if (cancelled) return;

      const edgeMetrics: DashboardState['edgeMetrics'] = {};
      const edgeReachable: DashboardState['edgeReachable'] = {};
      for (const r of edgeResults) {
        edgeMetrics[r.id] = r.data;
        edgeReachable[r.id] = r.reachable;
      }

      const hitRatioByNode: Record<string, number> = {};
      for (const r of edgeResults) {
        if (r.data) hitRatioByNode[r.id] = r.data.hitRatio;
      }
      historyRef.current = [...historyRef.current, { t: Date.now(), hitRatioByNode }].slice(-MAX_HISTORY_POINTS);

      setState({
        edgeMetrics,
        edgeReachable,
        routing,
        originPurges,
        history: historyRef.current,
        lastUpdated: Date.now(),
      });
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return state;
}
