// Public search endpoint — no auth required
// GET /api/search?type=L|V&type_bien=Appartement&budget=1500&q=marseille

import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { env } = await import('cloudflare:workers');
  const db = (env as any).DB as D1Database;

  const url = new URL(request.url);
  const type = url.searchParams.get('type'); // L or V
  const typeBien = url.searchParams.get('type_bien');
  const budget = url.searchParams.get('budget');
  const q = url.searchParams.get('q');

  // Allow ?source= filter for debugging
  const sourceFilter = url.searchParams.get('source');
  const conditions: string[] = ["status = 'active'"];
  const bindings: any[] = [];

  if (sourceFilter && (sourceFilter === 'ubiflow' || sourceFilter === 'wordpress')) {
    conditions.push('source = ?');
    bindings.push(sourceFilter);
  }

  if (type) {
    conditions.push('type_annonce = ?');
    bindings.push(type);
  }

  if (typeBien) {
    conditions.push('type_bien = ?');
    bindings.push(typeBien);
  }

  if (budget) {
    const budgetNum = parseInt(budget, 10);
    if (!isNaN(budgetNum)) {
      if (type === 'L') {
        conditions.push('(loyer_cc <= ? OR prix <= ?)');
        bindings.push(budgetNum, budgetNum);
      } else {
        conditions.push('prix <= ?');
        bindings.push(budgetNum);
      }
    }
  }

  if (q) {
    conditions.push('(ville LIKE ? OR quartier LIKE ? OR adresse LIKE ? OR titre LIKE ?)');
    const like = `%${q}%`;
    bindings.push(like, like, like, like);
  }

  const where = conditions.join(' AND ');

  const countSql = `SELECT COUNT(*) as total FROM annonces WHERE ${where}`;
  const sql = `
    SELECT id, slug, type_annonce, type_bien, titre, ville, quartier, code_postal,
           prix, loyer_cc, surface, nb_pieces, nb_chambres
    FROM annonces
    WHERE ${where}
    ORDER BY date_creation DESC
    LIMIT 20
  `;

  try {
    const [countResult, results] = await Promise.all([
      db.prepare(countSql).bind(...bindings).first<{ total: number }>(),
      db.prepare(sql).bind(...bindings).all(),
    ]);
    const total = countResult?.total ?? 0;

    // Fetch first photo for each result
    const ids = results.results.map((a: any) => a.id);
    let photoMap = new Map<number, string>();
    if (ids.length > 0) {
      const photos = await db
        .prepare(
          `SELECT annonce_id, url FROM annonces_photos
           WHERE annonce_id IN (${ids.map(() => '?').join(',')}) AND position = 0`
        )
        .bind(...ids)
        .all<{ annonce_id: number; url: string }>();
      for (const p of photos.results) {
        photoMap.set(p.annonce_id, p.url);
      }
    }

    const data = results.results.map((a: any) => ({
      ...a,
      photo: photoMap.get(a.id) || null,
    }));

    return new Response(JSON.stringify({ total, count: data.length, results: data }), {
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
