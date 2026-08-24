// PATCH  /api/admin-pujol/alertes/:id  → change status (pause / re-activate)
// DELETE /api/admin-pujol/alertes/:id  → delete an alert
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, setAlertStatus, deleteAlert, type AlertStatus } from '../../../../lib/alerts-db';

export const PATCH: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const b: any = await request.json().catch(() => ({}));
  const status = b.status as AlertStatus;
  if (!['active', 'paused', 'unsub'].includes(status)) return Response.json({ ok: false, error: 'Statut invalide.' }, { status: 400 });
  const db = await getDB();
  await ensureSchema(db);
  const alert = await setAlertStatus(db, String(params.id), status);
  if (!alert) return new Response('Not found', { status: 404 });
  return Response.json({ ok: true, alert });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const ok = await deleteAlert(db, String(params.id));
  return Response.json({ ok });
};
