// GET  /api/admin-pujol/publish/  → { pending: {articles, experts, pages, total}, deployConfigured }
// POST /api/admin-pujol/publish/  → snapshot published state (publishArticles/Experts/Pages) + fire deploy.yml
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema as ensureBlog, publishArticles, countPendingArticles } from '../../../../lib/blog-db';
import { ensureSchema as ensureExperts, publishExperts, countPendingExperts } from '../../../../lib/experts-db';
import { ensureSchema as ensurePages, publishPages, countPendingPages } from '../../../../lib/pages-db';
import { triggerDeploy, deployConfigured } from '../../../../lib/deploy';

async function getEnv(): Promise<any> {
  const { env } = await import('cloudflare:workers');
  return env;
}

export const GET: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureBlog(db);
  await ensureExperts(db);
  await ensurePages(db);
  const articles = await countPendingArticles(db);
  const experts = await countPendingExperts(db);
  const pages = await countPendingPages(db);
  const env = await getEnv();
  return Response.json({
    pending: { articles, experts, pages, total: articles + experts + pages },
    deployConfigured: deployConfigured(env),
  });
};

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureBlog(db);
  await ensureExperts(db);
  await ensurePages(db);
  // 1. Freeze the current content as the published snapshot (what the build reads).
  await publishArticles(db);
  await publishExperts(db);
  await publishPages(db);
  // 2. Fire the site rebuild.
  const env = await getEnv();
  const deploy = await triggerDeploy(env);
  return Response.json({
    ok: true,
    snapshotted: true,
    deployTriggered: deploy.ok,
    deployError: deploy.ok ? undefined : deploy.error,
    by: admin,
  }, { status: deploy.ok ? 200 : 202 });
};
