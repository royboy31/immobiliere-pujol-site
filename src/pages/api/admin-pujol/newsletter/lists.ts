// GET /api/admin-pujol/newsletter/lists  (guarded)
// → { ok, lists: [{ id, label }] } — the recipient lists THIS environment may
// send to. Sourced from the email worker's NEWSLETTER_LIST_IDS allowlist, not
// from Brevo: the composer must only ever offer lists the environment is
// permitted to mail, so staging can never address the real subscriber list.
// Returns 501 (with an empty list) if the worker/Brevo isn't configured yet.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { callWorker } from '../../../../lib/newsletter-worker';

export const GET: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const r = await callWorker('/newsletter/lists', {});
  // Always hand the composer a `lists` array so it can render without special-casing.
  return Response.json({ ok: r.ok, lists: r.data?.lists || [], ...(r.ok ? {} : { error: r.data?.error }) },
    { status: r.ok ? 200 : r.status });
};
