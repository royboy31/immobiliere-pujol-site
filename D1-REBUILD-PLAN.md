# Plan — Publish blog/expert edits from D1 to the live site

**Goal:** when an admin creates / updates / deletes a **blog article** or **expert** in the D1
admin editor, clicking **"Publier"** rebuilds the site so the change appears on the public
frontend — **safely** (nothing overwritten) and **cleanly** (only affected pages actually change),
**without** disturbing the annonces (ubiflow / lbi / content-JSON) pipeline.

## Locked decisions (from the design discussion)

1. **Data path = D1 → file sync (clone of the annonces pattern).** Two build scripts write
   `.md`/`.json` from D1 before `astro build`. Consumer pages + content config stay unchanged.
   *(Chosen over custom Content-Layer loaders for lowest risk / max consistency with the existing,
   proven `sync-d1-to-content.mjs`.)*
2. **Trigger = a manual "Publier" button.** Edit freely in D1 → click once → one deploy. No
   per-save auto-deploy, no debounce.
3. **Rebuild model = full rebuild, only affected pages change.** `astro build` re-renders every
   static page (as the site already does hourly), but idempotent output + Cloudflare asset
   hash-dedupe mean unaffected pages are byte-identical and are **not** re-uploaded or disturbed.
   True per-page incremental rebuild is **not possible** on static Astro/Cloudflare (see §6).
4. **Publish gating = a published snapshot.** Builds read only an explicitly-published snapshot, so
   the hourly annonces rebuild can never push half-finished blog/expert edits live (see §4).
5. **Overwrite protection is a hard requirement** — see §5.

> Full background on how blog/experts are imported, created, and rendered **today** is in
> `CONTENT-DATA-FLOW.md`. Read that first for context.

## Progress (2026-07-14, session 3) — steps 1–3 DONE, local-verified

- ✅ **Step 1 — parity gate + slug fix + clean re-import.** `scripts/parity-check-d1-content.mjs`
  caught the original import mangling 619 slugs. Added `normalizeSlug()` to `blog-db.ts` (preserves
  `local/…`, `m²`, `__`, full length). `scripts/reimport-articles-to-d1.mjs` wiped + re-imported all
  1017 articles exactly. Parity now **0 missing / 0 drift** (experts clean bar one legit newer D1 edit).
- ✅ **Step 2 — published snapshot.** Added `published_json` (+ `published_at` on experts) to both
  tables + `publishArticles`/`publishExperts` + `countPending*` helpers (SQLite `json_object`, server
  side). `scripts/backfill-published-snapshot.mjs` froze the live baseline: 1017 + 27 snapshotted, 0
  pending.
- ✅ **Step 3 — sync scripts + build wiring + LOCAL VERIFY.** `scripts/sync-d1-{articles,experts}-to-
  content.mjs` read `published_json` → write `.md`/`.json` (abort build on D1 error / 0 rows). Wired
  into the `package.json` build chain; `src/content/articles`+`experts` added to the CLAUDE.md restore
  rule. Verified via `astro dev`: `local/…` and `m²` slug articles render at their exact URLs, blog
  index + experts index (18 tiles/6 depts) + expert single all 200. Generated files diff vs committed
  = **YAML-quoting only, identical values/bodies.** Artifacts restored (`git checkout HEAD --`).
  - Note: `experts/[slug]` (SSR) needs **no change** — it reads the now-D1-derived bundled JSON file,
    consistent with the static pages. (The per-request-D1 swap was an Approach-2 idea, not needed here.)
- ✅ **Step 4 — publish button + endpoints.** `src/lib/deploy.ts` (triggerDeploy/latestDeployRun/
  deployConfigured, mirrors cron-sync); `POST /api/admin-pujol/publish/` snapshots (publishArticles/
  Experts) then fires `deploy.yml`; `GET` returns pending counts; `…/publish/status/` polls the run;
  `🚀 Publier` bar + pending banner + live status on the admin dashboard. Verified on `astro dev`:
  guard 401, pending count, POST snapshots → pending 0, graceful 202 when no token. Degrades cleanly
  until secrets set.
  - **Leftover (needs deploy):** set `GITHUB_TOKEN` (reuse cron-sync token) + `GITHUB_REPO=royboy31/
    immobiliere-pujol-site` as main-app secrets — only then does "Publier" actually fire the build.
- ✅ **Step 5 — blog SEO/OG render gap closed.** `content.config.ts` articles schema += canonicalUrl/
  focusKeyword/noindex/nofollow/ogTitle/ogDescription/ogImage/twitterCard. `BaseLayout.astro` gained
  those props (independent nofollow via `robotsContent`; og/twitter overrides). `[...slug].astro`
  passes them for articles; `sync-d1-articles-to-content.mjs` writes them to frontmatter (from
  `published_json`). Verified on `astro dev`: `twitter:card` now emits from D1; injected overrides
  (canonical/og:title/og:description/twitter:card) all render correctly. Note: articles now default
  to `twitter:card=summary_large_image` (was "summary").
- ⏭️ **NEXT — all code done; remaining is DEPLOY-GATED (needs explicit OK):** set main-app secrets
  `GITHUB_TOKEN` + `GITHUB_REPO`; commit on `develop`; `npm run build` (restore artifacts!) →
  `npx wrangler deploy` (main app only) → push `develop`+`develop:main`; verify edit→Publier→live on
  staging. Production only with Roy's per-change OK. **Nothing deployed yet.**

**How to test steps 1–3 locally** (reads staging D1 read-only for content; needs
`export CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a`):
```bash
node scripts/parity-check-d1-content.mjs --remote          # 1. verify D1 == committed (exit 0)
node scripts/sync-d1-articles-to-content.mjs --remote      # 2. regenerate .md from D1
node scripts/sync-d1-experts-to-content.mjs --remote       #    …and .json
npx astro dev --port 4399                                  # 3. serve; curl /experts/, a blog URL, etc.
git checkout HEAD -- src/content/articles src/content/experts   # 4. ALWAYS restore the artifacts
```

---

## 1. Why a publish = a full rebuild (platform reality)

Every public page is **statically prerendered** into one Cloudflare Worker. Astro/Cloudflare has
**no incremental static regeneration** — you cannot rebuild "just the expert archive + that one
single page" and ship only those. A publish = one `npm run build` → `astro build` (all static pages)
→ `wrangler deploy`.

This is already the site's **normal** mode: the `cron-sync` worker fires a full `deploy.yml`
whenever the Ubiflow feed changes (~hourly). A blog/expert publish is just one more of the same.

---

## 2. The data path (D1 → files → build → deploy)

```
D1 tables (published snapshot)
  ├─ scripts/sync-d1-articles-to-content.mjs  → src/content/articles/*.md
  └─ scripts/sync-d1-experts-to-content.mjs   → src/content/experts/*.json
        ↓  (added to the "build" chain in package.json, BEFORE astro build)
  astro build   ← glob loaders + getCollection UNCHANGED; prerenders into ./dist
        ↓
  wrangler deploy   ← uploads ./dist (Cloudflare uploads only hash-changed assets)
```

- The two new scripts **mirror `scripts/sync-d1-to-content.mjs`** (the annonces D1→JSON sync that
  already runs in the build). They query D1 the same way (`wrangler d1 execute --remote --json`,
  **batched** to dodge the partial-read/buffer gotcha on large `body_html`).
- **`annonces` collection is untouched** — its own `glob()` loader + `sync-d1-to-content.mjs` keep
  running exactly as today. Blog/expert sync is a separate, isolated code path over separate D1
  tables. A blog publish never pulls the ubiflow feed or the lbi zip (those live in the cron-sync
  worker + `sync-lbi-ftp` workflow, **not** in `npm run build`).
- **Consumer pages need no changes** — they still call `getCollection('articles'|'experts')`; the
  files under them are just now generated from D1 instead of hand-committed.

### Field mapping (see `CONTENT-DATA-FLOW.md` §3 for the full tables)
- Articles: D1 `blog_articles` (snake_case) → `.md` frontmatter (camelCase) + HTML body.
- Experts: D1 `experts` (snake_case) → `.json` (camelCase), incl. `sort_order`→`order`,
  `email_aliases`→`emailAliases`, `listing_only`→`listingOnly`.

---

## 3. What refreshes, and when

- **On "Publier" (full build → deploy):** every blog/expert page regenerates from the freshly-synced
  files — `experts/index`, blog article pages (`[...slug]`), `blog-immobilier-marseille`,
  `categorie/*`, `tag/*`, `local/index`, `services/[slug]`, plus sitemaps/feed.
- **Only affected pages actually change:** idempotent sync → unchanged rows produce byte-identical
  files → byte-identical HTML → Cloudflare skips re-uploading them. The edited article/expert + the
  list pages that reference it are the only things that move.
- **On an unrelated hourly annonces rebuild:** blog/expert pages re-render the **same published
  snapshot** → no change, no draft leak (see §4).

---

## 4. Publish gating — the **published snapshot** (prevents premature publish)

**Problem:** the hourly annonces rebuild also runs the blog/expert sync. If the sync read the *live*
rows, that rebuild would publish whatever state they're in — including half-finished edits — with no
"Publier" click. (Note: the hourly sync only ever *writes* the `annonces` table; it never overwrites
blog/expert rows. The risk is **premature publication**, not data loss.)

**Fix:** separate **"saved in D1"** (working draft) from **"published"** (a frozen snapshot). Any
build may only ever render the last snapshot the admin explicitly published.

- **Add columns** `published_json` (TEXT, nullable) + `published_at` to `blog_articles` and
  `experts` (additive `ALTER`, via each lib's `ensureSchema`).
- **Editor save** → writes the working columns as today. Not visible to the site.
- **"Publier"** → (a) snapshots each pending row's state into `published_json` + stamps
  `published_at`, then (b) fires the deploy.
- **The sync scripts read `published_json` only.** A row with `published_json = NULL` = never
  published = no file emitted = not on the site.
- **Deletes/unpublish are gated too:** deleting in the admin stages the removal; "Publier" commits it
  (the sync stops emitting that file). Until published, the live page stays.
- **Experts gain a real publish gate for the first time** (they only had `hidden`/`listingOnly`).

Result: the hourly annonces rebuild re-renders the **same** snapshot → **idempotent**, no leak, no
revert. Working edits stay invisible until *you* click Publier.

**Publish scope (open UX choice):** one "Publier toutes les modifications" button that promotes all
pending rows (recommended, with an "N modifications non publiées" banner) vs per-item publish.

---

## 5. ⭐ Overwrite protection (hard requirement)

Data moves in three directions; each has a guarantee.

### A. Your D1 data (admin edits) — nothing can overwrite it
Only the **admin API** ever writes `blog_articles`/`experts`:
| Vector | Reality |
|---|---|
| Hourly `cron-sync` | writes **only** `annonces` — never blog/experts |
| lbi zip (`sync-lbi-ftp`) | writes **only** annonces |
| The file sync (this pipeline) | **one-directional: D1 → files only.** Files are never read back into D1 |
| A rebuild / deploy | **reads** D1; never writes it |
| Editor update | *partial* update (`input ?? existing`) — editing A never blanks A's other fields or touches B |

→ **D1 is written by exactly one thing: the admin editor.** (Only caveat: two admins editing the
*same* item = last-save-wins; add an optimistic `updated_at` check later if desired.)

### B. The existing live content (committed `.md`/`.json`) — the sync can't clobber/lose it
1. **Parity gate before cutover (mandatory first step).** Dry-run: generate files from D1, `diff`
   against the committed files, confirm **every committed slug exists in D1 with no content loss**
   (D1 already has 1017 articles ⊇ 891, 27 = 27 — but we *prove* it, not assume). Flip the switch
   only when the diff is clean.
2. **Build artifacts are never committed.** Add `src/content/articles` + `src/content/experts` to the
   `git checkout HEAD -- …` restore rule (CLAUDE.md / WORKFLOW.md / the build loop). CI builds from a
   fresh checkout and discards the generated files → the **git source stays frozen and immutable**;
   a build can never permanently overwrite it. (Same safeguard annonces already uses.)
3. **Fail loud on D1 error.** If D1 is unreachable at build, the sync **aborts the build** — it must
   never silently fall back to stale files (that would look like edits "reverted").

### C. The published state — a build can't revert it or leak drafts
The published-snapshot model (§4): builds read only `published_json` → idempotent → hourly rebuilds
re-render the same state → no revert, no premature publish.

### The design decision behind all of it
After cutover, **D1 is the single source of truth** for blog/experts, and the committed files become
**disposable build artifacts** (exactly like annonces today): one authoritative store (D1, written
only by the admin) + one throwaway derived layer (files, regenerated each build, never committed,
never read back).

*(Optional extra-conservative variant: write to a separate filename namespace — `<slug>_d1sync.md`
— so committed originals are physically never touched, à la annonces' `_d1sync.json`. Given D1 is a
verified superset, a clean cutover is simpler and recommended.)*

---

## 6. Why not true per-page incremental rebuild
`astro build` re-renders all static pages; `wrangler deploy` replaces the whole worker. There is no
partial static build on this stack. The only architecture that gives literal per-page updates is
**SSR-from-D1** (pages render on demand) — considered and **not chosen**, because it drops the
file-sync model, runs hot SEO routes per-request against D1, and re-opens the Cloudflare **1102**
resource limit that `experts/[slug]` was written around. We accept the full rebuild and rely on
idempotency + hash-dedupe (§3) so only affected pages change.

---

## 7. Work items

1. **Schema migration** — add `published_json` + `published_at` to `blog_articles` and `experts`
   (additive `ALTER` in each lib's `ensureSchema`).
2. **`scripts/sync-d1-articles-to-content.mjs`** — read `blog_articles` rows whose `published_json`
   is set (and `status='published'`), batched; write `src/content/articles/<slug>.md`
   (frontmatter + HTML body). Clean stale D1-managed files so unpublish/delete removes the page.
   **Abort (non-zero exit) on any D1 error.**
3. **`scripts/sync-d1-experts-to-content.mjs`** — same over `experts` (published snapshot),
   snake→camel map; write `src/content/experts/<slug>.json`.
4. Add both scripts to the **`"build"`** chain in `package.json`, **before `astro build`**, next to
   `sync-d1-to-content.mjs`.
5. **Parity dry-run harness** (validation only, no cutover) — generate-from-D1 vs committed `diff`;
   report any missing slug / content drift. Must be clean before step 4 goes live.
6. **Publish endpoint** — `POST /api/admin-pujol/publish/` (guarded): snapshot all pending rows into
   `published_json`/`published_at`, commit staged deletes, **then** fire `deploy.yml`
   `workflow_dispatch` (`ref: main`) via the `triggerRedeploy()` pattern in `workers/cron-sync`.
7. **Publish status + UI** — `GET /api/admin-pujol/publish/status/` (reads the latest `deploy.yml`
   Actions run) + a `🚀 Publier les modifications` button + "N modifications non publiées" banner +
   live status line on the admin dashboard (`admin-pujol/index.astro`).
8. **Secrets on the main app** — `GITHUB_TOKEN` (reuse the cron-sync token value; needs
   `actions: write`) + `GITHUB_REPO=royboy31/immobiliere-pujol-site`.
9. **Blog SEO/render gap** — extend the `articles` schema in `content.config.ts` + the `<head>` in
   `[...slug].astro` to emit the fields the editor already stores but the site ignores today:
   `canonical_url`, `og_*`, `noindex`, `nofollow`, `twitter_card`, `article_date`. (The sync must
   write these into the `.md` frontmatter for them to take effect.)
10. **Build-artifact rule** — add `src/content/articles` + `src/content/experts` to the
    `git checkout HEAD -- …` restore rule (CLAUDE.md / WORKFLOW.md / the loop).

---

## 8. Guardrails (unchanged project rules)

- Build + verify **locally first** (sync against local Miniflare D1; run the parity dry-run; confirm
  the list/single pages render identically to today).
- **Staging only** by default; production (`pujol-main`) needs Roy's explicit per-change approval.
- Nothing hits staging / a deploy without the user's explicit go-ahead.
- Keep `main == develop` after any push (`git push origin develop && git push origin develop:main`).

---

## 9. Suggested order of implementation

1. Schema migration (§7.1) + the two sync scripts reading the **live** rows first, run **only** as
   the **parity dry-run** (§7.5) — prove D1 ⊇ committed with no loss. **No build wiring yet.**
2. Add `published_json` snapshot + point the sync at it (§4).
3. Wire the scripts into the build chain + the restore rule (§7.4, §7.10); build locally; verify
   pages render from D1.
4. Publish endpoint + button + secrets (§7.6–7.8).
5. Blog SEO/render gap (§7.9).
6. Deploy to **staging only**, with explicit go-ahead; verify edit → Publier → live. Production later,
   Roy-approved.

---

## 10. History of this plan
- **Dropped:** custom Content-Layer loaders (Approach 2) — user chose the file-sync clone of annonces.
- **Retained:** manual publish button; published-snapshot gating.
- **Added:** the overwrite-protection guarantees (§5) and the mandatory parity dry-run; the
  full-rebuild-but-only-affected-pages-change model (§3, §6).
