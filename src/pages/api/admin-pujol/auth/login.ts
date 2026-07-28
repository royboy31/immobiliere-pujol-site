export const prerender = false;
import type { APIRoute } from 'astro';
import {
  getAdminEnv,
  getAdminPath,
  emailAllowed,
  signSession,
  makeSessionCookie,
} from '../../../../lib/admin-auth';
import { verifyAdminPassword } from '../../../../lib/admin-users';

// Brute-force protection. Backed by D1 (no KV binding in this worker). It fails OPEN on
// any D1 error so a database hiccup never locks a real admin out — same philosophy as
// emailAllowed(). Legit users effectively never hit these thresholds.
const RL_LIMIT = 10; // failed attempts within the window before a lockout
const RL_WINDOW = 15 * 60; // seconds — rolling window for counting failures
const RL_LOCKOUT = 15 * 60; // seconds — how long a lockout lasts once triggered

async function getDb(): Promise<any | undefined> {
  try {
    const { env } = await import('cloudflare:workers');
    return (env as any).DB;
  } catch {
    return undefined;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const env = await getAdminEnv();
  const adminPath = getAdminPath(env);
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-real-ip') || 'unknown';
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);

  // Read (and lazily create) the throttle row for this IP. Never let throttling errors
  // block a login: on any failure we simply skip rate-limiting for this request.
  let row: any = null;
  if (db) {
    try {
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS login_throttle (
           ip TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0,
           window_start INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0
         )`,
      ).run();
      row = await db
        .prepare('SELECT fails, window_start, locked_until FROM login_throttle WHERE ip = ?')
        .bind(ip)
        .first();
      if (row && Number(row.locked_until) > now) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/${adminPath}/login?err=rate`,
            'Retry-After': String(Number(row.locked_until) - now),
          },
        });
      }
    } catch {
      row = null; // fail open
    }
  }
  const ct = request.headers.get('content-type') || '';
  let email = '', password = '', next = `/${adminPath}/`;
  if (ct.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    email = String(form.get('email') || '');
    password = String(form.get('password') || '');
    next = String(form.get('next') || `/${adminPath}/`);
  } else if (ct.includes('application/json')) {
    const body = await request.json() as any;
    email = String(body?.email || ''); password = String(body?.password || ''); next = String(body?.next || `/${adminPath}/`);
  }

  if (!(await emailAllowed(env, email)) || !(await verifyAdminPassword(env, email, password))) {
    if (db) {
      try {
        if (row && now - Number(row.window_start) < RL_WINDOW) {
          const fails = Number(row.fails) + 1;
          const lockedUntil = fails >= RL_LIMIT ? now + RL_LOCKOUT : 0;
          await db
            .prepare('UPDATE login_throttle SET fails = ?, locked_until = ? WHERE ip = ?')
            .bind(fails, lockedUntil, ip)
            .run();
        } else {
          // First failure, or the previous window has expired: start a fresh window.
          await db
            .prepare(
              `INSERT INTO login_throttle (ip, fails, window_start, locked_until) VALUES (?, 1, ?, 0)
               ON CONFLICT(ip) DO UPDATE SET fails = 1, window_start = ?, locked_until = 0`,
            )
            .bind(ip, now, now)
            .run();
        }
      } catch {
        // never block the (already-failed) login on a throttle write error
      }
    }
    return new Response(null, {
      status: 302,
      headers: { Location: `/${adminPath}/login?err=1&next=${encodeURIComponent(next)}` },
    });
  }

  // Successful login: clear any accumulated failures for this IP.
  if (db) {
    try {
      await db.prepare('DELETE FROM login_throttle WHERE ip = ?').bind(ip).run();
    } catch {
      /* non-fatal */
    }
  }

  const token = await signSession(env, email);
  // Only redirect to same-origin paths starting with /${adminPath}
  const safeNext = next.startsWith(`/${adminPath}`) ? next : `/${adminPath}/`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: safeNext,
      'Set-Cookie': makeSessionCookie(token),
    },
  });
};
