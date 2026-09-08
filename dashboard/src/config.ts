// Dashboard talks to each service directly from the browser. Locally (via
// docker-compose or run-local.sh) these default to localhost ports. For a
// real deployment, set these as Vite build-time env vars (VITE_ prefix is
// required — Vite only exposes prefixed vars to client code) so the built
// dashboard points at each service's real public URL instead:
//
//   VITE_ORIGIN_URL=https://minicdn-origin.fly.dev
//   VITE_ROUTING_URL=https://minicdn-routing.fly.dev
//   VITE_EDGE_US_URL=https://minicdn-edge-us.fly.dev
//   VITE_EDGE_EU_URL=https://minicdn-edge-eu.fly.dev
//   VITE_EDGE_ASIA_URL=https://minicdn-edge-asia.fly.dev
//
// These must be set at BUILD time (they get baked into the static JS),
// not at container runtime — see dashboard/fly.toml for how to pass them
// as Docker build args.
const originUrl = import.meta.env.VITE_ORIGIN_URL || 'http://localhost:4000';
const routingUrl = import.meta.env.VITE_ROUTING_URL || 'http://localhost:5000';

export const NODES = [
  { id: 'us', label: 'US (Virginia)', metricsUrl: `${import.meta.env.VITE_EDGE_US_URL || 'http://localhost:4001'}/metrics` },
  { id: 'eu', label: 'EU (Frankfurt)', metricsUrl: `${import.meta.env.VITE_EDGE_EU_URL || 'http://localhost:4002'}/metrics` },
  { id: 'asia', label: 'Asia (Singapore)', metricsUrl: `${import.meta.env.VITE_EDGE_ASIA_URL || 'http://localhost:4003'}/metrics` },
];

export const ROUTING_METRICS_URL = `${routingUrl}/metrics`;
export const ORIGIN_STATS_URL = `${originUrl}/admin/stats`;

export const POLL_INTERVAL_MS = 3000;
