/**
 * Throw away Cloudflare's saved copies of every Help Centre page so visitors
 * see freshly published content. Run after every docs merge and Worker deploy.
 *
 * Reads the page list from the live help sitemap, then purges those URLs from
 * the eggz.ai zone in batches of 30 (the API's per-request limit).
 *
 * The sitemap only lists pages that still exist, so a merge that DELETED or
 * RENAMED a page leaves its cached copy live for the rest of the 24-hour TTL.
 * REMOVED_HELP_PAGES carries those pages' repo paths (the workflow reads them
 * from the merge's own diff) so their URLs get purged too.
 *
 * Requires CLOUDFLARE_PURGE_TOKEN (a token scoped to Zone > Cache Purge on
 * eggz.ai only). Fails loudly if it is missing or a purge call fails.
 */

import { helpPageUrls } from "./help-page-url.mjs";

const ZONE_ID = "1699c41c1a1f4329cf16a8fe6fc01766"; // eggz.ai
const SITEMAP_URL = "https://eggz.ai/help/sitemap.xml";
const EXTRA_URLS = [
  "https://eggz.ai/help",
  "https://eggz.ai/help/sitemap.xml",
  "https://eggz.ai/help/llms.txt",
  "https://eggz.ai/help/llms-full.txt",
];
const BATCH_SIZE = 30;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const token = requireEnv("CLOUDFLARE_PURGE_TOKEN");

const sitemapResponse = await fetch(SITEMAP_URL);
if (!sitemapResponse.ok) {
  throw new Error(`Sitemap fetch failed: ${sitemapResponse.status} ${SITEMAP_URL}`);
}
const sitemapXml = await sitemapResponse.text();
const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim())
  .filter((u) => u.startsWith("https://eggz.ai/"));
if (sitemapUrls.length === 0) {
  throw new Error(`Sitemap at ${SITEMAP_URL} contained no eggz.ai URLs — refusing to purge nothing`);
}

// Pages this merge removed: absent from the sitemap above, still in the cache.
const removedUrls = helpPageUrls(process.env.REMOVED_HELP_PAGES ?? "");
if (removedUrls.length > 0) {
  console.log(`Also purging ${removedUrls.length} removed or renamed page(s):`);
  for (const url of removedUrls) console.log(`  ${url}`);
}

const urls = [...new Set([...sitemapUrls, ...EXTRA_URLS, ...removedUrls])];
console.log(`Purging ${urls.length} URLs from the eggz.ai edge cache…`);

for (let i = 0; i < urls.length; i += BATCH_SIZE) {
  const files = urls.slice(i, i + BATCH_SIZE);
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ files }),
    },
  );
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(`Purge batch failed (HTTP ${res.status}): ${JSON.stringify(body.errors)}`);
  }
  console.log(`  purged ${i + files.length}/${urls.length}`);
}

console.log("Done — every help page will be re-fetched fresh on its next visit.");
