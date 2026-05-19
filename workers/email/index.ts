// Email worker — handles all contact form submissions via Mandrill.
// Deployed as a separate worker alongside the main Astro site.

interface Env {
  MANDRILL_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

const MANDRILL_URL = 'https://mandrillapp.com/api/1.0/messages/send';
const RECIPIENT = 'kamindudushmantha@gmail.com';

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cors(origin: string, env: Env): Record<string, string> {
  // Allow the staging/production origin + localhost for dev
  const allowed = [env.ALLOWED_ORIGIN, 'http://localhost:4321', 'http://localhost:3000'];
  const allow = allowed.includes(origin) ? origin : env.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonOk(data: unknown, origin: string, env: Env) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...cors(origin, env) },
  });
}

function jsonErr(msg: string, status: number, origin: string, env: Env) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin, env) },
  });
}

async function sendEmail(
  env: Env,
  opts: { subject: string; html: string; replyTo?: string }
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    key: env.MANDRILL_API_KEY,
    message: {
      from_email: 'contact@immobiliere-pujol.com',
      from_name: 'Immobilière Pujol — Site Web',
      to: [{ email: RECIPIENT, type: 'to' as const }],
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { headers: { 'Reply-To': opts.replyTo } } : {}),
    },
  };

  try {
    const res = await fetch(MANDRILL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as any;

    if (!res.ok || data?.status === 'error') {
      return { ok: false, error: data?.message || `Mandrill HTTP ${res.status}` };
    }
    if (Array.isArray(data) && data[0]?.status === 'rejected') {
      return { ok: false, error: `Rejected: ${data[0].reject_reason}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Network error' };
  }
}

function buildTable(subject: string, rows: [string, string][]): string {
  const trs = rows
    .filter(([, v]) => v)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;font-weight:600;vertical-align:top;white-space:nowrap;border-bottom:1px solid #eee">${esc(label)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${esc(value).replace(/\n/g, '<br>')}</td></tr>`
    )
    .join('');

  return `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#0f1a2b;border-bottom:3px solid #b2c04e;padding-bottom:12px">${esc(subject)}</h2>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">${trs}</table>
      <p style="color:#888;font-size:12px;margin-top:24px">Envoyé depuis le site immobiliere-pujol.com</p>
    </div>`;
}

// ── Form definitions (Gravity Forms field mappings) ─────────────────────────

interface FormDef {
  subject: string;
  fields: [string, string][]; // [label, formDataKey]
  honeypot: string;
  emailField: string;
}

const FORM_DEFS: Record<string, FormDef> = {
  // Main contact + Agency + Dynamic service pages
  '4': {
    subject: 'Contact — Immobilière Pujol',
    fields: [
      ['Prénom', 'input_6.3'],
      ['Nom', 'input_6.6'],
      ['Email', 'input_2'],
      ['Téléphone', 'input_4'],
      ['Objet', 'input_10'],
      ['Message', 'input_3'],
    ],
    honeypot: 'input_11',
    emailField: 'input_2',
  },
  // Emergency
  '12': {
    subject: '🚨 URGENCE — Immobilière Pujol',
    fields: [
      ['Profil', 'input_4'],
      ['Prénom', 'input_1.3'],
      ['Nom', 'input_1.6'],
      ['Téléphone', 'input_6'],
      ['Email', 'input_2'],
      ['Adresse', 'input_5.1'],
      ['Ville', 'input_5.3'],
      ['Code postal', 'input_5.5'],
      ['Étage', 'input_7'],
      ['Description', 'input_3'],
    ],
    honeypot: 'input_9',
    emailField: 'input_2',
  },
  // Vendre
  '9': {
    subject: 'Estimation Vente — Immobilière Pujol',
    fields: [
      ['Prénom', 'input_1.3'],
      ['Nom', 'input_1.6'],
      ['Email', 'input_2'],
      ['Téléphone', 'input_3'],
      ['Message', 'input_10'],
    ],
    honeypot: 'input_15',
    emailField: 'input_2',
  },
  // Gestion Locative
  '1': {
    subject: 'Gestion Locative — Immobilière Pujol',
    fields: [
      ['Prénom', 'input_2.3'],
      ['Nom', 'input_2.6'],
      ['Téléphone', 'input_8'],
      ['Email', 'input_4'],
      ['Message', 'input_3'],
    ],
    honeypot: 'input_9',
    emailField: 'input_4',
  },
  // Mettre en Location
  '8': {
    subject: 'Mise en Location — Immobilière Pujol',
    fields: [
      ['Prénom', 'input_1.3'],
      ['Nom', 'input_1.6'],
      ['Email', 'input_2'],
      ['Téléphone', 'input_3'],
      ['Message', 'input_11'],
    ],
    honeypot: 'input_14',
    emailField: 'input_2',
  },
  // Syndic
  '6': {
    subject: 'Syndic — Immobilière Pujol',
    fields: [
      ['Prénom', 'input_1.3'],
      ['Nom', 'input_1.6'],
      ['Email', 'input_2'],
      ['Téléphone', 'input_3'],
      ['Message', 'input_6'],
    ],
    honeypot: 'input_9',
    emailField: 'input_2',
  },
};

// ── Route handlers ──────────────────────────────────────────────────────────

async function handleContact(fd: FormData, env: Env): Promise<{ ok: boolean; error?: string }> {
  const formId = (fd.get('gform_submit') as string) || '';
  const def = FORM_DEFS[formId];
  if (!def) return { ok: false, error: `Unknown form ID: ${formId}` };

  // Honeypot — silently accept to not tip off bots
  const honey = ((fd.get(def.honeypot) as string) || '').trim();
  if (honey) return { ok: true };

  const rows: [string, string][] = def.fields.map(([label, key]) => [
    label,
    ((fd.get(key) as string) || '').trim(),
  ]);

  const filledCount = rows.filter(([, v]) => v).length;
  if (filledCount < 2) return { ok: false, error: 'Veuillez remplir les champs obligatoires.' };

  const replyTo = ((fd.get(def.emailField) as string) || '').trim();
  return sendEmail(env, {
    subject: def.subject,
    html: buildTable(def.subject, rows),
    replyTo: replyTo || undefined,
  });
}

async function handleContactAnnonce(fd: FormData, env: Env): Promise<{ ok: boolean; error?: string }> {
  const name = ((fd.get('name') as string) || '').trim();
  const email = ((fd.get('email') as string) || '').trim();
  const phone = ((fd.get('phone') as string) || '').trim();
  const message = ((fd.get('message') as string) || '').trim();
  const reference = ((fd.get('reference') as string) || '').trim();
  const title = ((fd.get('title') as string) || '').trim();

  if (!name || !email) return { ok: false, error: 'Veuillez remplir les champs obligatoires.' };

  const subject = `Demande Annonce ${reference || 'N/A'} — Immobilière Pujol`;
  return sendEmail(env, {
    subject,
    html: buildTable(subject, [
      ['Annonce', `${title} (${reference})`],
      ['Nom', name],
      ['Email', email],
      ['Téléphone', phone],
      ['Message', message],
    ]),
    replyTo: email,
  });
}

async function handleNewsletter(fd: FormData, env: Env): Promise<{ ok: boolean; error?: string }> {
  const email = ((fd.get('email') as string) || '').trim();
  if (!email) return { ok: false, error: 'Email requis.' };

  const subject = 'Nouvelle inscription newsletter — Immobilière Pujol';
  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#0f1a2b;border-bottom:3px solid #b2c04e;padding-bottom:12px">Nouvelle inscription newsletter</h2>
      <p style="font-size:16px">L'adresse suivante souhaite recevoir la newsletter :</p>
      <p style="font-size:18px;font-weight:600;color:#0f1a2b">${esc(email)}</p>
      <p style="color:#888;font-size:12px;margin-top:24px">Envoyé depuis le site immobiliere-pujol.com</p>
    </div>`;

  return sendEmail(env, { subject, html });
}

// ── Worker entry point ──────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin, env) });
    }

    if (request.method !== 'POST') {
      return jsonErr('Method not allowed', 405, origin, env);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ''); // strip trailing slash

    let fd: FormData;
    try {
      fd = await request.formData();
    } catch {
      return jsonErr('Invalid form data', 400, origin, env);
    }

    let result: { ok: boolean; error?: string };

    switch (path) {
      case '/contact':
        result = await handleContact(fd, env);
        break;
      case '/contact-annonce':
        result = await handleContactAnnonce(fd, env);
        break;
      case '/newsletter':
        result = await handleNewsletter(fd, env);
        break;
      default:
        return jsonErr('Not found', 404, origin, env);
    }

    if (!result.ok) {
      return jsonErr(result.error || "Erreur d'envoi", 500, origin, env);
    }

    return jsonOk({ ok: true }, origin, env);
  },
};
