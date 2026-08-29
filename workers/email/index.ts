// Email worker — handles all contact form submissions via Mandrill.
// Deployed as a separate worker alongside the main Astro site.

interface Env {
  DB: D1Database;
  MANDRILL_API_KEY: string;
  ALLOWED_ORIGIN: string;
  TURNSTILE_SECRET?: string;
  // --- newsletter / Brevo (optional until provisioned; see newsletter-dev-spec.md) ---
  BREVO_API_KEY?: string;
  NEWSLETTER_LIST_ID?: string;
  // Allowlist of lists the composer may send to, "id:label" comma-separated, e.g.
  // "3:Newsletter,7:Vendeurs". Deliberately an env allowlist and NOT "every list
  // in the Brevo account": the recipient list being fixed in config is what makes
  // spec §9's "staging can never send to the real list" structural rather than a
  // matter of clicking the right dropdown entry. Unset → falls back to the single
  // NEWSLETTER_LIST_ID, i.e. exactly the previous behaviour.
  NEWSLETTER_LIST_IDS?: string;
  DOI_TEMPLATE_ID?: string;
  NEWSLETTER_SENDER_EMAIL?: string;
  NEWSLETTER_SENDER_NAME?: string;
  // Where replies to a newsletter go. Unset → the sender address. Never leave
  // it to Brevo's own default: that is the account owner (carolinepujol@).
  NEWSLETTER_REPLY_TO?: string;
  NEWSLETTER_CONFIRM_REDIRECT_URL?: string;
  NEWSLETTER_INTERNAL_TOKEN?: string;
  // ISO timestamp. Automatic reminders only consider signups on/after this
  // release cutoff, so historical pending contacts stay in the reviewed batch.
  NEWSLETTER_REMINDER_AUTO_FROM?: string;
  // Least-privilege token used only by cron-sync for matched-listing emails.
  // The site's newsletter token remains unchanged for opt-in and admin calls.
  ALERT_INTERNAL_TOKEN?: string;
  // Dedicated Brevo-verified sender for subscriber-facing alert emails
  // (opt-in / match / registered), e.g. alerte@alerte.immobiliere-pujol.fr.
  // Only set once the alerte sending domain is authenticated in Brevo —
  // an unverified sender makes Brevo reject the send. Unset → the shared
  // NEWSLETTER_SENDER_EMAIL sender, i.e. exactly the previous behaviour.
  ALERT_SENDER_EMAIL?: string;
}

const MANDRILL_URL = 'https://mandrillapp.com/api/1.0/messages/send';
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbyrEh_gNbjxEMs2O5D6QT5iyGEYF_yoBWzmtZM1i7SDm8YhbPY87vC6IzCYc2tJ1zHm/exec';
const ZOHO_PARSER = 'g9f4fx36@parser.eu.zohocrm.com';

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The public site posts here from the live domain, but every form hardcodes the
// staging worker URL (deploy-pujol.yml never rewrites it), so ALLOWED_ORIGIN —
// a staging URL on both deployments — never matched a production visitor. The
// worker still processed those submissions and mailed them; only the browser
// could not read the reply, so the form showed "Erreur de connexion" on a
// submission that had in fact gone through. Hence the live hostnames listed here.
const PROD_ORIGINS = [
  'https://www.immobiliere-pujol.fr',
  'https://immobiliere-pujol.fr',
  'https://immobiliere-pujol-staging.pujol.workers.dev',
];

function cors(origin: string, env: Env): Record<string, string> {
  const allowed = [
    env.ALLOWED_ORIGIN,
    ...PROD_ORIGINS,
    'http://localhost:4321',
    'http://localhost:3000',
  ];
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
  // Brevo-verified sender address that overrides the shared newsletter
  // sender for this message (must be active in Brevo or the send fails).
  senderEmail?: string;
}

// 21 Jul 2026: Mandrill died with the MailChimp account cancellation. Brevo is
// now the primary transactional provider (BREVO_API_KEY is set on both staging
// and prod workers); the Mandrill path remains only as a legacy fallback for
// environments where Brevo isn't provisioned.
//
// Sender note: the agency domain immobiliere-pujol.fr is NOT yet authenticated
// in Brevo, so we always send From the Brevo-verified sender
// (NEWSLETTER_SENDER_EMAIL) and keep the intended identity in the display name.
// Reply-To preserves the routing convention: internal notifications reply to
// the prospect; prospect auto-replies reply to the agent's real address. Once
// the domain is authenticated in Brevo, restore `sender.email = fromEmail`.
async function sendEmail(
  env: Env,
  opts: SendOpts
): Promise<{ ok: boolean; error?: string }> {
  if (env.BREVO_API_KEY) return sendViaBrevo(env, opts);
  return sendViaMandrill(env, opts);
}

async function sendViaBrevo(
  env: Env,
  opts: SendOpts
): Promise<{ ok: boolean; error?: string }> {
  const intendedFrom = opts.fromEmail || 'contact@immobiliere-pujol.fr';
  const payload = {
    sender: {
      email: opts.senderEmail || env.NEWSLETTER_SENDER_EMAIL || 'notifications@immobiliere-pujol.fr',
      name: opts.fromName || 'Immobilière Pujol',
    },
    to: [{ email: opts.to || 'contact@immobiliere-pujol.fr' }],
    ...(opts.cc ? { cc: [{ email: opts.cc }] } : {}),
    replyTo: { email: opts.replyTo || intendedFrom },
    subject: opts.subject,
    htmlContent: opts.html,
    tags: ['source=site-public'],
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY!, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as any;
      return { ok: false, error: data?.message || `Brevo HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Network error' };
  }
}

async function sendViaMandrill(
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

// Upsert one row keyed by a column value (e.g. Email), so a newsletter signup
// that arrives as two POSTs — step 1 (email) then step 2 (name + interests) —
// lands on a SINGLE row instead of two appends. The Apps Script matches `key`
// in `data`, updates the existing row's provided non-empty cells, or inserts a
// new row. Public form callers keep the fire-and-forget behaviour; scheduled
// reconciliation uses strict mode so a failed write marks the cron run failed.
interface SheetUpsertOptions {
  writeOnce?: string[];
  strict?: boolean;
}

async function upsertSheet(
  tab: string,
  key: string,
  data: Record<string, string>,
  options: SheetUpsertOptions = {},
): Promise<boolean> {
  try {
    const res = await fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify({ tab, key, data, writeOnce: options.writeOnce || [] }),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Sheets HTTP ${res.status}`);

    const result = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!result?.ok) throw new Error(result?.error || 'Réponse Sheets invalide');
    return true;
  } catch (err) {
    if (options.strict) throw err;
    // Fire-and-forget — don't block the response if Sheets is down
    return false;
  }
}

async function updateExistingSheetRows(
  tab: string,
  key: string,
  records: Record<string, string>[],
  writeOnce: string[] = [],
): Promise<{ matchedRecords: number; updatedRows: number }> {
  const res = await fetch(SHEETS_URL, {
    method: 'POST',
    body: JSON.stringify({ tab, key, records, updateOnly: true, writeOnce }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Sheets HTTP ${res.status}`);

  const result = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    matchedRecords?: number;
    updatedRows?: number;
  } | null;
  if (!result?.ok) throw new Error(result?.error || 'Réponse Sheets invalide');
  return {
    matchedRecords: result.matchedRecords || 0,
    updatedRows: result.updatedRows || 0,
  };
}

interface NewsletterReminderState {
  email: string;
  signup_at: string;
  reminder_at: string | null;
}

async function ensureNewsletterReminderSchema(env: Env): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS newsletter_reminders (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    signup_at TEXT NOT NULL,
    reminder_at TEXT
  )`).run();
}

async function recordPendingNewsletterSignup(env: Env, email: string, signupAt: string): Promise<void> {
  await ensureNewsletterReminderSchema(env);
  await env.DB.prepare(`INSERT INTO newsletter_reminders (email, signup_at, reminder_at)
    VALUES (?, ?, NULL)
    ON CONFLICT(email) DO UPDATE SET signup_at = MIN(newsletter_reminders.signup_at, excluded.signup_at)`)
    .bind(email.trim().toLowerCase(), signupAt)
    .run();
}

async function fetchNewsletterReminderStates(env: Env, emails: string[]): Promise<NewsletterReminderState[]> {
  await ensureNewsletterReminderSchema(env);
  if (!emails.length) return [];
  const placeholders = emails.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT email, signup_at, reminder_at FROM newsletter_reminders WHERE email IN (${placeholders})`,
  ).bind(...emails).all<NewsletterReminderState>();
  return result.results || [];
}

async function fetchDueNewsletterReminders(env: Env, start: string, cutoff: string): Promise<NewsletterReminderState[]> {
  await ensureNewsletterReminderSchema(env);
  const result = await env.DB.prepare(`SELECT email, signup_at, reminder_at
    FROM newsletter_reminders
    WHERE reminder_at IS NULL AND signup_at >= ? AND signup_at <= ?
    ORDER BY signup_at ASC
    LIMIT 50`)
    .bind(start, cutoff)
    .all<NewsletterReminderState>();
  return result.results || [];
}

const SITE_URL = 'https://www.immobiliere-pujol.fr';
const STAGING_URL = 'https://immobiliere-pujol-staging.roy-68a.workers.dev';
const RGPD_URL = 'https://www.declarations-juridiques.fr/processing-policy/immobiliere-pujol_056808868';

// Sender for INTERNAL form notifications. Must NOT be one of the recipient
// agents: Gmail ignores Reply-To when you reply to a mail that appears to come
// from your own address (it replies to the To/Cc instead), so an agent who is
// both the From and a recipient could never "Répondre" straight to the prospect.
// A neutral address keeps From != recipient, so Reply-To (the prospect) wins.
// The prospect-facing auto-reply still goes out from the agent identity.
const NOTIFY_FROM = 'notifications@immobiliere-pujol.fr';

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
                  <a href="https://www.immobiliere-pujol.fr/contact-immobiliere-pujol/" style="color:#ffffff!important;text-decoration:underline!important"><span style="color:#ffffff!important">Contactez-nous</span></a>
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
                  <a href="https://www.immobiliere-pujol.fr/contact-immobiliere-pujol/" style="color:#ffffff!important;text-decoration:underline!important"><span style="color:#ffffff!important">Contactez-nous</span></a>
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

async function handleContact(fd: FormData, env: Env, ctx: ExecutionContext): Promise<{ ok: boolean; error?: string }> {
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
      // (Caroline 11/06), no internal notification. Deferred so the browser
      // gets its response immediately.
      if (replyTo) {
        ctx.waitUntil(sendAutoReply(env, replyTo, prénom, fromEmail, fromName, LOCATION_AUTO_REPLY));
      }
      ctx.waitUntil(logToSheet(def.tab, [now(), ...rows.map(([, v]) => v)]));
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
    fromEmail: NOTIFY_FROM,
    fromName,
  });

  // Log to Google Sheet + send the auto-reply in the background so the browser
  // gets its response right after the notification send (not 2-3s later).
  ctx.waitUntil(logToSheet(def.tab, [now(), ...rows.map(([, v]) => v)]));
  if (replyTo) {
    ctx.waitUntil(sendAutoReply(env, replyTo, prénom, fromEmail, fromName));
  }

  return emailResult;
}

async function handleContactAnnonce(fd: FormData, env: Env, ctx: ExecutionContext): Promise<{ ok: boolean; error?: string }> {
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
  const negociateurEmail = ((fd.get('negociateur_email') as string) || '').trim().toLowerCase();

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
    // Route to the negotiator shown on the listing — their email is passed as a
    // hidden field (the conseiller displayed on the annonce page = email_a_afficher).
    // Validate it is an internal @immobiliere-pujol.fr address so a tampered form
    // can't make us mail an arbitrary recipient; fall back to the shared annonces@
    // box when it's missing/unknown.
    const negotiatorEmail = negociateurEmail.endsWith('@immobiliere-pujol.fr')
      ? negociateurEmail
      : `annonces${D}`;
    await sendEmail(env, {
      subject,
      html: buildTable(subject, tableRows),
      replyTo: email,
      to: negotiatorEmail,
      fromEmail: NOTIFY_FROM,
      fromName,
    });
    // Also send to Zoho parser
    ctx.waitUntil(sendEmail(env, {
      subject,
      html: buildTable(subject, tableRows),
      replyTo: email,
      to: ZOHO_PARSER,
      fromEmail,
      fromName,
    }));
  } else {
    // Location Phase 1 — Zoho parser only
    ctx.waitUntil(sendEmail(env, {
      subject,
      html: buildTable(subject, tableRows),
      replyTo: email,
      to: ZOHO_PARSER,
      fromEmail,
      fromName,
    }));
  }

  ctx.waitUntil(logToSheet('Annonces', [now(), reference, title, type, codePostal, negociateur, name, email, phone, message]));

  // Unified auto-reply — for Vente, sender visible = negotiator name (so client identifies interlocutor)
  const prénom = name.split(' ')[0];
  const replyFromName = isVente && negociateur && negociateur !== 'Immobilière Pujol'
    ? negociateur
    : fromName;
  ctx.waitUntil(sendAutoReply(env, email, prénom, fromEmail, replyFromName));

  return { ok: true };
}

// Newsletter signup — Brevo double opt-in (newsletter-dev-spec.md §3.2).
//
// ⚠️ DOUBLE-GATED ON PURPOSE — read before loosening either condition.
//
// This worker is NOT staging-only. The PRODUCTION site posts here too: the
// `pujol-main` footer hardcodes `action="https://pujol-email.roy-68a.workers.dev
// /newsletter"` and deploy-pujol.yml never patches it (spec §6.2 is unresolved).
// So an unguarded DOI path would send REAL customers a confirmation from whatever
// Brevo account holds BREVO_API_KEY — currently a personal free account sending
// from a gmail address, into a test list — and would drop Caroline's per-signup
// copy. The two gates below keep that from happening by accident:
//
//   1. CONFIG  — all of BREVO_API_KEY + DOI_TEMPLATE_ID + NEWSLETTER_LIST_ID set.
//   2. ORIGIN  — the request comes from ALLOWED_ORIGIN (this worker's own
//                environment, i.e. the staging site). Production posts from a
//                different origin and therefore keeps the pre-Brevo behaviour.
//
// Origin is a routing signal, NOT a security boundary (a bot can forge the
// header); it is here to keep environments apart while Brevo is a test account.
// To curl the DOI path, send `-H "Origin: <ALLOWED_ORIGIN>"`.
//
// Before arming this for production: resolve §6.2 (per-environment worker URL),
// move to the client's own Brevo account (§1.1), authenticate
// news.immobiliere-pujol.fr (§1.3), and create the DOI template (§1.2).
async function requestDoiEmail(
  env: Env,
  email: string,
  attributes?: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  if (!env.BREVO_API_KEY || !env.DOI_TEMPLATE_ID || !env.NEWSLETTER_LIST_ID) {
    return { ok: false, error: 'Double opt-in non configuré.' };
  }
  const res = await fetch(`${BREVO}/contacts/doubleOptinConfirmation`, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      includeListIds: [Number(env.NEWSLETTER_LIST_ID)],
      templateId: Number(env.DOI_TEMPLATE_ID),
      redirectionUrl: env.NEWSLETTER_CONFIRM_REDIRECT_URL,
      ...(attributes ? { attributes } : {}),
    }),
  });
  if (!res.ok) {
    console.error(`Brevo DOI ${res.status}: ${await res.text().catch(() => '')}`);
    return { ok: false, error: 'Inscription impossible pour le moment.' };
  }
  return { ok: true };
}

async function handleNewsletter(fd: FormData, env: Env, ctx: ExecutionContext, origin: string): Promise<{ ok: boolean; error?: string; doi?: boolean }> {
  const email = ((fd.get('email') as string) || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { ok: false, error: 'Email invalide.' };

  const configured = !!(env.BREVO_API_KEY && env.DOI_TEMPLATE_ID && env.NEWSLETTER_LIST_ID);
  const isOwnEnv = !!env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN;
  const doiReady = configured && isOwnEnv;

  const subject = 'Nouvelle inscription newsletter — Immobilière Pujol';
  const notifyRows: [string, string][] = [['Email', email]];
  if (doiReady) notifyRows.push(['Statut', 'en attente de confirmation (double opt-in)']);
  const notify = () =>
    sendEmail(env, {
      subject,
      html: buildTable(subject, notifyRows),
      to: `contact${D}`,
      cc: `carolinepujol${D}`,   // Caroline wants a copy of every newsletter signup
    });

  // Pre-Brevo behaviour — unchanged, including surfacing a send failure as an error.
  if (!doiReady) {
    const emailResult = await notify();
    ctx.waitUntil(upsertSheet('Newsletter', 'Email', {
      Date: now(), Email: email, 'Statut opt-in': 'Inscrit (sans double opt-in)',
    }));
    return emailResult;
  }

  // Brevo sends the branded confirmation; the contact joins the list only after
  // they click. Brevo records consent date/source = our RGPD registry (§3.2/§8).
  const doiResult = await requestDoiEmail(env, email, {
    SOURCE: 'site',
    OPTIN_DATE: new Date().toISOString(),
  });

  // Brevo answers 201 both for a new signup and for an existing/already-confirmed
  // contact (it simply re-sends the confirmation), so this endpoint has no
  // "already exists" 400 to swallow — that is POST /contacts' behaviour, not this
  // one's. Every 400 here is a real fault (invalid address, missing
  // redirectionUrl, no active DOI template), so surface it instead of promising
  // the visitor a confirmation email that was never sent.
  if (!doiResult.ok) return doiResult;

  ctx.waitUntil(upsertSheet('Newsletter', 'Email', {
    Date: now(), Email: email, 'Statut opt-in': 'En attente (double opt-in)',
  }));
  ctx.waitUntil(recordPendingNewsletterSignup(env, email, new Date().toISOString()));
  ctx.waitUntil(notify().then(() => undefined));   // keep Caroline's copy, non-blocking

  return { ok: true, doi: true };
}

// /newsletter/profile — the signup card's optional step 2. After the email DOI,
// the visitor may add their name + topic interests inline; we enrich the SAME
// Brevo contact (keyed by email) with FIRSTNAME/LASTNAME + INT_* boolean
// attributes. This implies no new consent and adds no list — the opt-in already
// happened at the email step. Origin-gated like the DOI path so environments
// stay apart; outside the DOI env it silently no-ops (still 200) so the UI flows.
async function handleNewsletterProfile(fd: FormData, env: Env, ctx: ExecutionContext, origin: string): Promise<{ ok: boolean; error?: string }> {
  const email = ((fd.get('email') as string) || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { ok: false, error: 'Email invalide.' };

  const configured = !!(env.BREVO_API_KEY && env.NEWSLETTER_LIST_ID);
  const isOwnEnv = !!env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN;
  if (!configured || !isOwnEnv) return { ok: true };   // no-op outside the Brevo/DOI env

  const firstname = ((fd.get('firstname') as string) || '').trim().slice(0, 80);
  const lastname = ((fd.get('lastname') as string) || '').trim().slice(0, 80);
  const picked = fd.getAll('interests').map((v) => String(v));

  // Enrich the SAME sheet row (keyed by email) with name + interests. Only
  // non-empty cells overwrite, so this never blanks step 1's Date / opt-in.
  const sheetData: Record<string, string> = {
    Email: email,
    'Intérêt Location': picked.includes('location') ? 'Oui' : 'Non',
    'Intérêt Vente': picked.includes('vente') ? 'Oui' : 'Non',
    'Intérêt Syndic': picked.includes('syndic') ? 'Oui' : 'Non',
    'Tous sujets': picked.includes('tous') ? 'Oui' : 'Non',
  };
  if (firstname) sheetData['Prénom'] = firstname;
  if (lastname) sheetData['Nom'] = lastname;
  ctx.waitUntil(upsertSheet('Newsletter', 'Email', sheetData));

  const attributes: Record<string, string | boolean> = {
    INT_LOCATION: picked.includes('location'),
    INT_VENTE: picked.includes('vente'),
    INT_SYNDIC: picked.includes('syndic'),
    INT_TOUS: picked.includes('tous'),
  };
  if (firstname) attributes.FIRSTNAME = firstname;
  if (lastname) attributes.LASTNAME = lastname;

  // POST /contacts with updateEnabled updates the existing (pending-DOI) contact;
  // no listIds/opt-in change here — attributes only.
  const res = await fetch(`${BREVO}/contacts`, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email, attributes, updateEnabled: true }),
  });
  if (!res.ok && res.status !== 204) {
    console.error(`Brevo profile ${res.status}: ${await res.text().catch(() => '')}`);
    return { ok: false, error: 'Enregistrement impossible pour le moment.' };
  }
  return { ok: true };
}

// ── Newsletter — Brevo campaign endpoints (internal, JSON body) ─────────────
// Called by the main app (composer) over HTTP with a shared internal token. All
// Brevo access is centralised here so BREVO_API_KEY lives in one place. These
// are inert until the Brevo secrets/vars are provisioned (return 501).
const BREVO = 'https://api.brevo.com/v3';

interface BrevoContact {
  email?: string;
  listIds?: number[];
}

interface BrevoEmailEvent {
  date?: string;
  email?: string;
}

function parisDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

async function fetchBrevoPages<T>(
  env: Env,
  path: string,
  itemKey: 'contacts' | 'events',
  limit: number,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;

  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BREVO}${path}${separator}limit=${limit}&offset=${offset}`, {
      headers: { 'api-key': env.BREVO_API_KEY as string },
    });
    if (!res.ok) throw new Error(`Brevo ${path} HTTP ${res.status}`);

    const payload = (await res.json()) as Record<string, unknown>;
    const page = Array.isArray(payload[itemKey]) ? payload[itemKey] as T[] : [];
    items.push(...page);
    if (page.length < limit) return items;
    offset += limit;
  }
}

// Brevo owns the confirmation click and exposes no callback to this Worker.
// Reconcile the source of truth once a day instead: confirmed contacts are list
// members, and DOI click events provide the consent timestamp. The production
// origin guard is intentional because the staging worker shares the live Sheet.
async function fetchConfirmedNewsletterEmails(env: Env): Promise<Set<string>> {
  if (!env.BREVO_API_KEY || !env.NEWSLETTER_LIST_ID) {
    throw new Error('Newsletter Brevo non configurée');
  }
  const listId = Number(env.NEWSLETTER_LIST_ID);
  if (!Number.isSafeInteger(listId) || listId <= 0) throw new Error('NEWSLETTER_LIST_ID invalide');
  const contacts = await fetchBrevoPages<BrevoContact>(
    env,
    `/contacts?sort=asc&listIds=${encodeURIComponent(String(listId))}`,
    'contacts',
    1000,
  );
  return new Set(contacts
    .filter((contact) => contact.email && contact.listIds?.includes(listId))
    .map((contact) => contact.email!.trim().toLowerCase()));
}

async function reconcileNewsletterSheet(env: Env): Promise<Set<string>> {
  if (env.ALLOWED_ORIGIN !== SITE_URL) return new Set();
  if (!env.BREVO_API_KEY || !env.NEWSLETTER_LIST_ID || !env.DOI_TEMPLATE_ID) {
    throw new Error('Newsletter Sheet sync is not configured');
  }

  const confirmedEmails = await fetchConfirmedNewsletterEmails(env);

  const events = await fetchBrevoPages<BrevoEmailEvent>(
    env,
    `/smtp/statistics/events?days=90&event=clicks&templateId=${encodeURIComponent(env.DOI_TEMPLATE_ID)}`,
    'events',
    5000,
  );
  const firstClickByEmail = new Map<string, string>();
  for (const event of events) {
    const email = event.email?.trim().toLowerCase();
    if (!email || !event.date) continue;
    const current = firstClickByEmail.get(email);
    if (!current || Date.parse(event.date) < Date.parse(current)) {
      firstClickByEmail.set(email, event.date);
    }
  }

  let withoutClickTimestamp = 0;
  const records = [...confirmedEmails].map((email) => {
    const confirmationDate = firstClickByEmail.get(email);
    if (!confirmationDate) withoutClickTimestamp++;
    return {
      Email: email,
      'Statut opt-in': 'Confirmé (double opt-in)',
      ...(confirmationDate ? { 'Date confirmation': parisDate(confirmationDate) } : {}),
    };
  });

  // updateOnly makes the Sheet itself the allowlist: imported/repermission
  // contacts absent from the production signup log are never inserted. This is
  // more robust than Brevo's free-text SOURCE attribute, whose historical values
  // are not controlled. The Apps Script matches and updates duplicate rows.
  const sheetResult = await updateExistingSheetRows(
    'Newsletter',
    'Email',
    records,
    ['Date confirmation'],
  );

  console.log(JSON.stringify({
    event: 'newsletter_sheet_reconciled',
    confirmedListContacts: confirmedEmails.size,
    matchedSheetRecords: sheetResult.matchedRecords,
    updatedSheetRows: sheetResult.updatedRows,
    withoutClickTimestamp,
  }));
  return confirmedEmails;
}

async function markNewsletterReminder(env: Env, email: string): Promise<void> {
  await ensureNewsletterReminderSchema(env);
  const reminderAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO newsletter_reminders (email, signup_at, reminder_at)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET reminder_at = COALESCE(newsletter_reminders.reminder_at, excluded.reminder_at)`)
    .bind(email, reminderAt, reminderAt)
    .run();
  const sheetSaved = await upsertSheet('Newsletter', 'Email', {
    Email: email,
    'Date rappel opt-in': now(),
  }, { writeOnce: ['Date rappel opt-in'] });
  if (!sheetSaved) console.warn(JSON.stringify({ event: 'newsletter_reminder_sheet_mark_failed' }));
}

async function sendEligibleNewsletterReminders(
  env: Env,
  emails: string[],
  confirmedEmails: Set<string>,
  limit: number,
): Promise<{ eligible: number; sent: number; failed: number; excludedConfirmed: number; excludedAlreadyReminded: number }> {
  const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const states = await fetchNewsletterReminderStates(env, unique);
  const reminded = new Set(states.filter((state) => !!state.reminder_at).map((state) => state.email));
  const candidates = unique.filter((email) => !reminded.has(email));
  let sent = 0;
  let failed = 0;
  let excludedConfirmed = 0;
  const excludedAlreadyReminded = reminded.size;
  for (const email of candidates.slice(0, limit)) {
    if (confirmedEmails.has(email)) {
      excludedConfirmed++;
      continue;
    }
    // Reminder calls deliberately omit OPTIN_DATE so the original signup date
    // remains the consent-history timestamp in Brevo and in the Sheet.
    const result = await requestDoiEmail(env, email);
    if (!result.ok) {
      failed++;
      continue;
    }
    await markNewsletterReminder(env, email);
    sent++;
  }
  return {
    eligible: candidates.filter((email) => !confirmedEmails.has(email)).length,
    sent,
    failed,
    excludedConfirmed,
    excludedAlreadyReminded,
  };
}

async function runAutomaticNewsletterReminders(env: Env, confirmedEmails: Set<string>): Promise<void> {
  if (env.ALLOWED_ORIGIN !== SITE_URL || !env.NEWSLETTER_REMINDER_AUTO_FROM) return;
  const start = Date.parse(env.NEWSLETTER_REMINDER_AUTO_FROM);
  if (!Number.isFinite(start)) throw new Error('NEWSLETTER_REMINDER_AUTO_FROM invalide');
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await fetchDueNewsletterReminders(env, new Date(start).toISOString(), cutoff);
  const result = await sendEligibleNewsletterReminders(env, rows.map((row) => row.email), confirmedEmails, 50);
  console.log(JSON.stringify({ event: 'newsletter_reminders_automatic', ...result }));
}

async function handleNewsletterReminders(req: Request, env: Env): Promise<Response> {
  const guard = nlGuard(req, env);
  if (guard) return guard;
  if (env.ALLOWED_ORIGIN !== SITE_URL || !env.DOI_TEMPLATE_ID || !env.NEWSLETTER_LIST_ID) {
    return nlJson({ error: 'Rappels newsletter non configurés.' }, 501);
  }
  let rawBody: unknown;
  try { rawBody = await req.json(); } catch { return nlJson({ error: 'JSON invalide.' }, 400); }
  if (!rawBody || typeof rawBody !== 'object') return nlJson({ error: 'JSON invalide.' }, 400);
  const body = rawBody as { dryRun?: unknown; emails?: unknown };
  const emails = Array.isArray(body.emails) ? body.emails.filter((email): email is string => typeof email === 'string') : [];
  const requested = new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.includes('@')));
  if (!requested.size || requested.size > 100) return nlJson({ error: 'Liste de destinataires invalide.' }, 400);

  const [states, confirmedEmails] = await Promise.all([
    fetchNewsletterReminderStates(env, [...requested]),
    fetchConfirmedNewsletterEmails(env),
  ]);
  const reminded = new Set(states.filter((state) => !!state.reminder_at).map((state) => state.email));
  const eligible = [...requested].filter((email) => !reminded.has(email) && !confirmedEmails.has(email));
  // The caller supplies the manually reviewed historical pending allowlist.
  // Future signups are recorded directly in D1 by handleNewsletter().
  const summary = {
    requested: requested.size,
    eligible: eligible.length,
    excludedConfirmed: [...requested].filter((email) => confirmedEmails.has(email)).length,
    excludedNotPending: 0,
    excludedAlreadyReminded: [...reminded].filter((email) => !confirmedEmails.has(email)).length,
  };
  if (body.dryRun !== false) return nlJson({ ok: true, dryRun: true, ...summary });

  const result = await sendEligibleNewsletterReminders(env, eligible, confirmedEmails, 100);
  console.log(JSON.stringify({ event: 'newsletter_reminders_one_time', requested: summary.requested, ...result }));
  return nlJson({ ok: result.failed === 0, dryRun: false, ...summary, sent: result.sent, failed: result.failed }, result.failed ? 502 : 200);
}
function nlJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function nlGuard(req: Request, env: Env): Response | null {
  if (!env.NEWSLETTER_INTERNAL_TOKEN || req.headers.get('x-internal-token') !== env.NEWSLETTER_INTERNAL_TOKEN)
    return nlJson({ error: 'Forbidden' }, 403);
  if (!env.BREVO_API_KEY) return nlJson({ error: 'Newsletter non configurée (BREVO_API_KEY manquant).' }, 501);
  return null;
}

function alertMatchGuard(req: Request, env: Env): Response | null {
  if (!env.ALERT_INTERNAL_TOKEN || req.headers.get('x-internal-token') !== env.ALERT_INTERNAL_TOKEN)
    return nlJson({ error: 'Forbidden' }, 403);
  if (!env.BREVO_API_KEY) return nlJson({ error: 'Alertes non configurées (BREVO_API_KEY manquant).' }, 501);
  return null;
}

// ── Recipient-list allowlist ────────────────────────────────────────────────
// The composer may only send to a list named here. This worker is the ONLY
// enforcement point: the admin UI's dropdown is a convenience, and a caller
// holding the internal token could otherwise post any list id it liked.
interface AllowedList { id: number; label: string; }

function allowedLists(env: Env): AllowedList[] {
  const raw = (env.NEWSLETTER_LIST_IDS || '').trim();
  if (raw) {
    const out: AllowedList[] = [];
    for (const part of raw.split(',')) {
      const s = part.trim();
      if (!s) continue;
      const i = s.indexOf(':');                      // labels may contain ':'? take the FIRST colon only
      const id = Number((i === -1 ? s : s.slice(0, i)).trim());
      if (!Number.isInteger(id) || id <= 0) continue;  // skip junk rather than send somewhere unintended
      out.push({ id, label: (i === -1 ? '' : s.slice(i + 1).trim()) || `Liste ${id}` });
    }
    if (out.length) return out;
  }
  // Fallback: the single configured list = the pre-allowlist behaviour.
  const single = Number(env.NEWSLETTER_LIST_ID);
  return Number.isInteger(single) && single > 0 ? [{ id: single, label: 'Newsletter' }] : [];
}

// Resolve the requested list to an allowed one. Returns null if it isn't allowed,
// so the caller can refuse rather than silently retarget the send.
function resolveList(env: Env, requested: unknown): AllowedList | null {
  const lists = allowedLists(env);
  if (!lists.length) return null;
  if (requested === undefined || requested === null || requested === '') return lists[0];
  const id = Number(requested);
  return lists.find((l) => l.id === id) || null;
}

// POST /newsletter/lists — the lists this environment may send to (for the composer),
// each with its live emailable count = Brevo totalSubscribers minus blacklisted,
// i.e. exactly how many addresses a campaign to that list actually leaves for.
// Count is best-effort: on any Brevo hiccup the list still appears with count:null
// so the composer never loses its send target, it just can't show the number.
async function handleNewsletterLists(req: Request, env: Env): Promise<Response> {
  const bad = nlGuard(req, env); if (bad) return bad;
  const base = allowedLists(env);
  const lists = await Promise.all(base.map(async (l) => {
    if (!env.BREVO_API_KEY) return { ...l, count: null };
    try {
      const res = await fetch(`${BREVO}/contacts/lists/${l.id}`, { headers: { 'api-key': env.BREVO_API_KEY } });
      if (!res.ok) return { ...l, count: null };
      const j: any = await res.json();
      const total = Number(j.totalSubscribers ?? j.uniqueSubscribers ?? 0);
      const blacklisted = Number(j.totalBlacklisted ?? 0);
      return { ...l, count: Math.max(0, total - blacklisted) };
    } catch { return { ...l, count: null }; }
  }));
  return nlJson({ ok: true, lists });
}

// POST /newsletter/send — create + send a Brevo campaign to a permitted list.
async function handleNewsletterSend(req: Request, env: Env): Promise<Response> {
  const bad = nlGuard(req, env); if (bad) return bad;
  const { subject, html, campaignName, listId } = (await req.json().catch(() => ({}))) as any;
  if (!subject || !html) return nlJson({ error: 'subject + html requis' }, 400);

  // Refuse rather than fall back to the default list: a caller that asked for a
  // specific audience must never be silently redirected to a different one.
  const list = resolveList(env, listId);
  if (!list) {
    return nlJson({
      error: listId ? `Liste ${listId} non autorisée pour cet environnement.` : 'Aucune liste configurée.',
      allowed: allowedLists(env),
    }, 400);
  }

  const create = await fetch(`${BREVO}/emailCampaigns`, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: campaignName || `Newsletter ${now()}`,
      subject,
      sender: { name: env.NEWSLETTER_SENDER_NAME, email: env.NEWSLETTER_SENDER_EMAIL },
      // Without an explicit replyTo, Brevo falls back to the account owner's
      // address — carolinepujol@ — so every "reply" to a newsletter would land
      // in her personal inbox instead of the shared contact box.
      replyTo: env.NEWSLETTER_REPLY_TO || env.NEWSLETTER_SENDER_EMAIL,
      htmlContent: html,
      recipients: { listIds: [list.id] },
    }),
  });
  if (!create.ok) return nlJson({ error: 'Brevo create failed', detail: await create.text() }, 502);
  const { id: campaignId } = (await create.json()) as { id: number };

  const send = await fetch(`${BREVO}/emailCampaigns/${campaignId}/sendNow`, {
    method: 'POST', headers: { 'api-key': env.BREVO_API_KEY! },
  });
  if (!send.ok) return nlJson({ error: 'Brevo send failed', detail: await send.text(), campaignId }, 502);
  return nlJson({ ok: true, campaignId, listId: list.id, listLabel: list.label });
}

// POST /newsletter/test — send the rendered HTML to a single address (transactional).
async function handleNewsletterTest(req: Request, env: Env): Promise<Response> {
  const bad = nlGuard(req, env); if (bad) return bad;
  const { testEmail, subject, html } = await req.json().catch(() => ({} as any));
  if (!testEmail || !html) return nlJson({ error: 'testEmail + html requis' }, 400);
  const res = await fetch(`${BREVO}/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: env.NEWSLETTER_SENDER_NAME, email: env.NEWSLETTER_SENDER_EMAIL },
      replyTo: { email: env.NEWSLETTER_REPLY_TO || env.NEWSLETTER_SENDER_EMAIL as string },
      to: [{ email: testEmail }],
      subject: subject || '[TEST] Newsletter',
      htmlContent: html,
    }),
  });
  if (!res.ok) return nlJson({ error: 'Brevo test failed', detail: await res.text() }, 502);
  return nlJson({ ok: true });
}

// POST /newsletter/stats — fetch campaign statistics for the in-admin history.
async function handleNewsletterStats(req: Request, env: Env): Promise<Response> {
  const bad = nlGuard(req, env); if (bad) return bad;
  const { campaignId } = await req.json().catch(() => ({} as any));
  if (!campaignId) return nlJson({ error: 'campaignId requis' }, 400);
  const res = await fetch(`${BREVO}/emailCampaigns/${campaignId}`, { headers: { 'api-key': env.BREVO_API_KEY! } });
  if (!res.ok) return nlJson({ error: 'Brevo stats failed', detail: await res.text() }, 502);
  const data = (await res.json()) as any;
  return nlJson({ ok: true, stats: data?.statistics?.globalStats ?? null });
}

// ── Alerts (annonces) : double opt-in email + agency lead notification ───────
// Called by the site's /api/alerts/* routes (they hold the D1 binding) with a
// JSON body + x-internal-token. This worker only renders + sends the emails.

const PUJOL_LOGO = 'https://www.immobiliere-pujol.fr/images/home/pujol-logo-white.png';

function alertGreeting(prenom: string, nom: string): string {
  const fullName = [prenom, nom].filter(Boolean).join(' ');
  return fullName ? `Bonjour ${esc(fullName)},` : 'Bonjour,';
}

function buildAlertOptin(prenom: string, nom: string, criteriaText: string, confirmUrl: string): string {
  const hi = alertGreeting(prenom, nom);
  const safeCriteria = esc(criteriaText);
  const safeConfirmUrl = esc(confirmUrl);
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#eef3ef;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ef;padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background:#0f1a2b;padding:20px 32px;border-radius:8px 8px 0 0" align="center">
        <img src="${PUJOL_LOGO}" alt="Immobilière Pujol" width="180" style="display:block;max-width:180px;height:auto"></td></tr>
      <tr><td style="background:#B2C54F;height:4px;font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="background:#fff;padding:32px 32px 24px">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#0f1a2b;text-transform:uppercase;letter-spacing:.8px"><span style="border-bottom:2px solid #B2C54F;padding-bottom:3px">Alerte annonces</span></p>
        <h1 style="margin:20px 0 16px;font-size:24px;line-height:1.3;color:#0f1a2b;font-weight:700">Confirmez votre alerte</h1>
        <div style="font-size:14px;color:#3a3a3a;line-height:1.7">
          <p style="margin:0 0 14px">${hi}</p>
          <p style="margin:0 0 14px">Vous souhaitez être prévenu(e) dès qu'un bien correspond à votre recherche&nbsp;:</p>
          <p style="margin:0 0 14px;padding:12px 16px;background:#f4f6ef;border-left:3px solid #B2C54F;font-weight:600;color:#0f1a2b">${safeCriteria}</p>
          <p style="margin:0 0 14px">Il reste une étape&nbsp;: cliquez ci-dessous pour activer votre alerte.</p>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr>
          <td align="center" style="background:#EC7234;border-radius:4px">
            <a href="${safeConfirmUrl}" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:.3px">ACTIVER MON ALERTE</a></td></tr></table>
        <div style="font-size:14px;color:#3a3a3a;line-height:1.7">
          <p style="margin:0 0 14px"><strong style="color:#b3261e">Tant que vous n'avez pas cliqué</strong>, l'alerte n'est pas active et vous ne recevrez rien.</p>
          <p style="margin:0 0 14px"><strong>Vous n'êtes pas à l'origine de cette demande&nbsp;?</strong> Ignorez simplement cet e-mail.</p>
        </div>
        <hr style="border:none;border-top:1px solid #eef3ef;margin:24px 0 14px">
        <p style="margin:0;font-size:11px;color:#8a8a8a;line-height:1.6">Si le bouton ne fonctionne pas, copiez ce lien&nbsp;:<br>
          <a href="${safeConfirmUrl}" style="color:#8a8a8a;text-decoration:underline;word-break:break-all">${safeConfirmUrl}</a></p>
      </td></tr>
      <tr><td style="background:#0f1a2b;padding:24px 32px;border-radius:0 0 8px 8px"><p style="margin:0;font-size:12px;color:#fff;opacity:.75;line-height:1.6">Immobilière Pujol — 7 rue du Docteur Fiolle, 13006 Marseille<br>Vente, location, gestion locative et syndic de copropriété.</p></td></tr>
    </table>
  </td></tr></table></body></html>`;
}

// POST /alerts/optin — send the double opt-in email to the person who signed up.
async function handleAlertOptin(req: Request, env: Env): Promise<Response> {
  const bad = nlGuard(req, env); if (bad) return bad;
  const b = (await req.json().catch(() => ({}))) as any;
  const email = (b.email || '').trim();
  if (!email) return nlJson({ error: 'email requis' }, 400);
  const r = await sendEmail(env, {
    subject: 'Confirmez votre alerte annonces — Immobilière Pujol',
    html: buildAlertOptin(String(b.prenom || ''), String(b.nom || ''), String(b.criteriaText || ''), String(b.confirmUrl || '')),
    to: email,
    fromEmail: NOTIFY_FROM,
    fromName: 'Immobilière Pujol',
    replyTo: env.NEWSLETTER_REPLY_TO || `contact${D}`,
    senderEmail: env.ALERT_SENDER_EMAIL,
  });
  return nlJson(r.ok ? { ok: true } : { ok: false, error: r.error }, r.ok ? 200 : 502);
}

// POST /alerts/notify: tell the agency a new qualified lead just confirmed.
// Zoho and Caroline receive every alert. Benoît receives only when the prospect
// declares a property to sell. Listing negotiators and annonces@ are deliberately
// excluded because the CRM owns dispatch and follow-up.
async function handleAlertNotify(req: Request, env: Env): Promise<Response> {
  const bad = nlGuard(req, env); if (bad) return bad;
  const b = (await req.json().catch(() => ({}))) as any;
  const isVente = b.transac === 'V';

  const rows: [string, string][] = [
    ['Type de recherche', isVente ? 'Vente' : 'Location'],
    ['Critères', String(b.criteriaText || '')],
    ['Prénom', String(b.prenom || '')],
    ['Nom', String(b.nom || '')],
    ['Email', String(b.email || '')],
    ['Téléphone', String(b.phone || '')],
  ];
  if (isVente) {
    if (b.proprietaire) rows.push(['Déjà propriétaire', 'Oui']);
    if (b.bien_a_vendre) rows.push(['A un bien à vendre', 'Oui — LEAD VENDEUR']);
  }
  if (b.source_ref) rows.push(["Annonce d'origine", String(b.source_ref)]);

  const subject = `Nouvelle alerte ${isVente ? 'Vente' : 'Location'} : ${String(b.prenom || '')} ${String(b.nom || '')} (${String(b.email || '')})`.replace(/\s+/g, ' ').trim();
  const html = buildTable(subject, rows);

  const recipients = new Set<string>([
    ZOHO_PARSER,
    `carolinepujol${D}`,
  ]);
  if (!!b.bien_a_vendre) recipients.add(CONTACT_ROUTING['Vente'].to);

  const to = Array.from(recipients);
  for (const addr of to) {
    await sendEmail(env, {
      subject, html, replyTo: String(b.email || ''), to: addr,
      fromEmail: NOTIFY_FROM, fromName: `Alerte ${isVente ? 'Vente' : 'Location'}`,
    });
  }
  return nlJson({ ok: true, notified: to });
}

// Subscriber-facing "un bien correspond à votre alerte" email (Phase 2 matching).
function alertMatchCard(l: any): string {
  const url = esc(String(l.url || ''));
  const image = esc(String(l.image || ''));
  const title = esc(String(l.title || ''));
  const location = esc(String(l.location || ''));
  const price = esc(String(l.price || ''));
  const img = image
    ? `<a href="${url}" style="text-decoration:none"><img src="${image}" width="536" alt="" style="width:100%;max-width:536px;height:auto;display:block;border-radius:10px 10px 0 0"></a>`
    : '';
  const topRadius = l.image ? '0 0 10px 10px' : '10px';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td>
    ${img}
    <div style="border:1px solid #ececec;${l.image ? 'border-top:none;' : ''}border-radius:${topRadius};padding:16px 18px">
      <div style="font-weight:700;font-size:16px;color:#0f1a2b;line-height:1.35">${title}</div>
      ${location ? `<div style="color:#6b7280;font-size:13px;margin:5px 0 0">${location}</div>` : ''}
      ${price ? `<div style="color:#EC7234;font-weight:800;font-size:21px;margin:10px 0 14px">${price}</div>` : ''}
      <a href="${url}" style="display:inline-block;background:#0f1a2b;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.3px">VOIR L'ANNONCE</a>
    </div></td></tr></table>`;
}

function buildAlertMatch(prenom: string, criteriaText: string, listings: any[], manageUrl: string): string {
  const hi = prenom ? `Bonjour ${esc(prenom)},` : 'Bonjour,';
  const safeCriteria = esc(criteriaText);
  const safeManageUrl = esc(manageUrl);
  const n = listings.length;
  const head = n === 1 ? 'Un bien correspond' : `${n} biens correspondent`;
  const intro = n === 1
    ? "Un nouveau bien vient d'être mis en ligne et correspond à votre alerte&nbsp;:"
    : "De nouveaux biens viennent d'être mis en ligne et correspondent à votre alerte&nbsp;:";
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#eef3ef;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ef;padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background:#0f1a2b;padding:20px 32px;border-radius:8px 8px 0 0" align="center"><img src="${PUJOL_LOGO}" alt="Immobilière Pujol" width="180" style="display:block;max-width:180px;height:auto"></td></tr>
      <tr><td style="background:#B2C54F;height:4px;font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="background:#fff;padding:30px 32px 26px">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#0f1a2b;text-transform:uppercase;letter-spacing:.8px"><span style="border-bottom:2px solid #B2C54F;padding-bottom:3px">Alerte annonces</span></p>
        <h1 style="margin:18px 0 12px;font-size:23px;line-height:1.3;color:#0f1a2b">${head} à votre recherche</h1>
        <p style="margin:0 0 6px;font-size:14px;color:#3a3a3a;line-height:1.6">${hi}</p>
        <p style="margin:0 0 18px;font-size:14px;color:#3a3a3a;line-height:1.6">${intro}</p>
        ${safeCriteria ? `<p style="margin:0 0 22px;padding:11px 15px;background:#f4f6ef;border-left:3px solid #B2C54F;font-weight:600;color:#0f1a2b;font-size:14px">${safeCriteria}</p>` : ''}
        ${listings.map(alertMatchCard).join('')}
        <hr style="border:none;border-top:1px solid #eef3ef;margin:8px 0 14px">
        <p style="margin:0;font-size:12px;color:#8a8a8a;line-height:1.6">Vous recevez cet e-mail car vous avez créé une alerte sur immobiliere-pujol.fr.<br>
          <a href="${safeManageUrl}" style="color:#0f1a2b;font-weight:700;text-decoration:underline">Gérer ou supprimer mon alerte</a></p>
      </td></tr>
      <tr><td style="background:#0f1a2b;padding:24px 32px;border-radius:0 0 8px 8px"><p style="margin:0;font-size:12px;color:#fff;opacity:.75;line-height:1.6">Immobilière Pujol — 7 rue du Docteur Fiolle, 13006 Marseille<br>Vente, location, gestion locative et syndic de copropriété.</p></td></tr>
    </table>
  </td></tr></table></body></html>`;
}

// POST /alerts/match — send the subscriber a "bien correspondant" email.
// Body: { email, prenom, criteriaText, manageUrl, listings:[{title,price,location,url,image}] }.
async function handleAlertMatch(req: Request, env: Env): Promise<Response> {
  const bad = alertMatchGuard(req, env); if (bad) return bad;
  const b = (await req.json().catch(() => ({}))) as any;
  const email = (b.email || '').trim();
  const listings = Array.isArray(b.listings) ? b.listings : [];
  if (!email || !listings.length) return nlJson({ error: 'email + listings requis' }, 400);
  const r = await sendEmail(env, {
    subject: listings.length === 1 ? 'Un bien correspond à votre alerte — Immobilière Pujol' : `${listings.length} biens correspondent à votre alerte — Immobilière Pujol`,
    html: buildAlertMatch(String(b.prenom || ''), String(b.criteriaText || ''), listings, String(b.manageUrl || '')),
    to: email,
    fromEmail: NOTIFY_FROM,
    fromName: 'Immobilière Pujol',
    replyTo: env.NEWSLETTER_REPLY_TO || `contact${D}`,
    senderEmail: env.ALERT_SENDER_EMAIL,
  });
  return nlJson(r.ok ? { ok: true } : { ok: false, error: r.error }, r.ok ? 200 : 502);
}

// POST /alerts/registered — courtesy email for a back-office (manual) add: the
// alert is already active, so this confirms it and offers one-click unsubscribe.
function buildAlertRegistered(prenom: string, nom: string, criteriaText: string, manageUrl: string): string {
  const hi = alertGreeting(prenom, nom);
  const safeCriteria = esc(criteriaText);
  const safeManageUrl = esc(manageUrl);
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#eef3ef;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ef;padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background:#0f1a2b;padding:20px 32px;border-radius:8px 8px 0 0" align="center"><img src="${PUJOL_LOGO}" alt="Immobilière Pujol" width="180" style="display:block;max-width:180px;height:auto"></td></tr>
      <tr><td style="background:#B2C54F;height:4px;font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="background:#fff;padding:32px 32px 26px">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#0f1a2b;text-transform:uppercase;letter-spacing:.8px"><span style="border-bottom:2px solid #B2C54F;padding-bottom:3px">Alerte annonces</span></p>
        <h1 style="margin:18px 0 12px;font-size:23px;color:#0f1a2b">Votre alerte est enregistrée</h1>
        <div style="font-size:14px;color:#3a3a3a;line-height:1.7">
          <p style="margin:0 0 14px">${hi}</p>
          <p style="margin:0 0 14px">Nous avons enregistré votre alerte à votre demande. Dès qu'un bien correspond, vous recevrez un e-mail&nbsp;:</p>
          <p style="margin:0 0 14px;padding:11px 15px;background:#f4f6ef;border-left:3px solid #B2C54F;font-weight:600;color:#0f1a2b">${safeCriteria}</p>
          <p style="margin:0 0 14px">Vous pouvez vous désinscrire à tout moment&nbsp;:</p>
        </div>
        <p style="margin:0 0 6px"><a href="${safeManageUrl}" style="color:#0f1a2b;font-weight:700;text-decoration:underline">Supprimer mon alerte</a></p>
      </td></tr>
      <tr><td style="background:#0f1a2b;padding:24px 32px;border-radius:0 0 8px 8px"><p style="margin:0;font-size:12px;color:#fff;opacity:.75;line-height:1.6">Immobilière Pujol — 7 rue du Docteur Fiolle, 13006 Marseille</p></td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function handleAlertRegistered(req: Request, env: Env): Promise<Response> {
  const bad = nlGuard(req, env); if (bad) return bad;
  const b = (await req.json().catch(() => ({}))) as any;
  const email = (b.email || '').trim();
  if (!email) return nlJson({ error: 'email requis' }, 400);
  const r = await sendEmail(env, {
    subject: 'Votre alerte annonces est enregistrée — Immobilière Pujol',
    html: buildAlertRegistered(String(b.prenom || ''), String(b.nom || ''), String(b.criteriaText || ''), String(b.manageUrl || '')),
    to: email,
    fromEmail: NOTIFY_FROM,
    fromName: 'Immobilière Pujol',
    replyTo: env.NEWSLETTER_REPLY_TO || `contact${D}`,
    senderEmail: env.ALERT_SENDER_EMAIL,
  });
  return nlJson(r.ok ? { ok: true } : { ok: false, error: r.error }, r.ok ? 200 : 502);
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
  'Newsletter':        ['Date', 'Email', 'Statut opt-in', 'Date confirmation', 'Date rappel opt-in', 'Prénom', 'Nom', 'Profil', 'Intérêt Location', 'Intérêt Vente', 'Intérêt Syndic', 'Tous sujets', 'Notes'],
};

// ── Worker entry point ──────────────────────────────────────────────────────

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (env.ALLOWED_ORIGIN !== SITE_URL) return;
    const confirmedEmails = controller.cron === '20 * * * *'
      ? await fetchConfirmedNewsletterEmails(env)
      : await reconcileNewsletterSheet(env);
    await runAutomaticNewsletterReminders(env, confirmedEmails);
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // Newsletter internal endpoints carry a JSON body + x-internal-token — handle
    // them BEFORE the formData() parse below (which would consume/fail on JSON).
    if (path === '/newsletter/send')  return handleNewsletterSend(request, env);
    if (path === '/newsletter/test')  return handleNewsletterTest(request, env);
    if (path === '/newsletter/stats') return handleNewsletterStats(request, env);
    if (path === '/newsletter/lists') return handleNewsletterLists(request, env);
    if (path === '/newsletter/reminders') return handleNewsletterReminders(request, env);
    if (path === '/alerts/optin')     return handleAlertOptin(request, env);
    if (path === '/alerts/notify')    return handleAlertNotify(request, env);
    if (path === '/alerts/match')     return handleAlertMatch(request, env);
    if (path === '/alerts/registered') return handleAlertRegistered(request, env);

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

    // Content spam filter — link-stuffed / HTML messages (e.g. pharma SEO spam).
    // Legit form submissions never contain HTML anchors or several URLs, so we
    // silently drop them. Catches bots that skip the honeypot.
    let blob = '';
    for (const v of fd.values()) if (typeof v === 'string') blob += ' ' + v;
    const urlCount = (blob.match(/https?:\/\//gi) || []).length;
    const hasHtmlLink = /<\s*a\b|href\s*=|\[url[=\]]|\bBBcode\b/i.test(blob);
    if (hasHtmlLink || urlCount >= 3) {
      return jsonOk({ ok: true }, origin, env);
    }

    // Cloudflare Turnstile — enforced only when the secret is configured.
    // No secret → skipped (honeypot + content filter stand in).
    //
    // /newsletter used to be exempt ("no widget by design"); spec §3.5 calls that
    // a list-bombing hole and the signup form now carries a widget, so the
    // exemption is gone. This worker has NO TURNSTILE_SECRET today, so nothing is
    // enforced here yet.
    // ⚠️ Setting TURNSTILE_SECRET on THIS worker will start rejecting newsletter
    // signups that arrive without a token — and PRODUCTION posts here (§6.2)
    // while `pujol-main` still ships the widget-less form. Ship the widget to
    // pujol-main BEFORE setting that secret, or prod signups will 403.
    // /newsletter/profile is the signup card's optional step 2 (name + interests);
    // the visitor already cleared Turnstile at the email step, so exempt it (there
    // is no fresh token) — the honeypot + content filter above still apply.
    if (env.TURNSTILE_SECRET && path !== '/newsletter/profile') {
      const token = ((fd.get('cf-turnstile-response') as string) || '').trim();
      let pass = false;
      if (token) {
        try {
          const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              secret: env.TURNSTILE_SECRET,
              response: token,
              remoteip: request.headers.get('CF-Connecting-IP') || '',
            }),
          });
          pass = ((await v.json()) as { success?: boolean }).success === true;
        } catch {
          pass = false;
        }
      }
      if (!pass) {
        return jsonErr('Vérification anti-spam échouée. Veuillez réessayer.', 403, origin, env);
      }
    }

    let result: { ok: boolean; error?: string; doi?: boolean };

    switch (path) {
      case '/contact':
        result = await handleContact(fd, env, ctx);
        break;
      case '/contact-annonce':
        result = await handleContactAnnonce(fd, env, ctx);
        break;
      case '/newsletter':
        result = await handleNewsletter(fd, env, ctx, origin);
        break;
      case '/newsletter/profile':
        result = await handleNewsletterProfile(fd, env, ctx, origin);
        break;
      default:
        return jsonErr('Not found', 404, origin, env);
    }

    if (!result.ok) {
      return jsonErr(result.error || "Erreur d'envoi", 500, origin, env);
    }

    // `doi: true` tells the signup form to ask for inbox confirmation instead of
    // thanking the visitor outright (spec §6.4). Absent on every other path.
    return jsonOk(result.doi ? { ok: true, doi: true } : { ok: true }, origin, env);
  },
};
