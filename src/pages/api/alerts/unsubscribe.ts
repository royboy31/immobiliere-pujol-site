// GET /api/alerts/unsubscribe?token=… — one-click desinscription from an alert.
// Sets the alert to `unsub` (kept for the RGPD record, never matched again).
export const prerender = false;

import type { APIRoute } from 'astro';
import { getDB, ensureSchema, unsubscribeAlert } from '../../../lib/alerts-db';

export const GET: APIRoute = async ({ request, redirect }) => {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return redirect('/alerte/?erreur=lien', 302);

  const db = await getDB();
  await ensureSchema(db);
  const alert = await unsubscribeAlert(db, token);
  if (!alert) return redirect('/alerte/?erreur=lien', 302);

  return redirect('/alerte/desabonnee/', 302);
};
