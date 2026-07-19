# Newsletter implementation — review & audit (14 Jul 2026)

**Reviewed:** commits `891469b7` (Admin content editors: blog + experts + newsletter), `e7642ab5` (D1→frontend publish pipeline), `ae6bae97` (editor image fixes), against `docs/newsletter-dev-spec.md`, plus a **live smoke test on staging** (admin login → composer → preview → test-send → auth checks).

**Verdict: strong foundation, roughly 75% there.** The composer, templates, campaign log, auth guards and Brevo send path are well built — in several places better than the spec asked. But the **subscriber-facing half (double opt-in) is missing entirely**, which means the system can send newsletters but nobody can actually join the list. That is the one blocker before this feature means anything in production.

---

## What's excellent 👏

- **Architecture followed exactly**: Brevo centralized in the email worker (one home for `BREVO_API_KEY`), main app renders HTML and calls it with `x-internal-token`, D1 keeps only the campaign log. Clean 501 degradation when unconfigured (`src/lib/newsletter-worker.ts`).
- **Auth is airtight**: `requireAdmin()` is called on **all 7** newsletter API routes (verified one by one), and the live test confirms it — unauthenticated `POST /send` → 401. Token guard on the worker also rejects when the secret is unset (no empty-token bypass).
- **`send.ts` flow is thoughtful**: draft row persisted in D1 *before* attempting the Brevo send, so a failed/unconfigured send loses nothing; Brevo campaign id recorded on success.
- **Templates beyond spec**: spec asked for one `digest` template; we got three (`blog`, `listings`, `broadcast` with expert card), all sharing a branded shell that matches the transactional emails (navy/olive, RGPD notice, socials). Correct email-HTML discipline: tables, inline CSS, 600px, hidden preheader, `{{ unsubscribe }}` tag present (verified in the rendered preview output).
- **Composer UX**: template cards, subject + preheader, light RTF (bold/italic/link), article picker with search + drag-reorder, live listings picker (from the active feed, garages excluded), iframe preview, test-send box, drafts, history with delete. Live check: history + composer pages 200, articles API returns clean JSON.
- **Brevo staging provisioning already done** (secrets on both workers: `BREVO_API_KEY`, `NEWSLETTER_LIST_ID`, `NEWSLETTER_SENDER_*`, `NEWSLETTER_INTERNAL_TOKEN`, `EMAIL_WORKER_URL`). Live test-send through the full chain (admin API → email worker → Brevo `/smtp/email`) returned `{"ok":true}` and delivered a real email.

---

## Findings

### 🔴 Blocker

**B1 — Double opt-in not implemented; signups never reach Brevo.**
`workers/email/index.ts:791-808` — `handleNewsletter` is still the pre-project stub: it emails contact@ (cc Caroline) and logs a Sheet row. It never calls `POST /v3/contacts/doubleOptinConfirmation`. Consequence: **the Brevo list has no inflow**; campaigns would go to an unpopulated (or manually populated) list, and the several-signups-per-day Caroline reports are only accumulating in the Google Sheet. This is the core of the "Inscription & double opt-in" devis line. Spec §3.2 has the exact code shape. Also needed with it (spec §1.2): a Brevo **DOI template** containing `{{ doubleoptin }}` and the `NEWSLETTER_CONFIRM_REDIRECT_URL` var (currently unset — check `wrangler secret list`; it's absent).

### 🟠 High

**H1 — Turnstile exemption still in place on `/newsletter`.**
`workers/email/index.ts:965` — `if (env.TURNSTILE_SECRET && path !== '/newsletter')`. Spec §3.5 explicitly says remove the exemption and add the widget to the form (site key `0x4AAAAAADow4gNbXgTPXvdL`, `data-appearance="interaction-only"`). Without it, once DOI goes live, bots can trigger confirmation emails to arbitrary addresses (list-bombing) with only the honeypot in the way. Do this **together with B1**.

**H2 — Confirmation landing page missing.**
Spec §6.3: `src/pages/newsletter-confirmee.astro` (the DOI `redirectionUrl` target). Doesn't exist. Small page, but the DOI flow can't ship without a destination.

**H3 — Signup success message wrong for DOI.**
`NewsletterSignup.astro:39` shows "Merci pour votre inscription !". With double opt-in it must say "Vérifiez votre boîte mail pour confirmer votre inscription." or people will never click the confirmation and silently never join.

### 🟡 Medium

**M1 — `USE_CDN=false` is based on a wrong premise.**
`newsletter-template.ts:42-53` — the comment says "the site currently serves native raster (cfImg passthrough is OFF)". That's true on *staging* only; **prod has Transform Images live** (IMAGE_RESIZE on since go-live, plus a zone cache rule for `/cdn-cgi/image/*`). Since `SITE` is hardcoded to `www.immobiliere-pujol.fr`, the transform endpoint is available to emails regardless of which env rendered them. With the flag off, emails embed **original-size files** — listing photos run 600 KB-1 MB each, so a 4-listing email ships ~3-4 MB of images (slow on mobile, bad engagement). Flip `USE_CDN = true`; `onerror=redirect` already makes it safe even if a transform ever fails, and `format=jpeg` guarantees no AVIF reaches mail clients.

**M2 — Prod email-worker URL resolution unresolved (spec §6.2).**
`NewsletterSignup.astro:8` hardcodes `https://pujol-email.roy-68a.workers.dev/newsletter`, and `deploy-pujol.yml` patches only the R2 hash + the worker's `ALLOWED_ORIGIN` — **nothing rewrites the frontend URL for prod**. Verify which email worker the prod site actually posts to today (the contact forms share this pattern) and make it explicit — e.g. an `PUBLIC_EMAIL_WORKER_URL` env read at build, patched in `deploy-pujol.yml` like the R2 URL. Otherwise prod newsletter signups will hit Roy's staging worker (and Roy's Brevo credentials/list).

**M3 — Which Brevo account/list is staging pointing at?**
Secrets are set but values are opaque. Spec §1.1/§9 requires staging = a **separate test Brevo account/list** so staging can never touch the real list — with the send path now live on staging, a click on "Envoyer" creates and sends a real campaign to whatever `NEWSLETTER_LIST_ID` holds. Confirm it's a test list (and note which sender: today's test email in Roy's inbox shows the configured sender + whether the domain is authenticated). If it's the future prod account, split it now.

**M4 — Recipient count not shown in the composer.**
Spec §5.2: a "Destinataires : N abonnés confirmés" line before sending. Currently the count appears only in history *after* a send. Caroline should see the blast radius before clicking Envoyer. Brevo `GET /contacts/lists/{id}` gives `totalSubscribers` — small worker endpoint + one line of UI.

**M5 — `newsletter_campaigns` schema lives only in code.**
`newsletter-db.ts:34-56` creates/migrates the table at runtime (`ensureSchema`). Convenient, but `src/db/schema.sql` remains the repo's schema reference and doesn't mention the table. Add it there too (comment fine) so the next person diffing D1 against schema.sql isn't surprised. Runtime `CREATE TABLE IF NOT EXISTS` on every API call also costs a query per request — cheap, but a one-time migration would be cleaner.

### 🟢 Low / polish

- **L1 — Social icons hotlinked from `img.icons8.com`** (`newsletter-template.ts:70`): a third-party dependency inside every email; if icons8 blocks hotlinking the footer breaks, and subscriber opens leak to a third party. Copy the 4 icons to `public/images/email/` and serve from the site domain.
- **L2 — Stats endpoint built but not surfaced**: `/newsletter/stats` (worker) is ready; the history page shows no opens/clicks. Add a small per-campaign stats fetch in `newsletter/index.astro` (or on row expand) — it's the "statistiques" half of the devis line.
- **L3 — Rich-text fields aren't sanitized server-side**: intro/outro/body HTML from the composer is injected into the email as-is; only plain fields go through `esc()`. Admin-only input, so low risk, but a 5-line allowlist strip (`b/i/a/p/br` only) in `renderNewsletter` would close it.
- **L4 — Test-send accepts empty content**: an empty-articles blog template rendered and sent fine. Consider requiring ≥1 article/listing (or a warning) so a half-composed test doesn't confuse.
- **L5 — No double-click protection on Envoyer**: two rapid clicks = two Brevo campaigns. The confirm dialog mitigates; disabling the button while in flight is cheap insurance.

---

## New requirement — Abonnés & stats dashboard (Caroline's only window into Brevo)

**Why:** Pujol owns the Brevo account but, by design, **Caroline never logs into Brevo** (everything happens in the site). So the back-office is her *only* view of (a) who's on the list and (b) how past newsletters performed. This is the natural completion of the "Envoi de campagne & statistiques" devis line, and it **reuses M4 + L2** rather than adding new plumbing. **Read-only** — Brevo stays the source of truth; nothing new persisted in D1 beyond the existing campaign log. Build M4, L2 and this as **one** "Newsletter → Abonnés & stats" area, not three disconnected pieces.

### A. Abonnés (subscription overview)
- **Headline tiles**: total confirmed subscribers · new this month · unsubscribed/bounced.
  - `GET /v3/contacts/lists/{NEWSLETTER_LIST_ID}` → `totalSubscribers` / `totalBlacklisted`. This is the **same call M4** needs for the composer count — build the worker endpoint once, reuse in both places.
  - "New this month": derive from `GET /v3/contacts?listIds={id}&modifiedSince=<startOfMonth>` (`createdAt`); Brevo has no built-in historical series.
- **Subscriber table**: paginated (email, subscribe date, status), search by email, **CSV export** on demand.
  - `GET /v3/contacts/lists/{id}/contacts?limit=&offset=` (paginate; cap page size, lazy-load).
- **Scope guard**: view + search + export only. **No add/edit/delete in the UI** — unsubscribe handling already removes people, rare manual cases go through Roy. A full contacts CRUD is out of scope.

### B. Stats des newsletters envoyées (past-campaign performance)
- Surface the **already-built** `/newsletter/stats` worker endpoint (L2) in the history page: per campaign show date, subject, recipients, **delivered · open rate · click rate · unsubscribes · bounces**.
  - The D1 campaign log already stores the Brevo campaign id per send → `GET /v3/emailCampaigns/{campaignId}` → `statistics.globalStats` (sent, delivered, uniqueViews, uniqueClicks, unsubscriptions, hardBounces…).
- Small aggregate header (avg open rate over last N sends) is a nice-to-have, not required.

### Notes
- **Caching**: live Brevo reads on an admin page — cache list counts / campaign stats a few minutes (KV or in-worker) to stay under Brevo rate limits and keep the page snappy.
- **Auth/GDPR**: the subscriber table exposes personal data (emails) — keep it behind the existing `requireAdmin()`. It's Pujol's own admin over their own data, so fine.
- **Absorbs M4 + L2**: treat those two findings as sub-parts of this screen.

---

## Live smoke test (staging, 14 Jul)

| Check | Result |
|---|---|
| Admin login (session cookie) | ✅ 302 → `/admin-pujol/` |
| `/admin-pujol/newsletter/` (history) | ✅ 200 |
| `/admin-pujol/newsletter/new/` (composer) | ✅ 200 |
| Articles picker API (authed) | ✅ 200, correct JSON |
| `POST /send` without session | ✅ 401 rejected |
| Preview render | ✅ 200; `{{ unsubscribe }}` present; images absolute |
| Test-send through full chain | ✅ 200 — **real email delivered via Brevo** (staging is provisioned) |

## Acceptance vs devis (current state)

| Devis line | State |
|---|---|
| Intégration Brevo & délivrabilité | 🟡 Brevo wired + provisioned on staging; sending domain/DKIM status unverified (M3) |
| Inscription & double opt-in | 🔴 Not implemented (B1 + H1-H3) |
| Désinscription & hygiène | ✅ `{{ unsubscribe }}` in place; Brevo handles suppression |
| Composeur | ✅ Done, beyond spec (3 templates) |
| Gabarit e-mail | 🟡 Done; flip image CDN (M1); multi-client test pass still to run |
| Aperçu & envoi de test | ✅ Done, verified live |
| Envoi & statistiques | 🟡 Send done; needs the **Abonnés & stats dashboard** (absorbs L2 stats UI + M4 recipient count + subscriber overview/table/export) |
| Migration liste MailChimp | ⬜ Not started (needs Anthony's export — not a code task) |
| RGPD / CNIL | 🟡 Footer + consent checkbox done; DOI consent registry blocked by B1; mentions légales update pending |
| Recette & mise en production | ⬜ Blocked on B1; prod config open (M2, M3) |

## Suggested order of work

1. **B1 + H1 + H2 + H3 as one changeset** — the DOI flow end to end: Brevo DOI template + `NEWSLETTER_CONFIRM_REDIRECT_URL`, rework `handleNewsletter`, remove Turnstile exemption + add widget, landing page, success message. This completes the missing half of the system.
2. **M1** (flip `USE_CDN`) and **M3** (confirm staging Brevo account/list separation) — 10 minutes each, do immediately.
3. **M2** — decide the prod URL mechanism with Roy before any prod promotion.
4. **Abonnés & stats dashboard** (absorbs M4 + L2) — recipient count, per-campaign stats, and the subscriber overview/table/export. This is Caroline's only window into Brevo, so it completes both the "statistiques" devis line and the "no Brevo access" design.
5. **M5, L1, L3-L5** — polish batch.
6. Then: full multi-client render test (Gmail web/app, Outlook desktop, Apple Mail, mobile) using the test-send, and the MailChimp list migration once the export arrives.

---

*Review by Roy/PWS (Claude-assisted). Code references are to `develop` @ `a69d24c0`. The live tests created one D1 draft campaign row and sent one [TEST] email to roy@perelweb.studio; no campaigns were sent to any list.*
