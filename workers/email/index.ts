// Email worker — handles all contact form submissions via Mandrill.
// Deployed as a separate worker alongside the main Astro site.

interface Env {
  MANDRILL_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

const MANDRILL_URL = 'https://mandrillapp.com/api/1.0/messages/send';
const RECIPIENT = 'kamindudushmantha@gmail.com';
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbyrEh_gNbjxEMs2O5D6QT5iyGEYF_yoBWzmtZM1i7SDm8YhbPY87vC6IzCYc2tJ1zHm/exec';

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

function now(): string {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

async function logToSheet(tab: string, row: string[]): Promise<void> {
  try {
    await fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify({ tab, row }),
      redirect: 'follow',
    });
  } catch {
    // Fire-and-forget — don't block the response if Sheets is down
  }
}

function buildTable(subject: string, rows: [string, string][]): string {
  const trs = rows
    .filter(([, v]) => v)
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:12px 16px;font-weight:600;color:#55666f;vertical-align:top;white-space:nowrap;width:140px;font-size:14px">${esc(label)}</td>
          <td style="padding:12px 16px;color:#3a3a3a;font-size:14px;line-height:1.5">${esc(value).replace(/\n/g, '<br>')}</td>
        </tr>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#eef3ef;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3ef;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

        <!-- Header -->
        <tr><td style="background-color:#0f1a2b;padding:24px 32px;border-radius:8px 8px 0 0" align="center">
          <img src="https://immobiliere-pujol-staging.roy-68a.workers.dev/images/home/pujol-logo-white.png" alt="Immobilière Pujol" width="220" style="display:block;max-width:220px;height:auto">
        </td></tr>

        <!-- Green accent bar -->
        <tr><td style="background-color:#B2C54F;height:4px;font-size:0;line-height:0">&nbsp;</td></tr>

        <!-- Body -->
        <tr><td style="background-color:#ffffff;padding:32px">

          <!-- Subject heading -->
          <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f1a2b">${esc(subject)}</h1>
          <p style="margin:0 0 24px;font-size:13px;color:#7e7e7d">Reçu le ${now()}</p>

          <!-- Data table -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef3ef;border-radius:6px;overflow:hidden">
            <tr><td style="background-color:#f8faf5;padding:12px 16px;font-size:12px;font-weight:700;color:#55666f;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #B2C54F">Détails du formulaire</td></tr>
            <tr><td style="padding:0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
                ${trs}
              </table>
            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:#0f1a2b;padding:28px 32px;border-radius:0 0 8px 8px">

          <!-- Contact info -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;padding-right:16px" width="50%">
                <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff">Immobilière Pujol</p>
                <p style="margin:0;font-size:13px;color:#ffffff;line-height:1.7">
                  7 rue du Docteur Fiolle<br>
                  13006 Marseille
                </p>
                <p style="margin:12px 0 0;font-size:13px;color:#ffffff;line-height:1.7">
                  <strong>Tél.</strong> <a href="tel:+33491373839" style="color:#ffffff!important;text-decoration:none!important"><span style="color:#ffffff!important">04 91 37 38 39</span></a><br>
                  <strong>Email</strong> <a href="mailto:contact@immobiliere-pujol.fr" style="color:#ffffff!important;text-decoration:none!important"><span style="color:#ffffff!important">contact@immobiliere-pujol.fr</span></a>
                </p>
              </td>
              <td style="vertical-align:top" width="50%">
                <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff">Horaires</p>
                <p style="margin:0;font-size:13px;color:#ffffff;line-height:1.7">
                  Lundi – Jeudi<br>
                  9h – 12h / 14h – 18h<br><br>
                  Vendredi<br>
                  9h – 12h / 14h – 17h
                </p>
              </td>
            </tr>
          </table>

          <!-- Divider -->
          <hr style="border:none;border-top:1px solid #2a3a4b;margin:20px 0">

          <!-- Social icons: YouTube, Instagram, Facebook, LinkedIn (same order as website) -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding-bottom:16px">
              <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0"><tr><![endif]-->
              <!-- YouTube -->
              <a href="https://www.youtube.com/channel/UCqKIrOqKql-5A7sUsGuIphA" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/youtube-play.png" alt="YouTube" width="28" height="28" style="display:block;border:0">
              </a>
              <!-- Instagram -->
              <a href="https://www.instagram.com/immobiliere_pujol/" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/instagram-new.png" alt="Instagram" width="28" height="28" style="display:block;border:0">
              </a>
              <!-- Facebook -->
              <a href="https://www.facebook.com/immobilierepujol/" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/facebook-new.png" alt="Facebook" width="28" height="28" style="display:block;border:0">
              </a>
              <!-- LinkedIn -->
              <a href="https://www.linkedin.com/company/immobiliere-pujol/" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/linkedin.png" alt="LinkedIn" width="28" height="28" style="display:block;border:0">
              </a>
              <!--[if mso]></tr></table><![endif]-->
            </td></tr>
            <tr><td align="center">
              <p style="margin:0;font-size:12px;color:#ffffff;opacity:0.7;line-height:1.5">
                Agence immobilière indépendante à Marseille depuis 2002.<br>
                Vente, location, gestion locative et syndic de copropriété.
              </p>
            </td></tr>
          </table>

        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Form definitions (Gravity Forms field mappings) ─────────────────────────

interface FormDef {
  subject: string;
  tab: string; // Google Sheet tab name
  fields: [string, string][]; // [label, formDataKey]
  honeypot: string;
  emailField: string;
}

const FORM_DEFS: Record<string, FormDef> = {
  // Main contact + Agency + Dynamic service pages
  '4': {
    subject: 'Contact — Immobilière Pujol',
    tab: 'Contact',
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
    tab: 'Urgence',
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
    tab: 'Vente',
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
    tab: 'Gestion Locative',
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
    tab: 'Mise en Location',
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
    tab: 'Syndic',
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
  const emailResult = await sendEmail(env, {
    subject: def.subject,
    html: buildTable(def.subject, rows),
    replyTo: replyTo || undefined,
  });

  // Log to Google Sheet
  const sheetRow = [now(), ...rows.map(([, v]) => v)];
  await logToSheet(def.tab, sheetRow);

  return emailResult;
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
  const emailResult = await sendEmail(env, {
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

  await logToSheet('Annonces', [now(), reference, title, name, email, phone, message]);

  return emailResult;
}

async function handleNewsletter(fd: FormData, env: Env): Promise<{ ok: boolean; error?: string }> {
  const email = ((fd.get('email') as string) || '').trim();
  if (!email) return { ok: false, error: 'Email requis.' };

  const subject = 'Nouvelle inscription newsletter — Immobilière Pujol';
  const html = buildTable(subject, [['Email', email]]);

  const emailResult = await sendEmail(env, { subject, html });

  await logToSheet('Newsletter', [now(), email]);

  return emailResult;
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
