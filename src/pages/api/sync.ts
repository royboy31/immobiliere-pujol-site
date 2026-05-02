// Manual sync trigger endpoint
// POST /api/sync — triggers Ubiflow → D1 sync
// Protected by UPLOAD_TOKEN (same token used for R2 uploads)

import type { APIRoute } from 'astro';
import { syncAnnonces } from '../../lib/sync-annonces';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { env } = await import('cloudflare:workers');
  const cfEnv = env as any;

  // Auth check
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (token !== cfEnv.UPLOAD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await syncAnnonces({ DB: cfEnv.DB, PHOTOS: cfEnv.PHOTOS });
    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
