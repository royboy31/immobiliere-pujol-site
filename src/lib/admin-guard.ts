// Guard for admin API routes. The middleware only protects PAGE routes under
// /admin-pujol/ — API routes under /api/admin-pujol/ are NOT auto-guarded, so
// every admin endpoint must call this explicitly.
import { getAdminEnv, parseSessionCookie, verifySession } from './admin-auth';

/** Returns the authenticated admin email, or null if the request isn't a valid session. */
export async function requireAdmin(request: Request): Promise<string | null> {
  const env = await getAdminEnv();
  const token = parseSessionCookie(request.headers.get('cookie'));
  return token ? await verifySession(env, token) : null;
}
