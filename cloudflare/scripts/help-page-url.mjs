/**
 * Repo path of a Help Centre page → the URL it is published at.
 *
 * Used to purge pages a merge DELETED or RENAMED. Those are exactly the URLs the
 * post-rebuild sitemap can no longer name, yet their cached copies are still
 * live, so without this the old page would keep being served for the rest of the
 * 24-hour edge TTL.
 *
 * The rule is verified against production: applied to all 38 `help/**\/*.mdx`
 * files it reproduces the 38 URLs in https://eggz.ai/help/sitemap.xml exactly.
 */

const PUBLIC_ORIGIN = "https://eggz.ai";

/**
 * @param {string} repoPath e.g. `help/guides/dashboard.mdx`
 * @returns {string | null} the published URL, or null if the path is not a
 * published help page (so callers can ignore images, snippets and the like).
 */
export function helpPageUrl(repoPath) {
  const path = repoPath.trim();
  if (!path.startsWith("help/") || !path.endsWith(".mdx")) return null;

  let slug = path.slice("help/".length, -".mdx".length);
  // Mintlify serves a directory's `index` at the directory itself.
  if (slug === "index") return `${PUBLIC_ORIGIN}/help`;
  if (slug.endsWith("/index")) slug = slug.slice(0, -"/index".length);

  return `${PUBLIC_ORIGIN}/help/${slug}`;
}

/**
 * @param {string} paths whitespace- or newline-separated repo paths
 * @returns {string[]} deduplicated published URLs
 */
export function helpPageUrls(paths) {
  const urls = paths
    .split(/\s+/)
    .filter(Boolean)
    .map(helpPageUrl)
    .filter((u) => u !== null);
  return [...new Set(urls)];
}
