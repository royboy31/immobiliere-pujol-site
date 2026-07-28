// GET /api/alerts/confirm?token=… — the double-opt-in click. Activates a pending
// alert, and on the first activation notifies the agency (it's a real lead now).
// Idempotent: re-clicking an already-active link just lands on the confirmation page.
export const prerender = false;

import type { APIRoute } from 'astro';
import { getDB, ensureSchema, getAlertByToken, confirmAlert, describeCriteria } from '../../../lib/alerts-db';
import { callWorker } from '../../../lib/newsletter-worker';

export const GET: APIRoute = async ({ request, redirect }) => {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return redirect('/alerte/?erreur=lien', 302);

  const db = await getDB();
  await ensureSchema(db);

  const before = await getAlertByToken(db, token);
  if (!before) return redirect('/alerte/?erreur=lien', 302);

  const wasPending = before.status === 'pending';
  const alert = (await confirmAlert(db, token)) || before;

  // Notify the agency only on the pending → active transition, so a re-clicked
  // link (or an already-confirmed alert) doesn't spam the négociateur.
  if (wasPending && alert.status === 'active') {
    await callWorker('/alerts/notify', {
      transac: alert.transac,
      email: alert.email,
      prenom: alert.prenom || '',
      nom: alert.nom || '',
      phone: alert.phone || '',
      criteriaText: describeCriteria(alert),
      negociateur_email: alert.negociateur_email || '',
      proprietaire: !!alert.proprietaire,
      bien_a_vendre: !!alert.bien_a_vendre,
      source_ref: alert.source_ref || '',
    });
  }

  return redirect('/alerte/confirmee/', 302);
};
