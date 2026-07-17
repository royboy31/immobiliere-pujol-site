export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, getOrCreateUser, setName } from '../../../../lib/admin-users';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NAME_MAX = 60;

/** Current admin's profile: name + whether they still use the shared password. */
export const GET: APIRoute = async ({ request }) => {
  const email = await requireAdmin(request);
  if (!email) return json({ error: 'unauthorized' }, 401);

  try {
    const db = await getDB();
    await ensureSchema(db);
    const user = await getOrCreateUser(db, email);
    return json({ email: user.email, name: user.name, has_own_password: !!user.password_hash });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};

/** Rename the current admin. */
export const POST: APIRoute = async ({ request }) => {
  const email = await requireAdmin(request);
  if (!email) return json({ error: 'unauthorized' }, 401);

  let name = '';
  try {
    const body = (await request.json()) as any;
    name = String(body?.name ?? '').trim();
  } catch {
    return json({ error: 'Requête invalide.' }, 400);
  }

  if (!name) return json({ error: 'Le nom ne peut pas être vide.' }, 400);
  if (name.length > NAME_MAX) return json({ error: `Le nom ne peut pas dépasser ${NAME_MAX} caractères.` }, 400);

  try {
    const db = await getDB();
    await ensureSchema(db);
    await getOrCreateUser(db, email);
    await setName(db, email, name);
    const user = await getOrCreateUser(db, email);
    return json({ ok: true, name: user.name });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};
