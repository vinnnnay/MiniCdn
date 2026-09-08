import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface StoredAsset {
  key: string;
  filePath: string;
  contentType: string;
  etag: string;
  lastModified: string;
  size: number;
}

const ASSETS_DIR = path.join(__dirname, '..', 'data', 'assets');

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

/**
 * Filesystem-backed "origin store". Section 4.1 of the plan notes S3 as an
 * alternative; local filesystem is the simplest thing that is still a real
 * durable store (vs. an in-memory map), and keeps the whole project
 * runnable with zero cloud credentials.
 */
export class OriginStore {
  private cache = new Map<string, StoredAsset>();

  constructor(private assetsDir: string = ASSETS_DIR) {
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
    }
  }

  private computeEtag(buffer: Buffer): string {
    return `"${crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16)}"`;
  }

  /** Resolve an asset by key (e.g. "logo.png" or "api/config.json"). */
  get(key: string): StoredAsset | null {
    const safeKey = key.replace(/\.\./g, '');
    const filePath = path.join(this.assetsDir, safeKey);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return null;
    }

    const stat = fs.statSync(filePath);
    const cached = this.cache.get(safeKey);
    if (cached && cached.lastModified === stat.mtime.toUTCString()) {
      return cached;
    }

    const buffer = fs.readFileSync(filePath);
    const asset: StoredAsset = {
      key: safeKey,
      filePath,
      contentType: contentTypeFor(filePath),
      etag: this.computeEtag(buffer),
      lastModified: stat.mtime.toUTCString(),
      size: stat.size,
    };
    this.cache.set(safeKey, asset);
    return asset;
  }

  readBuffer(asset: StoredAsset): Buffer {
    return fs.readFileSync(asset.filePath);
  }

  list(): string[] {
    return this.walk(this.assetsDir).map((p) => path.relative(this.assetsDir, p));
  }

  private walk(dir: string): string[] {
    let results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(this.walk(full));
      } else {
        results.push(full);
      }
    }
    return results;
  }

  invalidate(key: string) {
    this.cache.delete(key);
  }
}
