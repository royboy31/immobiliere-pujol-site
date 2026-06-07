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

  // --- Legacy WordPress AMP normalization (301 → canonical) ---
  // Google indexed many AMP URLs (…/amp/, ?amp, ?nonamp=1) and the singular
  // /annonce/… path. The Astro site dropped AMP, so 301 them to the canonical
  // page instead of 404. One dynamic rule replaces ~160 individual redirects.
  {
    let path = url.pathname;
    let changed = false;
    const ampStripped = path.replace(/\/amp\/?$/i, '/');
    if (ampStripped !== path) { path = ampStripped; changed = true; }
    if (path.startsWith('/annonce/')) { path = '/annonces/' + path.slice('/annonce/'.length); changed = true; }
    const hasAmpQuery = url.searchParams.has('amp') || url.searchParams.has('nonamp');
    if (changed || hasAmpQuery) {
      if (!path.endsWith('/') && !/\.[a-z0-9]+$/i.test(path)) path += '/';
      return new Response(null, { status: 301, headers: { Location: path } });
    }
  }

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
