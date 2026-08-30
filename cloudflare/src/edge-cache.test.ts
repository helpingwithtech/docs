import assert from "node:assert/strict";
import test from "node:test";

import { isCacheableRequest, isCacheableResponse } from "./edge-cache.ts";

function req(method: string, headers: Record<string, string> = {}) {
  return { method, headers: new Headers(headers) };
}

test("a plain page GET is cacheable", () => {
  assert.equal(
    isCacheableRequest(req("GET"), new URL("https://eggz.ai/help/index"), false),
    true,
  );
});

test("non-GET methods are never cached", () => {
  for (const method of ["POST", "HEAD", "PUT"]) {
    assert.equal(
      isCacheableRequest(req(method), new URL("https://eggz.ai/help"), false),
      false,
      `${method} must not be cached`,
    );
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
      isCacheableRequest(
        req("GET", { [header]: "1" }),
        new URL("https://eggz.ai/help"),
        false,
      ),
      false,
      `${header} must bypass the cache`,
    );
  }
});

test("query-string page variants are not cached — the purge script cannot evict them", () => {
  assert.equal(
    isCacheableRequest(
      req("GET"),
      new URL("https://eggz.ai/help/index?utm_source=newsletter"),
      false,
    ),
    false,
  );
});

test("hashed static assets stay cacheable despite their ?dpl= build id", () => {
  assert.equal(
    isCacheableRequest(
      req("GET"),
      new URL("https://eggz.ai/mintlify-assets/_next/static/chunks/a.js?dpl=dpl_1"),
      true,
    ),
    true,
  );
});

test("only 200s without Set-Cookie are stored", () => {
  const ok = { status: 200, headers: new Headers() };
  assert.equal(isCacheableResponse(ok), true);
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
