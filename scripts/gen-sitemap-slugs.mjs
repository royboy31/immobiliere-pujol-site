// Generates public/_data/sitemap-slugs.json at build time.
// Contains annonce slugs, category slugs, and tag slugs for the dynamic sitemap.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { loadPerdu } from './perdu-set.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

function slugify(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Annonce slugs. Active listings live in src/content/annonces; closed/vendu
// listings were moved to public/_data/annonces by copy-closed-annonces (which
// runs earlier in the build) to keep the Astro content bundle small. Union both
// so the sitemap covers active AND historical/closed listings.
const annonceDirs = [join(ROOT, 'src/content/annonces'), join(ROOT, 'public/_data/annonces')];
const annonceSet = new Set();
for (const dir of annonceDirs) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json')) annonceSet.add(f.replace('.json', ''));
  }
}
// D1 annonce slugs — active AND closed. An importer-era listing that closes
// after a build keeps its live page (the [slug] route serves it from D1 at
// request time) but exists in neither directory above, so without this query
// it silently drops out of the sitemap forever. Mirror the route's behavior:
// skip 'dropped' rows (302 to /annonces/) and closed rows whose reference has
// an active sibling (301 to the active slug) — neither may be advertised.
// Fail open on any D1 error: the sitemap then degrades to the file-based
// slugs (the pre-fix behavior) instead of breaking the build.
try {
  // One linear query only: a correlated NOT EXISTS on the same table timed out
  // (~39s) on the production D1 during the 30/09 deploy, so the sibling
  // exclusion is computed here in JS instead, mirroring the exact-match
  // semantics of getActiveSlugByReference in src/lib/db-annonces.ts.
  const sql = `SELECT slug, status, reference_agence, ubiflow_reference FROM annonces WHERE status IN ('active', 'closed')`;
  const out = execSync(
    `npx wrangler d1 execute pujol-annonces --remote --json --command="${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 120000, maxBuffer: 50 * 1024 * 1024, cwd: ROOT, env: { ...process.env } },
  );
  const rows = JSON.parse(out)[0]?.results || [];
  const activeRefs = new Set();
  for (const r of rows) {
    if (r.status !== 'active') continue;
    if (r.reference_agence) activeRefs.add(r.reference_agence);
    if (r.ubiflow_reference) activeRefs.add(r.ubiflow_reference);
  }
  let added = 0;
  let siblingSkipped = 0;
  for (const r of rows) {
    if (!r.slug) continue;
    // Closed row whose reference has an active sibling: the route 301s that
    // URL to the active slug, so it must not be advertised.
    if (
      r.status === 'closed' &&
      ((r.reference_agence && activeRefs.has(r.reference_agence)) ||
        (r.ubiflow_reference && activeRefs.has(r.ubiflow_reference)))
    ) { siblingSkipped++; continue; }
    if (!annonceSet.has(r.slug)) { annonceSet.add(r.slug); added++; }
  }
  console.log(`[gen-sitemap-slugs] D1 slugs: ${rows.length} (${added} not in content dirs, ${siblingSkipped} closed-with-active-sibling skipped)`);
} catch (e) {
  console.warn(`[gen-sitemap-slugs] ⚠️ D1 slug query failed, sitemap falls back to file-based slugs only: ${e.message}`);
  if (e.stderr) console.warn(String(e.stderr).slice(0, 2000));
}

// Exclude "perdu" (lost-mandate) listings — they're hidden from the site
// (perdu-set) so they must not be advertised in the sitemap. Same matcher as
// the rest of the site (full slug or leading reference token).
const perdu = await loadPerdu();
const annonces = [...annonceSet].filter((s) => !perdu.isPerdu(s));

// Categories, tags, and article metadata from article frontmatter
const articlesDir = join(ROOT, 'src/content/articles');
const cats = new Set();
const tags = new Set();
const articles = [];

for (const f of readdirSync(articlesDir).filter(f => f.endsWith('.md'))) {
  const content = readFileSync(join(articlesDir, f), 'utf-8');
  if (!content.startsWith('---')) continue;
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) continue;
  const fm = content.slice(3, endIdx);

  // Extract article metadata for post-sitemap
  const slugMatch = fm.match(/^slug\s*:\s*"?([^"\n]+)"?/m);
  const dateMatch = fm.match(/^date\s*:\s*"?([^"\n]+)"?/m);
  const titleMatch = fm.match(/^title\s*:\s*"([^"]+)"/m);
  const imageMatch = fm.match(/^featuredImage\s*:\s*"?([^"\n]+)"?/m);

  if (slugMatch) {
    articles.push({
      slug: slugMatch[1].trim(),
      date: dateMatch ? dateMatch[1].trim() : undefined,
      title: titleMatch ? titleMatch[1].trim() : undefined,
      image: imageMatch ? imageMatch[1].trim() : undefined,
    });
  }

  // Extract categories and tags — handles both inline JSON arrays and YAML lists
  const catMatch = fm.match(/^categories\s*:\s*(.+)$/m);
  if (catMatch) {
    try {
      const arr = JSON.parse(catMatch[1]);
      if (Array.isArray(arr)) arr.forEach(c => cats.add(slugify(c)));
    } catch { /* try YAML list format below */ }
  }
  const tagMatch = fm.match(/^tags\s*:\s*(.+)$/m);
  if (tagMatch) {
    try {
      const arr = JSON.parse(tagMatch[1]);
      if (Array.isArray(arr)) arr.forEach(t => { if (t) tags.add(slugify(t)); });
    } catch { /* skip */ }
  }
}

// Collect slugs from other content directories (eliminates import.meta.glob in CF Workers)
function dirSlugs(dir, ext) {
  const full = join(ROOT, dir);
  try {
    return readdirSync(full).filter(f => f.endsWith(ext)).map(f => f.replace(ext, '')).sort();
  } catch { return []; }
}

// Exclude WP parent__child flattened pages (thank-you / confirmation pages we
// dropped, and a duplicate mentions-légales): their `__` slugs have no valid
// route (404) and must not appear in the sitemap.
const pages = dirSlugs('src/content/pages', '.md').filter((s) => !s.includes('__'));
const services = dirSlugs('src/content/services', '.md');
const experts = dirSlugs('src/content/experts', '.json');
const serviceImmobilier = dirSlugs('src/content/serviceImmobilier', '.md');
const arrondissements = dirSlugs('src/content/arrondissements', '.json');
const quartiers = dirSlugs('src/content/quartiers', '.json');

const data = {
  annonces: annonces.sort(),
  categories: [...cats].sort(),
  tags: [...tags].sort(),
  articles: articles.sort((a, b) => a.slug.localeCompare(b.slug)),
  pages,
  services,
  experts,
  serviceImmobilier,
  arrondissements,
  quartiers,
};

const outPath = join(ROOT, 'public/_data/sitemap-slugs.json');
writeFileSync(outPath, JSON.stringify(data));
console.log(`[gen-sitemap-slugs] annonces: ${data.annonces.length}, categories: ${data.categories.length}, tags: ${data.tags.length}, articles: ${data.articles.length}, pages: ${pages.length}, services: ${services.length}, experts: ${experts.length}, serviceImmo: ${serviceImmobilier.length}, arrond: ${arrondissements.length}, quartiers: ${quartiers.length}`);
