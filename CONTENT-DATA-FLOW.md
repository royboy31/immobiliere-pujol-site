# Content data flow — Blog posts & Experts (current state)

How blog articles and expert profiles are **imported**, **created/edited**, and **shown on the
public site** as the system works **today**. This is a description of the *current* implementation,
not the planned D1-rebuild changes (those are in `D1-REBUILD-PLAN.md`).

---

## 0. The big picture — D1 is authoritative, the files are build artifacts

**Updated 2026-08-20. The gap described below as "two disconnected worlds" is closed.** Blog,
experts and legal pages now have the same D1 → files bridge that annonces have always had.

| | **Files under `src/content/`** | **D1 database** |
|---|---|---|
| Blog | `src/content/articles/*.md` | table `blog_articles` |
| Experts | `src/content/experts/*.json` | table `experts` |
| Pages | `src/content/pages/*.md` | table `site_pages` |
| Annonces | `src/content/annonces/*.json` | table `annonces` |
| Written by | a **build-time sync script**, from D1 | the **admin editors** |
| Read by | **the public site** (Astro content collections) | the admin UI, and the sync scripts |

- **The admin editors read/write D1.** D1 is the source of truth for all four collections.
- **`npm run build` regenerates the files from D1** before `astro build` runs, in this order:
  `sync-d1-to-content.mjs` (annonces), `sync-d1-articles-to-content.mjs`,
  `sync-d1-experts-to-content.mjs`, `sync-d1-pages-to-content.mjs`.
- Every sync reads the **`published_json` column only**, never the live working row, so a rebuild
  (including the hourly annonces rebuild) can never publish an in-progress edit.
- ⚠️ **The files under `src/content/` are build artifacts. Editing one in git changes nothing:**
  the next build overwrites it from D1. To change published content, write to D1 (admin editor, or
  a `wrangler d1 execute` on both `fonction`-style columns **and** `published_json`). Restore a
  dirty working copy with `git checkout HEAD -- src/content/<collection>`.
- The articles and experts syncs also **delete** any file with no published row behind it. The pages
  sync never deletes, because most of `src/content/pages` is not backed by D1.

> Consequence for the site's own repo history: commits that edit `src/content/articles/*.md` or
> `src/content/experts/*.json` are cosmetic. They keep git readable but have no effect on the
> deployed site.

---

## 1. BLOG POSTS

### 1a. How they were / are IMPORTED

**Original catalogue (Store A — the live source today):**
- ~891 articles were **scraped from the old WordPress site** into `src/content/articles/*.md`.
- Each file = YAML frontmatter + a **raw-HTML body** (the scraped WP markup, not Markdown prose).
- Frontmatter fields (validated by `src/content.config.ts` → `articles` schema):
  `title, slug, date, excerpt, categories[], tags[], featuredImage, author, seoTitle,
  seoDescription, expertCta, expertCtaTitle`.
- These files are **committed to git** and are the current source of truth for the public site.

**Import into D1 (Store B — done for staging, 2026-07-12):**
- A one-off importer (scratchpad `import-to-staging.cjs`) logged in as an admin and **POSTed each
  local `.md` to the guarded admin API** (`POST /api/admin-pujol/articles/`), mapping the frontmatter
  → the API's snake_case input (see §3). Result: **1017 rows** in staging `blog_articles`.
- Gotcha found: `slugify()` truncates to **96 chars**, so a few long `local/…` slugs collided; the
  race under concurrency dropped 4 rows → reconciled and re-POSTed sequentially.
- Verify counts with `wrangler d1 execute … "SELECT COUNT(*) FROM blog_articles"` (the list **API GET
  is unreliable** for bulk reads — a huge `SELECT *` with `body_html` returns partial data).

**Local demo seed (dev only):**
- `blog-db.ts` → `ensureSchema()` seeds **3 demo articles** into an empty **local** DB **only when
  `SEED_DEMO=1`** (`.dev.vars`). Never runs against staging/prod.

### 1b. How they are CREATED / EDITED (admin → D1)

```
Admin UI (browser)                 API route (guarded)              D1 layer
──────────────────                 ───────────────────              ────────
ArticleEditor.astro   ──JSON──▶    /api/admin-pujol/articles/  ──▶  src/lib/blog-db.ts
 (WYSIWYG + SEO/OG)      fetch       index.ts   (POST create)         createArticle()   ──▶ blog_articles
 admin-pujol/articles/[id]/edit     [id].ts    (GET/PUT/DELETE)       updateArticle()/deleteArticle()
```

- **Pages:** `src/pages/admin-pujol/articles/{index,new,[id]/edit,[id]/preview}.astro`.
- **Editor component:** `src/components/admin/ArticleEditor.astro` — title, WYSIWYG body (toolbar
  H2/H3/¶/B/I/list/quote/link + 🖼️ image upload, with a `</> Source HTML` toggle), sidebar
  (status draft/published, article date, slug auto-gen+freeze, featured image + upload, excerpt,
  categories, tags, author, expert-CTA picker), and a tabbed **SEO/Social** panel (meta title/desc
  with counters, canonical, focus keyword, robots noindex/nofollow, Open Graph, Twitter card, live
  Google-SERP + social-card previews).
- **API routes** (`prerender = false`, guarded by `requireAdmin`):
  - `POST /api/admin-pujol/articles/` → `createArticle()` → **201** with the created row.
  - `GET/PUT/DELETE /api/admin-pujol/articles/[id]/`.
  - `POST /api/admin-pujol/articles/upload-image/` → stores in R2 `PHOTOS` under
    `blog/<year>/<ts>-<slug>.<ext>`, returns `{ url: "/media/<key>/" }` (served by
    `src/pages/media/[...path].ts`).
- **D1 layer (`src/lib/blog-db.ts`):**
  - Table **`blog_articles`** (columns: see §3). `getDB()` reads the `DB` binding (works in
    `astro dev` too). `ensureSchema()` is idempotent: `CREATE TABLE IF NOT EXISTS` + additive
    `ALTER` migration for newer columns.
  - `createArticle()` — generates a **unique slug** (`slugify` → 96-char cap → `-2/-3…` on
    collision), sets `status` (default `draft`), stamps `published_at` when published, serialises
    `categories`/`tags` to JSON columns.
  - `updateArticle()` — **slug frozen** after creation unless explicitly changed (preserves indexed
    URLs); partial update (unspecified fields keep their existing value).
  - `deleteArticle()` — hard delete by id.

### 1c. How they are SHOWN on the public site (build → serve)

**All from Store A files, at build time:**
1. `src/content.config.ts` declares `articles` with a **`glob()` loader** over
   `src/content/articles/**/*.md`. At build, Astro loads + schema-validates every file into the
   content store.
2. Pages read them via **`getCollection('articles')`** and are **statically prerendered**:
   - **`src/pages/[...slug].astro`** (`prerender = true`) — the article page. `getStaticPaths()`
     enumerates all articles (root-level URLs), renders `entry.body` (raw HTML) via `set:html` with
     post-processing: strips legacy WP share blocks, wraps image+caption pairs, balances stray
     `</div>`s. Emits `<head>` SEO from `seoTitle`/`seoDescription`/`featuredImage` only (the newer
     OG/robots fields are **not** rendered yet). Appends an optional `ExpertContactCard` when
     frontmatter has `expertCta`.
   - **List/archive pages** (all static, all `getCollection('articles')`):
     `blog-immobilier-marseille.astro` (blog index), `categorie/[...slug]` + `categorie/index`,
     `tag/[slug]` + `tag/index`, `local/index`, and `services/[slug]` (related-articles block).
3. `npm run build` → these prerender into `./dist/`; `wrangler deploy` serves them as **static
   assets** (binding `ASSETS`) — **no D1, no code at request time.**

---

## 2. EXPERTS

### 2a. How they were / are IMPORTED

**Original profiles (hand-authored, now superseded by D1):**
- `src/content/experts/*.json`, one object per expert (the real 27 profiles). Originally
  hand-authored and committed; **since the D1 bridge landed these files are regenerated at every
  build** by `scripts/sync-d1-experts-to-content.mjs` from `experts.published_json`.
- Fields (validated by `src/content.config.ts` → `experts` schema):
  `title ("Prénom Nom – Rôle"), slug, fonction, description (HTML bio), photo, phone, email,
  emailAliases[], linkedin, facebook, instagram, seoTitle, seoDescription, hidden, listingOnly,
  department, order, agenda, secteur`.
- ⚠️ **The source of truth for `/experts/` is the `experts` table in D1, not these files.** The sync
  aborts the build (exit 1) on a D1 error or a 0-row result, and removes any JSON with no published
  row behind it. Note the two D1 databases are distinct: staging lives in Roy's account, production
  in the Pujol account (`pujol-annonces-eu`), so a content change has to be applied to both.

**Import into D1 (Store B — done for staging, 2026-07-12):**
- Same importer approach as blog: `POST /api/admin-pujol/experts/` for each JSON, mapping camelCase
  → snake_case (see §3). Result: **27 rows** in staging `experts`.

**Local demo seed (dev only):**
- `experts-db.ts` → `ensureSchema()` → `seedFromContent()` reads the **real 27 JSON files** (eager
  `import.meta.glob`) and inserts them into an empty **local** DB **only when `SEED_DEMO=1`**. So the
  local editor opens with production data; never runs against staging/prod.

### 2b. How they are CREATED / EDITED (admin → D1)

```
ExpertEditor.astro    ──JSON──▶   /api/admin-pujol/experts/   ──▶   src/lib/experts-db.ts
 (bio WYSIWYG + SEO)     fetch      index.ts  (POST create)          createExpert()  ──▶ experts
 admin-pujol/experts/[id]/edit     [id].ts   (GET/PUT/DELETE)        updateExpert()/deleteExpert()
```

- **Pages:** `src/pages/admin-pujol/experts/{index,new,[id]/edit}.astro` (index reads D1).
- **Editor component:** `src/components/admin/ExpertEditor.astro` — bio WYSIWYG (H3/H4/¶/B/I/list/
  quote/link/image + `</>` source, plus **« Chapô »** / **★ Spécialité** buttons applying the public
  `expert-bio-quote`/`expert-bio-spec` classes), sidebar (department, order, secteur, slug), photo
  (url + upload → R2 `experts/…`), coordonnées (phone, email, email aliases), réseaux & agenda
  (linkedin/facebook/instagram/agenda), visibilité (`hidden`, `listing_only`), and SEO (meta
  title/desc + counters + SERP preview).
- **API routes** (`prerender = false`, guarded): `POST /api/admin-pujol/experts/` → `createExpert()`
  → 201; `GET/PUT/DELETE …/[id]/`; `POST …/upload-image/` → R2.
- **D1 layer (`src/lib/experts-db.ts`):**
  - Table **`experts`** (columns: see §3). Column is **`sort_order`** (not `order` — reserved word).
    `email_aliases` stored as a JSON column. **No draft/publish lifecycle** — visibility is governed
    by `hidden` + `listing_only`.
  - `createExpert()` — slug derived from the **name half** of the title (`"Prénom Nom – Rôle"` → name)
    then `slugify` (96-cap, `-N` on collision).
  - `updateExpert()` — slug frozen unless explicitly changed; partial update.
  - `deleteExpert()` — hard delete by id.

### 2c. How they are SHOWN on the public site

Experts use **two different read mechanisms** (unlike blog):

1. **`src/pages/experts/index.astro`** (the archive) — **static**, `getCollection('experts')` (fed by
   the `glob()` loader over `src/content/experts/*.json`, themselves regenerated from D1 by the
   build, see §0). Filters out `hidden`/`listingOnly`, groups
   by `department` (Direction → Vente → Gestion locative → Syndic → others), sorts by `order`,
   prerenders the grid.

2. **`src/pages/experts/[slug].astro`** (single profile) — **SSR** (`prerender = false`). It does
   **not** use `getCollection`; it reads the expert JSON **per request** via a **lazy
   `import.meta.glob`** that loads only the one file matching the slug. (Eager-globbing all bios into
   the SSR worker tripped Cloudflare **1102** resource limits — hence lazy.) It stays SSR because it
   also renders the expert's **live** listings via `fetchUbiflowAnnonces`.

Experts also appear via:
- ⚠️ **`src/pages/index.astro` — the homepage carousel holds its own hard-coded expert array**
  (`href`, `photo`, `type`, `first`, `last`, `role`), independent of D1 and of the content
  collection. A profile renamed in D1 keeps its old title here until this array is edited too. Any
  change to an expert's `fonction` therefore needs **two** edits: the D1 row (both `fonction` and
  `published_json`, on staging and production) **and** this file.
- `ExpertContactCard` — appended to a blog article when its frontmatter sets `expertCta` (read in
  `[...slug].astro` from a build-time expert glob).
- `lib/experts.ts` — maps a listing's `contactAAfficher` email (incl. `emailAliases`) to an expert,
  used by annonce components (`AnnonceLive`/`AnnonceClosed`).

---

## 3. FIELD MAPPING (the three representations)

The **same field** has three names: the **committed file** (camelCase), the **D1 column**
(snake_case), and the **API input** (snake_case, matches D1). The importer translates file → API.

### Blog article
| Content `.md` frontmatter | D1 `blog_articles` column | Notes |
|---|---|---|
| `title` | `title` | |
| `slug` | `slug` | UNIQUE; `slugify` 96-char cap |
| `excerpt` | `excerpt` | |
| *(HTML body of the file)* | `body_html` | raw HTML |
| `featuredImage` | `featured_image` | og:image today |
| `categories[]` | `categories` | JSON string column |
| `tags[]` | `tags` | JSON string column |
| `author` | `author` | |
| `date` | `article_date` | `YYYY-MM-DD` |
| `seoTitle` | `seo_title` | |
| `seoDescription` | `seo_description` | |
| — | `canonical_url` | editor-only, not rendered yet |
| — | `focus_keyword` | editor-only |
| — | `noindex` / `nofollow` | INTEGER 0/1, not rendered yet |
| — | `og_title`/`og_description`/`og_image`/`twitter_card` | editor-only, not rendered yet |
| `expertCta` / `expertCtaTitle` | `expert_cta` / `expert_cta_title` | |
| — | `status` | `draft` \| `published` |
| — | `created_by`, `created_at`, `updated_at`, `published_at` | lifecycle |

### Expert
| Content `.json` key | D1 `experts` column | Notes |
|---|---|---|
| `title` | `title` | "Prénom Nom – Rôle" |
| `slug` | `slug` | UNIQUE |
| `fonction` | `fonction` | |
| `description` | `description` | HTML bio |
| `photo` | `photo` | |
| `phone` | `phone` | |
| `email` | `email` | |
| `emailAliases[]` | `email_aliases` | JSON string column |
| `linkedin`/`facebook`/`instagram` | same | |
| `seoTitle` / `seoDescription` | `seo_title` / `seo_description` | |
| `department` | `department` | Direction/Vente/Gestion locative/Syndic/Contentieux/… |
| `order` | `sort_order` | ⚠️ renamed (`order` is reserved) |
| `agenda` | `agenda` | Google Calendar URL |
| `secteur` | `secteur` | covered zone |
| `hidden` | `hidden` | INTEGER 0/1 |
| `listingOnly` | `listing_only` | INTEGER 0/1 |
| — | `created_by`, `created_at`, `updated_at` | lifecycle |

---

## 4. Where the code lives (quick index)

| Concern | Blog | Experts |
|---|---|---|
| Committed files | `src/content/articles/*.md` | `src/content/experts/*.json` |
| Collection schema | `src/content.config.ts` → `articles` | `src/content.config.ts` → `experts` |
| D1 layer + CRUD | `src/lib/blog-db.ts` | `src/lib/experts-db.ts` |
| Admin API | `src/pages/api/admin-pujol/articles/*` | `src/pages/api/admin-pujol/experts/*` |
| Admin pages | `src/pages/admin-pujol/articles/*` | `src/pages/admin-pujol/experts/*` |
| Editor component | `src/components/admin/ArticleEditor.astro` | `src/components/admin/ExpertEditor.astro` |
| Public single | `src/pages/[...slug].astro` (static) | `src/pages/experts/[slug].astro` (SSR) |
| Public list(s) | `blog-immobilier-marseille`, `categorie/*`, `tag/*`, `local/index`, `services/[slug]` | `src/pages/experts/index.astro` |
| Auth guard | `src/lib/admin-guard.ts` (`requireAdmin`) | same |

---

## 5. The one-line summary

- **Imported:** blog from a WP scrape → `.md` files (and separately POSTed into D1 for staging);
  experts hand-authored → `.json` files (and POSTed into D1). D1 also self-seeds locally when
  `SEED_DEMO=1`.
- **Created/edited:** admin UI → guarded `/api/admin-pujol/{articles,experts}/` → `blog-db.ts` /
  `experts-db.ts` → **D1 tables**.
- **Shown:** public site reads the **committed files** (glob → `getCollection`, plus a lazy glob for
  `experts/[slug]`) at **build time** and serves prerendered HTML — it **does not read D1**. That is
  the gap the D1-rebuild plan closes.
