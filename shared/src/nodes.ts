/**
 * Static registry of edge node locations, used by the routing layer for
 * haversine nearest-node selection. In a real deployment these coordinates
 * would be the actual datacenter locations (e.g. Fly.io regions).
 */

export interface EdgeNodeConfig {
  id: string;
  region: string;
  label: string;
  lat: number;
  lng: number;
  /** Base URL the routing layer / dashboard uses to reach this node. */
  url: string;
}

// Simulated 3-region deployment: US (iad), EU (fra), Asia (sin) —
// mirroring the Fly.io region codes mentioned in the plan.
export const EDGE_NODES: EdgeNodeConfig[] = [
  {
    id: 'us',
    region: 'iad',
    label: 'US (Virginia)',
    lat: 38.9519,
    lng: -77.4480,
    url: process.env.EDGE_US_URL || 'http://edge-us:4001',
  },
  {
    id: 'eu',
    region: 'fra',
    label: 'EU (Frankfurt)',
    lat: 50.1109,
    lng: 8.6821,
    url: process.env.EDGE_EU_URL || 'http://edge-eu:4002',
  },
  {
    id: 'asia',
    region: 'sin',
    label: 'Asia (Singapore)',
    lat: 1.3521,
    lng: 103.8198,
    url: process.env.EDGE_ASIA_URL || 'http://edge-asia:4003',
  },
];

/** A handful of named "client locations" for simulated geo-routing/demo purposes. */
export const SIMULATED_CLIENT_LOCATIONS: Record<string, { lat: number; lng: number; label: string }> = {
  'new-york': { lat: 40.7128, lng: -74.006, label: 'New York, US' },
  london: { lat: 51.5072, lng: -0.1276, label: 'London, UK' },
  frankfurt: { lat: 50.1109, lng: 8.6821, label: 'Frankfurt, DE' },
  singapore: { lat: 1.3521, lng: 103.8198, label: 'Singapore' },
  tokyo: { lat: 35.6762, lng: 139.6503, label: 'Tokyo, JP' },
  mumbai: { lat: 19.076, lng: 72.8777, label: 'Mumbai, IN' },
  'sao-paulo': { lat: -23.5505, lng: -46.6333, label: 'São Paulo, BR' },
  sydney: { lat: -33.8688, lng: 151.2093, label: 'Sydney, AU' },
};

/** Haversine great-circle distance between two lat/lng points, in kilometers. */
export function haversineDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

/** Sort edge nodes by distance from a client location, nearest first. */
export function rankNodesByDistance(
  client: { lat: number; lng: number },
  nodes: EdgeNodeConfig[] = EDGE_NODES,
): Array<EdgeNodeConfig & { distanceKm: number }> {
  return nodes
    .map((node) => ({ ...node, distanceKm: haversineDistanceKm(client, node) }))
    .sort((x, y) => x.distanceKm - y.distanceKm);
}
