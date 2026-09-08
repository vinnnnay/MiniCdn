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

app.get('/assets/*', (req: Request, res: Response) => {
  const key = req.params[0];
  const asset = store.get(key);

  if (!asset) {
    res.status(404).json({ error: 'not_found', key });
    return;
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
