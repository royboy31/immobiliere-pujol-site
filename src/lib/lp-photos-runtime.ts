// Runtime side of lp-photos.ts for the two proposal page templates (rendered on request).
// Visitors get the published photos; an admin on ?apercu=1 gets the drafts. If D1 is unreachable the
// pages fall back to the photos committed in the repo, so they never break because of the editor.
import { requireAdmin } from './admin-guard';
import { defaultPhotoMap, getPhotoMap, type Photo } from './lp-photos';

export async function loadLpPhotos(request: Request, url: URL): Promise<{ photos: Record<string, Photo>; preview: boolean }> {
  const wantsPreview = url.searchParams.has('apercu');
  try {
    const { env } = await import('cloudflare:workers');
    const db = (env as any).DB as D1Database;
    if (!db) return { photos: defaultPhotoMap(), preview: false };
    const preview = wantsPreview && !!(await requireAdmin(request));
    return { photos: await getPhotoMap(db, preview ? 'draft' : 'published'), preview };
  } catch (e: any) {
    // "no such table" until the admin photos screen is opened once (it creates the table).
    if (!/no such table/i.test(String(e?.message))) console.error('lp-photos: falling back to repo photos', e);
    return { photos: defaultPhotoMap(), preview: false };
  }
}
