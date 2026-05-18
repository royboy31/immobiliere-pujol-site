// Ads (annonces) sitemap — matches live WP ads-sitemap1.xml through ads-sitemapN.xml
// Paginated at 1000 URLs per page. Fetches active annonces from R2 at request time.
// All annonce slugs come from pre-built sitemap-slugs.json (no glob import needed).
export const prerender = false;

import type { APIRoute } from 'astro';
import { ADS_PER_PAGE, entry, fetchAllAnnonceSlugs, wrapUrlset, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = async ({ params, request }) => {
  const page = parseInt(params.page || '1', 10);
  if (isNaN(page) || page < 1) {
    return new Response('Not found', { status: 404 });
  }

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

  const { activeSlugs, allSlugs } = await fetchAllAnnonceSlugs(staticSlugs, request.url);

  // Paginate
  const start = (page - 1) * ADS_PER_PAGE;
  const end = start + ADS_PER_PAGE;

  if (start >= allSlugs.length) {
    return new Response('Not found', { status: 404 });
  }

  const pageSlugs = allSlugs.slice(start, end);
  const urls: string[] = [];

  // Add the /annonces/ listing page on the first page only
  if (page === 1) {
    urls.push(entry('/annonces/'));
  }

  for (const slug of pageSlugs) {
    const activeDate = activeSlugs.get(slug);
    const lastmod = activeDate || undefined;
    urls.push(entry(`/annonces/${slug}/`, lastmod));
  }

  return xmlResponse(wrapUrlset(urls));
};
