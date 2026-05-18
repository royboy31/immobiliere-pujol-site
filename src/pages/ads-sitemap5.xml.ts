// Ads sitemap page 5 — auto-generated, uses shared handler.
export const prerender = false;
import type { APIRoute } from 'astro';
import { generateAdsSitemap } from '../lib/sitemap';
export const GET: APIRoute = async ({ request }) => generateAdsSitemap(5, request.url);
