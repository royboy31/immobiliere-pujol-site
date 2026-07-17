# Admin Content Editors — Progress & Handover

**Status:** Three D1-backed admin tools running **locally** (never deployed): **blog articles**
(+ R2 image upload + rich SEO/OG), **experts** (+ R2 photo upload + SEO), and a **newsletter
composer** (3 email templates + live preview + Brevo send wiring; sending blocked on Brevo keys).
Last updated: 2026-07-10.
**Scope:** Admin editors (create/read/update/delete + WYSIWYG HTML) for the Immobilière Pujol
site. Local-only so far — nothing pushed to staging or prod.

### ▶ Resume here (next session, 2026-07-11+)
Everything below is **built + verified locally, uncommitted** (branch `develop`; nothing staged/
deployed). To pick up:
1. **Start the app:** `cd site && npm run dev` → http://localhost:4321/admin-pujol/login/
   (`roy@perelweb.studio` / `local`). Local Miniflare D1 persists; blog demo rows + the real 27
   experts are seeded (`SEED_DEMO=1` in `.dev.vars`).
2. **State of play:** blog editor ✅, experts editor ✅, newsletter composer ✅ (3 templates +
   live preview + D1 log). Newsletter **sending is stubbed** — degrades to 501 until Brevo exists.
3. **Nothing is committed.** 23 uncommitted paths (see `git status`). Decide with Roy whether to
   commit/stage before more work. Per WORKFLOW.md: work on `develop`, staging-only, never touch
   `pujol-main` without approval.
4. **Likely next tasks** (pick per Roy's priority):
   - Newsletter signup **double opt-in** + Turnstile + `newsletter-confirmee` page (§10 remaining #1).
   - Or the **D1 → content build-sync** so blog/experts edits reach the public site (§9 rollout).
   - Or start the **staging deploy** path (§9) once a feature is approved.
   - Blocked-on-Roy for real newsletter sends: Brevo account/keys/domain (§10 "Blocked on Roy").

> **Scope decision (2026-07-09, reaffirmed 2026-07-10 for experts):** build the **backend only
> for now — D1 + R2 + the admin API + admin UI**. The **public frontend** (rendering the edited
> data on the live site, the D1→content build-sync, and Publier→deploy) is a **separate later
> phase** — see **§8 Staging → Production rollout** for the exact steps. The backend + admin UI
> layer for both features is complete + verified locally.

### Session log
- **2026-07-09 (session 1):** studied the stack; built the D1-backed CRUD editor (list, create,
  edit, delete, preview) + WYSIWYG-with-HTML-source editor; got it running under `astro dev` with
  local `.dev.vars` creds; fixed the login/logout trailing-slash 404s. Recorded this doc + memory.
- **2026-07-09 (session 2):** wired **R2 image upload** — new guarded `upload-image` endpoint +
  public `/media/[...path]` serve route; editor gains toolbar/paste/drag-drop body-image upload
  and featured-image upload. Verified upload→store→serve roundtrip. Chose to keep staging D1
  **untouched** (stay fully local).
- **2026-07-09 (session 3):** **rich SEO + Open Graph editor.** Added D1 columns (article_date,
  canonical_url, focus_keyword, noindex, nofollow, og_title, og_description, og_image,
  twitter_card) with an additive migration (PRAGMA table_info + ALTER). Editor now has a tabbed
  SEO/Social panel: meta title + description with **live char counters**, canonical, focus
  keyword, robots (noindex/nofollow), full Open Graph (title/desc/image+upload, Twitter card),
  a live **Google-SERP preview** and **social-card preview**, plus an article date field. The
  `/preview/` page renders real `og:*`/`twitter:*`/`canonical`/`robots` meta + an effective-values
  table. Fixed edit-page nav (preview/back one level deeper than `new`).
- **2026-07-10 (session 4):** **(a)** Fixed the article editor's "basic, small" form fields —
  AdminLayout's input styling is Astro-scoped to the layout so it never reached the editor's
  slotted `text`/`url`/`textarea` fields (they fell back to browser defaults); added the
  design-system field styling (15px, olive focus ring) scoped inside `ArticleEditor.astro`.
  **(b)** Built the **experts editor backend + admin UI** end-to-end, mirroring the blog pattern
  (D1 table `experts`, guarded API, `ExpertEditor.astro`, admin index/new/edit, R2 photo upload).
  Seeds the real 27 profiles into local D1 (gated by `SEED_DEMO=1`). Full CRUD verified. See §9.
  **(c)** Built the **newsletter composer** (Brevo) — 3 email templates matching the transactional
  brand, admin composer with live preview, D1 campaign log, worker Brevo endpoints. Templates +
  preview + log verified locally; actual sending blocked on Brevo provisioning. See §10.
  **(d)** Verification pass — relaunched `npm run dev` (astro v6.1.3, ready on
  http://localhost:4321/) and confirmed the backend is live: `/admin-pujol/login/` → 200,
  and `/admin-pujol/blog|experts|newsletter/` → 302 (auth guard redirecting to login as
  expected). Local Miniflare D1 persisted the seeded blog demo rows + 27 experts. No code
  changes this pass; still uncommitted on `develop`.

---

## 1. Decisions locked in (with the user)

1. **Publish model:** build-triggered, mirroring the annonces pattern. D1 is the source of
   truth; a build-time sync writes `.md` files; "Publier" will trigger a rebuild/deploy.
   (The deploy trigger is **not wired yet** — see Next steps.)
2. **Existing 891 articles:** will be imported into D1 so old + new are edited in one place.
   (Import script **not written yet**.)
3. **Editor:** WYSIWYG **with an HTML-source toggle** (contenteditable + toolbar + `</> Source`).

---

## 2. Architecture studied (the constraints that shaped everything)

- **Stack:** Astro 6 SSR via `@astrojs/cloudflare` adapter → runs as a **Cloudflare Worker**.
  D1 (SQLite) for data, R2 for images. All client content is **French**.
- **Blog articles today:** 891 markdown files in `src/content/articles/*.md` with **raw-HTML
  bodies**, loaded via `getCollection('articles')`. Rendered by `src/pages/[...slug].astro`
  which is **`prerender = true`** (built at build time) and injects the body via `set:html`.
- **Key constraint:** Cloudflare Workers have a **read-only filesystem at runtime** → an editor
  can NOT write `.md` files live. Editable content must live in **D1** (writable at runtime),
  then be synced to content files at build (exactly what `scripts/sync-d1-to-content.mjs`
  already does for annonces, which are D1-backed).
- **Deploy trigger exists:** `workers/cron-sync/index.ts` fires `deploy.yml` via GitHub Actions
  `workflow_dispatch` using `GITHUB_TOKEN`. The "Publier" button will reuse this mechanism.
  `deploy.yml` triggers on push to `main`/`develop` + `workflow_dispatch`.
- **Auth (reused):** `src/middleware.ts` guards **page** routes under `/admin-pujol/`. **API
  routes under `/api/admin-pujol/` are NOT auto-guarded** → every API route must call the guard
  explicitly. `src/lib/admin-auth.ts` = PBKDF2 password + JWT session cookie (`jose`), shared
  password + email allowlist (`ADMIN_EMAILS`).
- **Image upload:** a pre-existing `src/pages/api/r2-upload.ts` PUTs to R2 `PHOTOS` via
  `UPLOAD_TOKEN` (temporary/token-based). Instead of reusing it we added a dedicated
  session-guarded endpoint + a `/media` serve route (see §3) — now wired into the editor.
- **Config:** `trailingSlash: 'always'` and Astro CSRF **origin checks** on non-GET form posts —
  both bit us (see Gotchas).

### Cloudflare accounts (via wrangler `kamindudushmantha@gmail.com`)
| Account | ID | Role |
|---|---|---|
| Roy@perelweb.studio | `68abcbaf4817943a805737802e15679a` | **Staging** |
| Pujol@net-system.be | `75ed262d0cb67f3a54ee1cc2d7ffd157` | **Production** |

- **Staging D1:** `pujol-annonces`, id `109fb417-c984-4c08-90b2-2a10ae1bc279` (EEUR).
  Tables: `annonces` (5,348 rows), `annonces_photos`, `annonces_seo_links`, `sync_log`.
  **No `blog_articles` table yet.**
- **Email worker (`pujol-email`) secrets:** only `MANDRILL_API_KEY`. No Brevo/newsletter/Turnstile.
- ⚠️ **Security note (pre-existing):** admin `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET`
  live in **plaintext `vars`** in `wrangler.jsonc` (should be Cloudflare secrets). The session
  secret in the clear means admin JWTs are forgeable by anyone with repo access.

---

## 3. What was built (files)

Backend / data:
- `src/lib/blog-db.ts` — D1 access: `getDB`, `ensureSchema` (CREATE TABLE IF NOT EXISTS +
  gated demo seed), `slugify`, `listArticles`, `getArticle`, `createArticle`, `updateArticle`,
  `deleteArticle`. Table `blog_articles` (see schema in that file).
- `src/lib/admin-guard.ts` — `requireAdmin(request)` → email or null.
- `src/pages/api/admin-pujol/articles/index.ts` — GET list, POST create (guarded).
- `src/pages/api/admin-pujol/articles/[id].ts` — GET / PUT / DELETE (guarded).
- `src/pages/api/admin-pujol/articles/upload-image.ts` — POST (guarded): stores a multipart
  `file` in R2 `PHOTOS` under `blog/<year>/<ts>-<slug>.<ext>`, returns `{ url: "/media/<key>/" }`.
- `src/pages/media/[...path].ts` — GET (public): streams an object from R2 `PHOTOS`, long cache.
  Images use root-relative `/media/<key>/` URLs → identical in local dev and prod, no r2.dev
  branching. Note the **trailing slash** is required (site is `trailingSlash:'always'`).
  Tradeoff: served through the worker, not the r2.dev CDN / cdn-cgi/image resize — fine for the
  low volume of blog images; can switch to absolute r2.dev URLs later if wanted.

Admin UI:
- `src/pages/admin-pujol/articles/index.astro` — real list (replaced the old stub): title,
  status badge, date, Aperçu/Éditer/Suppr.
- `src/pages/admin-pujol/articles/new.astro` — create.
- `src/pages/admin-pujol/articles/[id]/edit.astro` — edit (loads row from D1).
- `src/pages/admin-pujol/articles/[id]/preview.astro` — public-style preview from D1.
- `src/components/admin/ArticleEditor.astro` — the editor: title, WYSIWYG body (toolbar:
  H2/H3/¶, B, I, list, quote, link, 🖼️ image upload) + `</> Source HTML` toggle. Sidebar:
  publication (status, article date, slug auto-gen+freeze), featured image + upload + thumb,
  excerpt/categories/tags/author, expert-CTA picker. **Tabbed SEO/Social panel** below the body:
  meta title + meta description with live char counters, canonical URL, focus keyword, robots
  (noindex/nofollow), Open Graph (title, description, image + upload, Twitter card), and live
  **Google-SERP** + **social-card** previews. Images: toolbar / paste / drag-drop, both modes.
- `src/lib/blog-db.ts` `blog_articles` columns (beyond the basics): `article_date`,
  `seo_title`, `seo_description`, `canonical_url`, `focus_keyword`, `noindex`, `nofollow`,
  `og_title`, `og_description`, `og_image`, `twitter_card`. `ensureSchema` runs an additive
  migration so old DBs upgrade in place.

Touched existing files (correct per the site's own `trailingSlash: 'always'`):
- `src/pages/admin-pujol/login.astro` — form action `…/auth/login` → `…/auth/login/`.
- `src/layouts/AdminLayout.astro` — logout form action + trailing slash; sidebar already links
  the articles section.

Local-only (gitignored):
- `.dev.vars` — local admin creds + `SEED_DEMO=1`. **Login password: `local`**,
  emails `roy@perelweb.studio` / `carolinepujol@immobiliere-pujol.fr`.

---

## 4. How to run & test locally

```bash
cd /home/kamindu/pujol/site
npm install            # once (use PUPPETEER_SKIP_DOWNLOAD=1 — no browser needed)
npm run dev            # astro dev on http://localhost:4321
```
1. Open `http://localhost:4321/admin-pujol/login/`, log in `roy@perelweb.studio` / `local`.
2. Sidebar → **Articles de blog** → create/edit/preview/publish/delete.
- Data lives in a **local Miniflare D1**, persisted to `.wrangler/state/v3/d1/…sqlite`
  (survives restarts). Isolated from staging/prod. Seeded with 3 demo rows (because `SEED_DEMO=1`).
- Nothing here is deployed. `npm run build` is NOT required to test the editor.

---

## 5. Gotchas discovered (save yourself the pain)

- **`trailingSlash: 'always'`** — every fetch/form to an API route needs a **trailing slash**,
  else the dev server 404s (POST/PUT/DELETE don't redirect). All our client calls use `/…/`.
- **Astro CSRF origin check** — non-GET requests with form content-types are 403'd unless the
  `Origin` header matches. Browsers send it automatically; `curl` tests must add
  `-H "Origin: http://localhost:4321"` (or use JSON content-type, which isn't origin-checked).
- **Secure cookie on localhost** — the session cookie is `Secure`; real browsers send it on
  `localhost` (secure context), but `curl` won't over http — capture Set-Cookie manually to test.
- **Editing `.dev.vars` restarts dev and can crash Miniflare** (`Expected 'miniflare' to be
  defined`). Fix = full clean restart (`pkill -f astro; npm run dev`), not HMR. Data persists.
- **D1 schema:** don't collapse multi-line SQL with `--` comments onto one line (the comment
  eats the rest). `blog-db.ts` uses a single comment-free statement via `db.prepare().run()`.
- **No browser in this WSL env** — puppeteer's Chrome download fails; can't screenshot. Preview
  via the live localhost URL.

---

## 6. Next steps

**Backend (D1 + R2 + admin API) — DONE.** CRUD, image upload/serve, rich SEO/OG fields all built
and verified locally. This is the current agreed scope.

### Frontend phase — later (deferred by scope decision)

1. ~~**Image upload in the editor**~~ ✅ DONE (2026-07-09) — toolbar 🖼️, paste, and drag-drop
   upload body images; featured image has a "Téléverser" button. Stored in R2, served via
   `/media/<key>/`. Works locally + prod.
2. **Publier → real deploy** → on publish, set status + fire `deploy.yml` `workflow_dispatch`
   (reuse the cron-sync `GITHUB_TOKEN` pattern; needs the token as a main-app secret).
3. **Build-time sync** `scripts/sync-d1-articles-to-content.mjs` → write `.md` from D1 rows,
   add to the `npm run build` chain (next to `sync-d1-to-content.mjs`). Then add
   `src/content/articles` to the CLAUDE.md build-artifact restore rule.
   ⚠️ **Render/schema gap:** `content.config.ts` (articles) + `[...slug].astro` currently only
   support `seoTitle`, `seoDescription`, `featuredImage` (featured = og:image). The new fields
   (`canonical_url`, `og_image`, `og_title`, `og_description`, `noindex`, `nofollow`,
   `twitter_card`, `focus_keyword`, `article_date`) are stored + shown in the editor/preview but
   the **public site won't use them until** the content schema and the page `<head>` are
   extended to emit them. Do this together with the sync script so editor == live behaviour.
4. **Import the 891 existing articles** → `scripts/import-articles-to-d1.mjs` (parse frontmatter
   + HTML body → `blog_articles`, status=published). Verify render parity for a sample.
5. **Production-parity preview** → render preview through the real `[...slug].astro` pipeline
   (image-pair layout, div-balancing) instead of the current faithful stand-in.
6. **Staging** → create `blog_articles` on staging D1 (additive), then deploy when approved.

---

## 7. Staging D1 — safety notes

> **Decision (2026-07-09):** stay **fully local** for now — staging D1 is intentionally
> **untouched** (no `blog_articles` table created, nothing written). Revisit once the editor is
> further along.


- Our code **only ever touches the `blog_articles` table** — it never reads/writes `annonces`
  or any existing table. So connecting to staging D1 **cannot damage the existing setup**.
- The demo seed is now gated behind `SEED_DEMO=1` (local `.dev.vars` only) → connecting to
  staging will **never** insert demo rows.
- Making staging "ready" = one additive, reversible statement:
  ```bash
  # create (safe, IF NOT EXISTS, touches nothing else)
  CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a \
    npx wrangler d1 execute pujol-annonces --remote \
    --command "CREATE TABLE IF NOT EXISTS blog_articles ( ... )"   # schema from blog-db.ts
  # undo if ever needed
  #   ... --command "DROP TABLE blog_articles"
  ```
- To have the **local dev server read/write the real staging D1 live**, use wrangler remote
  bindings (experimental). Safe for existing data (isolated table + gated seed) but makes local
  writes hit the shared staging DB — do it deliberately.

---

## 8. Experts editor (2026-07-10) — backend + admin UI, local only

Mirrors the blog editor exactly. Lets admins manage the team profiles that power `/experts/`,
`/experts/{slug}/`, the `ExpertContactCard` appended to blog articles, and `lib/experts.ts`
(feed email → expert matching for listings).

### What was built (files)
- `src/lib/experts-db.ts` — D1 table **`experts`** + CRUD + `slugify` + `ensureSchema` (CREATE IF
  NOT EXISTS, additive PRAGMA/ALTER migration). On an **empty local** DB with `SEED_DEMO=1` it
  seeds the **real 27 profiles** from `src/content/experts/*.json` (eager `import.meta.glob`, same
  bundling trick as `lib/experts.ts`). Reuses the same `DB` binding as the blog.
- `src/pages/api/admin-pujol/experts/index.ts` — GET list, POST create (guarded).
- `src/pages/api/admin-pujol/experts/[id].ts` — GET / PUT / DELETE (guarded).
- `src/pages/api/admin-pujol/experts/upload-image.ts` — POST (guarded): stores a photo in R2
  `PHOTOS` under `experts/<year>/<ts>-<slug>.<ext>`, returns `{ url: "/media/<key>/" }`. Separate
  from the blog `upload-image` so photos land under `experts/` and the blog endpoint is untouched.
- `src/components/admin/ExpertEditor.astro` — bio WYSIWYG (H3/H4/¶/B/I/list/quote/link/image +
  `</>` source toggle) with two extra buttons **« Chapô »** / **★ Spécialité** that apply the
  public `expert-bio-quote` / `expert-bio-spec` classes. Sidebar: Profil (department, order,
  secteur, slug), Photo (url + upload + preview), Coordonnées (phone, email, email aliases),
  Réseaux & agenda (linkedin/facebook/instagram/agenda), Visibilité (`hidden`, `listing_only`).
  SEO card: meta title + description with live counters + a live Google-SERP preview. Uses the
  fixed design-system field styling (see session-4 note (a)).
- `src/pages/admin-pujol/experts/index.astro` — **rewritten** from the old JSON-glob stub to read
  D1: a table with avatar, name, fonction, department, visibility badge, Voir/Éditer/Suppr.
- `src/pages/admin-pujol/experts/new.astro` + `[id]/edit.astro` — create / edit (loads from D1).

### Data model notes (faithful to the existing JSON)
- Columns match `content.config.ts` `experts` schema: `title` ("Prénom Nom – Rôle"), `fonction`,
  `description` (HTML bio), `photo`, `phone`, `email`, `email_aliases` (JSON), `linkedin`,
  `facebook`, `instagram`, `seo_title`, `seo_description`, `department`, `sort_order` (col named
  `sort_order`, **not** `order` — reserved word), `agenda`, `secteur`, `hidden`, `listing_only`.
- **No draft/publish lifecycle** (unlike blog) — visibility is governed by `hidden` +
  `listing_only`, matching how `/experts/` and the listings already work.
- **Departments in the real data:** Direction, Vente, Gestion locative, Syndic, Contentieux,
  **Accueil**, **Comptabilité** (last two on hidden profiles). The editor dropdown lists all of
  them **and preserves any unknown value** — otherwise editing an Accueil/Comptabilité expert
  would silently blank the field on save.
- `email_aliases` matters: `lib/experts.ts` uses them to map feed `contactAAfficher` emails to an
  expert. Keep them editable/preserved (only `benoit-transactions` uses one today).

### Verified (2026-07-10, local)
Full CRUD roundtrip green via the live API: seed→27, GET list + single, POST create (201),
PUT update (no field loss, slug frozen, aliases/dept/phone/hidden all round-trip), DELETE (200,
back to 27). Admin index + edit pages render. No dev errors.

### Deferred (same scope decision as blog)
Public **D1 → `src/content/experts/*.json` build-sync** and the Publier/deploy trigger. Until
that's wired, expert edits live **only in D1** and do **not** appear on the public `/experts/`
pages (those still read the hand-authored JSON files). See §9.

---

## 9. Staging → Production rollout (both editors) — the future-reference checklist

> Nothing here is done yet — this is the plan for when we take the editors live. **Follow
> `WORKFLOW.md` + `CLAUDE.md` for every step.** Key rules that apply: **staging-only by default**;
> **never touch `pujol-main` (production) without Roy's explicit per-change approval**; after any
> push run BOTH `git push origin develop` and `git push origin develop:main` (keep `main==develop`
> or the hourly `pujol-cron-sync` reverts you); **never commit build artifacts** — restore with
> `git checkout HEAD -- src/content/annonces src/data public/_data` after each build.

**The core gap:** the editors write to **D1**, but the public site renders from **content files**
(`src/content/articles/*.md`, `src/content/experts/*.json`) that are read at **build time**. So
"going live" = a build-time sync that materialises D1 rows into those files, wired into
`npm run build`, plus a deploy. Ordered steps:

1. **Write the two build-sync scripts** (mirror `scripts/sync-d1-to-content.mjs`, which already
   does this for annonces):
   - `scripts/sync-d1-articles-to-content.mjs` → `blog_articles` rows → `src/content/articles/*.md`
     (frontmatter + HTML body). Only `status='published'`.
   - `scripts/sync-d1-experts-to-content.mjs` → `experts` rows → `src/content/experts/*.json`
     (map snake_case cols → the JSON camelCase keys: `sort_order`→`order`, `email_aliases`→
     `emailAliases`, `listing_only`→`listingOnly`, etc.). Emit **all** rows.
   - Add both to the `"build"` chain in `package.json` (before `astro build`). Add
     `src/content/articles` + `src/content/experts` to the **build-artifact restore** rule in
     `CLAUDE.md` / `WORKFLOW.md` so a build never leaves them committed.
2. **Close the render/schema gaps** (do together with the sync so editor == live):
   - **Blog:** extend `content.config.ts` (articles) + `[...slug].astro` `<head>` to emit the new
     SEO/OG fields (`canonical_url`, `og_*`, `noindex`, `nofollow`, `twitter_card`,
     `focus_keyword`, `article_date`) — today only `seoTitle`/`seoDescription`/`featuredImage`
     are used (see §6.3).
   - **Experts:** `content.config.ts` already covers every field the editor writes — verify the
     sync output validates against it (esp. `agenda` is `.url()`, `order` is a number).
3. **Import existing content into D1** (so old + new live in one place; run against the target DB):
   - Blog: `scripts/import-articles-to-d1.mjs` — the 891 `.md` → `blog_articles` (status=published).
   - Experts: **already handled locally** by the `SEED_DEMO` seed from the 27 JSON files; for
     staging/prod run a one-off import (same mapping) since the seed is gated off outside local.
4. **Create the tables on the target D1** (additive, reversible — `IF NOT EXISTS`, touches nothing
   else). Staging = Roy acct `68abcbaf4817943a805737802e15679a`, D1 `pujol-annonces`:
   ```bash
   CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a \
     npx wrangler d1 execute pujol-annonces --remote --command "<SCHEMA from blog-db.ts>"
   CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a \
     npx wrangler d1 execute pujol-annonces --remote --command "<SCHEMA from experts-db.ts>"
   ```
   `ensureSchema` also creates/migrates them on first request, but doing it explicitly is clearer.
5. **R2 in prod:** uploads already use root-relative `/media/<key>/` served by
   `src/pages/media/[...path].ts` from the `PHOTOS` bucket → identical local/staging/prod, no URL
   rewrite. Confirm the prod worker binds `PHOTOS`.
6. **Publier → deploy trigger** (optional, later): on publish, fire `deploy.yml`
   `workflow_dispatch` (reuse the `workers/cron-sync` `GITHUB_TOKEN` pattern; needs the token as a
   main-app secret). Until then, publishing = merge + the normal build/deploy loop.
7. **Deploy to STAGING** via the CLAUDE.md loop: build → `npx wrangler deploy` → restore artifacts
   → `git push origin develop` + `git push origin develop:main` → verify on
   `https://immobiliere-pujol-staging.roy-68a.workers.dev`. **Then ask Roy** before promoting to
   production (`pujol-main`) — one approval does not carry to the next change.

⚠️ **Security debt to fix before prod (pre-existing, flagged 2026-07-09):** admin
`ADMIN_PASSWORD_HASH` + `ADMIN_SESSION_SECRET` live in plaintext `vars` in `wrangler.jsonc` —
move them to Cloudflare **secrets** (a clear session secret means admin JWTs are forgeable by
anyone with repo access).

---

## 10. Newsletter composer (2026-07-10) — 3 templates + composer + Brevo wiring, local only

Implements `newsletter-dev-spec.md` (approved 2026-07-07) **extended from 1 template to 3** at
Caroline/Roy's request. Follows the spec's architecture exactly: **Brevo owns list/DOI/unsubscribe/
deliverability**; the **`pujol-email` worker owns all Brevo calls**; the **main app renders HTML**
and calls the worker with a shared internal token; **D1 stores only a campaign log**.

### The 3 templates (all share one branded shell)
Matched to the **real transactional email brand** (`workers/email/index.ts`): navy `#0f1a2b`
header/footer, olive `#B2C54F` accent, `#eef3ef` bg, white logo, RGPD notice, address/hours/social
footer, `{{ unsubscribe }}` tag. *(The spec §4's `#1f7a44` green is wrong — ignore it.)*
- **`blog`** (Actualités) — intro + 1–3 blog-article cards + outro. For posts / latest updates.
- **`listings`** (Sélection de biens) — heading + property cards (photo, price, Vente/Location
  badge, city, surface/pièces, "Voir le bien") + "Voir toutes nos annonces". For sales / rentals /
  offers. Type toggle V/L/mixte.
- **`broadcast`** (Message / Offre) — hero + headline + rich text + one CTA + optional expert
  contact card (reuses the experts data). For announcements / promotions / estimation campaigns.

### Files
- `src/lib/newsletter-template.ts` — branded shell + `emailImg()` (absolute; `USE_CDN=false` for
  now since cfImg/Transform-Images is OFF, so sources are native raster — flip to cdn-cgi JPEG once
  Transform Images is live) + `renderBlog/renderListings/renderBroadcast` + `renderNewsletter()`.
- `src/lib/newsletter-db.ts` — D1 `newsletter_campaigns` (spec §2 + a `content_json` col for
  template-specific content) + `ensureSchema` (isolated table, additive migration) + CRUD.
- `src/lib/newsletter-worker.ts` — thin client to the email worker (`EMAIL_WORKER_URL` +
  `NEWSLETTER_INTERNAL_TOKEN`); returns **501** when unset (i.e. locally / until Brevo provisioned).
- `src/pages/api/admin-pujol/newsletter/*` — guarded: `articles` (blog picker via
  `getCollection('articles')`), `listings` (live Ubiflow feed, auto-suggest + search + kind),
  `preview` (renders HTML), `test`, `send` (writes draft log → worker → mark sent), `index`
  (list/save-draft), `[id]` (get/delete). **All client calls need a trailing slash** (site is
  `trailingSlash:'always'`) — the picker fetch URLs include it.
- `src/pages/admin-pujol/newsletter/{index,new}.astro` — history table + composer (template picker,
  per-template fields, article/listing pickers with **auto-suggested default set + editable**,
  minimal rich-text intro/outro/body, live `<iframe srcdoc>` preview, Aperçu/Test/Brouillon/Envoyer).
- `src/layouts/AdminLayout.astro` — added the **Newsletters** nav item (section `'newsletter'`).
- `workers/email/index.ts` — added `Env` fields + `/newsletter/{send,test,stats}` (JSON, guarded by
  `x-internal-token`, intercepted **before** the `formData()` parse). Inert (501/403) until Brevo
  secrets exist. The existing signup `/newsletter` DOI rework (spec §3.2) + Turnstile (§3.5) are
  **NOT done yet** — separate item.

### Verified (2026-07-10, local)
Composer + history pages render; all 3 templates render via `/preview` (200, correct brand +
template-specific content); article picker returns real posts, listing picker returns live feed
biens with formatted prices; save-draft / list / delete round-trip; **`send` degrades to 501 with
the draft preserved** and a clear French message (Brevo not configured). No dev errors.

**Fix (2026-07-10):** picker thumbnails rendered full-size because the rows are built with
`innerHTML` in client JS and so don't carry the component's Astro scope attribute — the scoped
`.pick-item img` / `.pick-row img` size rules never applied. Fixed by making all `.pick-*` rules
`:global()` in `new.astro` (52×40 selected, 46×34 available). Same class of bug as the
article-editor field styling — **remember: any element created via `innerHTML` needs `:global()`
CSS, scoped rules won't reach it.**

### Blocked on Roy/client (not code) — needed before any real send
Per spec §1 + §9: a **Brevo account** + `BREVO_API_KEY`, an **authenticated sending domain**
`news.immobiliere-pujol.fr` (SPF/DKIM/DMARC green), the **list id**, and a **DOI template id**.
Set on the **email worker** (secrets/vars); set `EMAIL_WORKER_URL` + `NEWSLETTER_INTERNAL_TOKEN` on
the **main app**. Staging must use Roy's **separate** Brevo account/test list (never the prod list).

### Newsletter — remaining spec items (later phases)
1. **Signup double opt-in** — rework `handleNewsletter` in the worker to call Brevo DOI (spec §3.2),
   add the Turnstile widget to `NewsletterSignup.astro` + re-enable Turnstile on `/newsletter`
   (§3.5/§6), create `src/pages/newsletter-confirmee.astro` landing page.
2. **Stats in admin** — surface `/newsletter/stats` (opens/clicks) on the history page.
3. **MailChimp list migration** — re-opt-in via a separate `Reconfirmation` Brevo list (spec §7).
4. **RGPD** — add Brevo (Sendinblue SAS) as processor in mentions légales (spec §8).
5. **Deploy** — same staging→prod path as §9 (create `newsletter_campaigns` on target D1; set the
   Brevo secrets/vars per environment; never send from staging to the prod list).

---

## 11. Staging migration — IN PROGRESS, paused on a GitHub token (2026-07-12)

**Goal:** get the admin editors (backend + admin UI) running on **staging**, **Scope A** — editors
write to the real staging D1/R2; the public frontend + build-sync stay deferred (§9). Decided to
build **from scratch** (staging had no editor tables/backend to reuse). User authorised staging
implementation, on the condition **the existing staging site must not break or change**.

### Verified before starting (local, real data)
- All 3 editor write paths reach D1 + R2 locally. Pushed the **real** `benoit-transactions.json`
  (13/13 fields) and the **real** `vacance-locative.md` (10/10 fields + **byte-identical 7498-char
  HTML body**) through the live create→read-back API — zero field loss. The backend can edit
  **everything** on the two live sample pages (it's a superset). Artifacts cleaned up.
- Staging recon: admin **shell** (login) is deployed (`/admin-pujol/login/` → 200) but editor APIs
  are **404** (backend not deployed); staging D1 had only `annonces*` + `sync_log`.

### Done (safe; existing site untouched)
1. Committed the 23 editor files on `develop` — local commit **`f740d4d0`** ("Admin content
   editors: blog + experts + newsletter"). `.dev.vars` + `.wrangler` confirmed gitignored; no build
   artifacts staged.
2. Rebased `develop` onto `origin/develop` to pick up **`dfaba8e6`** (Roy's typo fix — the only
   commit we were missing; it touches only the vacance-locative `.md`, no conflict). Local `develop`
   is now **1 ahead / 0 behind** origin. **Nothing pushed yet.**
3. Created the **3 editor tables** on **staging D1** `pujol-annonces` (remote, additive
   `IF NOT EXISTS`; SQL = the verbatim `SCHEMA` consts from `blog-db.ts` / `experts-db.ts` /
   `newsletter-db.ts`). Verified `annonces` unchanged at **5353**; the 3 tables exist and are empty.

### BLOCKER
`git push` fails **403** — the stored credential (`~/.git-credentials`, user `royboy31`) is
**read-only**. Need a **push-capable token** (fine-grained, `royboy31/immobiliere-pujol-site`,
Contents: read+write) **or** the user runs the two pushes themselves. Until then the deploy can't be
made durable (the hourly `pujol-cron-sync` redeploys `main` and would revert an un-pushed deploy).

### Resume checklist (once the token is set)
Run from `/home/kamindu/pujol/site`; staging account env: `export
CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a`.
1. **Deploy main app ONLY** (NOT the email worker): `npm run build && npx wrangler deploy`, then
   restore artifacts: `git checkout HEAD -- src/content/annonces src/data public/_data`. Abort if
   the build fails (site stays unbroken).
2. **Push:** `git push origin develop && git push origin develop:main` (keep `main==develop`).
3. **Import 27 experts** into staging D1 — cleanest via the deployed staging API
   (`POST https://immobiliere-pujol-staging.roy-68a.workers.dev/api/admin-pujol/experts/`, one call
   per JSON in `src/content/experts/*.json`, mapping camelCase→the API's snake_case input keys:
   `emailAliases→email_aliases`, `order→sort_order`, `listingOnly→listing_only`, `seoTitle→
   seo_title`, etc.). Requires an admin session cookie (login `roy@perelweb.studio` + the real
   staging password — the `ADMIN_PASSWORD_HASH` in `wrangler.jsonc`, NOT the local `local`).
4. **Secrets:** `npx wrangler secret put ADMIN_PASSWORD_HASH` + `ADMIN_SESSION_SECRET` on
   `immobiliere-pujol-staging` (same values currently in `wrangler.jsonc` so sessions/login don't
   break), then remove those two from `wrangler.jsonc` `vars`. Leave Brevo unset (send→501). **Never
   set `SEED_DEMO` on staging.** (Do this with/just before the deploy so code + secrets stay consistent.)
5. **Verify on staging:** login → blog/experts/newsletter write roundtrip vs remote D1/R2 → confirm
   rows land + `/media/…/` serves → confirm **no regression** on the annonces site + the two sample
   pages → newsletter send returns **501**.

**Open decision:** experts-only (create new blog posts on staging) **vs** also writing
`scripts/import-articles-to-d1.mjs` to import the **891** existing articles so posts like
vacance-locative are editable on staging too.

**Guardrails reaffirmed:** never touch `pujol-main` (production) without Roy's explicit per-change
approval; never deploy the email worker as part of this; keep every change surgical.
