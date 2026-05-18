// Shared sitemap helpers — used by all sitemap route handlers.

export const SITE = 'https://www.immobiliere-pujol.fr';
export const ADS_PER_PAGE = 1000;
const R2_ACTIVE = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev/annonces/active.json';

/** Build a single <url> entry (loc + optional lastmod only — matches live WP output). */
export function entry(loc: string, lastmod?: string): string {
  let xml = `  <url>\n    <loc>${SITE}${loc}</loc>`;
  if (lastmod) xml += `\n    <lastmod>${lastmod}</lastmod>`;
  xml += `\n  </url>`;
  return xml;
}

/** Build a <url> entry with an image (used for posts/articles). */
export function entryWithImage(loc: string, lastmod?: string, imageUrl?: string, imageTitle?: string): string {
  let xml = `  <url>\n    <loc>${SITE}${loc}</loc>`;
  if (lastmod) xml += `\n    <lastmod>${lastmod}</lastmod>`;
  if (imageUrl) {
    xml += `\n    <image:image>\n      <image:loc>${escapeXml(imageUrl)}</image:loc>`;
    if (imageTitle) xml += `\n      <image:title>${escapeXml(imageTitle)}</image:title>`;
    xml += `\n    </image:image>`;
  }
  xml += `\n  </url>`;
  return xml;
}

/** Wrap URL entries in a <urlset>. */
export function wrapUrlset(entries: string[], imageNs = false): string {
  const nsImage = imageNs ? '\n\txmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${nsImage}>\n${entries.join('\n')}\n</urlset>`;
}

/** Standard XML response headers. */
export function xmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/** Escape special XML characters. */
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Extract slugs from glob import keys. */
export function extractSlugs(modules: Record<string, unknown>): string[] {
  return Object.keys(modules).map(path => {
    const file = path.split('/').pop() || '';
    return file.replace(/\.(md|json|mdx)$/, '');
  });
}

/**
 * Fetch all annonce slugs: active from R2 + all static from build-time content.
 * Returns { activeSlugs: Set, allSlugs: string[] } sorted by slug.
 */
export async function fetchAllAnnonceSlugs(
  staticSlugs: string[],
  requestUrl: string,
): Promise<{ activeSlugs: Map<string, string>; allSlugs: string[] }> {
  // Active annonces from R2 — includes slug + date
  const activeSlugs = new Map<string, string>();
  try {
    const resp = await fetch(R2_ACTIVE);
    if (resp.ok) {
      const annonces = (await resp.json()) as Array<{ slug: string; date?: string }>;
      for (const a of annonces) {
        activeSlugs.set(a.slug, a.date || '');
      }
    }
  } catch { /* skip */ }

  // Merge static slugs (from content collection) with active slugs
  const allSet = new Set<string>([...activeSlugs.keys(), ...staticSlugs]);
  const allSlugs = [...allSet].sort();

  return { activeSlugs, allSlugs };
}

/** Compute how many ads sitemap pages are needed. */
export function adsPageCount(totalAds: number): number {
  return Math.max(1, Math.ceil(totalAds / ADS_PER_PAGE));
}

/** Generate ads sitemap XML for a specific page number. */
export async function generateAdsSitemap(page: number, requestUrl: string): Promise<Response> {
  // Load static annonce slugs from pre-built JSON
  const origin = new URL(requestUrl).origin;
  let staticSlugs: string[] = [];
  try {
    const resp = await fetch(`${origin}/_data/sitemap-slugs.json`);
    if (resp.ok) {
      const data = (await resp.json()) as { annonces: string[] };
      staticSlugs = data.annonces;
    }
  } catch { /* skip */ }

  const { activeSlugs, allSlugs } = await fetchAllAnnonceSlugs(staticSlugs, requestUrl);

  const start = (page - 1) * ADS_PER_PAGE;
  const end = start + ADS_PER_PAGE;

  if (start >= allSlugs.length) {
    return new Response('Not found', { status: 404 });
  }

  const pageSlugs = allSlugs.slice(start, end);
  const urls: string[] = [];

  if (page === 1) {
    urls.push(entry('/annonces/'));
  }

  for (const slug of pageSlugs) {
    const activeDate = activeSlugs.get(slug);
    const lastmod = activeDate || undefined;
    urls.push(entry(`/annonces/${slug}/`, lastmod));
  }

  return xmlResponse(wrapUrlset(urls));
}
