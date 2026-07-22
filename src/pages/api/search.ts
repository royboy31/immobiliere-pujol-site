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
  // Never surface dropped (mandat-clos) listings, even on a reference lookup.
  const conditions: string[] = ["status != 'dropped'"];
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
    // Map user-facing category to D1 type_bien patterns
    // D1 stores values like "T3", "Studio", "Maison", "Parking couvert", etc.
    const typePatterns: Record<string, string[]> = {
      'Appartement': ['T1','T2','T3','T4','T5','T6','T7','T8','T9','F1','F2','F3','F4','F5','Studio','Duplex%','Triplex%','Loft','Appartement%'],
      'Maison': ['Maison%','Villa%','Propriété%'],
      'Parking': ['Parking%','Garage%','Box%','Stationnement%'],
      'Local commercial': ['Local%','Commerce%','Boutique%','Bureau%','Atelier%','Entrepôt%'],
      'Bureau': ['Bureau%','Local d\'activité%'],
      'Terrain': ['Terrain%'],
      'Immeuble': ['Immeuble%'],
    };
    const patterns = typePatterns[typeBien];
    if (patterns) {
      const likeClauses = patterns.map(() => 'type_bien LIKE ?').join(' OR ');
      conditions.push(`(${likeClauses})`);
      bindings.push(...patterns);
    } else {
      conditions.push('type_bien = ?');
      bindings.push(typeBien);
    }
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
    // A query matches by reference (agency or ubiflow) in ANY status — so a
    // reference/id finds the bien even when it is sold/archived — OR by
    // location/title but only among ACTIVE listings (so a city/word search
    // doesn't surface thousands of sold archive pages).
    const like = `%${q}%`;
    conditions.push(
      '((reference_agence LIKE ? OR ubiflow_reference LIKE ?)' +
      " OR (status = 'active' AND (ville LIKE ? OR quartier LIKE ? OR adresse LIKE ? OR titre LIKE ?)))"
    );
    bindings.push(like, like, like, like, like, like);
  } else {
    // No text query: browsing by filters only — active listings.
    conditions.push("status = 'active'");
  }

  const where = conditions.join(' AND ');

  const countSql = `SELECT COUNT(*) as total FROM annonces WHERE ${where}`;
  const sql = `
    SELECT id, slug, status, reference_agence, ubiflow_reference, type_annonce, type_bien, titre, ville, quartier, code_postal,
           prix, loyer_cc, surface, nb_pieces, nb_chambres
    FROM annonces
    WHERE ${where}
    ORDER BY (status = 'active') DESC, date_creation DESC
    LIMIT 20
  `;

  try {
    const [countResult, results] = await Promise.all([
      db.prepare(countSql).bind(...bindings).first<{ total: number }>(),
      db.prepare(sql).bind(...bindings).all(),
    ]);
    const total = countResult?.total ?? 0;

    // Collapse slug-drift duplicates: one card per reference (active row wins via
    // the ORDER BY above), so a reference search never shows the same bien twice.
    const seenRef = new Set<string>();
    const rows = (results.results as any[]).filter((a: any) => {
      const ref = (a.reference_agence || a.ubiflow_reference || '').toUpperCase();
      if (!ref) return true;
      if (seenRef.has(ref)) return false;
      seenRef.add(ref);
      return true;
    });

    // Fetch first photo for each result
    const ids = rows.map((a: any) => a.id);
    let photoMap = new Map<number, string>();
    if (ids.length > 0) {
      const photos = await db
        .prepare(
          `SELECT annonce_id, url FROM annonces_photos
           WHERE annonce_id IN (${ids.map(() => '?').join(',')}) AND position = 0`
        )
        .bind(...ids)
        .all<{ annonce_id: number; url: string }>();
      const R2_PUBLIC = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev';
      for (const p of photos.results) {
        // Relative paths (from Ubiflow sync) need R2 base URL; full URLs (WordPress) are kept as-is
        const url = p.url.startsWith('http') ? p.url : `${R2_PUBLIC}/${p.url}`;
        photoMap.set(p.annonce_id, url);
      }
    }

    const data = rows.map((a: any) => ({
      ...a,
      photo: photoMap.get(a.id) || null,
    }));

    // Blog articles matching the text query (published only) — shown as a
    // separate section in the SearchOverlay.
    let articles: any[] = [];
    if (q) {
      const alike = `%${q}%`;
      try {
        const art = await db
          .prepare(
            `SELECT slug, title, excerpt, article_date FROM blog_articles
             WHERE status = 'published' AND noindex = 0
               AND slug NOT LIKE 'local/%'
               AND (title LIKE ? OR excerpt LIKE ? OR categories LIKE ?)
             ORDER BY datetime(article_date) DESC
             LIMIT 5`
          )
          .bind(alike, alike, alike)
          .all();
        articles = art.results as any[];
      } catch {
        // blog_articles absent (older DB) — search stays annonces-only
      }
    }

    return new Response(JSON.stringify({ total, count: data.length, results: data, articles }), {
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
