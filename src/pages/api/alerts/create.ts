// POST /api/alerts/create — public alert signup (pop-up, list-page button, /alerte/).
// Runs in the main worker (has the D1 binding). Flow: honeypot + optional Turnstile
// → validate → dedup → INSERT `pending` → ask the email worker to send the
// double-opt-in email. The alert stays inert until the person clicks the confirm link.
export const prerender = false;

import type { APIRoute } from 'astro';
import { getDB, ensureSchema, createAlert, findDuplicate, describeCriteria, normalizeBedroomCriterion, type Transac } from '../../../lib/alerts-db';
import { callWorker } from '../../../lib/newsletter-worker';

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Turnstile is PROD-only and its secret lives on the worker layer. We verify only
// when a secret is present on THIS worker; otherwise the honeypot is the guard
// (same posture as the email worker). Setting ALERTS_TURNSTILE_SECRET turns it on.
async function turnstileOk(env: any, token: string, ip: string | null): Promise<boolean> {
  const secret = env?.ALERTS_TURNSTILE_SECRET || env?.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new FormData();
    body.append('secret', secret);
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const j: any = await r.json();
    return !!j.success;
  } catch {
    return true; // never let a verifier outage block a genuine lead
  }
}

export const POST: APIRoute = async ({ request }) => {
  const fd = await request.formData().catch(() => null);
  if (!fd) return bad('Requête invalide.');

  // Honeypot — a filled hidden field is a bot; accept silently so it learns nothing.
  if (((fd.get('_hp') as string) || '').trim()) return Response.json({ ok: true });

  const { env } = await import('cloudflare:workers').catch(() => ({ env: {} as any }));
  const ip = request.headers.get('cf-connecting-ip');
  const tsToken = (fd.get('cf-turnstile-response') as string) || '';
  if (!(await turnstileOk(env, tsToken, ip))) return bad('Vérification anti-robot échouée. Rechargez la page et réessayez.');

  const email = ((fd.get('email') as string) || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return bad('Adresse email invalide.');

  const transac = ((fd.get('transac') as string) || '').trim().toUpperCase();
  if (transac !== 'V' && transac !== 'L') return bad('Type de recherche manquant.');

  const num = (k: string): number | null => {
    const n = parseInt(((fd.get(k) as string) || '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const str = (k: string): string | null => {
    const v = ((fd.get(k) as string) || '').trim();
    return v || null;
  };

  // Multi-select secteurs: one `cp` form entry per case cochée, stored as a sorted
  // CSV in the single `cp` column (sorted so the dedup string-compare is stable).
  const cps = [...new Set(fd.getAll('cp').map((v) => String(v).trim()).filter((v) => /^\d{5}$/.test(v)))].sort();

  const input = {
    email,
    prenom: str('prenom'),
    nom: str('nom'),
    phone: str('phone'),
    transac: transac as Transac,
    cp: cps.length ? cps.join(',') : null,
    kind: str('kind'),
    budget_max: num('budget_max'),
    chambres_min: normalizeBedroomCriterion(fd.get('chambres_min')),
    proprietaire: transac === 'V' && (fd.get('proprietaire') === 'on' || fd.get('proprietaire') === '1'),
    bien_a_vendre: transac === 'V' && (fd.get('bien_a_vendre') === 'on' || fd.get('bien_a_vendre') === '1'),
    source_ref: str('source_ref'),
    negociateur_email: (str('negociateur_email') || '').toLowerCase() || null,
  };

  const db = await getDB();
  await ensureSchema(db);

  // Same person + identical criteria already live → don't create a duplicate,
  // just tell them they're set. (An existing pending alert keeps its own opt-in email.)
  const dup = await findDuplicate(db, input);
  if (dup) {
    return Response.json({ ok: true, already: true, pending: dup.status === 'pending' });
  }

  const alert = await createAlert(db, input);

  // Ask the email worker to send the double opt-in. Build environment-correct URLs
  // from the request origin so staging confirms on staging and prod on prod.
  const origin = new URL(request.url).origin;
  const confirmUrl = `${origin}/api/alerts/confirm/?token=${alert.token}`;
  const r = await callWorker('/alerts/optin', {
    email: alert.email,
    prenom: alert.prenom || '',
    nom: alert.nom || '',
    criteriaText: describeCriteria(alert),
    confirmUrl,
  });
  // The alert is saved even if the email couldn't go out; surface a soft warning.
  if (!r.ok) return Response.json({ ok: true, emailQueued: false, warning: r.data?.error || 'Email non envoyé.' });
  return Response.json({ ok: true, emailQueued: true });
};
