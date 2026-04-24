// Admin auth: PBKDF2 password verification + JWT session cookies.
// Both work natively in Cloudflare Workers via Web Crypto — no Node deps.
import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'pujol_admin_session';
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LEN = 32;

function te(v: string) { return new TextEncoder().encode(v); }

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number, keyLen: number): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw', te(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    baseKey,
    keyLen * 8,
  );
  return new Uint8Array(bits);
}

/** Encode a password as "pbkdf2-sha256$<iterations>$<salt>$<hash>" (all b64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

export async function verifyStoredPassword(stored: string, candidate: string): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = b64urlDecode(parts[2]);
  const expected = b64urlDecode(parts[3]);
  const candidateHash = await pbkdf2(candidate, salt, iterations, expected.length);
  return timingSafeEqual(candidateHash, expected);
}

export interface AdminEnv {
  ADMIN_EMAILS: string;
  ADMIN_PASSWORD_HASH: string;
  ADMIN_SESSION_SECRET: string;
  ADMIN_PATH?: string;
}

export function getAdminPath(env: AdminEnv): string {
  return env.ADMIN_PATH || 'admin-pujol';
}

export function isAllowedEmail(env: AdminEnv, email: string): boolean {
  const allowed = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export async function verifyPassword(env: AdminEnv, plaintext: string): Promise<boolean> {
  return verifyStoredPassword(env.ADMIN_PASSWORD_HASH || '', plaintext);
}

export async function signSession(env: AdminEnv, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ email, iat: now })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(now + SESSION_TTL)
    .sign(te(env.ADMIN_SESSION_SECRET));
}

export async function verifySession(env: AdminEnv, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, te(env.ADMIN_SESSION_SECRET));
    const email = typeof payload.email === 'string' ? payload.email : null;
    if (!email) return null;
    if (!isAllowedEmail(env, email)) return null;
    return email;
  } catch { return null; }
}

export function makeSessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function makeLogoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Read admin env from CF Worker runtime. */
export async function getAdminEnv(): Promise<AdminEnv> {
  try {
    const { env } = await import('cloudflare:workers');
    return env as unknown as AdminEnv;
  } catch {
    return {} as AdminEnv;
  }
}
