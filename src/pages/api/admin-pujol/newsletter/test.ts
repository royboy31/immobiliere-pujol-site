// POST /api/admin-pujol/newsletter/test  (guarded)
// Body: { template, data, subject, testEmail? } → renders HTML and asks the email
// worker to send a single [TEST] email (transactional). Defaults to the logged-in
// admin's address. Returns 501 if the worker/Brevo isn't configured yet.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { renderNewsletter, type NewsletterTemplate } from '../../../../lib/newsletter-template';
import { callWorker } from '../../../../lib/newsletter-worker';

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const body = await request.json().catch(() => ({} as any));
  const template = (body.template || 'blog') as NewsletterTemplate;
  const subject = (body.subject || body.data?.subject || 'Newsletter').trim();
  const testEmail = (body.testEmail || admin).trim();

  let html: string;
  try {
    html = renderNewsletter(template, body.data || {});
  } catch (e: any) {
    return Response.json({ ok: false, error: `Rendu impossible : ${e?.message || e}` }, { status: 500 });
  }

  const r = await callWorker('/newsletter/test', { testEmail, subject: `[TEST] ${subject}`, html });
  return Response.json({ ok: r.ok, ...r.data }, { status: r.ok ? 200 : r.status });
};
