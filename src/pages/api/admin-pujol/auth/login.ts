export const prerender = false;
import type { APIRoute } from 'astro';
import {
  getAdminEnv,
  getAdminPath,
  isAllowedEmail,
  verifyPassword,
  signSession,
  makeSessionCookie,
} from '../../../../lib/admin-auth';

export const POST: APIRoute = async ({ request }) => {
  const env = await getAdminEnv();
  const adminPath = getAdminPath(env);
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

  if (!isAllowedEmail(env, email) || !(await verifyPassword(env, password))) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/${adminPath}/login?err=1&next=${encodeURIComponent(next)}` },
    });
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
