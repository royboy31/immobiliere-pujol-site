-- Release gestion 27/11/2026: consent record of guide requests (email worker /guide route).
-- The worker also runs this CREATE TABLE IF NOT EXISTS before its first insert, so applying it
-- is idempotent. Apply to PRODUCTION D1 before (or right after) the release, with Roy's go:
--   npx wrangler d1 execute <prod database> --remote --file migrations/2026-11-27_guide_requests.sql
CREATE TABLE IF NOT EXISTS guide_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, email TEXT NOT NULL, prenom TEXT, nom TEXT,
  guide TEXT NOT NULL, tag TEXT NOT NULL, consent TEXT NOT NULL, status TEXT NOT NULL,
  sheet_ok INTEGER NOT NULL DEFAULT 0, lead_ok INTEGER NOT NULL DEFAULT 0
);
