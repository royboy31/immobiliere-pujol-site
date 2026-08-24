// POST /api/admin-pujol/newsletter/reminders (guarded)
// Body: { dryRun?: boolean, emails: string[] }
// Produces counts only. Subscriber addresses never appear in the response or logs.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { callWorker } from '../../../../lib/newsletter-worker';

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return Response.json({ error: 'JSON invalide.' }, { status: 400 });
  }
  const body = raw as { dryRun?: unknown; emails?: unknown };
  const emails = Array.isArray(body.emails)
    ? body.emails.filter((email): email is string => typeof email === 'string')
    : [];
  const result = await callWorker('/newsletter/reminders', {
    dryRun: body.dryRun !== false,
    emails,
  });
  return Response.json(result.data || { error: 'Réponse vide du worker.' }, { status: result.status });
};
