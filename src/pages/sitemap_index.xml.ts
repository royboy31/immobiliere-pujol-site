// Sitemap index — matches live WP sitemap_index.xml structure.
// Lists all child sitemaps by type, with dynamic ads sitemap pagination.
// Reads annonce count from pre-built JSON + R2 to compute page count.
export const prerender = false;

import type { APIRoute } from 'astro';
import { SITE, adsPageCount, fetchAllAnnonceSlugs, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = async ({ request }) => {
  // Load static annonce slugs from pre-built JSON
  const origin = new URL(request.url).origin;
  let staticSlugs: string[] = [];
  try {
    const resp = await fetch(`${origin}/_data/sitemap-slugs.json`);
    if (resp.ok) {
      const data = (await resp.json()) as { annonces: string[] };
      staticSlugs = data.annonces;
    }
  } catch { /* skip */ }

  const { allSlugs } = await fetchAllAnnonceSlugs(staticSlugs, request.url);
  const totalAdsPages = adsPageCount(allSlugs.length);
  const today = new Date().toISOString().split('T')[0];

  const sitemaps: string[] = [];

  const sm = (loc: string, lastmod?: string) => {
    let xml = `  <sitemap>\n    <loc>${SITE}${loc}</loc>`;
    if (lastmod) xml += `\n    <lastmod>${lastmod}</lastmod>`;
    xml += `\n  </sitemap>`;
    sitemaps.push(xml);
  };

  // Match live WP sitemap index order exactly
  sm('/post-sitemap1.xml');
  sm('/page-sitemap1.xml');

  // Ads sitemaps (paginated, dynamic count)
  for (let i = 1; i <= totalAdsPages; i++) {
    sm(`/ads-sitemap${i}.xml`, today);
  }

  sm('/services-sitemap1.xml');
  sm('/category-sitemap1.xml');
  sm('/post_tag-sitemap1.xml');
  sm('/wpcf-code-post-sitemap1.xml');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.join('\n')}
</sitemapindex>`;

  return xmlResponse(xml);
};
