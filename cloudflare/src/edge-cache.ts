/**
 * Which proxied requests and responses may be kept in the Cloudflare edge cache
 * (`caches.default`), which the Worker keys on the public eggz.ai URL alone.
 *
 * A URL-only key is only safe while every entry under it is (a) the same bytes
 * every visitor should get and (b) reachable by `scripts/purge-help-cache.mjs`,
 * which purges exactly the sitemap URLs. The two rules below hold that line.
 */

/**
 * Headers Next.js sends on a client-router prefetch. Mintlify is a Next.js app,
 * so the SAME URL answers a navigation with `text/html` and a prefetch with a
 * `text/x-component` flight payload — hence its
 * `vary: rsc, next-router-state-tree, next-router-prefetch, …`. The Cache API
 * does not honour Vary on these, so caching a prefetch would serve raw RSC text
 * to real visitors until the next purge. Prefetches skip the cache entirely.
 */
const PREFETCH_HEADERS: readonly string[] = [
  "rsc",
  "next-router-prefetch",
  "next-router-state-tree",
  "next-router-segment-prefetch",
];

/**
 * @param isStaticAsset whether the path is a content-hashed
 * `/mintlify-assets/_next/static/` asset, for which staleness is impossible and
 * a `?dpl=…` build id in the URL is therefore safe to cache under.
 */
export function isCacheableRequest(
  request: Pick<Request, "method" | "headers">,
  url: Pick<URL, "search">,
  isStaticAsset: boolean,
): boolean {
  if (request.method !== "GET") return false;
  if (PREFETCH_HEADERS.some((h) => request.headers.has(h))) return false;
  // A `?utm_source=…` variant gets its own cache entry that the purge script —
  // which only knows the sitemap URLs — can never evict, so it would survive
  // every docs merge and serve stale content for the full 24 hours.
  if (url.search && !isStaticAsset) return false;
  return true;
}

/**
 * Only successful, visitor-identical responses are stored: a `Set-Cookie` would
 * otherwise be replayed from the cache to every subsequent visitor.
 */
export function isCacheableResponse(
  response: Pick<Response, "status" | "headers">,
): boolean {
  return response.status === 200 && !response.headers.has("set-cookie");
}
