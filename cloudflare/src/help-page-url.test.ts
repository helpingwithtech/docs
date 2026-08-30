import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error — plain JS helper shared with the purge script, no types.
import { helpPageUrl, helpPageUrls } from "../scripts/help-page-url.mjs";

test("a page maps to the URL it is published at", () => {
  assert.equal(
    helpPageUrl("help/guides/dashboard.mdx"),
    "https://eggz.ai/help/guides/dashboard",
  );
});

test("index pages map to their directory", () => {
  assert.equal(helpPageUrl("help/index.mdx"), "https://eggz.ai/help");
  assert.equal(
    helpPageUrl("help/unscrambled-tabs/index.mdx"),
    "https://eggz.ai/help/unscrambled-tabs",
  );
});

test("non-page files are ignored", () => {
  for (const path of [
    "docs.json",
    "help/logo/dark.svg",
    "cloudflare/src/proxy.ts",
    "README.md",
  ]) {
    assert.equal(helpPageUrl(path), null, path);
  }
});

test("a diff's worth of removed paths becomes a deduplicated URL list", () => {
  const urls = helpPageUrls(
    "help/guides/old-page.mdx\nhelp/logo/dark.svg\nhelp/guides/old-page.mdx\n\nhelp/index.mdx\n",
  );
  assert.deepEqual(urls, [
    "https://eggz.ai/help/guides/old-page",
    "https://eggz.ai/help",
  ]);
});

test("empty input yields nothing to purge", () => {
  assert.deepEqual(helpPageUrls(""), []);
  assert.deepEqual(helpPageUrls("\n  \n"), []);
});
