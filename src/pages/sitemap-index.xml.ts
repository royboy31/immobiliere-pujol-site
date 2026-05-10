// Sitemap index — points to the main sitemap.
// Matches the URL referenced in Footer.astro
export const prerender = false;

import type { APIRoute } from 'astro';

const SITE = 'https://www.immobiliere-pujol.fr';

export const GET: APIRoute = async () => {
  const today = new Date().toISOString().split('T')[0];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${SITE}/sitemap.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
