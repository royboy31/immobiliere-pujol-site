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

import { verifyPassword, verifyStoredPassword, isAllowedEmail, type AdminEnv } from './admin-auth';

export type AdminRole = 'super' | 'admin';

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  password_hash: string | null; // null = still using the shared env password
  role: AdminRole;              // 'super' may manage other admins
  active: boolean;              // false = kept for history but cannot log in
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
  role TEXT NOT NULL DEFAULT 'admin',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

// Additive migration for tables created before role/active existed (staging's
// admin_users predates them). Existing rows default to a regular, active admin —
// which matches how they behaved before the columns existed.
const ADD_COLUMNS: Record<string, string> = {
  role: "TEXT NOT NULL DEFAULT 'admin'",
  active: 'INTEGER NOT NULL DEFAULT 1',
};

let schemaReady = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  const info = await db.prepare('PRAGMA table_info(admin_users)').all();
  const existing = new Set((info.results || []).map((r: any) => r.name));
  for (const [col, def] of Object.entries(ADD_COLUMNS)) {
    if (!existing.has(col)) await db.prepare(`ALTER TABLE admin_users ADD COLUMN ${col} ${def}`).run();
  }
  schemaReady = true;
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
    role: row.role === 'super' ? 'super' : 'admin',
    active: row.active === undefined || row.active === null ? true : Number(row.active) === 1,
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

// ── Roles + user management (super-admin only) ──────────────────────────────
//
// Bootstrap trust: everyone in ADMIN_EMAILS (the env allowlist) is treated as a
// SUPER-admin, always. They are the original trusted set, they can't be demoted
// from the UI, and this guarantees there is always at least one super-admin who
// can manage the others — even on a fresh D1. UI-created admins default to the
// regular 'admin' role and are super only if a super grants it.

export function isEnvAdmin(env: AdminEnv, email: string): boolean {
  return isAllowedEmail(env, email);
}

/** A super-admin may manage other admins. Env admins are always super. */
export async function isSuperAdmin(env: AdminEnv, email: string): Promise<boolean> {
  if (isAllowedEmail(env, email)) return true;
  try {
    const db = await getDB();
    await ensureSchema(db);
    const user = await getUser(db, email);
    return user?.active === true && user?.role === 'super';
  } catch {
    return false; // D1 down: only env admins (handled above) are super
  }
}

export async function listUsers(db: D1Database): Promise<AdminUser[]> {
  const { results } = await db.prepare('SELECT * FROM admin_users ORDER BY datetime(created_at) DESC').all();
  return (results || []).map(toUser);
}

export interface CreateUserInput { email: string; name?: string; role?: AdminRole; passwordHash: string | null; }

/**
 * Create a new admin. Throws 'exists' if the email is already a D1 row (the
 * UNIQUE constraint), so the caller can return a clean 409. An email that is
 * also in ADMIN_EMAILS is allowed to have a row too — it just adds profile data.
 */
export async function createUser(db: D1Database, input: CreateUserInput): Promise<AdminUser> {
  const email = normalizeEmail(input.email);
  const existing = await getUser(db, email);
  if (existing) { const e = new Error('exists'); (e as any).code = 'exists'; throw e; }
  await db.prepare(
    "INSERT INTO admin_users (email, name, role, active, password_hash) VALUES (?,?,?,?,?)"
  ).bind(
    email,
    (input.name || defaultName(email)).trim(),
    input.role === 'super' ? 'super' : 'admin',
    1,
    input.passwordHash,
  ).run();
  return (await getUser(db, email))!;
}

export async function setRole(db: D1Database, email: string, role: AdminRole): Promise<void> {
  await db.prepare("UPDATE admin_users SET role=?, updated_at=datetime('now') WHERE email=?")
    .bind(role === 'super' ? 'super' : 'admin', normalizeEmail(email)).run();
}

export async function setActive(db: D1Database, email: string, active: boolean): Promise<void> {
  await db.prepare("UPDATE admin_users SET active=?, updated_at=datetime('now') WHERE email=?")
    .bind(active ? 1 : 0, normalizeEmail(email)).run();
}
