/**
 * eggz.ai help path — reverse proxy to Mintlify (`*.mintlify.app`).
 *
 * Mintlify serves docs under the `/help` prefix on the preview host. The Worker
 * forwards the browser path unchanged, except sitemap and llms files
 * that Mintlify keeps at the host root but we expose under `/help` on eggz.ai.
 *
 * Robots: `https://eggz.ai/robots.txt` is the **canonical** URL (200 with the bytes from
 * `src/robots-content.ts`). `https://eggz.ai/help/robots.txt` mirrors the same bytes for
 * convenience. There is no Vercel-side robots.txt — `app.eggz.ai` is auth-walled.
 *
 * HTML and XML responses rewrite mintlify.app URLs to `https://eggz.ai/help/…`.
 * Response headers rewrite `frame-ancestors` / drop `X-Frame-Options` so
 * `eggz.ai`, `app.eggz.ai` (and staging/preview/Vercel previews) can embed help in-app.
 *
 * Per Mintlify Cloudflare guidance: target `subdomain.mintlify.app`, omit Host,
 * set Origin and X-Forwarded-* headers, cache only hashed static under
 * `mintlify-assets/_next/static` (long Cache-Control on that prefix only).
 */

import { applyInAppEmbedHeaders } from "./embed-framing";
import { ROBOTS_TXT } from "./robots-content";

interface Env {
  MINTLIFY_ORIGIN: string;
}

const PUBLIC_ORIGIN = "https://eggz.ai";

const PROXIED_PREFIXES: readonly string[] = [
  "/help",
  "/.well-known/vercel/",
  "/.well-known/skills/",
  "/_mintlify/",
  "/mintlify-assets/_next/static/",
];

const PROXIED_EXACT: readonly string[] = ["/skill.md"];

function isApexMintlifyPath(pathname: string): boolean {
  return (
    pathname.startsWith("/mintlify-assets/") ||
    pathname.startsWith("/_mintlify/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/_next/")
  );
}

/** Browser paths under /help that Mintlify actually serves from the host root. */
const HELP_BROWSER_TO_UPSTREAM_ROOT: Readonly<Record<string, string>> = {
  "/help/sitemap.xml": "/sitemap.xml",
  "/help/llms.txt": "/llms.txt",
  "/help/llms-full.txt": "/llms-full.txt",
};

/**
 * Browser → Mintlify pathname. Default: identical (docs live under /help on
 * eggz.mintlify.app). Exceptions: SEO/LLM files Mintlify exposes at `/` on the
 * preview host but we surface under `/help/...` on eggz.ai.
 */
function upstreamPathname(browserPathname: string): string {
  const hit = HELP_BROWSER_TO_UPSTREAM_ROOT[browserPathname];
  if (hit) return hit;
  return browserPathname;
}

function shouldExposeUnderHelpOnPublicSite(pathname: string): boolean {
  if (!pathname || pathname === "/") return true;
  if (pathname === "/help" || pathname.startsWith("/help/")) return true;
  return !isApexMintlifyPath(pathname);
}

function mintlifyAbsoluteToPublic(absolute: string, mintlifyOrigin: string): string {
  let u: URL;
  try {
    u = new URL(absolute);
  } catch {
    return absolute;
  }
  if (u.hostname !== mintlifyOrigin) return absolute;

  const path = u.pathname;
  let publicPath = path;
  if (shouldExposeUnderHelpOnPublicSite(path)) {
    if (path === "/" || path === "") publicPath = "/help";
    else if (path === "/help" || path.startsWith("/help/")) publicPath = path;
    else publicPath = `/help${path.startsWith("/") ? "" : "/"}${path}`;
  }

  return `${PUBLIC_ORIGIN}${publicPath}${u.search}${u.hash}`;
}

function prefixHelpForRootRelative(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/help") ||
    isApexMintlifyPath(value)
  ) {
    return value;
  }
  return `/help${value}`;
}

function rewriteAttributeIfMintlifyAbsolute(
  el: Element,
  attr: string,
  mintlifyOrigin: string,
): void {
  const v = el.getAttribute(attr);
  if (!v) return;
  const httpsOrigin = `https://${mintlifyOrigin}`;
  const httpOrigin = `http://${mintlifyOrigin}`;
  let next = v;
  if (v.startsWith(httpsOrigin) || v.startsWith(httpOrigin)) {
    next = mintlifyAbsoluteToPublic(v, mintlifyOrigin);
  } else if (v.startsWith("/") && !v.startsWith("//")) {
    next = prefixHelpForRootRelative(v);
  }
  if (next !== v) el.setAttribute(attr, next);
}

class MintlifyUrlAttrRewriter {
  constructor(
    private readonly attr: string,
    private readonly mintlifyOrigin: string,
  ) {}
  element(el: Element) {
    rewriteAttributeIfMintlifyAbsolute(el, this.attr, this.mintlifyOrigin);
  }
}

function shouldProxy(pathname: string): boolean {
  if (PROXIED_EXACT.includes(pathname)) return true;
  return PROXIED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p === "/help" ? "/help/" : p),
  );
}

function isStaticAsset(pathname: string): boolean {
  return pathname.startsWith("/mintlify-assets/_next/static/");
}

function isHtml(contentType: string | null): boolean {
  return !!contentType && contentType.toLowerCase().startsWith("text/html");
}

function isXmlLike(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.includes("xml") || ct.includes("text/plain");
}

function rewriteLocationHeader(
  loc: string,
  mintlifyOrigin: string,
): string | null {
  try {
    if (loc.startsWith("/")) {
      const q = loc.indexOf("?");
      const pathOnly = q === -1 ? loc : loc.slice(0, q);
      const search = q === -1 ? "" : loc.slice(q);
      if (isApexMintlifyPath(pathOnly)) {
        return `${PUBLIC_ORIGIN}${pathOnly}${search}`;
      }
      if (pathOnly === "/" || pathOnly === "") {
        return `${PUBLIC_ORIGIN}/help${search}`;
      }
      if (pathOnly === "/help" || pathOnly.startsWith("/help/")) {
        return `${PUBLIC_ORIGIN}${pathOnly}${search}`;
      }
      return `${PUBLIC_ORIGIN}/help${pathOnly}${search}`;
    }
    const abs = new URL(loc);
    if (abs.hostname !== mintlifyOrigin) return null;
    return mintlifyAbsoluteToPublic(abs.toString(), mintlifyOrigin);
  } catch {
    return null;
  }
}

function rewritePlainTextMintlifyUrls(body: string, mintlifyOrigin: string): string {
  const esc = mintlifyOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`https?://${esc}[^\\s"'<>]*`, "g");
  return body.replace(re, (match) => mintlifyAbsoluteToPublic(match, mintlifyOrigin));
}

/**
 * Serve the single canonical robots.txt inline. The bytes live in
 * `src/robots-content.ts` and are bundled into the Worker, so editing them
 * requires a Worker deploy (which is the desired single-source-of-truth model).
 */
function serveCanonicalRobots(): Response {
  return new Response(ROBOTS_TXT, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/robots.txt" || url.pathname === "/help/robots.txt") {
      return serveCanonicalRobots();
    }

    if (!shouldProxy(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }

    // Edge cache, keyed on the public eggz.ai URL (not the Mintlify origin URL)
    // so the zone purge API can evict entries. Purged by
    // `scripts/purge-help-cache.mjs` after every docs merge and Worker deploy.
    const cacheable = request.method === "GET";
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    if (cacheable) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const out = new Response(hit.body, hit);
        out.headers.set("x-eggz-help-cache", "HIT");
        return out;
      }
    }

    const storeIfCacheable = (res: Response): Response => {
      if (cacheable && res.status === 200 && !res.headers.has("set-cookie")) {
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
      }
      return res;
    };

    const origin = env.MINTLIFY_ORIGIN;
    const upPath = upstreamPathname(url.pathname);
    const upstream = new URL(`https://${origin}${upPath}${url.search}`);

    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.delete("host");
    upstreamHeaders.set("Origin", `https://${origin}`);
    upstreamHeaders.set("X-Forwarded-Host", url.host);
    upstreamHeaders.set("X-Forwarded-Proto", "https");

    const clientIP = request.headers.get("CF-Connecting-IP");
    if (clientIP) {
      upstreamHeaders.set("X-Real-IP", clientIP);
      const xff = request.headers.get("X-Forwarded-For");
      upstreamHeaders.set(
        "X-Forwarded-For",
        xff ? `${xff}, ${clientIP}` : clientIP,
      );
    }

    const upstreamRequest = new Request(upstream.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? null
          : request.body,
      redirect: "manual",
    });

    const upstreamResponse = await fetch(upstreamRequest);

    const outHeaders = new Headers(upstreamResponse.headers);
    const loc = upstreamResponse.headers.get("Location");
    if (loc) {
      const nextLoc = rewriteLocationHeader(loc, origin);
      if (nextLoc) outHeaders.set("Location", nextLoc);
    }

    if (isStaticAsset(url.pathname)) {
      outHeaders.set("Cache-Control", "public, max-age=86400, immutable");
    } else {
      // Browsers revalidate after 5 minutes; the edge holds 24 hours
      // (s-maxage governs `caches.default`) and is purged on every docs merge.
      outHeaders.set("Cache-Control", "public, max-age=300, s-maxage=86400");
    }
    outHeaders.set("x-eggz-help-cache", "MISS");

    // In-app Help Centre (app.eggz.ai iframe): Mintlify denies all embeds by default.
    applyInAppEmbedHeaders(outHeaders);

    const contentType = upstreamResponse.headers.get("content-type");

    if (isHtml(contentType)) {
      const rewriter = new HTMLRewriter()
        .on('link[rel="canonical"]', new MintlifyUrlAttrRewriter("href", origin))
        .on('link[rel="alternate"]', new MintlifyUrlAttrRewriter("href", origin))
        .on('meta[property="og:url"]', new MintlifyUrlAttrRewriter("content", origin))
        .on('meta[name="twitter:url"]', new MintlifyUrlAttrRewriter("content", origin))
        .on("a[href]", new MintlifyUrlAttrRewriter("href", origin))
        .on("link[href]", new MintlifyUrlAttrRewriter("href", origin))
        .on("script[src]", new MintlifyUrlAttrRewriter("src", origin))
        .on("img[src]", new MintlifyUrlAttrRewriter("src", origin))
        .on("form[action]", new MintlifyUrlAttrRewriter("action", origin));

      return storeIfCacheable(
        rewriter.transform(
          new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: outHeaders,
          }),
        ),
      );
    }

    if (
      isXmlLike(contentType) &&
      (url.pathname.endsWith("/sitemap.xml") ||
        url.pathname.endsWith("/robots.txt") ||
        url.pathname.endsWith(".xml"))
    ) {
      const text = await upstreamResponse.text();
      const rewritten = rewritePlainTextMintlifyUrls(text, origin);
      return storeIfCacheable(
        new Response(rewritten, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: outHeaders,
        }),
      );
    }

    return storeIfCacheable(
      new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: outHeaders,
      }),
    );
  },
};
