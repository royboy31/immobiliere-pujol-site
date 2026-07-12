// POST /api/admin-pujol/newsletter/preview  (guarded)
// Body: { template, data }  → returns the rendered email HTML (text/html).
// The composer shows it in an <iframe srcdoc>. No Brevo/worker involved.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { renderNewsletter, type NewsletterTemplate } from '../../../../lib/newsletter-template';

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const body = await request.json().catch(() => ({} as any));
  const template = (body.template || 'blog') as NewsletterTemplate;
  const data = body.data || {};
  try {
    const html = renderNewsletter(template, data);
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (e: any) {
    return new Response(`Erreur de rendu : ${e?.message || e}`, { status: 500 });
  }
};
