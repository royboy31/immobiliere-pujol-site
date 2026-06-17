// Phase-1 meta mirror for annonce (SSR) pages.
//
// The full annonce title/description map is ~2.3 MB. Parsing that on a cold isolate
// exceeds the Worker CPU limit (empty/503 responses). So the map is SHARDED into 64
// small files (public/seo-meta-annonces/<shard>.json, ~35 KB each) keyed by
// FNV-1a(slug) % 64. Each request fetches and parses only its one shard, memoized
// per isolate. See migration/build-seo-meta-json.py (must use the same hash).

import { hashString } from './internal-links';

interface SeoMeta { t: string; d: string }
type Assets = { fetch: (req: Request) => Promise<Response> } | undefined;

const SHARDS = 64;
const _cache = new Map<number, Record<string, SeoMeta>>();

/** Normalize a pathname to the map key: percent-decoded, trailing slash. */
function keyFor(pathname: string): string {
  return decodeURIComponent(pathname).replace(/\/?$/, '/');
}

/**
 * Live WP meta for an annonce, or null if not in the map (e.g. a listing created
 * after the scrape — caller falls back to the generated title/description).
 * `slug` selects the shard; `pathname` is the lookup key.
 */
export async function getAnnonceSeoMeta(
  assets: Assets,
  baseUrl: URL,
  slug: string,
  pathname: string,
): Promise<SeoMeta | null> {
  const shard = hashString(slug) % SHARDS;
  let map = _cache.get(shard);
  if (!map) {
    try {
      const url = new URL(`/seo-meta-annonces/${shard}.json`, baseUrl);
      const resp = assets
        ? await assets.fetch(new Request(url.toString()))
        : await fetch(url.toString());
      map = resp.ok ? ((await resp.json()) as Record<string, SeoMeta>) : {};
    } catch {
      map = {};
    }
    _cache.set(shard, map);
  }
  return map[keyFor(pathname)] ?? null;
}
