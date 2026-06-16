# Meta-mirror playbook (replicate staging → production)

**Purpose.** Phase 1 must make every page's `<title>` and `<meta name="description">`
**byte-identical to the live WordPress site** (immobiliere-pujol.fr). No rewriting,
no SEO optimization. Optimization is Phase 2.

**Why this doc exists.** A record of the meta-mirror work so it's reproducible and
verifiable. NOTE (corrected 16 Jun): staging (Roy acct) and production (Pujol acct)
deploy from the SAME repo `github.com/royboy31/immobiliere-pujol-site` — staging from
`main`/`develop` via `deploy.yml`, production from `pujol-main` via `deploy-pujol.yml`
(which auto-patches Roy→Pujol values at CI). See `Kamindu_infrastructure.md`. So
"replicating to prod" is NOT a file copy — it's `merge main → pujol-main → push`.

> The meta-mirror files here are account-agnostic (live WP data + generic lookup code,
> no `roy-68a`/R2/account-id refs), so they need NO new patch step in deploy-pujol.yml.

---

## The problem (diagnosed 15 Jun 2026)

Astro templates *generate* meta instead of emitting the live Yoast values. Verified
mismatches (live WP → current staging):

| Page type | Live WordPress (truth) | Current staging | Cause |
|---|---|---|---|
| Home | `Immobilière Pujol – Le site de l'agence immobilière Pujol` | `Immobilière Pujol – L'agence immobilière la plus recommandée par ses clients` | hardcoded title in `src/pages/index.astro` |
| Article/page | `… environs – Immobilière Pujol` | `… environs` (suffix lost) | `src/pages/[...slug].astro:140` splits seoTitle on `\|`, WP separator is ` – ` |
| Annonce (sale) | `Appartement T2 à vendre, 13004, Marseille` | `Appartement T2 à vendre à Marseille – Immobilière Pujol` | template builds own pattern at `src/pages/annonces/[slug].astro:352` |
| Description | full descriptif, HTML-stripped | `.substring(0,160)` of raw HTML, `<br>` leaks | `src/pages/annonces/[slug].astro:353` |

The stored `seoTitle`/`seoDescription` in scraped content are unreliable (often body
text, sometimes swapped) — do not trust them; re-scrape from live WP.

**Hard constraint:** `src/content/annonces/**` is regenerated from D1 on every build
(`scripts/sync-d1-to-content.mjs`). Annonce meta written into those JSONs is wiped on
the next build. Meta must live in a central sidecar map (or D1), not per-file.

**Deadline:** live WP (OVH) shuts 28-29 Jun. The scrape (step 1) must run before then.

---

## The plan

1. **Scrape live WP** → `migration/seo-meta.csv`. Python script reads
   `https://www.immobiliere-pujol.fr/sitemap_index.xml`, follows child sitemaps to the
   full URL list (~6,200), fetches each page, extracts the exact `<title>` and
   `<meta name="description">` (HTML entities decoded to text). Resumable, rate-limited.
   Columns: `url,path,type,title,description`.
2. **Compile** → `src/seo-data/seo-meta.json`, keyed by URL pathname → `{t, d}`.
3. **Emit verbatim** (template surgery, append nothing):
   - `src/pages/index.astro` — home title/description from the map.
   - `src/pages/[...slug].astro` — article/page: lookup by pathname; stop splitting on `|`.
   - `src/pages/annonces/[slug].astro` — drop the ` – Immobilière Pujol` build and the
     `substring(0,160)`; use the map.
   - `src/layouts/BaseLayout.astro` — unchanged emit, but confirm it never re-appends a suffix.
4. **Annonce fallback** for feed-only listings with no WP page: reverse-engineer the Yoast
   pattern (sale `{typeBien} {Tx} à vendre, {CP}, {ville}`; rental `… à louer, …`;
   description = full descriptif, HTML-stripped). Verify pattern across samples first.
5. **Verify**: re-scrape a sample of staging URLs, diff title+description against the CSV,
   drive mismatches to zero.

---

## Change log (keep current — this is what gets copied to prod)

Status: Phase A (scrape) in progress. Confirmations resolved by Roy (15 Jun): copy
live VERBATIM including ugly bits (home description keeps trailing phone+email);
storage = central sidecar map.

Format for each entry: `[date] <commit> — files — what changed`.

- **[15 Jun]** `migration/scrape-wp-meta.py` — new resumable scraper.
  Enumerates live `sitemap_index.xml` (14 child sitemaps) → 7,172 URLs → writes
  `migration/seo-meta.csv` (`path,url,final_url,status,title,description`). Notes:
  percent-encodes IRIs (the `prix au m²` pillar pages failed on raw urllib until
  fixed); `load_done()` treats empty-title rows as not-done so failures get retried;
  158 annonce timeouts were backfilled with a gentler retry (TIMEOUT=60, 3 workers).
  CSV is account-agnostic data → reaches prod via the normal main→pujol-main merge.
  Result: 6,646 usable titles; 525 legitimately-empty thin pages (`/tag/`,`/quartiers/`).
- **[15 Jun]** `migration/build-seo-meta-json.py` — compiles the CSV into two
  pathname-keyed maps (key = percent-DECODED path + trailing slash; value `{t,d}`,
  description verbatim incl. empty; only non-empty titles emitted):
  - `src/seo-data/seo-meta.json` — non-annonce pages, 1,230 entries / 64 KB gz (SSG, build-time only).
  - `src/seo-data/seo-meta-annonces.json` — `/annonces/*`, 5,416 entries / 478 KB gz (bundled in SSR worker).
  NB: in `src/seo-data/`, NOT `src/data/` — the latter is a build-artifact dir (regenerated/restored, never committed; see section "Build artifacts" in Kamindu_infrastructure.md).
- **[15 Jun]** `src/layouts/BaseLayout.astro` — import `seo-meta.json`; compute
  `liveKey = decodeURIComponent(Astro.url.pathname).replace(/\/?$/,'/')`; override ONLY
  the meta tags (`<title>`, description, og:title/description, twitter:title/description)
  with the live values when present. Breadcrumbs deliberately keep the page's own `title`.
- **[15 Jun]** `src/pages/annonces/[slug].astro` — import `seo-meta-annonces.json`; same
  key lookup; `pageTitle`/`pageDescription` use the live values when present, else fall
  back to the existing generated values. Removed reliance on ` – Immobilière Pujol`
  concatenation + `substring(0,160)` for in-map annonces. TODO (new-listing fallback):
  replicate the exact Yoast pattern so listings created AFTER the scrape also match.

**Offline-verified** (node, replicating the runtime key normalization): home, article,
service, a non-ASCII `prix m²` article, and two annonces all resolve to the exact live
title/description. NOT yet built/deployed to staging — see deploy note below.

### Deploy (corrected 16 Jun — push-based, per Kamindu_infrastructure.md)
Do NOT deploy locally (local `wrangler deploy` targets Roy and needs creds not in .env).
Use the branch flow:
```
# commit the meta-mirror files on develop (see file lists above)
git push origin develop
git push origin develop:main          # Roy/STAGING auto-deploys via deploy.yml
# verify staging:
curl -s https://immobiliere-pujol-staging.roy-68a.workers.dev/ | grep -o '<title>[^<]*</title>'
# then production:
git checkout pujol-main && git merge origin/main --no-edit && git push origin pujol-main
# Pujol/PROD auto-deploys via deploy-pujol.yml (patches Roy→Pujol). verify:
curl -s https://immobiliere-pujol-staging.pujol.workers.dev/ | grep -o '<title>[^<]*</title>'
git checkout develop
```
Reminder: do NOT stage `src/content/annonces`, `src/data`, or `public/_data` (build
artifacts). DO commit `src/seo-data/*`, the two `migration/*.py`, the CSV, and the
edits to `BaseLayout.astro` + `annonces/[slug].astro`.

### New files this work introduces (commit on develop)
- `migration/seo-meta.csv` — scraped live WP meta (account-agnostic data)
- `migration/scrape-wp-meta.py` — the scraper ✅
- `migration/build-seo-meta-json.py` — CSV → JSON compiler ✅
- `src/seo-data/seo-meta.json` — non-annonce lookup map ✅
- `src/seo-data/seo-meta-annonces.json` — annonce lookup map ✅
- `migration/META-MIRROR-PLAYBOOK.md` — this doc

### Files this work modifies
- `src/layouts/BaseLayout.astro` — meta-tag override from seo-meta.json ✅
- `src/pages/annonces/[slug].astro` — pageTitle/pageDescription override from seo-meta-annonces.json ✅
  (NOTE: index.astro and [...slug].astro did NOT need edits — BaseLayout's override covers
  home + all SSG pages centrally.)

---

## Resolved confirmations (Roy, 15 Jun)
1. Verbatim INCLUDING ugly bits (home description keeps trailing phone+email). ✅ Option A.
2. Storage = central sidecar map (in `src/seo-data/`, not per-file frontmatter). ✅
