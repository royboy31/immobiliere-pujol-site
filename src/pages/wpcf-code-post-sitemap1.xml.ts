// Arrondissement sitemap — matches live WP wpcf-code-post-sitemap1.xml
// Reads slugs from pre-built sitemap-slugs.json (no import.meta.glob needed).
export const prerender = false;

import type { APIRoute } from 'astro';
import { entry, wrapUrlset, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = async ({ request }) => {
  const urls: string[] = [];

  try {
    const origin = new URL(request.url).origin;
    const resp = await fetch(`${origin}/_data/sitemap-slugs.json`);
    if (resp.ok) {
      const data = (await resp.json()) as { arrondissements: string[] };
      for (const slug of data.arrondissements) {
        urls.push(entry(`/arrondissement/${slug}/`));
      }
    }
  } catch { /* skip */ }

  return xmlResponse(wrapUrlset(urls));
};
