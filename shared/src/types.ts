export interface AssetMeta {
  key: string;
  etag: string;
  lastModified: string;
  contentType: string;
  maxAgeSeconds: number;
  size: number;
}

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
  lastInvalidation: {
    key: string;
    propagationMs: number;
    at: string;
  } | null;
  uptimeSeconds: number;
  healthy: true;
}

export interface PurgeMessage {
  action: 'purge';
  key: string;
  publishedAt: number; // epoch ms, used to compute propagation latency
}

export interface RoutingDecision {
  chosenNodeId: string;
  chosenNodeUrl: string;
  clientLocation: string;
  candidates: Array<{ nodeId: string; distanceKm: number; healthy: boolean }>;
  fellBack: boolean;
}
