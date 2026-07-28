# Alert system — production cherry-pick manifest

The annonces alert system is built on `develop` (staging). Production deploys via
cherry-pick onto **`pujol-main`** (see the prod deploy workflow). This file lists
exactly which commits make up the alert system so they can be picked cleanly,
without dragging in unrelated develop-only work.

**Keep this updated:** every new alert commit → add its hash to the list below.

## Cherry-pick order (chronological — pick in this order)

| # | Commit | Summary |
|---|--------|---------|
| 1 | `fa527788` | Foundation: D1 `alerts` store + API (`create`/`confirm`/`unsubscribe`) + `/alerts/optin` & `/alerts/notify` worker endpoints + confirmee/desabonnee pages |
| 2 | `2afee487` | Capture UI: reusable `AlertForm` + public `/alerte/` page |
| 3 | `f9701f10` | Fix: post to trailing-slash API URLs (avoid the 308 hop) |
| 4 | `c3f68fe3` | Form: clear selected state on the achat/location toggle |
| 5 | `5827aeac` | Listing pop-up on each active fiche (`AnnonceLive`) |
| 6 | `eec05583` | Closed-listing pop-up (`AnnonceClosed`) + list-page "Créer une alerte" band (`ventes`/`locations`) |
| 7 | `9125d717` | Phase 2 send side: `/alerts/match` worker endpoint + `buildAlertMatch` subscriber email |
| 8 | `f6256aa5` | Phase 2 matcher: `cron-sync` detects new active listings → emails matching alerts |

Convenience (verify against the table first — grep can drift):
```
git log --reverse --format='%H %s' develop --grep='^Alerts' 
```

To apply onto prod:
```
git checkout pujol-main && git reset --hard origin/pujol-main
git cherry-pick fa527788 2afee487 f9701f10 c3f68fe3 5827aeac eec05583 9125d717 f6256aa5
git push origin pujol-main      # triggers the prod deploy workflow
```

## NOT part of this set (do not cherry-pick as "alerts")
Two security commits landed on develop from another session, interleaved but
unrelated to alerts (handle separately):
- `b32b1475` security: move admin secrets out of committed wrangler.jsonc
- `b347c1a3` security: gate cron-sync write endpoints behind a shared secret

## Files owned by the alert system
New: `src/lib/alerts-db.ts` · `src/pages/api/alerts/{create,confirm,unsubscribe}.ts` ·
`src/pages/alerte/{index,confirmee,desabonnee}.astro` ·
`src/components/alertes/{AlertForm,AlertPopup,AlertListCta}.astro`
Modified: `workers/email/index.ts` (added `/alerts/optin` + `/alerts/notify` + route registration) ·
`src/components/annonces/{AnnonceLive,AnnonceClosed}.astro` · `src/pages/annonces/{ventes,locations}.astro`

## Prod prerequisites (already satisfied unless noted)
- **Email worker** (`pujol-email`, Pujol acct): `BREVO_API_KEY` + `NEWSLETTER_INTERNAL_TOKEN` — already set (newsletter uses them). The alert endpoints reuse them; **no new secret required**.
- **Main worker**: `EMAIL_WORKER_URL` + `NEWSLETTER_INTERNAL_TOKEN` + the `DB` binding — already set.
- **D1 `alerts` table**: created automatically by `ensureSchema` on first API hit (prod D1 `6bf184d7…`). No manual migration.
- **Optional** `ALERTS_TURNSTILE_SECRET` on the main prod worker to enforce Turnstile on alert forms (else honeypot is the guard). Do NOT set `TURNSTILE_SECRET` on the email worker (it would start rejecting newsletter signups — see that worker's note).
- ⚠️ **On prod the notification emails are LIVE**: a confirmed vente alert emails `benoit@` + the listing négociateur; a location alert emails the négociateur or `annonces@`. Expect real agency emails once live.
- **Phase 2 matcher config (cron-sync worker)** — the matcher stays **dormant (safe no-op)** until all three are set on the `pujol-cron-sync` worker:
  - `EMAIL_WORKER_URL` (var) = the email worker URL for that env (prod: `https://pujol-email.<pujol-acct>.workers.dev`).
  - `NEWSLETTER_INTERNAL_TOKEN` (secret) = **the same value** as on the email worker (Roy/deploy holds it; Claude can't read it).
  - `SITE_BASE_URL` (var) = public site origin (prod `https://www.immobiliere-pujol.fr`, staging the staging URL) — used for listing + manage links.
  - Set on prod via `wrangler secret put NEWSLETTER_INTERNAL_TOKEN --name pujol-cron-sync` (+ add the two vars to `workers/cron-sync/wrangler.jsonc` or patch them in `deploy-pujol.yml`). Matcher guards: backfill >40 new = skip, anti-flood ~1 email/day/alert, only ACTIVE new listings.

## Post-deploy check (prod)
1. `GET /alerte/` returns 200 with the form.
2. `POST /api/alerts/create/` (with a browser Origin header) → `{ok:true,emailQueued:true}`, opt-in email arrives.
3. Click the confirm link → lands on `/alerte/confirmee/`, the row flips to `active`, agency notification sent.
4. Listing pop-up appears on an active fiche and a sold fiche; "Créer une alerte" band on `/annonces/ventes/` + `/annonces/locations/`.
