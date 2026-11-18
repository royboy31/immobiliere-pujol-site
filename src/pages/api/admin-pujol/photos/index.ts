// GET  /api/admin-pujol/photos/  → { slots, duplicates }  (guarded)
// POST /api/admin-pujol/photos/  → one action (guarded):
//   { action: 'draft',    slot, photo, revision }   photo null = back to the original photo
//   { action: 'previous', slot, revision }          draft = the photo online before the last publish
//   { action: 'publish',  page, revisions }         put the drafts of ONE page online (nothing else)
//   { action: 'discard',  page }                    drop the unpublished drafts of one page
// A stale editor (revision mismatch) gets 409 and must reload; nothing is overwritten.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import {
  ConflictError, discardPage, draftFromPrevious, duplicateGroups, ensureLpPhotosSchema, getSlotStates, publishPage, saveDraft,
} from '../../../../lib/lp-photos';

async function db(): Promise<D1Database> {
  const { env } = await import('cloudflare:workers');
  const d = (env as any).DB as D1Database;
  if (!d) throw new Error('D1 binding "DB" is not available');
  await ensureLpPhotosSchema(d);
  return d;
}

async function state(d: D1Database) {
  const slots = await getSlotStates(d);
  return { slots, duplicates: duplicateGroups(Object.fromEntries(slots.map((s) => [s.id, s.draft]))) };
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await requireAdmin(request))) return new Response('Unauthorized', { status: 401 });
  return Response.json(await state(await db()), { headers: { 'cache-control': 'no-store' } });
};

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const d = await db();
  const body = (await request.json().catch(() => ({}))) as any;
  try {
    let changed: string[] | undefined;
    switch (body.action) {
      case 'draft': await saveDraft(d, String(body.slot), body.photo ?? null, Number(body.revision ?? 0), admin); break;
      case 'previous': await draftFromPrevious(d, String(body.slot), Number(body.revision ?? 0), admin); break;
      case 'publish': changed = await publishPage(d, String(body.page), body.revisions || {}, admin); break;
      case 'discard': changed = await discardPage(d, String(body.page), admin); break;
      default: return Response.json({ ok: false, error: 'Action inconnue' }, { status: 400 });
    }
    return Response.json({ ok: true, changed, ...(await state(d)) });
  } catch (e: any) {
    if (e instanceof ConflictError) {
      return Response.json({ ok: false, conflict: true, error: 'Ces photos ont été modifiées entre-temps (autre onglet ou autre personne). Les données ont été rechargées : vérifiez puis recommencez.', ...(await state(d)) }, { status: 409 });
    }
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 400 });
  }
};
