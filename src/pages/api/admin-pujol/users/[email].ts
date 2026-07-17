// /api/admin-pujol/users/:email  (SUPER-ADMIN ONLY)
//   POST { role?, active? } → update a D1 admin user
// Env-bootstrap admins (in ADMIN_EMAILS) have no D1 row to change and are always
// super/active, so they are refused here — you cannot demote or lock out a
// configured admin from the UI. A super also cannot deactivate or demote
// themselves (belt-and-braces against locking the last super out via the UI).
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireSuperAdmin } from '../../../../lib/admin-guard';
import { getAdminEnv } from '../../../../lib/admin-auth';
import { getDB, ensureSchema, getUser, setRole, setActive, isEnvAdmin } from '../../../../lib/admin-users';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params }) => {
  const admin = await requireSuperAdmin(request);
  if (!admin) return json({ error: 'forbidden' }, 403);

  const target = String(params.email || '').trim().toLowerCase();
  if (!target) return json({ error: 'Adresse manquante.' }, 400);

  const env = await getAdminEnv();
  if (isEnvAdmin(env, target)) return json({ error: 'Ce compte est configuré au niveau serveur et ne peut pas être modifié ici.' }, 400);
  if (target === admin.trim().toLowerCase()) return json({ error: 'Vous ne pouvez pas modifier votre propre statut.' }, 400);

  let role: string | undefined, active: boolean | undefined;
  try {
    const b = (await request.json()) as any;
    if (b?.role !== undefined) role = b.role === 'super' ? 'super' : 'admin';
    if (b?.active !== undefined) active = !!b.active;
  } catch { return json({ error: 'Requête invalide.' }, 400); }

  try {
    const db = await getDB();
    await ensureSchema(db);
    const user = await getUser(db, target);
    if (!user) return json({ error: 'Compte introuvable.' }, 404);
    if (role !== undefined) await setRole(db, target, role as any);
    if (active !== undefined) await setActive(db, target, active);
    return json({ ok: true, user: { ...(await getUser(db, target))!, password_hash: undefined } });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};
