import express, { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fetch from 'node-fetch';
import {
  EDGE_NODES,
  SIMULATED_CLIENT_LOCATIONS,
  rankNodesByDistance,
  RoutingDecision,
} from '@minicdn/shared';
import { HealthPoller } from './healthPoller';
import { resolveClientIp, geolocateIp } from './geolocation';

const PORT = Number(process.env.PORT || 5000);
// 'redirect' issues a 302 to the chosen edge node (closer to how a real geo
// -DNS/anycast CDN behaves from the client's point of view — the client
// talks directly to the edge after the first hop). 'proxy' has the routing
// layer itself stream the response, which is simpler to demo end-to-end
// through one entrypoint/port and is the default here.
const MODE = (process.env.ROUTING_MODE || 'proxy') as 'proxy' | 'redirect';
// Set to 'true' to geolocate real client IPs via ip-api.com instead of
// requiring `?loc=` on every request. Off by default so local/demo testing
// keeps working exactly as before with zero setup. Turn this on for a real
// public deployment. See routing/src/geolocation.ts for the provider.
const USE_REAL_GEOLOCATION = (process.env.USE_REAL_GEOLOCATION || 'false').toLowerCase() === 'true';

const app = express();
const healthPoller = new HealthPoller();
healthPoller.start();

app.use(cors());
app.use(morgan('tiny'));

let requestsRouted = 0;
const requestsPerNode: Record<string, number> = Object.fromEntries(EDGE_NODES.map((n) => [n.id, 0]));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'routing', mode: MODE });
});

app.get('/metrics', (_req, res) => {
  res.json({
    requestsRouted,
    requestsPerNode,
    nodeHealth: healthPoller.snapshot(),
  });
});

/**
 * Resolve the client's location.
 *
 * `?loc=` (or the `X-MiniCDN-Client-Loc` header) always wins when present —
 * this is the simulation path used for local testing and demos, naming one
 * of the SIMULATED_CLIENT_LOCATIONS, so the routing/fallback logic itself
 * is real and testable without needing a real public IP to test against.
 *
 * When no `?loc=` is given and USE_REAL_GEOLOCATION=true, this instead
 * geolocates the request's real IP via ip-api.com (routing/src/geolocation.ts)
 * — this is the path an actual public deployment uses. Falls back to
 * New York if geolocation fails (private/local IP, network error, rate
 * limit) so routing never breaks outright, just becomes less precise.
 */
async function resolveClientLocation(req: Request): Promise<{ lat: number; lng: number; label: string; key: string }> {
  const requested = (req.query.loc as string) || req.header('X-MiniCDN-Client-Loc');
  if (requested) {
    const loc = SIMULATED_CLIENT_LOCATIONS[requested];
    if (loc) return { ...loc, key: requested };
    // Unknown location key — fall back to New York rather than erroring, and
    // say so via the response so the caller can tell.
    return { ...SIMULATED_CLIENT_LOCATIONS['new-york'], key: 'new-york (fallback, unknown loc requested)' };
  }

  if (USE_REAL_GEOLOCATION) {
    const ip = resolveClientIp(req as any);
    const geo = await geolocateIp(ip);
    if (geo) return { ...geo, key: `geo:${ip}` };
    return { ...SIMULATED_CLIENT_LOCATIONS['new-york'], key: `new-york (fallback, geolocation failed for ${ip || 'unknown ip'})` };
  }

  return { ...SIMULATED_CLIENT_LOCATIONS['new-york'], key: 'new-york (default — no ?loc= given, USE_REAL_GEOLOCATION off)' };
}

async function decideRoute(req: Request): Promise<RoutingDecision> {
  const client = await resolveClientLocation(req);
  const ranked = rankNodesByDistance(client, EDGE_NODES);

  const candidates = ranked.map((n) => ({
    nodeId: n.id,
    distanceKm: Math.round(n.distanceKm),
    healthy: healthPoller.isHealthy(n.id),
  }));

  const firstHealthy = ranked.find((n) => healthPoller.isHealthy(n.id)) || ranked[0];
  const fellBack = firstHealthy.id !== ranked[0].id;

  return {
    chosenNodeId: firstHealthy.id,
    chosenNodeUrl: firstHealthy.url,
    clientLocation: client.key,
    candidates,
    fellBack,
  };
}

app.get('/route-info', async (req: Request, res: Response) => {
  res.json(await decideRoute(req));
});

app.get('/assets/*', async (req: Request, res: Response) => {
  const decision = await decideRoute(req);
  requestsRouted += 1;
  requestsPerNode[decision.chosenNodeId] = (requestsPerNode[decision.chosenNodeId] || 0) + 1;

  const key = req.params[0];
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const targetUrl = `${decision.chosenNodeUrl}/assets/${key}${qs}`;

  if (MODE === 'redirect') {
    res.redirect(302, targetUrl);
    return;
  }

  try {
    const upstream = await fetch(targetUrl);
    const buffer = await upstream.buffer();
    res.status(upstream.status);
    upstream.headers.forEach((value, name) => {
      if (name.toLowerCase() === 'content-encoding') return; // avoid double-decoding issues
      res.set(name, value);
    });
    res.set('X-MiniCDN-Routed-To', decision.chosenNodeId);
    res.set('X-MiniCDN-Client-Location', decision.clientLocation);
    res.set('X-MiniCDN-Fellback', String(decision.fellBack));
    res.send(buffer);
  } catch (err) {
    console.error('[routing] proxy to edge failed', err);
    res.status(502).json({ error: 'edge_unreachable', attemptedNode: decision.chosenNodeId });
  }
});

app.listen(PORT, () => {
  console.log(`[routing] listening on :${PORT} (mode=${MODE})`);
  console.log(`[routing] known edge nodes: ${EDGE_NODES.map((n) => `${n.id}@${n.url}`).join(', ')}`);
  console.log(
    USE_REAL_GEOLOCATION
      ? '[routing] real IP geolocation ENABLED (ip-api.com) — ?loc= still overrides when present'
      : '[routing] real IP geolocation disabled — using ?loc= simulation (default new-york). Set USE_REAL_GEOLOCATION=true for a real deployment.',
  );
});
