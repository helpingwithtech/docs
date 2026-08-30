import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCachePath,
  edgeCacheKeyUrl,
  isCacheableRequest,
  isCacheableResponse,
} from "./edge-cache.ts";

function req(method: string, headers: Record<string, string> = {}) {
  return { method, headers: new Headers(headers) };
}

test("help pages and their sitemap/llms files are cacheable documents", () => {
  for (const path of [
    "/help",
    "/help/index",
    "/help/guides/dashboard",
    "/help/sitemap.xml",
    "/help/llms-full.txt",
  ]) {
    assert.equal(classifyCachePath(path), "document", path);
  }
});

test("hashed Next.js assets are their own class", () => {
  assert.equal(
    classifyCachePath("/mintlify-assets/_next/static/chunks/a.js"),
    "static-asset",
  );
});

test("routes with no purge entry are never cached", () => {
  // Mintlify designates these no-cache, and the purge script cannot name them,
  // so a stored copy would outlive a docs merge or a domain change by a day.
  for (const path of [
    "/skill.md",
    "/.well-known/skills/index.json",
    "/.well-known/vercel/domain-verification",
    "/_mintlify/api/search",
  ]) {
    assert.equal(classifyCachePath(path), "never", path);
  }
});

test("a plain page GET is cacheable", () => {
  assert.equal(isCacheableRequest(req("GET"), "document"), true);
});

test("non-GET methods are never cached", () => {
  for (const method of ["POST", "HEAD", "PUT"]) {
    assert.equal(isCacheableRequest(req(method), "document"), false, method);
  }
});

test("Next.js prefetches never share the page's cache entry", () => {
  // Mintlify answers the same URL with text/x-component when these are present.
  for (const header of [
    "RSC",
    "Next-Router-Prefetch",
    "Next-Router-State-Tree",
    "Next-Router-Segment-Prefetch",
  ]) {
    assert.equal(
      isCacheableRequest(req("GET", { [header]: "1" }), "document"),
      false,
      header,
    );
  }
});

test("a never-cached route stays out even for a plain GET", () => {
  assert.equal(isCacheableRequest(req("GET"), "never"), false);
});

test("tracking parameters share the page's cache entry", () => {
  // Verified against production: /help/index and
  // /help/index?utm_source=newsletter&gclid=abc123 are byte-identical, so a
  // campaign link is served from the same entry the purge script evicts.
  const bare = edgeCacheKeyUrl(
    new URL("https://eggz.ai/help/index"),
    "document",
  );
  const tracked = edgeCacheKeyUrl(
    new URL("https://eggz.ai/help/index?utm_source=newsletter&gclid=abc123"),
    "document",
  );
  assert.equal(bare, "https://eggz.ai/help/index");
  assert.equal(tracked, bare);
});

test("hashed assets keep their build id in the cache key", () => {
  const url = new URL(
    "https://eggz.ai/mintlify-assets/_next/static/chunks/a.js?dpl=dpl_1",
  );
  assert.equal(
    edgeCacheKeyUrl(url, "static-asset"),
    "https://eggz.ai/mintlify-assets/_next/static/chunks/a.js?dpl=dpl_1",
  );
});

test("only 200s without Set-Cookie are stored", () => {
  assert.equal(isCacheableResponse({ status: 200, headers: new Headers() }), true);
  assert.equal(isCacheableResponse({ status: 404, headers: new Headers() }), false);
  assert.equal(isCacheableResponse({ status: 302, headers: new Headers() }), false);
  assert.equal(
    isCacheableResponse({
      status: 200,
      headers: new Headers({ "set-cookie": "a=b" }),
    }),
    false,
  );
});
