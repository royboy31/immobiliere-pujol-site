// /api/admin-pujol/users  (SUPER-ADMIN ONLY)
//   GET  → list all admin users
//   POST → create a new admin { email, name?, role?, password }
// Guarded with requireSuperAdmin: a regular admin gets 403, same as anon.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireSuperAdmin } from '../../../../lib/admin-guard';
import { getAdminEnv, hashPassword } from '../../../../lib/admin-auth';
import { getDB, ensureSchema, listUsers, createUser, isEnvAdmin } from '../../../../lib/admin-users';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PW = 10;

export const GET: APIRoute = async ({ request }) => {
  const admin = await requireSuperAdmin(request);
  if (!admin) return json({ error: 'forbidden' }, 403);
  try {
    const db = await getDB();
    await ensureSchema(db);
    const env = await getAdminEnv();
    // Flag env-bootstrap admins so the UI can show they are super-by-config and
    // cannot be demoted/deactivated (there is no D1 row to change for them).
    const users = (await listUsers(db)).map((u) => ({ ...u, env: isEnvAdmin(env, u.email), password_hash: undefined }));
    return json({ ok: true, users });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireSuperAdmin(request);
  if (!admin) return json({ error: 'forbidden' }, 403);

  let email = '', name = '', role = 'admin', password = '';
  try {
    const b = (await request.json()) as any;
    email = String(b?.email || '').trim().toLowerCase();
    name = String(b?.name || '').trim();
    role = b?.role === 'super' ? 'super' : 'admin';
    password = String(b?.password || '');
  } catch { return json({ error: 'Requête invalide.' }, 400); }

  if (!EMAIL_RE.test(email)) return json({ error: 'Adresse email invalide.' }, 400);
  // A password is REQUIRED: a null hash would make this account fall back to the
  // shared env password (see verifyAdminPassword), i.e. loggable-in by anyone
  // who knows it. Never create a UI admin without their own password.
  if (password.length < MIN_PW) return json({ error: `Le mot de passe doit faire au moins ${MIN_PW} caractères.` }, 400);

  try {
    const db = await getDB();
    await ensureSchema(db);
    const user = await createUser(db, { email, name, role: role as any, passwordHash: await hashPassword(password) });
    return json({ ok: true, user: { ...user, password_hash: undefined } });
  } catch (e: any) {
    if (e?.code === 'exists') return json({ error: 'Un compte existe déjà pour cette adresse.' }, 409);
    return json({ error: String(e?.message || e) }, 500);
  }
};
