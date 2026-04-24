export const prerender = false;
import type { APIRoute } from 'astro';
import { getAdminEnv, getAdminPath, makeLogoutCookie } from '../../../../lib/admin-auth';

export const POST: APIRoute = async () => {
  const env = await getAdminEnv();
  const adminPath = getAdminPath(env);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/${adminPath}/login`,
      'Set-Cookie': makeLogoutCookie(),
    },
  });
};
