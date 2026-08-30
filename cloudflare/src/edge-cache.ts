/**
 * What the Worker may keep in the Cloudflare edge cache (`caches.default`), and
 * under which key.
 *
 * The cache is only as safe as the purge script that empties it. That script
 * (`scripts/purge-help-cache.mjs`) evicts help page URLs by name, so anything
 * cached under a key it cannot name would sit there stale for the full 24-hour
 * TTL. Everything below exists to keep those two sets identical.
 */

const PUBLIC_ORIGIN = "https://eggz.ai";

/** Content-hashed Next.js assets: the URL changes whenever the bytes do. */
const STATIC_ASSET_PREFIX = "/mintlify-assets/_next/static/";

/**
 * How a proxied path may be cached.
 *
 * - `document` — a Help Centre page, sitemap or llms file. Cacheable, and the
 *   purge script knows its URL.
 * - `static-asset` — a content-hashed asset. Cacheable and never stale, so it
 *   needs no purge entry.
 * - `never` — Mintlify service routes (`/_mintlify/*`), generated agent skills
 *   (`/skill.md`, `/.well-known/skills/*`) and domain verification
 *   (`/.well-known/vercel/*`). Mintlify's own guidance is to cache none of
 *   these, and none appear in the purge inventory, so a stored copy could
 *   outlive a docs merge or a domain change by a day.
 */
export type CacheClass = "document" | "static-asset" | "never";

export function classifyCachePath(pathname: string): CacheClass {
  if (pathname.startsWith(STATIC_ASSET_PREFIX)) return "static-asset";
  if (pathname === "/help" || pathname.startsWith("/help/")) return "document";
  return "never";
}

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

export function isCacheableRequest(
  request: Pick<Request, "method" | "headers">,
  cacheClass: CacheClass,
): boolean {
  if (cacheClass === "never") return false;
  if (request.method !== "GET") return false;
  return !PREFETCH_HEADERS.some((h) => request.headers.has(h));
}

/**
 * The URL a response is stored under.
 *
 * Documents drop the query string so that one arrival with `?utm_source=…` or
 * `?gclid=…` shares the entry the purge script evicts by name — otherwise every
 * campaign link would build its own unpurgeable copy, and first-time visitors,
 * who are the likeliest to arrive with tracking parameters, would be the only
 * ones never served from cache. Mintlify renders these pages from a
 * `[[...slug]]` route that ignores the query: `/help/index` and
 * `/help/index?utm_source=newsletter&gclid=abc123` were verified byte-identical.
 *
 * Static assets keep their query, because the `?dpl=…` build id is what makes
 * one immutable asset distinct from the next.
 */
export function edgeCacheKeyUrl(
  url: Pick<URL, "pathname" | "search">,
  cacheClass: CacheClass,
): string {
  if (cacheClass === "static-asset") {
    return `${PUBLIC_ORIGIN}${url.pathname}${url.search}`;
  }
  return `${PUBLIC_ORIGIN}${url.pathname}`;
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
