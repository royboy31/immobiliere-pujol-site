import type { APIRoute } from 'astro';

// Dynamic robots.txt. Replaces the old static public/robots.txt so indexing is
// gated by the SAME signal as the noindex meta (BaseLayout: ALLOW_INDEXING) AND
// by host — so even with the flag on, only the real domain is crawlable and the
// *.workers.dev origin stays blocked.
export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  const host = new URL(request.url).host;
  const isProdDomain = /(^|\.)immobiliere-pujol\.fr$/i.test(host);
  const allow = Boolean(import.meta.env.ALLOW_INDEXING) && isProdDomain;

  const body = allow
    ? 'User-agent: *\nAllow: /\n\nSitemap: https://www.immobiliere-pujol.fr/sitemap_index.xml\n'
    : '# Indexing disabled (staging / non-production host)\nUser-agent: *\nDisallow: /\n';

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
