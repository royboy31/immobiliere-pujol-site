// Per-admin profile + credentials.
//
// Historically every admin shared ONE password: the ADMIN_PASSWORD_HASH env var
// (read-only at runtime, so it could never be changed from the UI). This table
// gives each admin their own name and their own password hash.
//
// Migration is deliberately lazy and lock-out-proof: a row's password_hash stays
// NULL until that person sets their own, and login falls back to the shared env
// hash while it is NULL. So Roy and Caroline keep signing in with the old shared
// password until they choose to change it — nothing has to be migrated up front.
//
// ADMIN_EMAILS remains the authoritative allowlist of who may log in at all;
// this table only carries profile + credential data for those emails. That keeps
// verifySession() free of a DB read on every request.

import { verifyPassword, verifyStoredPassword, type AdminEnv } from './admin-auth';

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  password_hash: string | null; // null = still using the shared env password
  created_at: string;
  updated_at: string;
}

/** Get the D1 binding from the Worker runtime (works in `astro dev` too). */
export async function getDB(): Promise<D1Database> {
  const { env } = await import('cloudflare:workers');
  const db = (env as any).DB as D1Database;
  if (!db) throw new Error('D1 binding "DB" is not available');
  return db;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.prepare(SCHEMA).run();
}

export const normalizeEmail = (email: string) => (email || '').trim().toLowerCase();

/** "roy.boy@x.com" -> "Roy Boy". Only a first guess; the admin can rename themselves. */
export function defaultName(email: string): string {
  const local = normalizeEmail(email).split('@')[0] || '';
  const words = local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(' ') || normalizeEmail(email);
}

function toUser(row: any): AdminUser {
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name || defaultName(String(row.email))),
    password_hash: row.password_hash ? String(row.password_hash) : null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

export async function getUser(db: D1Database, email: string): Promise<AdminUser | null> {
  const row = await db
    .prepare('SELECT * FROM admin_users WHERE email = ?')
    .bind(normalizeEmail(email))
    .first();
  return row ? toUser(row) : null;
}

/**
 * The row for an already-allowlisted admin, created on first sight with a NULL
 * password_hash (i.e. still on the shared password).
 */
export async function getOrCreateUser(db: D1Database, email: string): Promise<AdminUser> {
  const e = normalizeEmail(email);
  await db
    .prepare('INSERT OR IGNORE INTO admin_users (email, name) VALUES (?, ?)')
    .bind(e, defaultName(e))
    .run();
  const user = await getUser(db, e);
  if (!user) throw new Error(`admin_users row missing for ${e}`);
  return user;
}

export async function setName(db: D1Database, email: string, name: string): Promise<void> {
  await db
    .prepare("UPDATE admin_users SET name = ?, updated_at = datetime('now') WHERE email = ?")
    .bind(name.trim(), normalizeEmail(email))
    .run();
}

export async function setPasswordHash(db: D1Database, email: string, hash: string): Promise<void> {
  await db
    .prepare("UPDATE admin_users SET password_hash = ?, updated_at = datetime('now') WHERE email = ?")
    .bind(hash, normalizeEmail(email))
    .run();
}

/**
 * Check a password for an already-allowlisted admin: their own hash once they
 * have set one, otherwise the shared env hash.
 *
 * Note the two failure modes are different on purpose. A wrong password against
 * a per-user hash returns false — it must NOT fall through to the shared hash,
 * or changing your password would never actually retire the old shared one. But
 * if D1 itself is unreachable we do fall back, degrading to exactly the
 * behaviour that existed before this table: allowlist + shared password. That
 * keeps a D1 blip from locking every admin out, and leaves no login path weaker
 * than it already was.
 */
export async function verifyAdminPassword(
  env: AdminEnv,
  email: string,
  plaintext: string,
): Promise<boolean> {
  try {
    const db = await getDB();
    await ensureSchema(db);
    const user = await getUser(db, email);
    if (user?.password_hash) return await verifyStoredPassword(user.password_hash, plaintext);
  } catch {
    // D1 unavailable — fall through to the shared hash.
  }
  return await verifyPassword(env, plaintext);
}
