// GET /api/admin-pujol/publish/status/ → { run: latest deploy.yml run | null }
// Polled by the admin "Publier" button to show build progress.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { latestDeployRun } from '../../../../lib/deploy';

export const GET: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const { env } = await import('cloudflare:workers');
  const run = await latestDeployRun(env as any);
  return Response.json({ run });
};
