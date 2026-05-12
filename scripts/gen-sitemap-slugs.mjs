// Generates public/_data/sitemap-slugs.json at build time.
// Contains annonce slugs, category slugs, and tag slugs for the dynamic sitemap.
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;

function slugify(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Annonce slugs
const annonceDir = join(ROOT, 'src/content/annonces');
const annonces = readdirSync(annonceDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));

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

const data = {
  annonces: annonces.sort(),
  categories: [...cats].sort(),
  tags: [...tags].sort(),
  articles: articles.sort((a, b) => a.slug.localeCompare(b.slug)),
};

const outPath = join(ROOT, 'public/_data/sitemap-slugs.json');
writeFileSync(outPath, JSON.stringify(data));
console.log(`[gen-sitemap-slugs] annonces: ${data.annonces.length}, categories: ${data.categories.length}, tags: ${data.tags.length}, articles: ${data.articles.length}`);
