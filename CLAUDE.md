# CLAUDE.md — Immobilière Pujol site

**Read `WORKFLOW.md` before making any change.** It is the authoritative process
for branches, commits, deploys, and the build-artifact gotcha. The essentials:

## ⛔ STAGING ONLY — production needs explicit approval (per change)

**Every change is applied to STAGING only by default.** Production is the Pujol
Cloudflare account, deployed from the **`pujol-main`** branch (see
`Kamindu_infrastructure.md` in the Puyol Immo docs folder).

- **Staging = Roy account**, deployed from `develop` + `main`
  (`https://immobiliere-pujol-staging.roy-68a.workers.dev`). Push here freely.
- **Production = Pujol account**, deployed from `pujol-main`
  (`https://immobiliere-pujol-staging.pujol.workers.dev`).
- **NEVER touch `pujol-main`** (merge/push/`gh workflow run deploy-pujol.yml`)
  **without Roy's explicit approval for that specific change.** Approval for one
  change is NOT approval for the next. When work is staged and verified, ask Roy
  before promoting to production. Do not bundle an unapproved change into an
  approved production push.

## Non-negotiable rules

1. **Work on `develop`**, in `/Volumes/Projects/immobiliere-pujol-site` only.
   Never edit the Mac mini copy (a sync exists; editing both diverges).

2. **Keep `main` == `develop`.** After every push run BOTH:
   ```bash
   git push origin develop
   git push origin develop:main
   ```
   The `pujol-cron-sync` worker redeploys from `main` hourly. If `main` lags,
   it ships old code and silently **reverts your change**.

3. **Never commit build artifacts.** `npm run build` regenerates these from D1;
   restore them after every build:
   ```bash
   git checkout HEAD -- src/content/annonces src/content/articles src/content/experts src/data public/_data
   ```
   Committing them deletes thousands of annonce pages. `src/content/articles`
   (blog) and `src/content/experts` are now D1-synced too (see the
   `sync-d1-*-to-content.mjs` scripts) — restore them alongside annonces.

4. **Deploy the main app** with `npm run build && npx wrangler deploy` (repo root).
   The **email worker** deploys separately:
   `rm -rf .wrangler/deploy && cd workers/email && npx wrangler deploy`.

5. **Be surgical.** Stage only the files your task changed; verify `git status`
   shows nothing unexpected before committing.

## The loop
sync develop → edit → commit your files → `npm run build` → `npx wrangler deploy`
→ restore artifacts → `git push origin develop` → `git push origin develop:main`
→ verify on staging (`https://immobiliere-pujol-staging.roy-68a.workers.dev`).

See `WORKFLOW.md` for the full detail, branch table, and how to integrate
another dev's branch.
