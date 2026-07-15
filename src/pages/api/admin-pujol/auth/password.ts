export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getAdminEnv, hashPassword } from '../../../../lib/admin-auth';
import {
  getDB,
  ensureSchema,
  getOrCreateUser,
  setPasswordHash,
  verifyAdminPassword,
} from '../../../../lib/admin-users';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MIN_LEN = 10;

/**
 * Change the current admin's password.
 *
 * The first time someone does this they are moved off the shared env password
 * onto their own hash — from then on the shared one no longer works for them,
 * and it keeps working for everyone who hasn't switched yet.
 */
export const POST: APIRoute = async ({ request }) => {
  const email = await requireAdmin(request);
  if (!email) return json({ error: 'unauthorized' }, 401);

  let current = '', next = '';
  try {
    const body = (await request.json()) as any;
    current = String(body?.current_password ?? '');
    next = String(body?.new_password ?? '');
  } catch {
    return json({ error: 'Requête invalide.' }, 400);
  }

  if (!current || !next) return json({ error: 'Mot de passe actuel et nouveau requis.' }, 400);
  if (next.length < MIN_LEN) return json({ error: `Le nouveau mot de passe doit faire au moins ${MIN_LEN} caractères.` }, 400);
  if (next === current) return json({ error: 'Le nouveau mot de passe doit être différent de l’actuel.' }, 400);

  const env = await getAdminEnv();
  if (!(await verifyAdminPassword(env, email, current))) {
    return json({ error: 'Mot de passe actuel incorrect.' }, 403);
  }

  try {
    const db = await getDB();
    await ensureSchema(db);
    await getOrCreateUser(db, email);
    await setPasswordHash(db, email, await hashPassword(next));
    return json({ ok: true });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};
