import fetch from 'node-fetch';

export interface GeoLocation {
  lat: number;
  lng: number;
  label: string;
}

/**
 * Real IP-based geolocation, using ip-api.com's free tier (no API key
 * required for non-commercial use; rate-limited to 45 requests/minute per
 * source IP — see https://ip-api.com/docs/api:json). This is what a real
 * public deployment uses instead of the `?loc=` simulation in server.ts.
 *
 * Swap this module for MaxMind GeoLite2 or a paid provider if you need
 * higher volume or offline/self-hosted lookups — nothing else in the
 * routing layer needs to change, since callers only see resolveClientIp()
 * and geolocateIp()'s return shape.
 */

const IP_API_BASE = 'http://ip-api.com/json';
const REQUEST_TIMEOUT_MS = 2000;

// Simple in-memory cache: the same visitor (or NAT'd office, or CI runner)
// tends to hit repeatedly in a short window, and ip-api.com's free tier
// rate-limits per source IP — caching avoids burning that budget on
// requests we already have an answer for. Real deployments with heavy
// traffic should back this with Redis (shared across routing-layer
// replicas) rather than in-process memory.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, { loc: GeoLocation; expiresAt: number }>();

/** Private/loopback ranges — geolocation APIs can't place these; treat as unknown. */
function isPrivateOrLoopback(ip: string): boolean {
  return (
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    ip.startsWith('::ffff:127.') ||
    ip === 'localhost'
  );
}

/**
 * Extract the real client IP from a request. When this service sits behind
 * a load balancer, reverse proxy, or another CDN edge (the normal case for
 * a real public deployment), the direct TCP peer is that intermediary, not
 * the visitor — the actual client IP arrives in X-Forwarded-For instead.
 * We take the left-most entry (the original client), which is the standard
 * convention, but note this header is trivially spoofable by the client
 * unless your edge/proxy layer strips and re-sets it itself — don't trust
 * X-Forwarded-For for anything security-sensitive without that guarantee.
 */
export function resolveClientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || '';
}

/**
 * Look up an IP's approximate lat/lng via ip-api.com. Returns null on any
 * failure (private IP, network error, rate limit, malformed response) so
 * callers can fall back to a sane default rather than crashing routing.
 */
export async function geolocateIp(ip: string): Promise<GeoLocation | null> {
  if (!ip || isPrivateOrLoopback(ip)) {
    return null;
  }

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.loc;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${IP_API_BASE}/${encodeURIComponent(ip)}?fields=status,message,lat,lon,city,country`, {
      signal: controller.signal as any,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: 'success' | 'fail';
      message?: string;
      lat?: number;
      lon?: number;
      city?: string;
      country?: string;
    };

    if (data.status !== 'success' || typeof data.lat !== 'number' || typeof data.lon !== 'number') {
      return null;
    }

    const loc: GeoLocation = {
      lat: data.lat,
      lng: data.lon,
      label: [data.city, data.country].filter(Boolean).join(', ') || ip,
    };
    cache.set(ip, { loc, expiresAt: Date.now() + CACHE_TTL_MS });
    return loc;
  } catch {
    // Network error, timeout, or rate limit — treat as "couldn't geolocate".
    return null;
  }
}
