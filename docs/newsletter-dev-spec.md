# Newsletter system — developer implementation spec

Status: **approved (Caroline confirmed the quote, 2026-07-07)**. Scope = the newsletter only. The property‑alerts system is a separate future project and is explicitly out of scope here.

This document is a step‑by‑step build guide. It assumes you work in the real codebase `immobiliere-pujol-site` and know the existing stack (Astro 6 SSR on Cloudflare Workers, D1, R2, three workers). Read the whole thing once before writing code.

---

## 0. Architecture in one paragraph

We do **not** build an email‑sending engine. We build the *control surface*: a signup wiring, a composer inside the existing admin, a branded HTML email template, and a "send" action. The actual list storage, double opt‑in email, unsubscribe page, bounce/complaint suppression, and deliverability are owned by **Brevo** (EU, RGPD, French company) through its API. Caroline never logs into Brevo — she works only in the site back‑office. Our own D1 stores only a light **campaign log** (what was sent, when, which articles, Brevo campaign id) for the in‑admin history and stats.

```
Visitor ──signup form──► pujol-email worker ──Brevo DOI API──► Brevo sends confirmation ──► contact confirmed in Brevo "Newsletter" list
                                                                                   (Brevo owns unsubscribe + suppression)

Caroline ──/admin-pujol/newsletter──► main app builds HTML from blog articles ──► pujol-email worker ──Brevo Campaign API──► send to list
                                             │                                                                    │
                                             └── writes campaign row to D1 (log) ◄──────── returns brevo_campaign_id
```

**Why the split:** all Brevo access is centralised in the `pujol-email` worker so the `BREVO_API_KEY` lives in exactly one place. The main app renders the email HTML (it has the article content collection + the image helper) and calls the email worker over HTTP with a shared internal token.

---

## 1. Prerequisites (accounts, domain, DNS)

These are done once, before code, and are partly Roy/client actions. Track them; several are blockers.

### 1.1 Brevo accounts
- **Production:** a Brevo account owned by Immobilière Pujol (opened with the client's card). Plan: **Starter (~9 €/mo, 5 000 emails/mo)** — the free plan caps at 300 emails/day, which a 2 000‑person send exceeds. Roy opens this with the client.
- **Staging:** use a **separate Brevo free account** (Roy's) so staging can never touch the real list. Same code, different secrets.

### 1.2 Create the Brevo objects (in each account)
1. A contact **list** named `Newsletter — Immobilière Pujol`. Note its numeric **list id** → `NEWSLETTER_LIST_ID`.
2. A **double opt‑in (DOI) email template**: Brevo → Templates → create a branded confirmation email. It **must contain the `{{ doubleoptin }}` placeholder** (the confirm button/link). Note its **template id** → `DOI_TEMPLATE_ID`. Copy text to be written by Caroline/Roy (French, RGPD wording).
3. Authenticate the **sending domain** (see 1.3) and create a verified **sender** `Immobilière Pujol <newsletter@news.immobiliere-pujol.fr>` → `NEWSLETTER_SENDER_EMAIL` / `NEWSLETTER_SENDER_NAME`.
4. Generate an **API key** (Brevo → SMTP & API → API Keys) → `BREVO_API_KEY` (secret).

### 1.3 Sending domain + deliverability (the devis "sous-domaine d'envoi dédié")
Use a dedicated subdomain to isolate newsletter reputation from the agency's transactional mail (`contact@…` via Mandrill).
- In Brevo → Senders & Domains → add domain **`news.immobiliere-pujol.fr`**. Brevo shows the exact DNS records to add (a `brevo-code` TXT, a DKIM record, and a DMARC TXT). **Copy them verbatim** — do not hardcode from this doc, Brevo rotates them.
- Add those records in **Cloudflare DNS** for the `immobiliere-pujol.fr` zone. Start DMARC at `p=none` (monitor), tighten later.
- Wait for Brevo to show the domain as **authenticated (SPF/DKIM/DMARC green)** before any real send. This is a hard gate for inbox placement (Gmail/Yahoo/Microsoft 2024‑2025 rules).

> Deliverability, unsubscribe (RFC 8058 one‑click), bounce handling and spam‑complaint suppression are **handled by Brevo automatically** once the domain is authenticated and campaigns carry the unsubscribe tag (§4). This is the bulk of the devis "hygiène de liste" line — it is configuration + verification, not code.

---

## 2. Data model (D1)

We add **one** table. The subscriber list is NOT stored here (it lives in Brevo).

Add to `src/db/schema.sql`:

```sql
-- Newsletter campaign log (subscribers live in Brevo, not here)
CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brevo_campaign_id INTEGER,             -- id returned by Brevo (null until sent)
  subject TEXT NOT NULL,
  preheader TEXT,
  template TEXT NOT NULL DEFAULT 'digest',
  intro TEXT,
  outro TEXT,
  article_slugs TEXT,                    -- JSON array of selected article slugs
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'sent'
  recipient_count INTEGER,
  created_by TEXT,                       -- admin email (context.locals.adminEmail)
  sent_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Apply it to **both** databases (same command form the repo already uses):

```bash
# staging DB (Roy account)
npx wrangler d1 execute pujol-annonces --remote --file=src/db/schema.sql
# prod DB (Pujol account) — ONLY with Roy's approval, see §9
```

`CREATE TABLE IF NOT EXISTS` makes re‑running the full schema safe.

---

## 3. Backend — Brevo endpoints in the `pujol-email` worker

File: `workers/email/index.ts`. All Brevo calls live here. Brevo REST base: `https://api.brevo.com/v3`, auth header `api-key: <BREVO_API_KEY>`.

### 3.1 Extend the `Env` interface (lines 4‑8)

```typescript
interface Env {
  MANDRILL_API_KEY: string;
  ALLOWED_ORIGIN: string;
  TURNSTILE_SECRET?: string;
  // --- newsletter / Brevo ---
  BREVO_API_KEY: string;
  NEWSLETTER_LIST_ID: string;
  DOI_TEMPLATE_ID: string;
  NEWSLETTER_SENDER_EMAIL: string;
  NEWSLETTER_SENDER_NAME: string;
  NEWSLETTER_CONFIRM_REDIRECT_URL: string; // e.g. https://immobiliere-pujol.fr/newsletter-confirmee
  NEWSLETTER_INTERNAL_TOKEN: string;       // shared secret with the main app
}
```

### 3.2 Rework `handleNewsletter` → real double opt‑in

Replace the current stub (lines 783‑800, which only notifies + logs a Sheet). Keep the honeypot `_hp` check (already global, lines 860‑862) and **re‑enable Turnstile on this path** (see 3.5).

```typescript
async function handleNewsletter(fd: FormData, env: Env, ctx: ExecutionContext) {
  const email = ((fd.get('email') as string) || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { ok: false, error: 'Email invalide.' };

  const res = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      includeListIds: [Number(env.NEWSLETTER_LIST_ID)],
      templateId: Number(env.DOI_TEMPLATE_ID),
      redirectionUrl: env.NEWSLETTER_CONFIRM_REDIRECT_URL,
      attributes: { SOURCE: 'site', OPTIN_DATE: new Date().toISOString() },
    }),
  });

  // Brevo returns 201/204 on success; a 400 "Contact already exists"/"already in list"
  // should be treated as success from the visitor's point of view.
  if (!res.ok && res.status !== 400) {
    return { ok: false, error: 'Inscription impossible pour le moment.' };
  }

  ctx.waitUntil(logToSheet('Newsletter', [now(), email])); // keep the Sheet trail (optional)
  return { ok: true };
}
```

Brevo now sends the branded confirmation email; the contact is added to the list **only after** they click. Brevo records the consent (date/source) — that is our RGPD consent registry.

### 3.3 `POST /newsletter/send` — create + send a Brevo campaign (internal)

Called by the admin (main app) with the fully rendered HTML. Guard with the internal token.

```typescript
async function handleNewsletterSend(req: Request, env: Env) {
  if (req.headers.get('x-internal-token') !== env.NEWSLETTER_INTERNAL_TOKEN)
    return jsonErr('Forbidden', 403, '*', env);

  const { subject, html, campaignName } = await req.json();

  // 1) create the campaign (draft) targeting the Newsletter list
  const create = await fetch('https://api.brevo.com/v3/emailCampaigns', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: campaignName || `Newsletter ${now()}`,
      subject,
      sender: { name: env.NEWSLETTER_SENDER_NAME, email: env.NEWSLETTER_SENDER_EMAIL },
      htmlContent: html,                       // must contain the {{ unsubscribe }} tag (see §4)
      recipients: { listIds: [Number(env.NEWSLETTER_LIST_ID)] },
    }),
  });
  if (!create.ok) return jsonErr('Brevo create failed', 502, '*', env);
  const { id: campaignId } = await create.json();

  // 2) send now
  const send = await fetch(`https://api.brevo.com/v3/emailCampaigns/${campaignId}/sendNow`, {
    method: 'POST', headers: { 'api-key': env.BREVO_API_KEY },
  });
  if (!send.ok) return jsonErr('Brevo send failed', 502, '*', env);

  return jsonOk({ ok: true, campaignId }, '*', env);
}
```

### 3.4 `POST /newsletter/test` and `GET /newsletter/stats` (internal)
- **Test**: send the rendered HTML to one address via the transactional endpoint `POST /v3/smtp/email` (`{ sender, to:[{email}], subject:'[TEST] '+subject, htmlContent }`). Note the `{{ unsubscribe }}` tag renders literally in a transactional test — acceptable, or strip it for tests.
- **Stats**: `GET /v3/emailCampaigns/{brevo_campaign_id}` → returns `statistics.globalStats` (sent, delivered, uniqueViews, clickers, unsubscriptions, hardBounces…). Expose the numbers the admin needs.

Both guarded by `x-internal-token`.

### 3.5 Dispatch + anti‑spam
Add the routes to the switch (near lines 905‑914):

```typescript
case '/newsletter':       result = await handleNewsletter(fd, env, ctx); break;
case '/newsletter/send':  return handleNewsletterSend(req, env);   // returns Response directly
case '/newsletter/test':  return handleNewsletterTest(req, env);
case '/newsletter/stats': return handleNewsletterStats(req, env);
```

**Re‑enable Turnstile on signup.** Line 879 currently reads `if (env.TURNSTILE_SECRET && path !== '/newsletter')`. Change it to include `/newsletter` in Turnstile enforcement (remove the exemption). This closes the list‑bombing hole. It requires adding a Turnstile widget to the signup form (§6).

---

## 4. Email template module (the custom deliverable)

Create `src/lib/newsletter-template.ts` exporting:

```typescript
export interface NewsletterArticle { title: string; url: string; excerpt: string; imageUrl: string; }
export function renderDigest(input: {
  subject: string; preheader?: string; intro?: string; outro?: string;
  articles: NewsletterArticle[]; // 1..3
}): string   // returns a full HTML email document
```

Email‑HTML rules (non‑negotiable — Caroline cannot fix a broken render herself):
- **Tables for layout**, inline CSS only. No flexbox/grid. Max width ~600px, centered.
- **Preheader**: a hidden `<div style="display:none;max-height:0;overflow:hidden;opacity:0">{preheader}</div>` as the first body node, followed by a run of `&#8203;&nbsp;` padding.
- **Images must be raster + absolute** (email clients do not render AVIF, which the site serves). Do **not** use the site's `cfImg()` directly — it emits a relative path with `format=auto` (AVIF). Add an email variant:

```typescript
// absolute + forced JPEG for email clients
const SITE = 'https://immobiliere-pujol.fr';
export function emailImg(src: string, width = 600): string {
  const abs = src.startsWith('http') ? src : SITE + (src.startsWith('/') ? src : '/' + src);
  return `${SITE}/cdn-cgi/image/width=${width},quality=80,format=jpeg,onerror=redirect/${abs}`;
}
```

- **Footer must contain the Brevo unsubscribe tag** so campaigns carry a working one‑click unsubscribe: `<a href="{{ unsubscribe }}">Se désinscrire</a>`. Optionally `{{ update_profile }}` for a preference link. Brevo replaces these at send time.
- Brand: logo (absolute URL), green accent `#1f7a44`, per‑article card = image + title + 1‑line excerpt + a "Lire l'article" button linking to `article.url`.
- **Test across clients** (Gmail web/app, Outlook desktop = Word engine, Apple Mail, mobile) before sign‑off. Use Litmus/Email‑on‑Acid or real inboxes.

Start with **one** template (`digest`, handles 1–3 articles). The `template` field in D1 leaves room for more later.

---

## 5. Admin composer (main app)

Lives under the existing protected admin. Middleware (`src/middleware.ts`) already guards page routes under `/admin-pujol/`. **API routes under `/api/admin-pujol/…` are NOT auto‑guarded** (that prefix is outside the middleware match — that's why login lives there). So **guard every new API route explicitly.**

### 5.1 Auth guard helper
Reuse `src/lib/admin-auth.ts` (`getAdminEnv`, `parseSessionCookie`, `verifySession`). Add a small helper:

```typescript
// src/lib/admin-guard.ts
import { getAdminEnv, parseSessionCookie, verifySession } from './admin-auth';
export async function requireAdmin(request: Request): Promise<string | null> {
  const env = await getAdminEnv();
  const token = parseSessionCookie(request.headers.get('cookie') || '');
  return token ? await verifySession(env, token) : null; // returns email or null
}
```

Every newsletter API route starts with: `const admin = await requireAdmin(request); if (!admin) return new Response('Unauthorized', {status:401});`

### 5.2 Pages (SSR, under the protected prefix)
- `src/pages/admin-pujol/newsletter/index.astro` — campaign history from D1 (`SELECT … FROM newsletter_campaigns ORDER BY created_at DESC`) + a "Nouvelle newsletter" button. Add a card/link on the admin dashboard `index.astro`.
- `src/pages/admin-pujol/newsletter/new.astro` — the composer (the screen mocked in the quote): template select, subject, preheader, intro (light rich text: bold/italic/link only, sanitized), an **article picker** (list recent articles, choose up to 3, reorder/remove), outro, a **recipient count** line, and buttons **Aperçu / Envoyer un test / Enregistrer brouillon / Envoyer**. Client JS calls the API routes below.

### 5.3 API routes (Astro endpoints, each guarded)
- `GET /api/admin-pujol/newsletter/articles?limit=40` → `getCollection('articles')`, sort by `data.date` desc, return `{title, slug, excerpt, featuredImage, date, url}` where `url = '/' + slug + '/'`. Feeds the picker.
- `POST /api/admin-pujol/newsletter/preview` → body `{template, subject, preheader, intro, outro, articleSlugs[]}`. Resolve each slug via `getCollection('articles')`, map to `NewsletterArticle` (use `emailImg(featuredImage)`), call `renderDigest(...)`, return the HTML string. The composer shows it in an `<iframe srcdoc>`.
- `POST /api/admin-pujol/newsletter/test` → build the same HTML, POST to the email worker `/newsletter/test` with `x-internal-token`, body includes `testEmail` (default = the logged‑in admin's email).
- `POST /api/admin-pujol/newsletter/send` → build HTML, `INSERT` a `newsletter_campaigns` row (`status='draft'`, `created_by=admin`), POST to email worker `/newsletter/send`, then `UPDATE` the row with `brevo_campaign_id`, `status='sent'`, `sent_at`, `recipient_count`. Return the campaign id. Use the `DB` binding.
- (optional) `GET /api/admin-pujol/newsletter/campaigns/:id/stats` → proxy the email worker `/newsletter/stats`.

### 5.4 Main app config for talking to the email worker
Add to the main app `wrangler.jsonc` `vars`: `EMAIL_WORKER_URL` (staging = `https://pujol-email.roy-68a.workers.dev`; prod value patched in `deploy-pujol.yml`). Add secret `NEWSLETTER_INTERNAL_TOKEN` (same value as on the email worker).

---

## 6. Frontend signup wiring

File: `src/components/common/NewsletterSignup.astro`. The form already POSTs (`action=".../newsletter"`) with the `_hp` honeypot and an `email` field.
1. **Add a Cloudflare Turnstile widget** to the form (same site key already used by the lead forms: `0x4AAAAAADow4gNbXgTPXvdL`, `data-appearance="interaction-only"`), and ensure the token field is submitted — required now that the worker enforces Turnstile on `/newsletter`.
2. The form action URL is currently hardcoded to the staging worker (`pujol-email.roy-68a.workers.dev`). **Confirm how the live site resolves the email‑worker URL per environment** (route or `deploy-pujol.yml` patch) and follow the same mechanism so prod posts to the prod email worker, not staging.
3. Create the **confirmation landing page** `src/pages/newsletter-confirmee.astro` (the `redirectionUrl` Brevo sends users to after they click confirm): a simple "Merci, votre inscription est confirmée." Set `NEWSLETTER_CONFIRM_REDIRECT_URL` to its absolute URL.
4. Success UX on submit: message "Vérifiez votre boîte mail pour confirmer votre inscription." (because of double opt‑in). Keep the existing `dataLayer` `form_submit` push.

---

## 7. Migration of the existing MailChimp list (RGPD‑safe)

Do **not** import the old list straight into the active Newsletter list and mail it — consent provenance is unknown (the ~700 list is stale). Compliant path:
1. Roy/Anthony provides the MailChimp **audience CSV export**.
2. Clean: dedupe, validate email syntax, drop obvious junk/roles.
3. Import into a **separate Brevo list** `Reconfirmation` (Brevo → Contacts → Import), **not** the active list.
4. Send a **one‑time re‑opt‑in campaign** to `Reconfirmation` with a clear consent CTA linking to the site signup (which runs the DOI). Only re‑confirmers land in the active `Newsletter` list.
5. After ~2–4 weeks, archive the non‑responders. Document the counts.

---

## 8. RGPD / CNIL

- Consent registry = Brevo stores opt‑in date + source (set via the DOI `attributes`). Nothing else to build.
- Update **mentions légales / politique de confidentialité**: add **Brevo (Sendinblue SAS, EU)** as a processor of newsletter data; state the purpose, retention, and the right to unsubscribe/erasure (Brevo hosts unsubscribe; erasure = delete contact in Brevo on request). Keep the MailChimp mention until fully migrated off, then remove.
- Double opt‑in + one‑click unsubscribe + auto‑suppression satisfy the operational RGPD + Gmail/Yahoo/Microsoft requirements.

---

## 9. Environments, secrets, deployment

Follow the repo's normal workflow: work on `develop`, `npm run build`, `wrangler deploy` to **staging** (Roy account), push `develop` **and** `develop:main`. **Never deploy to prod (`pujol-main`) without Roy's explicit per‑change approval.** Prod is the Pujol Cloudflare account; `deploy-pujol.yml` patches env‑specific values.

**Secrets/vars to set (per environment / per account):**

| Where | Name | Type | Notes |
|---|---|---|---|
| email worker | `BREVO_API_KEY` | secret | `wrangler secret put BREVO_API_KEY --config workers/email/wrangler.jsonc` |
| email worker | `NEWSLETTER_INTERNAL_TOKEN` | secret | shared with main app |
| email worker | `NEWSLETTER_LIST_ID`, `DOI_TEMPLATE_ID`, `NEWSLETTER_SENDER_EMAIL`, `NEWSLETTER_SENDER_NAME`, `NEWSLETTER_CONFIRM_REDIRECT_URL` | vars | staging → Roy Brevo (test list/template); prod → Pujol Brevo. Patch prod values in `deploy-pujol.yml`. |
| email worker | `TURNSTILE_SECRET` | secret | already exists on prod; ensure set so `/newsletter` enforces it |
| main app | `NEWSLETTER_INTERNAL_TOKEN` | secret | same value as email worker |
| main app | `EMAIL_WORKER_URL` | var | staging vs prod (patch in `deploy-pujol.yml`) |

**Staging must never send to the real list.** Because staging uses Roy's separate Brevo account with a test list id, this is structurally guaranteed — keep it that way (don't point staging at the prod list id).

---

## 10. Acceptance checklist (maps to the quote)

| Devis line | Done when |
|---|---|
| Intégration Brevo & délivrabilité | `news.immobiliere-pujol.fr` shows authenticated (SPF/DKIM/DMARC) in Brevo; a test campaign lands in Gmail inbox (not spam) |
| Inscription & double opt‑in | Site signup → Brevo confirmation email received → click → contact appears in `Newsletter` list; Turnstile + honeypot active |
| Désinscription & hygiène | One‑click unsubscribe in a real send removes the contact; a hard‑bounced/complained address is auto‑suppressed by Brevo |
| Composeur | Caroline picks 1–3 articles + subject + preheader + intro/outro in `/admin-pujol/newsletter/new`, no code |
| Gabarit e‑mail | `renderDigest` output verified across Gmail/Outlook/Apple/mobile; images render (JPEG, absolute); links work |
| Aperçu & test | In‑admin iframe preview matches the real test‑send to Caroline's inbox |
| Envoi & statistiques | "Envoyer" creates+sends a Brevo campaign, D1 row written, opens/clicks visible in admin |
| Migration liste | Old list imported to `Reconfirmation`, re‑opt‑in campaign sent, confirmers in `Newsletter` |
| RGPD/CNIL | Mentions légales updated (Brevo processor); consent date/source stored; unsubscribe + erasure paths work |
| Recette & mise en prod | All above green on staging; promoted to prod with Roy's approval; short how‑to given to Caroline |

---

## 11. Out of scope / open items
- **Property alerts ("alertes annonces")** — separate future project. Do not build here, but keep the Brevo list/consent pattern reusable.
- Confirm the prod email‑worker URL resolution for the signup form (§6.2).
- Number of templates at launch: **one** (`digest`). More later if asked.
- Send scheduling ("programmer l'envoi") is not in scope for v1 (send‑now + test only).

## 12. Key file map
| Purpose | Path |
|---|---|
| Brevo endpoints (signup DOI, send, test, stats) | `workers/email/index.ts` |
| Email HTML template | `src/lib/newsletter-template.ts` (new) |
| Admin auth guard | `src/lib/admin-guard.ts` (new), `src/lib/admin-auth.ts` (existing) |
| Composer pages | `src/pages/admin-pujol/newsletter/{index,new}.astro` (new) |
| Composer API | `src/pages/api/admin-pujol/newsletter/*.ts` (new) |
| Signup form | `src/components/common/NewsletterSignup.astro` |
| Confirm landing page | `src/pages/newsletter-confirmee.astro` (new) |
| D1 schema | `src/db/schema.sql` |
| Env patching for prod | `.github/workflows/deploy-pujol.yml` |
| Image helper (reference) | `src/lib/img.ts` (`cfImg`) — do not reuse for email; see §4 |
