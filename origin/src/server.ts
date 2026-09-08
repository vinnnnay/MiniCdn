import express, { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import Redis from 'ioredis';
import { OriginStore } from './store';
import { PurgeMessage } from '@minicdn/shared';

const PORT = Number(process.env.PORT || 4000);
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const PURGE_CHANNEL = 'minicdn:purge';
// Default TTL applied to all served assets, in seconds. Real CDNs let each
// asset declare its own via response headers set at upload time; here we
// use one default plus a per-request override for demo purposes.
const DEFAULT_MAX_AGE = Number(process.env.DEFAULT_MAX_AGE_SECONDS || 30);

/**
 * Simulated client→origin network latency, in milliseconds.
 *
 * Why this exists: everything in this project runs on one machine, so there
 * is no real network distance anywhere. The edge nodes already fake their
 * own distance to the origin (SIMULATED_ORIGIN_LATENCY_MS, applied on a
 * cache miss) — but without this, a client hitting the origin DIRECTLY pays
 * no distance at all, which makes the origin look artificially fast and the
 * CDN look pointless (it measures as pure added overhead).
 *
 * A CDN's entire advantage comes from the client being far from the origin
 * and near an edge. Modelling only the edge→origin leg and leaving
 * client→origin at zero measures the overhead without the benefit, so the
 * benchmark in load-tests/benchmark.js reports a *negative* latency
 * reduction. This constant closes that gap.
 *
 * It is applied ONLY to direct client requests. Requests from an edge node
 * (identified by the X-MiniCDN-Edge header the edge sends) skip it, because
 * the edge has already applied its own region-specific delay for that same
 * long-haul leg — applying both would double-count it.
 *
 * The default (110ms) matches the Asia edge's SIMULATED_ORIGIN_LATENCY_MS,
 * i.e. it represents a far-from-origin client such as the `singapore`
 * benchmark location: that client and the Singapore edge are roughly
 * equidistant from a US origin. If you benchmark with a different
 * CLIENT_LOC, set this to that region's edge value (40 US / 70 EU / 110
 * Asia) so the comparison stays apples-to-apples.
 */
const SIMULATED_CLIENT_LATENCY_MS = Number(process.env.SIMULATED_CLIENT_LATENCY_MS || 110);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const app = express();
const store = new OriginStore();
const publisher = new Redis(REDIS_URL);

app.use(cors());
app.use(morgan('tiny'));
app.use(express.json());

let purgesSent = 0;
const startedAt = Date.now();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'origin', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
});

app.get('/assets/*', async (req: Request, res: Response) => {
  const key = req.params[0];
  const asset = store.get(key);

  if (!asset) {
    res.status(404).json({ error: 'not_found', key });
    return;
  }

  // Model the client→origin long-haul leg (see SIMULATED_CLIENT_LATENCY_MS).
  // Edge nodes identify themselves and are exempt: they already paid their
  // own simulated distance for this leg before calling us.
  const fromEdge = Boolean(req.header('X-MiniCDN-Edge'));
  if (!fromEdge && SIMULATED_CLIENT_LATENCY_MS > 0) {
    await sleep(SIMULATED_CLIENT_LATENCY_MS);
  }

  const maxAge = Number(req.query.maxAge) || DEFAULT_MAX_AGE;

  // Conditional GET support (ETag / If-None-Match) — same mechanism a real
  // origin uses so edges (and browsers) can revalidate cheaply.
  const ifNoneMatch = req.header('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === asset.etag) {
    res.status(304).set({
      ETag: asset.etag,
      'Cache-Control': `public, max-age=${maxAge}`,
    }).end();
    return;
  }

  const buffer = store.readBuffer(asset);
  res.status(200).set({
    'Content-Type': asset.contentType,
    'Content-Length': String(buffer.length),
    ETag: asset.etag,
    'Last-Modified': asset.lastModified,
    'Cache-Control': `public, max-age=${maxAge}`,
    'X-MiniCDN-Origin': 'true',
  });
  res.send(buffer);
});

app.get('/admin/assets', (_req, res) => {
  res.json({ assets: store.list() });
});

app.post('/admin/purge/*', async (req: Request, res: Response) => {
  const key = req.params[0];
  store.invalidate(key);

  const message: PurgeMessage = {
    action: 'purge',
    key,
    publishedAt: Date.now(),
  };

  const subscriberCount = await publisher.publish(PURGE_CHANNEL, JSON.stringify(message));
  purgesSent += 1;

  res.json({
    purged: key,
    channel: PURGE_CHANNEL,
    subscribersNotified: subscriberCount,
    publishedAt: message.publishedAt,
  });
});

app.get('/admin/stats', (_req, res) => {
  res.json({ purgesSent, assetCount: store.list().length });
});

app.listen(PORT, () => {
  console.log(`[origin] listening on :${PORT}`);
  console.log(`[origin] serving assets from data/assets — run "npm run seed --workspace=origin" if empty`);
});
