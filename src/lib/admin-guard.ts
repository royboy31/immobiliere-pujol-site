// Guard for admin API routes. The middleware only protects PAGE routes under
// /admin-pujol/ — API routes under /api/admin-pujol/ are NOT auto-guarded, so
// every admin endpoint must call this explicitly.
import { getAdminEnv, parseSessionCookie, verifySession } from './admin-auth';
import { isSuperAdmin } from './admin-users';

/** Returns the authenticated admin email, or null if the request isn't a valid session. */
export async function requireAdmin(request: Request): Promise<string | null> {
  const env = await getAdminEnv();
  const token = parseSessionCookie(request.headers.get('cookie'));
  return token ? await verifySession(env, token) : null;
}

/**
 * Returns the authenticated email only if it is a super-admin, else null.
 * Use on every user-management endpoint. A regular admin gets null (→ 403),
 * exactly as an unauthenticated request would.
 */
export async function requireSuperAdmin(request: Request): Promise<string | null> {
  const email = await requireAdmin(request);
  if (!email) return null;
  const env = await getAdminEnv();
  return (await isSuperAdmin(env, email)) ? email : null;
}
