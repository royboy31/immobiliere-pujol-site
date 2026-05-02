# Immobiliere Pujol — Phase 1 Implementation Plan

**Target launch:** End of May 2026
**Developers:** Kamindu (`kamindu` branch), Lilanga (`lilanga` branch)
**Merge target:** `main` (triggers staging deploy)

---

## Current State Assessment

### Already Built
- Astro 6 scaffold with Cloudflare Workers adapter (`@astrojs/cloudflare`)
- All 7 content collections defined in `src/content.config.ts`
- Content data migrated: ~5,259 annonces, ~891 articles, ~77 services, ~27 serviceImmobilier, ~23 experts, ~65 arrondissements, ~32 pages
- Ubiflow XML feed parser (`src/lib/ubiflow.ts`) with live SSR for rental listings
- SSR annonce detail page (`/annonces/[slug].astro`) handling active + closed listings
- Closed-annonce pre-build pipeline (`scripts/copy-closed-annonces.mjs`)
- Expert listings build script (`scripts/build-expert-listings.mjs`)
- Expert detail page (`/experts/[slug].astro`) with active + historical listings
- Admin auth system: PBKDF2 + JWT via `jose`, middleware gate, login/logout endpoints, admin dashboard
- R2 photo upload API endpoint (`/api/r2-upload.ts`)
- Catch-all `[...slug].astro` handling articles + static pages
- Category, tag, arrondissement taxonomy pages
- Service and serviceImmobilier detail pages
- BaseLayout with GTM, robots/noindex staging gate, JSON-LD schemas
- SCSS design system with variables, reset, fonts, mixins, components, layouts
- Header and Footer components with full WordPress menu structure preserved

### Not Built / Incomplete
1. `scripts/sync-opinionsystem-reviews.mjs` — does not exist yet
2. Reviews rendering on expert pages — no reviews section in `experts/[slug].astro`
3. La Boite Immo sales feed integration — blocked, waiting on their reply
4. Styling pass on all non-homepage pages — client feedback not applied
5. Forms are placeholders — service pages have `<!-- Form placeholder -->`, no EXO/Zoho integration
6. Blog archive page — no dedicated listing component with pagination
7. Prix au m2 sidebar — placeholder text in `[...slug].astro`
8. Mobile burger menu — button markup exists, no JS toggle logic
9. Gallery lightbox — basic thumbnail swap only, no fullscreen overlay
10. Production robots.txt / _headers — currently staging-blocked
11. Secrets rotation for production

### Known Bug
- **`src/pages/[...slug].astro`** has duplicate closing `</article>` and `</BaseLayout>` tags — produces invalid HTML on all 923 pages rendered by this route. Must fix immediately.

---

## Sprint Schedule

### SPRINT 0 — Dev Environment + Quick Fixes (Apr 30 – May 1)

| Task | Assignee | Details |
|---|---|---|
| Environment setup | Both | `cp .env.example .env`, fill values (see section 5 of DEVELOPER_HANDOVER.md), `nvm use 22`, `npm install`, `npm run build`, `npm run dev` |
| Fix `[...slug].astro` double-close bug | Kamindu | Remove duplicate `</article>` and `</BaseLayout>` closing tags, move article footer inside first article block. Merge to main immediately. |
| Follow up La Boite Immo | Kamindu | Send reminder to `passerelles@la-boite-immo.com` requesting: feed URL, status field mapping (active/retire/sous offre/sous promesse), update frequency, technical docs |

**Definition of done:** Both devs can run `npm run dev` and see the site at localhost:4321. Bug fix merged.

---

### SPRINT 1 — Core Functionality (May 2 – 9)

#### Kamindu — OpinionSystem Reviews

**Task 1.1: Create `scripts/sync-opinionsystem-reviews.mjs`**
- Read `OPINIONSYSTEM_API_KEY` from `.env`
- Step 1: `GET /client/collaborator?api_key=...` — fetch all collaborators
- Step 2: Load all expert JSONs from `src/content/experts/`, match by email to get `collaborator_id`
- Step 3: For each match, fetch `GET /collaborator/rating?collaborator_id={id}` and `GET /collaborator/survey?collaborator_id={id}&limit=50&offset=0`
- Step 4: Write `public/_data/reviews/{expert-slug}.json` with shape: `{ collaboratorId, rating, surveys, fetchedAt }`
- Step 5: Handle 204 (no reviews) — write `{ collaboratorId, rating: null, surveys: [], fetchedAt }`

**Task 1.2: Add reviews section to `src/pages/experts/[slug].astro`**
- After the historical listings section, add "Avis clients" section
- Load `/_data/reviews/{slug}.json` via ASSETS binding (same pattern as expert-listings)
- Display: overall star rating, total survey count, up to 10 recent review cards (client name, date, comment, rating)

**Task 1.3: Update build pipeline**
- In `package.json`, update `"build"` to include `node scripts/sync-opinionsystem-reviews.mjs` before `astro build`

#### Lilanga — Forms Integration (EXO/Zoho)

**Task 1.4: Build form submission infrastructure**
- Research the EXO / Mandrill email delivery mechanism (contact Anthony via Roy)
- Create reusable React island form components in `src/components/forms/`:
  - `ContactForm.tsx` — general contact
  - `EstimationForm.tsx` — property estimation
  - `ExpertContactForm.tsx` — expert-specific contact
  - `SyndicForm.tsx` — syndic inquiry
  - `NewsletterForm.tsx` — newsletter signup
- Create `/api/forms/submit.ts` (SSR endpoint, `prerender = false`) that forwards to Zoho via EXO

**Task 1.5: Connect forms to service pages**
- Replace `<!-- Form placeholder — connected in Gate 3 -->` in `/services/[slug].astro`
- Same for `/service-immobilier/[slug].astro`
- Connect estimation form at `/estimez-le-prix-de-vente-de-votre-bien-en-2mn/`

**Definition of done:** Expert pages show reviews. All form types submit and forward to Zoho.

---

### SPRINT 2 — Styling + Missing Pages (May 10 – 16)

#### Lilanga — Global Styling Pass

**Task 2.1: Apply client feedback to all page types**
- Client feedback: break visual repetition, reduce calligraphic/italic title overuse, smaller expert bubbles, more left-aligned titles (not everything centered)
- Files to modify under `src/styles/`:
  - `components/_cards.scss` — reduce expert bubble size, left-align card titles
  - `layouts/_listing.scss` — style annonces listing grid
  - `layouts/_single.scss` — style article, service, annonce single pages
  - `base/_rules.scss` — h1/h2 default to left-align, reduce italic
- Pages requiring styling: `/annonces/`, `/annonces/locations/`, `/annonces/ventes/`, `/annonces/[slug]/`, `/experts/`, `/experts/[slug]/`, `/services/[slug]/`, `/service-immobilier/[slug]/`, `/arrondissement/[...slug]/`, `/categorie/[...slug]/`, `/tag/[slug]/`, `/local/`, blog archive, all catch-all pages

**Task 2.2: Mobile burger menu JS**
- File: `src/components/common/Header.astro`
- Add inline `<script>` for burger toggle, submenu dropdowns on mobile, body scroll lock

**Task 2.3: Gallery lightbox**
- File: `src/pages/annonces/[slug].astro`
- Add fullscreen lightbox overlay with prev/next navigation, keyboard support, swipe on mobile

#### Kamindu — Data + Missing Features

**Task 2.4: La Boite Immo sales feed (if unblocked)**
- Create `src/lib/laboiteimmo.ts` analogous to `ubiflow.ts`
- Parse feed, map status fields
- Integrate into `/annonces/[slug].astro` and `/annonces/ventes.astro`
- If still blocked: document fallback plan (sales data already exists in annonces collection from WP migration, just won't auto-update)

**Task 2.5: Prix au m2 sidebar**
- File: `src/pages/[...slug].astro`
- Replace placeholder `"Sidebar arrondissements — a implementer"` with actual arrondissement links using the arrondissements content collection

**Task 2.6: Blog archive page**
- Create dedicated page at `src/pages/blog-immobilier-marseille.astro`
- Article listing with pagination
- Must render at exactly `/blog-immobilier-marseille/` (redirect from `/blog/` already configured in `astro.config.mjs`)

**Definition of done:** All pages styled per client feedback. Mobile menu works. Blog archive has pagination. Gallery has lightbox.

---

### SPRINT 3 — Testing (May 17 – 23)

| Test | Assignee | Checklist Item | How |
|---|---|---|---|
| URL verification | Kamindu | All legacy URLs (5,000+ listings + 900 blog posts) return 200, not 404 | Write a script that reads all content slugs and verifies each URL returns 200 against the staging build |
| Form end-to-end | Lilanga | All forms submit and reach Zoho via EXO; estimation lead hits Zoho CRM correctly | Test every form type, verify in Zoho |
| Closed listings | Kamindu | Closed listings render "ferme" template with internal links | Navigate to known closed listings, verify banner + CTA + related links |
| Admin area | Lilanga | Admin area at `/admin-pujol/` requires login; R2 photo upload works | Test login/logout, upload flow, verify unauthenticated access blocked |
| Robots/noindex gate | Kamindu | Gate works on staging and production | Test with `ALLOW_INDEXING=false` (meta noindex, X-Robots-Tag, robots.txt block) and `ALLOW_INDEXING=true` (all allow) |
| Listing freshness | Both | New listings appear within 12h of publication on Ubiflow | Verify Ubiflow feed returns current data; test La Boite Immo if integrated |
| Expert pages | Kamindu | Expert pages render reviews + recent sold listings | Verify reviews section + historical listing section on multiple expert pages |

**Definition of done:** All 11 items on the testing checklist (section 11 of DEVELOPER_HANDOVER.md) pass.

---

### SPRINT 4 — Production Prep + Launch (May 24 – 28)

**Task 4.1: Production wrangler config (Kamindu)**
- Create production wrangler config or use environments
- Rotate `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, `UPLOAD_TOKEN`
- Move secrets to `wrangler secret put` (not plain text in config)
- Set `ALLOW_INDEXING=true` for production

**Task 4.2: Production robots.txt + sitemap (Kamindu)**
- Replace staging robots.txt with production version allowing Googlebot
- Remove or conditionalize `_headers` X-Robots-Tag
- Add sitemap.xml generation (consider `@astrojs/sitemap` integration)

**Task 4.3: DNS cutover plan (Both)**
- Document exact steps for DNS switch from WordPress to Cloudflare
- Plan for zero-downtime migration
- Prepare rollback plan

**Task 4.4: Final merge + staging deploy (Both)**
- Merge `kamindu` and `lilanga` branches to `main`
- Resolve any conflicts
- Run full build and deploy to staging
- Run URL verification script one final time
- Client walkthrough for sign-off

**Task 4.5: Go-live (Both)**
- Deploy to production Cloudflare Workers
- Switch DNS for `immobiliere-pujol.fr`
- Verify `ALLOW_INDEXING=true` is active
- Monitor for 404s in Cloudflare analytics
- Submit updated sitemap to Google Search Console

---

## Developer Assignment Summary

| | Kamindu | Lilanga |
|---|---|---|
| **Primary** | Data integrations (OpinionSystem reviews, La Boite Immo, URL preservation) | Forms (EXO/Zoho), global styling pass |
| **Secondary** | Production infrastructure, robots/noindex, secrets rotation | Admin testing, mobile menu, gallery lightbox |

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| La Boite Immo still blocked | Sales listings won't auto-update | Sales data already in annonces collection from WP migration — usable as static fallback |
| `[...slug].astro` bug | Invalid HTML on 923 pages | Fix in Sprint 0, merge immediately |
| Worker bundle size | SSR pages may exceed 3 MiB limit | Expert page already avoids `getCollection`; monitor when adding reviews data |
| Form delivery (EXO/Zoho) | Leads lost if misconfigured | Need Anthony's input on EXO setup; test thoroughly in Sprint 3 |
| 5,259 annonce URLs | SEO damage if any return 404 | URL verification script in Sprint 3 catches gaps |

---

## Do NOT Touch

- Any annonce URL structure — SEO depends on exact URL preservation
- The GTM container ID (`GTM-WNFF3V`)
- The `admin-pujol` path (Caroline is used to it)

---

## References

- `DEVELOPER_HANDOVER.md` — full project context, env vars, API docs, contacts
- `src/content.config.ts` — content collection schemas
- `astro.config.mjs` — redirects, adapter config, SCSS setup
- `wrangler.jsonc` — Cloudflare bindings, runtime vars (staging values)
