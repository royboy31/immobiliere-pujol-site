// Ads sitemap page 2 — auto-generated, uses shared handler.
export const prerender = false;
import type { APIRoute } from 'astro';
import { generateAdsSitemap } from '../lib/sitemap';
export const GET: APIRoute = async ({ request }) => generateAdsSitemap(2, request.url);
