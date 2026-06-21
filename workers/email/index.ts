// Email worker — handles all contact form submissions via Mandrill.
// Deployed as a separate worker alongside the main Astro site.

interface Env {
  MANDRILL_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

const MANDRILL_URL = 'https://mandrillapp.com/api/1.0/messages/send';
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbyrEh_gNbjxEMs2O5D6QT5iyGEYF_yoBWzmtZM1i7SDm8YhbPY87vC6IzCYc2tJ1zHm/exec';
const ZOHO_PARSER = 'g9f4fx36@parser.eu.zohocrm.com';

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cors(origin: string, env: Env): Record<string, string> {
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

interface SendOpts {
  subject: string;
  html: string;
  replyTo?: string;
  to?: string;
  cc?: string;
  fromEmail?: string;
  fromName?: string;
}

async function sendEmail(
  env: Env,
  opts: SendOpts
): Promise<{ ok: boolean; error?: string }> {
  const recipients: { email: string; type: 'to' | 'cc' }[] = [
    { email: opts.to || 'contact@immobiliere-pujol.fr', type: 'to' },
  ];
  if (opts.cc) {
    recipients.push({ email: opts.cc, type: 'cc' });
  }

  const payload = {
    key: env.MANDRILL_API_KEY,
    message: {
      from_email: opts.fromEmail || 'contact@immobiliere-pujol.fr',
      from_name: opts.fromName || 'Immobilière Pujol',
      to: recipients,
      subject: opts.subject,
      html: opts.html,
      tags: ['source=site-public'],
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

const SITE_URL = 'https://www.immobiliere-pujol.fr';
const STAGING_URL = 'https://immobiliere-pujol-staging.roy-68a.workers.dev';
const RGPD_URL = 'https://www.declarations-juridiques.fr/processing-policy/immobiliere-pujol_056808868';

// ── Unified auto-reply (Caroline 21 mai) ─────────────────────────────────
// ONE template for ALL forms — simple, branded, same subject line.

const UNIFIED_AUTO_REPLY = {
  subject: 'Votre demande a bien été reçue — Immobilière Pujol',
  body: `<p>Nous avons bien reçu votre demande. Elle va être transmise à la personne
la mieux placée au sein de notre équipe pour vous apporter une réponse.
Vous aurez un retour sous peu.</p>
<p>Bien cordialement,</p>`,
  signoff: "L'équipe Immobilière Pujol",
};

// Specific auto-reply for the general contact form when the dropdown = "Location"
// (Caroline 11/06). Replaces the unified reply for that case only; the greeting
// + signoff are supplied by the branded wrapper, so the body starts after them.
const LOCATION_AUTO_REPLY = {
  subject: 'Votre recherche/demande de location – prochaines étapes',
  body: `<p>Nous faisons suite à votre demande de contact dans le cadre de votre recherche de location.</p>
<p>Nos annonces <strong>disponibles</strong> sont mises à jour quotidiennement sur notre site&nbsp;: <a href="${SITE_URL}/annonces/locations/" style="color:#0f1a2b">${SITE_URL}/annonces/locations/</a></p>
<p style="margin:16px 0 8px"><strong>Si votre demande concerne un bien en particulier&nbsp;:</strong><br>
Nous vous invitons à vérifier que l'annonce est bien publiée actuellement sur notre site (et non marquée clôturée)&nbsp;: <a href="${SITE_URL}/annonces/locations/" style="color:#0f1a2b">${SITE_URL}/annonces/locations/</a>. Si c'est le cas, nous vous demandons de faire votre demande directement depuis l'annonce concernée. Un email vous sera alors envoyé afin de compléter une fiche de renseignements, indispensable pour organiser une éventuelle visite et étudier votre dossier.</p>
<p style="margin:8px 0"><strong>Si vous êtes en recherche active&nbsp;:</strong><br>
Nous vous conseillons de consulter régulièrement notre site afin de ne manquer aucune nouvelle opportunité.</p>
<p>Nous restons à votre disposition et vous souhaitons une belle journée.</p>`,
  signoff: 'Le service Location',
};

function buildCustomerEmail(vars: { prénom?: string; bodyHtml?: string; signoff?: string }): string {
  const greeting = vars.prénom
    ? `Bonjour ${esc(vars.prénom)},`
    : 'Bonjour,';
  const bodyHtml = vars.bodyHtml ?? UNIFIED_AUTO_REPLY.body;
  const signoff = vars.signoff ?? UNIFIED_AUTO_REPLY.signoff;

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#eef3ef;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3ef;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

        <!-- Header -->
        <tr><td style="background-color:#0f1a2b;padding:20px 32px;border-radius:8px 8px 0 0" align="center">
          <img src="${STAGING_URL}/images/home/pujol-logo-white.png" alt="Immobilière Pujol" width="180" style="display:block;max-width:180px;height:auto">
        </td></tr>

        <!-- Green accent bar -->
        <tr><td style="background-color:#B2C54F;height:4px;font-size:0;line-height:0">&nbsp;</td></tr>

        <!-- Body -->
        <tr><td style="background-color:#ffffff;padding:32px 32px 24px">

          <p style="margin:0 0 16px;font-size:15px;color:#0f1a2b;font-weight:600">${greeting}</p>

          <div style="font-size:14px;color:#3a3a3a;line-height:1.7">
            ${bodyHtml}
          </div>

          <p style="margin:16px 0 0;font-size:14px;color:#0f1a2b;font-weight:600">${esc(signoff)}</p>

        </td></tr>

        <!-- RGPD notice — compact (Caroline 12/06: minimal space) -->
        <tr><td style="background-color:#ffffff;padding:0 32px 14px">
          <hr style="border:none;border-top:1px solid #eef3ef;margin:0 0 8px">
          <p style="margin:0;font-size:9px;color:#aaa;line-height:1.3">
            Dans le cadre de nos activités, nous traitons les données à caractère personnel de nos clients, prospects, salariés, dans le respect du Règlement général sur les données personnelles (RGPD) et de la loi n°78-17 du 6 janvier 1978. Vous pouvez accéder aux informations relatives aux traitements de vos données et à vos droits via notre <a href="${RGPD_URL}" style="color:#aaa;text-decoration:underline">politique de traitement des données</a>. Vous pouvez vous opposer à l'utilisation de vos données à des fins de prospection en contactant l'Immobilière Pujol au <a href="tel:0762203313" style="color:#aaa;text-decoration:underline">07&nbsp;62&nbsp;20&nbsp;33&nbsp;13</a> ou à <a href="mailto:rgpd@immobiliere-pujol.fr" style="color:#aaa;text-decoration:underline">rgpd@immobiliere-pujol.fr</a>.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:#0f1a2b;padding:28px 32px;border-radius:0 0 8px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;padding-right:16px" width="50%">
                <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff">Immobilière Pujol</p>
                <p style="margin:0;font-size:13px;color:#ffffff;line-height:1.7">
                  7 rue du Docteur Fiolle<br>
                  13006 Marseille
                </p>
                <p style="margin:12px 0 0;font-size:13px;color:#ffffff;line-height:1.7">
                  <strong>Site</strong> <a href="${SITE_URL}" style="color:#ffffff!important;text-decoration:none!important"><span style="color:#ffffff!important">www.immobiliere-pujol.fr</span></a><br>
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
                <p style="margin:12px 0 0;font-size:13px;color:#ffffff;line-height:1.7">
                  Accueil à l'agence sur rendez-vous uniquement
                </p>
              </td>
            </tr>
          </table>
          <hr style="border:none;border-top:1px solid #2a3a4b;margin:20px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding-bottom:16px">
              <a href="https://www.youtube.com/channel/UCqKIrOqKql-5A7sUsGuIphA" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/youtube-play.png" alt="YouTube" width="28" height="28" style="display:block;border:0">
              </a>
              <a href="https://www.instagram.com/immobiliere_pujol/" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/instagram-new.png" alt="Instagram" width="28" height="28" style="display:block;border:0">
              </a>
              <a href="https://www.facebook.com/immobilierepujol/" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/facebook-new.png" alt="Facebook" width="28" height="28" style="display:block;border:0">
              </a>
              <a href="https://www.linkedin.com/company/immobiliere-pujol/" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/linkedin.png" alt="LinkedIn" width="28" height="28" style="display:block;border:0">
              </a>
            </td></tr>
            <tr><td align="center">
              <p style="margin:0;font-size:12px;color:#ffffff;opacity:0.7;line-height:1.5">
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

async function sendAutoReply(
  env: Env,
  customerEmail: string,
  prénom: string,
  fromEmail?: string,
  fromName?: string,
  template?: { subject: string; body: string; signoff?: string },
): Promise<void> {
  if (!customerEmail || !customerEmail.includes('@')) return;
  try {
    await sendEmail(env, {
      subject: template?.subject ?? UNIFIED_AUTO_REPLY.subject,
      html: buildCustomerEmail({ prénom, bodyHtml: template?.body, signoff: template?.signoff }),
      to: customerEmail,
      fromEmail: fromEmail || 'contact@immobiliere-pujol.fr',
      fromName: fromName || 'Immobilière Pujol',
    });
  } catch {
    // Fire-and-forget
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
        <tr><td style="background-color:#0f1a2b;padding:20px 32px;border-radius:8px 8px 0 0" align="center">
          <img src="${STAGING_URL}/images/home/pujol-logo-white.png" alt="Immobilière Pujol" width="180" style="display:block;max-width:180px;height:auto">
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

        <!-- RGPD notice — compact (Caroline 12/06: minimal space) -->
        <tr><td style="background-color:#ffffff;padding:0 32px 14px">
          <hr style="border:none;border-top:1px solid #eef3ef;margin:0 0 8px">
          <p style="margin:0;font-size:9px;color:#aaa;line-height:1.3">
            Dans le cadre de nos activités, nous traitons les données à caractère personnel de nos clients, prospects, salariés, dans le respect du Règlement général sur les données personnelles (RGPD) et de la loi n°78-17 du 6 janvier 1978. Vous pouvez accéder aux informations relatives aux traitements de vos données et à vos droits via notre <a href="${RGPD_URL}" style="color:#aaa;text-decoration:underline">politique de traitement des données</a>. Vous pouvez vous opposer à l'utilisation de vos données à des fins de prospection en contactant l'Immobilière Pujol au <a href="tel:0762203313" style="color:#aaa;text-decoration:underline">07&nbsp;62&nbsp;20&nbsp;33&nbsp;13</a> ou à <a href="mailto:rgpd@immobiliere-pujol.fr" style="color:#aaa;text-decoration:underline">rgpd@immobiliere-pujol.fr</a>.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:#0f1a2b;padding:28px 32px;border-radius:0 0 8px 8px">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;padding-right:16px" width="50%">
                <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff">Immobilière Pujol</p>
                <p style="margin:0;font-size:13px;color:#ffffff;line-height:1.7">
                  7 rue du Docteur Fiolle<br>
                  13006 Marseille
                </p>
                <p style="margin:12px 0 0;font-size:13px;color:#ffffff;line-height:1.7">
                  <strong>Site</strong> <a href="${SITE_URL}" style="color:#ffffff!important;text-decoration:none!important"><span style="color:#ffffff!important">www.immobiliere-pujol.fr</span></a><br>
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
                <p style="margin:12px 0 0;font-size:13px;color:#ffffff;line-height:1.7">
                  Accueil à l'agence sur rendez-vous uniquement
                </p>
              </td>
            </tr>
          </table>

          <hr style="border:none;border-top:1px solid #2a3a4b;margin:20px 0">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding-bottom:16px">
              <a href="https://www.youtube.com/channel/UCqKIrOqKql-5A7sUsGuIphA" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/youtube-play.png" alt="YouTube" width="28" height="28" style="display:block;border:0">
              </a>
              <a href="https://www.instagram.com/immobiliere_pujol/" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/instagram-new.png" alt="Instagram" width="28" height="28" style="display:block;border:0">
              </a>
              <a href="https://www.facebook.com/immobilierepujol/" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/facebook-new.png" alt="Facebook" width="28" height="28" style="display:block;border:0">
              </a>
              <a href="https://www.linkedin.com/company/immobiliere-pujol/" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none">
                <img src="https://img.icons8.com/ios-filled/28/B2C54F/linkedin.png" alt="LinkedIn" width="28" height="28" style="display:block;border:0">
              </a>
            </td></tr>
            <tr><td align="center">
              <p style="margin:0;font-size:12px;color:#ffffff;opacity:0.7;line-height:1.5">
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

// ── Form definitions ────────────────────────────────────────────────────────
// Each form has: field mappings, routing (to/cc), sender identity, and sheet tab.

interface FormDef {
  subject: string;
  tab: string;
  fields: [string, string][];
  honeypot: string;
  emailField: string;
  to: string;
  cc?: string;
  fromEmail: string;
  fromName: string;
}

const D = '@immobiliere-pujol.fr'; // domain shorthand

const FORM_DEFS: Record<string, FormDef> = {
  // GF 4 — Contact général (routing done dynamically by dropdown, see handleContact)
  '4': {
    subject: 'Contact — Immobilière Pujol',
    tab: 'Contact général',
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
    to: `gabriella${D}`,          // default fallback; overridden by dropdown routing
    fromEmail: `contact${D}`,
    fromName: 'Immobilière Pujol',
  },
  // GF 12 — Urgence
  '12': {
    subject: 'Déclarer une urgence : {nom}',
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
    to: `stephanepujol${D}`,
    fromEmail: `stephanepujol${D}`,
    fromName: "Déclaration d'une urgence (site web)",
  },
  // GF 9 — Vendre (estimation)
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
    to: `benoit${D}`,
    fromEmail: `benoit${D}`,
    fromName: 'Immobilière Pujol — Vente',
  },
  // GF 1 — Gestion Locative (devis)
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
    to: `gaelle${D}`,
    fromEmail: `gaelle${D}`,
    fromName: 'Immobilière Pujol — Gestion Locative',
  },
  // GF 8 — Estimation de loyer (formerly "Mise en Location")
  '8': {
    subject: 'Demander une estimation de loyer : {nom}',
    tab: 'Estimation Loyer',
    fields: [
      ['Prénom', 'input_1.3'],
      ['Nom', 'input_1.6'],
      ['Email', 'input_2'],
      ['Téléphone', 'input_3'],
      ['Type de bien', 'input_10'],
      ['Adresse du bien', 'input_5'],
      ['Message', 'input_11'],
    ],
    honeypot: 'input_14',
    emailField: 'input_2',
    to: `gaelle${D}`,
    fromEmail: `stephanepujol${D}`,
    fromName: 'Demande estimation de loyer (site web)',
  },
  // GF 6 — Devis syndic
  '6': {
    subject: 'Demander un devis en syndic : {nom}',
    tab: 'Devis Syndic',
    fields: [
      ['Prénom', 'input_1.3'],
      ['Nom', 'input_1.6'],
      ['Email', 'input_2'],
      ['Téléphone', 'input_3'],
      ['Adresse copropriété', 'input_4'],
      ['Nombre de lots', 'input_5'],
      ['Message', 'input_6'],
    ],
    honeypot: 'input_9',
    emailField: 'input_2',
    to: `emeline${D}`,
    cc: `stephanepujol${D}`,
    fromEmail: `stephanepujol${D}`,
    fromName: "Demande d'un devis en syndic (site web)",
  },
  // GF 7 — Calculer honoraires syndic
  '7': {
    subject: 'Calculer vos honoraires de syndic : {nom}',
    tab: 'Honoraires Syndic',
    fields: [
      ['Prénom', 'input_7.3'],
      ['Nom', 'input_7.6'],
      ['Email', 'input_9'],
      ['Téléphone', 'input_8'],
      ['Rôle — Président CS', 'input_11.1'],
      ['Rôle — Membre CS', 'input_11.2'],
      ['Rôle — Copropriétaire', 'input_11.3'],
      ['Adresse', 'input_4.1'],
      ['Ville', 'input_4.3'],
      ['Code postal', 'input_4.5'],
      ['Nombre de lots', 'input_19'],
      ['Équipements', 'input_20'],
      ['Procédures / recouvrement', 'input_21'],
      ['Commentaires', 'input_17'],
    ],
    honeypot: 'input_24',
    emailField: 'input_9',
    to: `emeline${D}`,
    cc: `stephanepujol${D}`,
    fromEmail: `stephanepujol${D}`,
    fromName: 'Calculer vos honoraires de syndic',
  },
};

// ── Contact général — dropdown routing ──────────────────────────────────────
// The "Objet" dropdown value determines where the internal notification goes.

interface DropdownRoute {
  to: string;
  fromEmail: string;
  fromName: string;
}

const CONTACT_ROUTING: Record<string, DropdownRoute> = {
  'Location': {
    // Deflection — no internal notification, auto-reply from florian
    to: '',
    fromEmail: `florian${D}`,
    fromName: 'Immobilière Pujol — Location',
  },
  'Vente': {
    to: `benoit${D}`,
    fromEmail: `benoit${D}`,
    fromName: 'Immobilière Pujol — Vente',
  },
  'Gestion locative': {
    to: `gaelle${D}`,
    fromEmail: `gaelle${D}`,
    fromName: 'Immobilière Pujol — Gestion Locative',
  },
  'Achat': {
    to: `benoit${D}`,
    fromEmail: `benoit${D}`,
    fromName: 'Immobilière Pujol — Vente',
  },
  'Client syndic': {
    to: `stephanie${D}`,
    fromEmail: `stephanie${D}`,
    fromName: 'Immobilière Pujol — Syndic',
  },
  'Syndic devis': {
    to: `emeline${D}`,
    fromEmail: `emeline${D}`,
    fromName: 'Immobilière Pujol — Syndic',
  },
  'Autre': {
    to: `gabriella${D}`,
    fromEmail: `contact${D}`,
    fromName: 'Immobilière Pujol',
  },
};

// Match dropdown value to a route — the dropdown text is long, so we match by prefix.
function resolveContactRoute(objet: string): DropdownRoute {
  const lower = objet.toLowerCase();
  if (lower.startsWith('location')) return CONTACT_ROUTING['Location'];
  if (lower.startsWith('vente') || lower.startsWith('achat')) return CONTACT_ROUTING['Vente'];
  if (lower.startsWith('gestion')) return CONTACT_ROUTING['Gestion locative'];
  if (lower.startsWith('client syndic') || lower.startsWith('client')) return CONTACT_ROUTING['Client syndic'];
  if (lower.startsWith('syndic')) return CONTACT_ROUTING['Syndic devis'];
  if (lower.includes('urgence')) {
    return { to: `stephanepujol${D}`, fromEmail: `stephanepujol${D}`, fromName: 'Immobilière Pujol — Urgence' };
  }
  return CONTACT_ROUTING['Autre'];
}

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
  const prénom = rows.find(([l]) => l === 'Prénom')?.[1] || '';
  const nom = rows.find(([l]) => l === 'Nom')?.[1] || '';
  const fullName = [prénom, nom].filter(Boolean).join(' ') || 'Client';

  // Resolve {nom} placeholder in subject
  const subject = def.subject.replace('{nom}', fullName);

  // Determine routing — for GF 4, route by dropdown; others use def.to directly.
  let to = def.to;
  let cc = def.cc;
  let fromEmail = def.fromEmail;
  let fromName = def.fromName;

  if (formId === '4') {
    const objet = rows.find(([l]) => l === 'Objet')?.[1] || '';
    const route = resolveContactRoute(objet);
    fromEmail = route.fromEmail;
    fromName = route.fromName;

    if (!route.to) {
      // Location deflection — only send the location-specific auto-reply
      // (Caroline 11/06), no internal notification.
      if (replyTo) {
        await sendAutoReply(env, replyTo, prénom, fromEmail, fromName, LOCATION_AUTO_REPLY);
      }
      await logToSheet(def.tab, [now(), ...rows.map(([, v]) => v)]);
      return { ok: true };
    }

    to = route.to;
  }

  const emailResult = await sendEmail(env, {
    subject,
    html: buildTable(subject, rows),
    replyTo: replyTo || undefined,
    to,
    cc,
    fromEmail,
    fromName,
  });

  // Log to Google Sheet
  await logToSheet(def.tab, [now(), ...rows.map(([, v]) => v)]);

  // Send unified auto-reply
  if (replyTo) {
    await sendAutoReply(env, replyTo, prénom, fromEmail, fromName);
  }

  return emailResult;
}

async function handleContactAnnonce(fd: FormData, env: Env): Promise<{ ok: boolean; error?: string }> {
  const name = ((fd.get('name') as string) || '').trim();
  const email = ((fd.get('email') as string) || '').trim();
  const phone = ((fd.get('phone') as string) || '').trim();
  const message = ((fd.get('message') as string) || '').trim();
  const reference = ((fd.get('reference') as string) || '').trim();
  const title = ((fd.get('title') as string) || '').trim();
  // New hidden fields from ContactForm.astro
  const type = ((fd.get('type') as string) || '').trim();
  const codePostal = ((fd.get('code_postal') as string) || '').trim();
  const negociateur = ((fd.get('negociateur') as string) || '').trim();

  if (!name || !email) return { ok: false, error: 'Veuillez remplir les champs obligatoires.' };

  const isVente = type === 'V';
  const subjectPrefix = isVente ? 'Contact Annonce - Vente' : 'Contact Annonce - Location';
  const subject = `${subjectPrefix} : ${name}`;

  const tableRows: [string, string][] = [
    ['Annonce', `${title} (${reference})`],
    ['Référence', reference],
    ['Code postal', codePostal],
    ['Négociateur', negociateur],
    ['Type', isVente ? 'Vente' : 'Location'],
    ['Nom', name],
    ['Email', email],
    ['Téléphone', phone],
    ['Message', message],
  ];

  // Routing per brief:
  // Vente → negotiator (fallback annonces@) + Zoho parser
  // Location → Zoho parser only (Phase 1)
  const fromEmail = isVente ? `annonces${D}` : `annonces${D}`;
  const fromName = isVente
    ? `Contact du site web / annonce en vente`
    : `Contact du site web / annonce en location`;

  if (isVente) {
    // Send to negotiator (or fallback)
    const negotiatorEmail = negociateur && negociateur !== 'Immobilière Pujol'
      ? `annonces${D}`   // Phase 1: no structured negotiator email yet, fallback
      : `annonces${D}`;
    await sendEmail(env, {
      subject,
      html: buildTable(subject, tableRows),
      replyTo: email,
      to: negotiatorEmail,
      fromEmail,
      fromName,
    });
    // Also send to Zoho parser
    await sendEmail(env, {
      subject,
      html: buildTable(subject, tableRows),
      replyTo: email,
      to: ZOHO_PARSER,
      fromEmail,
      fromName,
    });
  } else {
    // Location Phase 1 — Zoho parser only
    await sendEmail(env, {
      subject,
      html: buildTable(subject, tableRows),
      replyTo: email,
      to: ZOHO_PARSER,
      fromEmail,
      fromName,
    });
  }

  await logToSheet('Annonces', [now(), reference, title, type, codePostal, negociateur, name, email, phone, message]);

  // Unified auto-reply — for Vente, sender visible = negotiator name (so client identifies interlocutor)
  const prénom = name.split(' ')[0];
  const replyFromName = isVente && negociateur && negociateur !== 'Immobilière Pujol'
    ? negociateur
    : fromName;
  await sendAutoReply(env, email, prénom, fromEmail, replyFromName);

  return { ok: true };
}

async function handleNewsletter(fd: FormData, env: Env): Promise<{ ok: boolean; error?: string }> {
  const email = ((fd.get('email') as string) || '').trim();
  if (!email) return { ok: false, error: 'Email requis.' };

  const subject = 'Nouvelle inscription newsletter — Immobilière Pujol';
  const html = buildTable(subject, [['Email', email]]);

  const emailResult = await sendEmail(env, {
    subject,
    html,
    to: `contact${D}`,
  });

  await logToSheet('Newsletter', [now(), email]);

  return emailResult;
}

// ── Sheet header setup (one-shot) ───────────────────────────────────────────

const SHEET_HEADERS: Record<string, string[]> = {
  'Contact général':   ['Date', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Objet', 'Message'],
  'Urgence':           ['Date', 'Profil', 'Prénom', 'Nom', 'Téléphone', 'Email', 'Adresse', 'Ville', 'Code postal', 'Étage', 'Description'],
  'Vente':             ['Date', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Message'],
  'Gestion Locative':  ['Date', 'Prénom', 'Nom', 'Téléphone', 'Email', 'Message'],
  'Estimation Loyer':  ['Date', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Type de bien', 'Adresse du bien', 'Message'],
  'Devis Syndic':      ['Date', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Adresse copropriété', 'Nombre de lots', 'Message'],
  'Honoraires Syndic': ['Date', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Rôle — Président CS', 'Rôle — Membre CS', 'Rôle — Copropriétaire', 'Adresse', 'Ville', 'Code postal', 'Nombre de lots', 'Équipements', 'Procédures / recouvrement', 'Commentaires'],
  'Annonces':          ['Date', 'Référence', 'Titre', 'Type (V/L)', 'Code postal', 'Négociateur', 'Nom', 'Email', 'Téléphone', 'Message'],
  'Newsletter':        ['Date', 'Email'],
};

// ── Worker entry point ──────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin, env) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    // GET /setup-headers — one-shot endpoint to write column headers to all Sheet tabs
    if (request.method === 'GET' && path === '/setup-headers') {
      const results: Record<string, string> = {};
      for (const [tab, headers] of Object.entries(SHEET_HEADERS)) {
        try {
          await logToSheet(tab, headers);
          results[tab] = 'ok';
        } catch {
          results[tab] = 'error';
        }
      }
      return new Response(JSON.stringify({ ok: true, results }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method !== 'POST') {
      return jsonErr('Method not allowed', 405, origin, env);
    }

    let fd: FormData;
    try {
      fd = await request.formData();
    } catch {
      return jsonErr('Invalid form data', 400, origin, env);
    }

    // Universal honeypot — a hidden "_hp" field present on every form. Humans
    // never see it; bots fill every field. If it's filled, silently accept
    // (return ok so the bot doesn't retry) and drop the submission.
    if (((fd.get('_hp') as string) || '').trim()) {
      return jsonOk({ ok: true }, origin, env);
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
