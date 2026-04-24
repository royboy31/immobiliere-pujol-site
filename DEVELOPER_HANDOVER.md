# Immobilière Pujol — Developer Handover

This document is the entry point for any developer joining the Pujol website migration. Read it end-to-end before touching code.

---

## 1. Project at a glance

- **Client:** Immobilière Pujol — real estate agency in Marseille, 4 agencies, 20+ years in business.
- **Goal:** Migrate `immobiliere-pujol.fr` from WordPress to Astro on Cloudflare Pages while preserving every existing URL (5,000+ property listings + 150+ blog articles + service pages).
- **Traffic:** ~20,000 monthly visits, ~600 monthly leads. High SEO stakes — do NOT break URLs.
- **Languages:** All client-facing content is French. Code, comments, and internal docs are English.
- **Target Phase 1 launch:** end of May 2026.

## 2. Stack

| Layer       | Tech                                                    |
|-------------|---------------------------------------------------------|
| Framework   | **Astro 6** (content collections + SSR on Cloudflare)   |
| UI          | React 19 islands + SCSS + vanilla Astro components      |
| Hosting     | **Cloudflare Workers** (via `@astrojs/cloudflare`)      |
| Storage     | **R2 bucket** `pujol-photos` (property photos)          |
| Runtime     | Node 22.12+                                             |
| Config      | `wrangler.jsonc` (Cloudflare bindings + vars)           |
| Auth (admin)| PBKDF2 + JWT via `jose`                                 |
| Feeds       | Ubiflow (rentals, XML) + La Boîte Immo (sales, TBC)     |

## 3. Getting started

```bash
cd site
cp .env.example .env          # then fill values from section 5
npm install
npm run dev                   # http://localhost:4321
```

Build + preview locally (runs the same scripts the production build runs):

```bash
npm run build                 # generates dist/
npm run preview               # serves dist/ via wrangler
```

### Node version

`package.json` requires Node >= 22.12.0. If you use `nvm`:

```bash
nvm install 22 && nvm use 22
```

## 4. Repository layout

```
site/
├── scripts/
│   ├── copy-closed-annonces.mjs       # moves closed/sold listings to public/_data before build
│   ├── build-expert-listings.mjs      # groups annonces by expert email → public/_data/expert-listings/
│   ├── extract-service-immobilier.mjs # one-off migration helper
│   ├── fix-content-data.mjs           # one-off migration helper
│   └── fix-yaml-errors.mjs            # one-off migration helper
├── src/
│   ├── components/                    # .astro components
│   ├── content/                       # all content collections (see section 6)
│   ├── data/                          # static JSON lookups (arrondissements, etc.)
│   ├── db/                            # D1 schema (deferred, not live yet)
│   ├── layouts/                       # BaseLayout, AdminLayout, etc.
│   ├── lib/
│   │   ├── admin-auth.ts              # PBKDF2 + JWT session helpers
│   │   ├── closed-annonces.ts         # reads public/_data/closed-annonces.json at SSR time
│   │   ├── experts.ts                 # expert profile loaders
│   │   └── schemas.ts                 # zod-ish shared schemas
│   ├── middleware.ts                  # admin route gate (/${ADMIN_PATH}/…)
│   ├── pages/                         # file-based routes
│   └── styles/                        # global SCSS
├── public/                            # static assets, served as-is
│   └── _data/                         # GENERATED at build time, gitignored
├── astro.config.mjs
├── wrangler.jsonc                     # Cloudflare bindings + runtime vars
├── package.json
├── .env.example                       # template — copy to .env
├── .env                                # gitignored — real values
└── DEVELOPER_HANDOVER.md              # you are here
```

### Important: `public/_data/` is generated

Anything under `public/_data/` is produced by the pre-build scripts. It is gitignored on purpose. Never edit it by hand — edit the source (`src/content/…`) and re-run `npm run build`.

## 5. Environment variables

### Build-time vars — live in `site/.env`

| Variable | Purpose | Value to use |
|---|---|---|
| `GTM_ID` | Google Tag Manager container ID, injected by `BaseLayout.astro`. | `GTM-WNFF3V` |
| `ALLOW_INDEXING` | Staging gate. `false` → robots noindex + `X-Robots-Tag`. Set to `true` only on production. | `false` on staging, `true` on prod |
| `OPINIONSYSTEM_API_KEY` | API key for OpinionSystem (transaction immobilier). Used by the reviews sync script (TBD, see section 8). | `a9f9adc7eae894bc19d850cc4894a354` |

### Runtime vars — live in `site/wrangler.jsonc` under `vars`

These are bound to the Cloudflare Worker at runtime. Already committed in `wrangler.jsonc`:

| Variable | Purpose |
|---|---|
| `UPLOAD_TOKEN` | Bearer token required by `/api/r2-upload` (admin photo upload endpoint). |
| `ADMIN_EMAILS` | Comma-separated allowlist of admin login emails. |
| `ADMIN_PASSWORD_HASH` | `pbkdf2-sha256$iterations$saltB64$hashB64` — verified by `src/lib/admin-auth.ts`. |
| `ADMIN_SESSION_SECRET` | HMAC secret used to sign the admin JWT session cookie. |
| `ADMIN_PATH` | URL prefix for the admin area (currently `admin-pujol`). |

⚠️ The values in `wrangler.jsonc` are **staging** values. Before going to production we will rotate `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, and `UPLOAD_TOKEN`, and move them to `wrangler secret put …` instead of plain `vars`.

### Cloudflare bindings

| Binding | Type | Name |
|---|---|---|
| `ASSETS` | static assets | `./dist` |
| `PHOTOS` | R2 bucket | `pujol-photos` |

## 6. Content collections

All content lives under `src/content/` and is declared in `src/content.config.ts`. The collections are:

| Collection | Path | Count | What it is |
|---|---|---|---|
| `annonces` | `src/content/annonces/*.json` | ~5,000 | Property listings (active + closed). Each file = one listing. |
| `articles` | `src/content/articles/**/*.md` | ~900 | Blog posts (migrated from WordPress). |
| `services` | `src/content/services/**/*.md` | ~77 | Service detail pages under `/services/{slug}/`. |
| `serviceImmobilier` | `src/content/serviceImmobilier/**/*.md` | ~27 | Service landing pages under `/service-immobilier/{slug}/`. |
| `experts` | `src/content/experts/*.json` | ~23 | Negotiator profiles. Linked to listings via `contactAAfficher`. |
| `arrondissements` | `src/content/arrondissements/…` | — | Marseille 1er–16e category pages. |
| `pages` | `src/content/pages/*.md` | — | Static pages (home, about, etc.). |

Each collection has a zod schema in `src/content.config.ts` — **do not add fields without updating the schema**, or the build will fail.

### Annonces — active vs. closed

- **Active listings** (`contactAAfficher` email matches a current expert, status = active) are rendered by `src/pages/biens/[slug].astro`.
- **Closed/sold/rented listings** must keep their URLs alive for SEO. The pre-build script `copy-closed-annonces.mjs` extracts them to `public/_data/closed-annonces.json`, then a catch-all route renders them with a different template (call-to-action + internal links to similar biens). Logic lives in `src/lib/closed-annonces.ts`.
- **URL policy:** when a property comes back on the market, Neotim assigns a new REF. We are intentionally creating a new URL for the new cycle and keeping the old URL alive as a "closed" page. Do **not** merge or redirect them. (See meeting notes for why.)

### Experts

Each expert JSON has an `email` field (their Pujol email). The build script `build-expert-listings.mjs` groups every annonce by that email and writes `public/_data/expert-listings/{slug}.json`. The expert page reads this file at SSR time to display "Biens gérés — historique".

## 7. Build pipeline

The `npm run build` command is:

```json
"build": "node scripts/copy-closed-annonces.mjs && node scripts/build-expert-listings.mjs && astro build"
```

1. `copy-closed-annonces.mjs` — scans all annonces, separates closed ones, writes to `public/_data/closed-annonces.json`.
2. `build-expert-listings.mjs` — groups annonces by expert email, writes one JSON per expert to `public/_data/expert-listings/`.
3. `astro build` — normal Astro SSR build for Cloudflare.

Output lands in `dist/`. Wrangler/Cloudflare deploys that directory.

## 8. Work in progress / your tasks

### In progress

- **Styling pass** — homepage is styled (inspired by Manda); all other pages need the global styles applied. Content is already present. Current design feedback from the client: break up the visual repetition, reduce calligraphic/italic title overuse, smaller expert bubbles, more left-aligned titles (not everything centered).
- **La Boîte Immo sales feed integration** — waiting on their technical reply. Their contact: `passerelles@la-boite-immo.com`. We asked about: the flux URL, how they expose status (active / retiré / sous offre / sous promesse), update frequency, and technical docs.
- **OpinionSystem reviews per expert** — API is working (tested). See section 9. To do: write `scripts/sync-opinionsystem-reviews.mjs` that fetches per-expert reviews at build time and writes them to `public/_data/reviews/{collaborator_id}.json`. The expert page will render them.

### Deferred until after Phase 1

- D1 database (schema exists at `src/db/…`, not connected yet)
- R2 photo upload UI polish (endpoint exists at `/api/r2-upload`, protected by `UPLOAD_TOKEN`)

### Do NOT touch

- Any annonce URL structure — SEO depends on exact URL preservation.
- The GTM container ID.
- The `admin-pujol` path (Caroline is used to it).

## 9. OpinionSystem API (reviews per expert)

The API key `a9f9adc7eae894bc19d850cc4894a354` gives read access to all collaborators (négociateurs) and their individual reviews for the transaction scope.

- **Docs:** `https://api.opinionsystem.fr/v2` and `https://api.opinionsystem.fr/v2/swagger.yaml`
- **Base URL:** `https://api.opinionsystem.fr/v2`
- **Auth:** `?api_key=…` query parameter on every request.

Useful endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /client/collaborator` | List all collaborators (id, first/last name, email, certificate URL). |
| `GET /collaborator/rating?collaborator_id={id}` | Overall rating + 6 question scores + survey totals. |
| `GET /collaborator/survey?collaborator_id={id}&limit=…&offset=…` | Individual review objects: client name, date, `invoice_detail` (the property), comment + Pujol's reply, ratings. |

### Mapping collaborator_id → expert

The API's `email` on `/client/collaborator` matches the `email` field on `src/content/experts/*.json`. Sync script should:

1. Fetch `/client/collaborator` once.
2. For each expert JSON in `src/content/experts/`, look up the matching `collaborator_id`.
3. Fetch that collaborator's rating + surveys.
4. Write to `public/_data/reviews/{expert-slug}.json`.
5. Fail soft on 204 (no reviews) — just write an empty array.

### Technical contact at OpinionSystem

- Coach: Nastasia Smits — `n.smits@opinionsystem.fr` — +33 7 56 79 80 59

## 10. Deployment

- **Staging:** deployed on every push to `main` (Cloudflare Pages auto-deploy).
- **Production:** not live yet. Cutover is planned for end of May 2026 after 2 weeks of testing.

Wrangler deploy (manual, for testing):

```bash
npx wrangler deploy
```

## 11. Testing checklist before Phase 1 launch

- [ ] New listings appear within 12h of publication on Ubiflow / La Boîte Immo.
- [ ] All forms (property estimation, contact, expert contact, syndic, newsletter) submit and reach Zoho via EXO.
- [ ] Property estimation lead hits Zoho's CRM correctly (parser may need updating).
- [ ] Robots / noindex gate works on staging and production.
- [ ] All legacy URLs (5,000+ listings + 900 blog posts) return 200, not 404.
- [ ] Closed listings render the "fermé" template with internal links.
- [ ] Expert pages render reviews + recent sold listings.
- [ ] Admin area at `/admin-pujol/` requires login.
- [ ] R2 photo upload through admin UI works.

## 12. Contacts

| Role | Name | Email |
|---|---|---|
| Developer lead (me) | Roy Perelgut | roy@perelweb.studio |
| Client project lead | Caroline Pujol | carolinepujol@immobiliere-pujol.fr |
| Client owner | Stéphane Pujol | stephanepujol@immobiliere-pujol.fr |
| SEO consultant | François Lamotte | (ask Roy) |
| Ubiflow | Yann | (ask Roy) |
| La Boîte Immo | Service Passerelles | passerelles@la-boite-immo.com |
| OpinionSystem | Nastasia Smits | n.smits@opinionsystem.fr |
| EXO / Mandrill (email delivery) | Anthony | (ask Roy) |

---

If anything in this doc is outdated, please fix it and commit. This file is the single source of truth for the handover.
