/**
 * Cache key design.
 *
 * Talking point (see docs/implementation.md §9): the cache key must reflect
 * everything that can change the response body, or you serve wrong content
 * from cache. We include the URL path and any query params (sorted, so
 * `?w=200&h=100` and `?h=100&w=200` hit the same cache entry), plus a
 * version-relevant header when present. We deliberately do NOT include
 * Accept-Encoding in this simplified version — content is served
 * uncompressed — but a production cache key would fold that in (or store
 * per-encoding variants) to avoid serving gzip bytes to a client that can't
 * decompress them.
 */
export function buildCacheKey(path: string, query: Record<string, string | string[] | undefined> = {}): string {
  const sortedParams = Object.keys(query)
    .filter((k) => query[k] !== undefined)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  return sortedParams ? `${path}?${sortedParams}` : path;
}
