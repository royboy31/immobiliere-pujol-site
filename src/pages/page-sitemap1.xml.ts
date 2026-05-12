// Page sitemap — matches live WP page-sitemap1.xml
// Includes static pages, experts, and service-immobilier pages.
export const prerender = false;

import type { APIRoute } from 'astro';
import { entry, extractSlugs, wrapUrlset, xmlResponse } from '../lib/sitemap';

const pageSlugs = extractSlugs(import.meta.glob('/src/content/pages/*.md', { eager: false }));
const expertSlugs = extractSlugs(import.meta.glob('/src/content/experts/*.json', { eager: false }));
const serviceImmoSlugs = extractSlugs(import.meta.glob('/src/content/serviceImmobilier/*.md', { eager: false }));

export const GET: APIRoute = async () => {
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

  // Service immobilier pages
  urls.push(entry('/service-immobilier/agence-immobiliere-pujol/'));
  urls.push(entry('/service-immobilier/gestion-locative/'));
  urls.push(entry('/service-immobilier/mettre-en-location/'));
  urls.push(entry('/service-immobilier/syndic-de-copropriete-a-marseille/'));
  for (const slug of serviceImmoSlugs) {
    // Skip the ones already listed above
    if (['agence-immobiliere-pujol', 'gestion-locative', 'mettre-en-location', 'syndic-de-copropriete-a-marseille'].includes(slug)) continue;
    urls.push(entry(`/service-immobilier/${slug}/`));
  }

  // Content pages
  for (const slug of pageSlugs) {
    urls.push(entry(`/${slug}/`));
  }

  // Expert individual pages
  for (const slug of expertSlugs) {
    urls.push(entry(`/experts/${slug}/`));
  }

  return xmlResponse(wrapUrlset(urls));
};
