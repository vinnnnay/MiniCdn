import express, { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import Redis from 'ioredis';
import fetch from 'node-fetch';
import { EdgeCache, CacheEntry } from './cache';
import { EdgeMetrics } from './metrics';
import { buildCacheKey, PurgeMessage } from '@minicdn/shared';

const PORT = Number(process.env.PORT || 4001);
const NODE_ID = process.env.NODE_ID || 'us';
const REGION = process.env.REGION || 'iad';
const ORIGIN_URL = process.env.ORIGIN_URL || 'http://origin:4000';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const MAX_CACHE_ENTRIES = Number(process.env.MAX_CACHE_ENTRIES || 200);
// Simulated network latency to origin, so cold vs warm requests show a
// measurable, realistic difference in the dashboard/load tests even when
// everything runs on one machine via docker-compose.
const SIMULATED_ORIGIN_LATENCY_MS = Number(process.env.SIMULATED_ORIGIN_LATENCY_MS || 40);

const PURGE_CHANNEL = 'minicdn:purge';

const app = express();
const cache = new EdgeCache(MAX_CACHE_ENTRIES);
const metrics = new EdgeMetrics();
const subscriber = new Redis(REDIS_URL);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

subscriber.subscribe(PURGE_CHANNEL, (err) => {
  if (err) {
    console.error(`[edge:${NODE_ID}] failed to subscribe to purge channel`, err);
  } else {
    console.log(`[edge:${NODE_ID}] subscribed to ${PURGE_CHANNEL}`);
  }
});

subscriber.on('message', (_channel, raw) => {
  try {
    const msg: PurgeMessage = JSON.parse(raw);
    const existed = cache.delete(msg.key);
    const propagationMs = Date.now() - msg.publishedAt;
    metrics.recordInvalidation(msg.key, propagationMs);
    console.log(
      `[edge:${NODE_ID}] purge received for "${msg.key}" (existed=${existed}, propagation=${propagationMs}ms)`,
    );
  } catch (e) {
    console.error(`[edge:${NODE_ID}] bad purge message`, e);
  }
});

app.use(cors());
app.use(morgan('tiny'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'edge', nodeId: NODE_ID, region: REGION });
});

app.get('/metrics', (_req, res) => {
  res.json(metrics.snapshot(NODE_ID, REGION, cache.size, cache.maxSize));
});

app.get('/assets/*', async (req: Request, res: Response) => {
  const key = req.params[0];
  const cacheKey = buildCacheKey(key, req.query as Record<string, string>);
  const start = Date.now();

  const cached = cache.get(cacheKey);
  if (cached) {
    const latency = Date.now() - start;
    metrics.recordHit(latency);
    res.status(200).set({
      'Content-Type': cached.contentType,
      ETag: cached.etag,
      'Last-Modified': cached.lastModified,
      'X-MiniCDN-Cache': 'HIT',
      'X-MiniCDN-Node': NODE_ID,
      'X-MiniCDN-Latency-Ms': String(latency),
    });
    res.send(cached.body);
    return;
  }

  // Cache miss — fetch from origin, honoring conditional revalidation if we
  // have a stale-but-present entry to check against.
  try {
    if (SIMULATED_ORIGIN_LATENCY_MS > 0) {
      await sleep(SIMULATED_ORIGIN_LATENCY_MS);
    }

    const stale = cache.peek(cacheKey);
    const headers: Record<string, string> = {};
    if (stale) headers['If-None-Match'] = stale.etag;

    const upstreamUrl = `${ORIGIN_URL}/assets/${key}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
    const upstream = await fetch(upstreamUrl, { headers });

    if (upstream.status === 304 && stale) {
      // Origin confirms our stale copy is still valid — refresh TTL clock.
      const maxAge = parseMaxAge(upstream.headers.get('cache-control')) ?? stale.ttlSeconds;
      cache.set(cacheKey, { ...stale, storedAt: Date.now(), ttlSeconds: maxAge });
      const latency = Date.now() - start;
      metrics.recordMiss(latency); // still a round trip to origin
      res.status(200).set({
        'Content-Type': stale.contentType,
        ETag: stale.etag,
        'Last-Modified': stale.lastModified,
        'X-MiniCDN-Cache': 'REVALIDATED',
        'X-MiniCDN-Node': NODE_ID,
        'X-MiniCDN-Latency-Ms': String(latency),
      });
      res.send(stale.body);
      return;
    }

    if (upstream.status === 404) {
      res.status(404).json({ error: 'not_found', key });
      return;
    }

    if (!upstream.ok) {
      res.status(502).json({ error: 'bad_gateway', upstreamStatus: upstream.status });
      return;
    }

    const body = await upstream.buffer();
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const etag = upstream.headers.get('etag') || '';
    const lastModified = upstream.headers.get('last-modified') || new Date().toUTCString();
    const ttlSeconds = parseMaxAge(upstream.headers.get('cache-control')) ?? 30;

    const entry: CacheEntry = { body, contentType, etag, lastModified, storedAt: Date.now(), ttlSeconds };
    cache.set(cacheKey, entry);

    const latency = Date.now() - start;
    metrics.recordMiss(latency);
    res.status(200).set({
      'Content-Type': contentType,
      ETag: etag,
      'Last-Modified': lastModified,
      'X-MiniCDN-Cache': 'MISS',
      'X-MiniCDN-Node': NODE_ID,
      'X-MiniCDN-Latency-Ms': String(latency),
    });
    res.send(body);
  } catch (err) {
    console.error(`[edge:${NODE_ID}] origin fetch failed`, err);
    res.status(502).json({ error: 'origin_unreachable' });
  }
});

function parseMaxAge(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const match = cacheControl.match(/max-age=(\d+)/);
  return match ? Number(match[1]) : null;
}

app.listen(PORT, () => {
  console.log(`[edge:${NODE_ID}] listening on :${PORT} (region=${REGION}, origin=${ORIGIN_URL}, maxEntries=${MAX_CACHE_ENTRIES})`);
});
