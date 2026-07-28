// GET  /api/admin-pujol/alertes/  → all alerts (back-office list)
// POST /api/admin-pujol/alertes/  → manual add by Caroline (created active; sends
//   a courtesy confirmation/management email so the person can unsubscribe — RGPD).
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, listAlerts, createAlert, describeCriteria, type Transac } from '../../../../lib/alerts-db';
import { callWorker } from '../../../../lib/newsletter-worker';

export const GET: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  return Response.json(await listAlerts(db));
};

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const b: any = await request.json().catch(() => ({}));
  const email = (b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ ok: false, error: 'Adresse email invalide.' }, { status: 400 });
  const transac = (b.transac === 'V' || b.transac === 'L') ? b.transac : null;
  if (!transac) return Response.json({ ok: false, error: 'Type de recherche manquant.' }, { status: 400 });

  const num = (v: any): number | null => {
    const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const db = await getDB();
  await ensureSchema(db);
  const alert = await createAlert(db, {
    email,
    prenom: (b.prenom || '').trim() || null,
    phone: (b.phone || '').trim() || null,
    transac: transac as Transac,
    cp: (b.cp || '').trim() || null,
    kind: (b.kind || '').trim() || null,
    budget_max: num(b.budget_max),
    chambres_min: num(b.chambres_min),
    proprietaire: transac === 'V' && !!b.proprietaire,
    bien_a_vendre: transac === 'V' && !!b.bien_a_vendre,
    status: 'active', // internal add: the request was already expressed
  });

  // Courtesy confirmation with a one-click unsubscribe (best-effort; the alert
  // is saved regardless).
  const origin = new URL(request.url).origin;
  await callWorker('/alerts/registered', {
    email: alert.email,
    prenom: alert.prenom || '',
    criteriaText: describeCriteria(alert),
    manageUrl: `${origin}/api/alerts/unsubscribe/?token=${alert.token}`,
  });

  return Response.json({ ok: true, alert });
};
