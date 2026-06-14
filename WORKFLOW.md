# Workflow: where to make changes, how to commit, where to push

This is the single source of truth for how anyone (human or AI agent) makes
changes to the Immobilière Pujol site. Read it fully before touching the repo.

## TL;DR

1. Work in **`/Volumes/Projects/immobiliere-pujol-site`** only. Branch: **`develop`**.
2. Commit your specific files (never the build artifacts, see below).
3. `npm run build` then `npx wrangler deploy`.
4. **Restore the regenerated content files** (they must never be committed).
5. `git push origin develop` then `git push origin develop:main` (keep main == develop).
6. Verify on staging.

```bash
git checkout develop && git pull origin develop      # 1. always start in sync
# ...make your edits...
git add <only the files you changed>                 # 2. surgical staging
git commit -m "..."
npm run build                                        # 3a. build
npx wrangler deploy                                  # 3b. deploy main app
git checkout HEAD -- src/content/annonces src/data public/_data  # 4. restore artifacts
git push origin develop                              # 5a. push working branch
git push origin develop:main                         # 5b. fast-forward main (CRITICAL)
```

---

## 1. Where to make changes

- **Only** in `/Volumes/Projects/immobiliere-pujol-site` on this Mac.
- Do **not** edit the copy on the Mac mini (`/Users/perelbot/wsl-projects/...`).
  A file sync exists between the mini and this folder, and editing both sides
  causes divergence and "phantom" changes. One person/agent, one working copy.
- The `Puyol Immo` folder is **documentation only** (no source code).

## 2. Branches and what they mean

| Branch | Role | Push here? |
|---|---|---|
| **`develop`** | The working/integration branch. **All changes land here first.** | ✅ Yes, this is your branch. |
| **`main`** | The deploy branch. **Must always equal `develop`** (fast-forward after every push). | ✅ Only as a fast-forward of develop (`develop:main`). Never commit directly. |
| `roy`, `kamindu`, `lilanga` | Personal/feature branches for individual devs. | Only the owning dev. Their work is merged or cherry-picked into `develop`. |

### Why `main` must always equal `develop`
The `pujol-cron-sync` worker triggers a GitHub Actions redeploy **from `main`**
every hour (and on data changes). If `main` is behind `develop`, that cron
rebuild ships **old code and silently reverts your recent change**. So: every
time you push `develop`, immediately fast-forward `main`:

```bash
git push origin develop
git push origin develop:main
```

If you ever see a change you just shipped "revert itself" on staging a few
minutes later, this is the cause: `main` was behind. Re-deploy and push main.

## 3. The build artifacts you must NEVER commit

`npm run build` runs `sync-d1-to-content.mjs`, which **regenerates and prunes**
content from the D1 database into these paths:

- `src/content/annonces/**`  (≈5,000 files get rewritten/deleted)
- `src/data/**`
- `public/_data/**`

After every build, restore them so they are never staged or committed:

```bash
git checkout HEAD -- src/content/annonces src/data public/_data
```

If you accidentally commit these, you will delete thousands of annonce pages.
A clean `git status` after a build should show **only** your intended files
(plus the untracked `lbi/` folder, which is ignored).

## 4. Deploy targets (three separate workers)

| What | Command | Notes |
|---|---|---|
| **Main app** (Astro site, `immobiliere-pujol-staging`) | `npm run build && npx wrangler deploy` (from repo root) | The adapter writes `.wrangler/deploy/config.json`; leave it for this deploy. |
| **Email worker** (`pujol-email`) | `rm -rf .wrangler/deploy && cd workers/email && npx wrangler deploy` | Must remove the root `.wrangler/deploy` first or wrangler errors on a config-path conflict. |
| **Cron-sync worker** (`pujol-cron-sync`) | `npm run deploy:cron` | Rarely needed; only when changing the sync logic. |

Staging URL: `https://immobiliere-pujol-staging.roy-68a.workers.dev`

## 5. The standard change loop (full)

```bash
# 0. Sync first — someone else may have pushed
git checkout develop
git fetch origin
git rev-list --left-right --count develop...origin/develop   # right>0 ? pull/rebase first

# 1. Make surgical edits (touch only what the task needs)

# 2. Stage only your files, commit
git add path/to/file1 path/to/file2
git commit -m "Clear message of what changed"

# 3. Build + deploy the main app
npm run build
npx wrangler deploy

# 4. Restore build artifacts (NEVER commit these)
git checkout HEAD -- src/content/annonces src/data public/_data

# 5. Push develop, then fast-forward main
git push origin develop
git push origin develop:main

# 6. Verify on staging (curl or browser) before declaring done
```

## 6. Integrating another dev's branch (e.g. Lilanga, Kamindu)

They push to their own branch (`lilanga`, `kamindu`). To bring a specific
change into `develop`, prefer cherry-picking just the file(s) rather than
merging the whole branch (their branch may contain unrelated work):

```bash
git fetch origin
git log --oneline origin/develop..origin/lilanga   # see what's new
git checkout <their-commit> -- path/to/just/the/file   # take only that file
git commit -m "Integrate <thing> from <dev>"
```

## 7. Quick sanity checks before you push

- `git status` shows only your intended files (no `src/content/annonces` etc.).
- `git rev-list --count develop..origin/develop` is `0` (you're not behind).
- Staging reflects your change (curl/grep the relevant page).
- After pushing: `main` and `develop` point at the same commit.
