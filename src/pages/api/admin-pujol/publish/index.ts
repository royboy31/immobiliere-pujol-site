// GET  /api/admin-pujol/publish/  → { pending: {articles, experts, pages, total}, deployConfigured }
// POST /api/admin-pujol/publish/  → snapshot published state (publishArticles/Experts/Pages) + fire deploy.yml
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema as ensureBlog, publishArticles, listPendingArticleChanges } from '../../../../lib/blog-db';
import { ensureSchema as ensureExperts, publishExperts, listPendingExpertChanges } from '../../../../lib/experts-db';
import { ensureSchema as ensurePages, publishPages, listPendingPageChanges } from '../../../../lib/pages-db';
import { triggerDeploy, deployConfigured } from '../../../../lib/deploy';
import { pendingPreviewCount, pendingPreviewToken, type PendingPublishPreview } from '../../../../lib/blog-workflow';

async function getEnv(): Promise<any> {
  const { env } = await import('cloudflare:workers');
  return env;
}

async function getPendingPreview(db: D1Database): Promise<PendingPublishPreview> {
  const [articles, experts, pages] = await Promise.all([
    listPendingArticleChanges(db),
    listPendingExpertChanges(db),
    listPendingPageChanges(db),
  ]);
  return { articles, experts, pages };
}

export const GET: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureBlog(db);
  await ensureExperts(db);
  await ensurePages(db);
  const preview = await getPendingPreview(db);
  const articles = preview.articles.length;
  const experts = preview.experts.length;
  const pages = preview.pages.length;
  const env = await getEnv();
  return Response.json({
    pending: { articles, experts, pages, total: articles + experts + pages },
    preview,
    previewToken: pendingPreviewToken(preview),
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
  const body = await request.json().catch(() => ({})) as any;
  const preview = await getPendingPreview(db);
  const currentToken = pendingPreviewToken(preview);
  if (body.previewToken !== currentToken) {
    return Response.json({
      ok: false,
      error: 'La liste des modifications a changé. Vérifiez le nouvel aperçu avant de publier.',
      preview,
      previewToken: currentToken,
    }, { status: 409 });
  }
  if (!pendingPreviewCount(preview)) {
    return Response.json({ ok: false, error: 'Aucune modification à publier.' }, { status: 400 });
  }
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
    published: preview,
    by: admin,
  }, { status: deploy.ok ? 200 : 202 });
};
