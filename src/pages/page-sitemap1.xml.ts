// Page sitemap — matches live WP page-sitemap1.xml
// Reads slugs from pre-built sitemap-slugs.json (no import.meta.glob needed).
export const prerender = false;

import type { APIRoute } from 'astro';
import { entry, wrapUrlset, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = async ({ request }) => {
  const urls: string[] = [];

  // Core pages (matching live WP page-sitemap)
  urls.push(entry('/'));
  urls.push(entry('/contact-immobiliere-pujol/'));
  urls.push(entry('/estimez-le-prix-de-vente-de-votre-bien-en-2mn/'));
  urls.push(entry('/experts/'));
  urls.push(entry('/services/'));
  urls.push(entry('/annonces/'));
  urls.push(entry('/annonces/locations/'));
  urls.push(entry('/annonces/ventes/'));
  urls.push(entry('/local/'));

  try {
    const origin = new URL(request.url).origin;
    const resp = await fetch(`${origin}/_data/sitemap-slugs.json`);
    if (resp.ok) {
      const data = (await resp.json()) as {
        pages: string[];
        experts: string[];
        serviceImmobilier: string[];
      };

      // Service immobilier pages
      for (const slug of data.serviceImmobilier) {
        urls.push(entry(`/service-immobilier/${slug}/`));
      }

      // Content pages
      for (const slug of data.pages) {
        urls.push(entry(`/${slug}/`));
      }

      // Expert individual pages
      for (const slug of data.experts) {
        urls.push(entry(`/experts/${slug}/`));
      }
    }
  } catch { /* skip */ }

  return xmlResponse(wrapUrlset(urls));
};
