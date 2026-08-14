# Alert system — handover & production cherry-pick manifest

**Read this first when resuming the alert work.** It is the single source of truth for:
what was built, how to see it, how to move it to production, and what is left.

- **Built on:** `develop` (staging). **Production deploy:** cherry-pick the commits below onto **`pujol-main`** (its push triggers the prod deploy workflow).
- **Devis:** approved `quotation-template/immobiliere-pujol/devis-alertes-immobiliere-pujol-2026-07-11` = **2 900 € HT** (covers Phase 1 capture + Phase 2 matching).
- **Full spec:** `Puyol Immo/plans/systeme-alerte-plan.md`.

## Status at handover (29 Jul 2026)

| Part | State |
|---|---|
| Phase 1 — capture (`/alerte/` page, pop-up on every listing, list-page buttons), double opt-in, agency notify | ✅ built + on staging |
| Phase 1 — back-office (`admin-pujol/alertes`: list, filter, manual add, pause/delete) | ✅ built + on staging |
| Phase 2 — matcher (email `/alerts/match` + `cron-sync` hook) | ✅ built + on staging, **core logic tested**, **live cron trigger NOT yet run** |
| Caroline feedback batch A (copy/layout) + multi-arrondissements + fix radios (14 Aug 2026) | ✅ built + on staging, verified (see below) |
| Production | ⬜ not deployed — cherry-pick below when ready |

**Nothing is on production yet.** The whole system lives on staging only.

## See it on staging
- Self-service page: `https://immobiliere-pujol-staging.roy-68a.workers.dev/alerte/`
- Pop-up on a listing (button under the contact form / in the sold card): any `/annonces/<slug>/`
- "Créer une alerte" band: `/annonces/ventes/` and `/annonces/locations/`
- Back-office (needs admin login → "Alertes" in the sidebar): `/admin-pujol/alertes/`

## What was verified vs. not
- ✅ **Create → pending row → opt-in email**: tested on staging (`{ok:true,emailQueued:true}`, row written, email sent).
- ✅ **Matching logic**: tested against a real staging listing — the exact matcher SQL selected a matching alert and correctly excluded a too-low-budget one; the real subscriber email was delivered with real listing data (photo/price/link).
- ⬜ **Live cron trigger** (findNewSlugs + in-import call firing during a real `/sync`): NOT run — needs the Phase-2 config below and a genuinely-new matching listing. The code builds clean and is guarded, but this last glue hasn't fired live.

## Cherry-pick order (pick in this order onto pujol-main)

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
| 9 | `d9d46f7d` | Back-office `admin-pujol/alertes` (list + filter + manual add + pause/delete) + `/alerts/registered` email + sidebar item |
| 10 | `c89f2fff` | Caroline batch A (14 Aug): titre + intro, 3 étapes au-dessus du formulaire, question Oui/Non "bien à vendre" (remplace 2 cases), RGPD raccourci + paragraphe légal, phrase finale/succès |
| 11 | `4b617ab2` | Multi-arrondissements (14 Aug): grille de cases Secteur (public + popup + admin), stockage CSV trié dans la colonne `cp` existante (pas de migration D1), matcher `cron-sync` passe de `cp=?` à `instr(','||cp||',', ','||?||',')`, `describeCriteriaC` formate la liste. **Touche `workers/cron-sync` → la promotion doit redéployer `pujol-cron-sync` en prod, pas seulement le worker site.** |
| 12 | `b22cb4f4` | Fix (14 Aug): radios Oui/Non invisibles (reset CSS global `appearance:none`) — règle scopée au formulaire qui restaure l'apparence native |
| 13 | `24a77e6c` | Expéditeur dédié (14 Aug): les emails abonnés (opt-in, match, registered) partent du sender Brevo `ALERT_SENDER_EMAIL` quand la var est posée sur le worker email (fallback inchangé sinon). Voir prérequis ci-dessous. |

Sanity-check the list against the log before picking (grep can drift):
```
git log --reverse --format='%H %s' develop --grep='^Alerts'
```

Apply to prod:
```
git checkout pujol-main && git reset --hard origin/pujol-main
git cherry-pick fa527788 2afee487 f9701f10 c3f68fe3 5827aeac eec05583 9125d717 f6256aa5 d9d46f7d c89f2fff 4b617ab2 b22cb4f4
git push origin pujol-main      # triggers the prod deploy workflow
```
⚠️ Le workflow prod déploie-t-il aussi `pujol-cron-sync` ? Vérifier avant de promouvoir : le commit `4b617ab2` modifie le matcher dans `workers/cron-sync/index.ts` et le worker prod doit être redéployé avec.
Files are isolated (see "Files owned"), so conflicts are unlikely; if one arises, take the alert-side additions.

## NOT part of this set (exclude)
Two security commits from Roy's **other agent** (admin-panel hardening) are interleaved on develop but touch different files — **do not** include them in the alert pick, handle separately:
- `b32b1475` security: move admin secrets out of committed wrangler.jsonc
- `b347c1a3` security: gate cron-sync write endpoints behind a shared secret

Two CI commits (health-check cron scheduling) are also interleaved and independent of the alert system:
- `6993b891` ci: move daily health check off the top-of-hour
- `68cad4b5` ci: trigger daily health check from Cloudflare cron

## Multi-arrondissements — vérifié sur staging (14 Aug 2026)
- Alerte test créée avec 3 secteurs → stockée `13006,13008,13009` (CSV trié) dans la colonne `cp` existante.
- Re-soumission des mêmes secteurs dans un autre ordre → détectée comme doublon (normalisation triée).
- SQL du matcher : matche `13009`, rejette `13001` (comparaison par élément complet, pas de faux positif sous-chaîne grâce aux virgules d'encadrement).
- Sémantique inchangée : `cp NULL` (aucune case cochée) = tous secteurs ; les alertes mono-secteur existantes restent compatibles sans migration.
- Les workers site + cron-sync staging redéployés le 14 Aug à 18:43 UTC.
- Inchangé côté moteur : cadence de sync, détection des nouveautés, filtres transac/type/budget/chambres, garde anti-backfill (>40), cap 1 email/jour/alerte, flux email.

## Files owned by the alert system
New: `src/lib/alerts-db.ts` · `src/pages/api/alerts/{create,confirm,unsubscribe}.ts` ·
`src/pages/alerte/{index,confirmee,desabonnee}.astro` ·
`src/components/alertes/{AlertForm,AlertPopup,AlertListCta}.astro` ·
`src/pages/admin-pujol/alertes/index.astro` · `src/pages/api/admin-pujol/alertes/{index,[id]}.ts`
Modified: `workers/email/index.ts` (`/alerts/optin` + `/alerts/notify` + `/alerts/match` + `/alerts/registered` + routes) ·
`workers/cron-sync/index.ts` (matcher hook) ·
`src/components/annonces/{AnnonceLive,AnnonceClosed}.astro` · `src/pages/annonces/{ventes,locations}.astro` ·
`src/layouts/AdminLayout.astro` (sidebar "Alertes" item + section type)

## Prod prerequisites
- **Email worker** (`pujol-email`, Pujol acct): `BREVO_API_KEY` + `NEWSLETTER_INTERNAL_TOKEN` — already set (newsletter uses them). Alert endpoints reuse them; **no new secret**.
- **Expéditeur dédié `alerte@alerte.immobiliere-pujol.fr`** (14 Aug 2026): domaine + sender créés dans Brevo (workflow manuel `brevo-alerte-domain.yml`, re-runnable). Reste : poser les 4 enregistrements DNS dans la zone Cloudflare (TXT brevo-code sur `alerte`, CNAME `brevo1._domainkey.alerte` et `brevo2._domainkey.alerte` vers `b1`/`b2.alerte-immobiliere-pujol-fr.dkim.brevo.com`, TXT `_dmarc.alerte`), re-runner le workflow pour authentifier + activer le sender, **puis** poser la var `ALERT_SENDER_EMAIL=alerte@alerte.immobiliere-pujol.fr` sur le worker email (staging et prod). ⚠️ Ne jamais poser la var avant que le sender soit actif dans Brevo, sinon les envois abonnés échouent.
- **Main worker**: `EMAIL_WORKER_URL` + `NEWSLETTER_INTERNAL_TOKEN` + the `DB` binding — already set.
- **D1 `alerts` table**: auto-created by `ensureSchema` on first API hit (prod D1 `6bf184d7…`). No migration.
- **Optional** `ALERTS_TURNSTILE_SECRET` on the main prod worker to enforce Turnstile on alert forms (else honeypot is the guard). Do **not** set `TURNSTILE_SECRET` on the email worker (it would reject newsletter signups).
- ⚠️ **On prod the notification emails are LIVE**: a confirmed vente alert emails `benoit@` + the listing négociateur; a location alert emails the négociateur or `annonces@`.

## Phase 2 activation (do after the cherry-pick, or on staging to test first)
The `cron-sync` matcher stays a **safe no-op** until these three are set on the `pujol-cron-sync` worker (per environment):
- `EMAIL_WORKER_URL` (var) — the email worker URL for that env (prod: `https://pujol-email.<pujol-acct>.workers.dev`; staging: `https://pujol-email.roy-68a.workers.dev`).
- `NEWSLETTER_INTERNAL_TOKEN` (secret) — **the same value** as on the email worker (Roy/deploy holds it; not readable via wrangler).
- `SITE_BASE_URL` (var) — public site origin (prod `https://www.immobiliere-pujol.fr`; staging the staging URL).

Set on prod, e.g.:
```
CLOUDFLARE_ACCOUNT_ID=<pujol> wrangler secret put NEWSLETTER_INTERNAL_TOKEN --name pujol-cron-sync
# + add EMAIL_WORKER_URL and SITE_BASE_URL as vars (wrangler.jsonc or patch in deploy-pujol.yml)
```
Matcher guards: no-op if unconfigured · backfill >40 new listings = skip · anti-flood ~1 email/day/alert (`last_notified_at`) · only ACTIVE new listings · fully try/caught (never breaks an import).

## Live end-to-end test (the untested last step)
On staging, once the 3 vars are set:
1. Create an active alert with broad criteria (or via the back-office).
2. Make one listing "new": delete an in-feed listing's row from staging D1 (it re-adds on the next sync).
3. Trigger the import (`/sync` needs `CRON_TRIGGER_SECRET`, set by the other agent).
4. Confirm: the listing re-imports, the matcher fires, the subscriber gets the "un bien correspond" email, and the alert's `last_notified_at` is set.

## Post-deploy check (prod)
1. `GET /alerte/` → 200 with the form.
2. `POST /api/alerts/create/` (with a browser Origin header) → `{ok:true,emailQueued:true}`, opt-in email arrives.
3. Click confirm → lands on `/alerte/confirmee/`, row flips to `active`, agency notification sent.
4. Pop-up on an active fiche + a sold fiche; "Créer une alerte" on `/annonces/ventes|locations/`.
5. Back-office `admin-pujol/alertes` loads, manual add works, pause/delete work.

## Open decisions / follow-ups
- Notification routing: per-négociateur vs centralised (Caroline to confirm with Benoît) — currently vente → négociateur + `benoit@`, location → négociateur/`annonces@`.
- Matching cadence: currently per-import batch capped ~1/day/alert; a true daily digest is a later refinement.
- Manual back-office add currently creates **active** + courtesy email; if stricter RGPD wanted, switch to pending + double opt-in.
- Caroline asked to review the `/alerte/` form (email drafted 28 Jul) — fold in her feedback.
