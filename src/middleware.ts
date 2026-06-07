// Protects every URL under /${ADMIN_PATH}/ (default: admin-pujol).
// Unauthenticated requests are redirected to the login page.
import type { MiddlewareHandler } from 'astro';
import {
  getAdminEnv,
  getAdminPath,
  parseSessionCookie,
  verifySession,
} from './lib/admin-auth';

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { url, request } = context;
  const env = await getAdminEnv();
  const adminPath = getAdminPath(env);
  const prefix = `/${adminPath}`;

  if (!url.pathname.startsWith(prefix)) return next();

  // Open: login page + login API (so you can actually get in)
  if (
    url.pathname === `${prefix}/login` ||
    url.pathname === `${prefix}/login/` ||
    url.pathname.startsWith(`/api/${adminPath}/auth/`)
  ) {
    return next();
  }

  const token = parseSessionCookie(request.headers.get('cookie'));
  const email = token ? await verifySession(env, token) : null;

  if (!email) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${prefix}/login?next=${encodeURIComponent(url.pathname)}` },
    });
  }

  // Stash the email on locals so pages can read it
  (context.locals as any).adminEmail = email;
  return next();
};
