// Phase-1 meta mirror for annonce (SSR) pages.
//
// The annonce title/description map is large (~2.3 MB), so it must NOT be bundled
// into the Worker (that exceeds the size/startup limit). Instead it is served as a
// static asset (public/seo-meta-annonces.json) and loaded here at runtime via
// env.ASSETS.fetch, memoized per isolate so it is fetched + parsed only once.
//
// See migration/seo-meta.csv + migration/build-seo-meta-json.py.

interface SeoMeta { t: string; d: string }
type Assets = { fetch: (req: Request) => Promise<Response> } | undefined;

let _cache: Record<string, SeoMeta> | null = null;

/** Normalize a pathname to the map key: percent-decoded, trailing slash. */
function keyFor(pathname: string): string {
  return decodeURIComponent(pathname).replace(/\/?$/, '/');
}

/**
 * Live WP meta for an annonce path, or null if not in the map (e.g. a listing
 * created after the scrape — caller falls back to the generated title/description).
 */
export async function getAnnonceSeoMeta(
  assets: Assets,
  baseUrl: URL,
  pathname: string,
): Promise<SeoMeta | null> {
  if (_cache === null) {
    try {
      const url = new URL('/seo-meta-annonces.json', baseUrl);
      const resp = assets
        ? await assets.fetch(new Request(url.toString()))
        : await fetch(url.toString());
      _cache = resp.ok ? ((await resp.json()) as Record<string, SeoMeta>) : {};
    } catch {
      _cache = {};
    }
  }
  return _cache[keyFor(pathname)] ?? null;
}
