// POST /api/admin-pujol/newsletter/send  (guarded)
// Body: { template, data, subject, preheader?, campaignName? }
// Flow (spec §5.3): render HTML → INSERT a draft campaign row → call the email
// worker /newsletter/send (creates + sends the Brevo campaign) → on success mark
// the row sent with the Brevo campaign id. If the worker/Brevo isn't configured,
// the draft row is still saved and a 501 is returned so nothing is lost.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { renderNewsletter, type NewsletterTemplate } from '../../../../lib/newsletter-template';
import { getDB, ensureSchema, createCampaign, updateCampaign, markSent } from '../../../../lib/newsletter-db';
import { callWorker } from '../../../../lib/newsletter-worker';

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const body = await request.json().catch(() => ({} as any));
  const template = (body.template || 'blog') as NewsletterTemplate;
  const data = body.data || {};
  const subject = (body.subject || data.subject || 'Newsletter').trim();
  const preheader = body.preheader || data.preheader || '';
  const campaignName = body.campaignName || `Newsletter — ${subject}`;

  let html: string;
  try {
    html = renderNewsletter(template, data);
  } catch (e: any) {
    return Response.json({ ok: false, error: `Rendu impossible : ${e?.message || e}` }, { status: 500 });
  }

  // 1) persist a draft campaign log before attempting the send
  const db = await getDB();
  await ensureSchema(db);
  const draftInput = {
    subject, preheader, template,
    intro: data.intro || '', outro: data.outro || '',
    article_slugs: Array.isArray(data.articles) ? data.articles.map((a: any) => a.slug).filter(Boolean) : [],
    content_json: data,
    status: 'draft' as const,
  };
  // If this send is of an existing draft (composer passes its id), reuse that row
  // so it moves draft → sent instead of leaving an orphan draft behind. A stale/
  // unknown id falls back to a fresh row so a send is never lost.
  const existingId = Number((body as any).id) || null;
  const draft = existingId
    ? (await updateCampaign(db, existingId, draftInput)) ?? (await createCampaign(db, draftInput, admin))
    : await createCampaign(db, draftInput, admin);

  // 2) ask the worker to create + send the Brevo campaign. listId is passed
  //    through as-is: the worker owns the allowlist and refuses anything not on
  //    it, so validating here too would only duplicate (and could drift from) it.
  const r = await callWorker('/newsletter/send', { subject, html, campaignName, listId: body.listId });
  if (!r.ok) {
    // Draft is preserved; surface why sending didn't happen.
    return Response.json({ ok: false, draftId: draft.id, ...r.data }, { status: r.status });
  }

  // 3) mark sent with the Brevo campaign id + the list the worker actually used
  //    (its echo, not our request — they differ if the request omitted a list).
  const brevoId = r.data?.campaignId ?? null;
  const recipients = r.data?.recipientCount ?? null;
  const sent = await markSent(db, draft.id, brevoId, recipients, {
    id: r.data?.listId ?? null,
    name: r.data?.listLabel ?? null,
  });
  return Response.json({ ok: true, campaign: sent, brevoCampaignId: brevoId });
};
