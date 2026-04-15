/**
 * Fix content collection data issues:
 * - Articles: empty titles (591), pipe-separated titles (187)
 * - Services: 1 empty title
 * - Experts: pipe-separated titles (15)
 * - Pages: empty titles (30)
 *
 * Also decodes HTML entities in titles and descriptions.
 */

import fs from 'fs';
import path from 'path';

const CONTENT_DIR = 'src/content';

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç')
    .replace(/&ocirc;/g, 'ô')
    .replace(/&ucirc;/g, 'û')
    .replace(/&iuml;/g, 'ï')
    .replace(/&euml;/g, 'ë');
}

function slugToTitle(slug) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bd\b/gi, "d'")
    .replace(/\bl\b/gi, "l'")
    .trim();
}

function cleanPipeTitle(title) {
  // Pipe-separated titles are usually "image_filename|actual title" or "title|title duplicate"
  const parts = title.split('|').map(p => p.trim()).filter(Boolean);

  // Find the longest part that looks like a real title (not a filename)
  const candidates = parts.filter(p =>
    !p.match(/\.(jpg|png|gif|webp|jpeg)$/i) &&  // not a filename
    !p.match(/^[A-Z0-9_]+\./i) &&                // not a file reference
    p.length > 5                                    // not too short
  );

  if (candidates.length > 0) {
    // Return the first candidate (usually the most relevant)
    return decodeHtmlEntities(candidates[0]);
  }

  // Fallback: return first part
  return decodeHtmlEntities(parts[0] || title);
}

function fixMarkdownFile(filePath, collection) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fmMatch = content.match(/^(---\n)([\s\S]*?)\n(---)/);
  if (!fmMatch) return false;

  let frontmatter = fmMatch[2];
  let changed = false;

  // Extract current values
  const titleMatch = frontmatter.match(/^title:\s*"(.*)"/m);
  const slugMatch = frontmatter.match(/^slug:\s*"(.*)"/m);
  const seoTitleMatch = frontmatter.match(/^seoTitle:\s*"(.*)"/m);
  const seoDescMatch = frontmatter.match(/^seoDescription:\s*"(.*)"/m);

  const currentTitle = titleMatch ? titleMatch[1] : '';
  const slug = slugMatch ? slugMatch[1] : '';
  const seoTitle = seoTitleMatch ? seoTitleMatch[1] : '';

  // Fix title
  let newTitle = currentTitle;

  if (!currentTitle || currentTitle.trim() === '') {
    // Empty title: use seoTitle or derive from slug
    if (seoTitle && seoTitle.trim()) {
      newTitle = cleanPipeTitle(seoTitle);
    } else if (slug) {
      const cleanSlug = slug.replace(/^(services|service-immobilier)\//, '');
      newTitle = slugToTitle(cleanSlug);
    }
    changed = true;
  } else if (currentTitle.includes('|')) {
    // Pipe-separated title: clean it
    newTitle = cleanPipeTitle(currentTitle);
    changed = true;
  }

  // Decode HTML entities in title
  const decodedTitle = decodeHtmlEntities(newTitle);
  if (decodedTitle !== newTitle) {
    newTitle = decodedTitle;
    changed = true;
  }

  // Clean seoTitle (remove pipe duplicates)
  if (seoTitle && seoTitle.includes('|')) {
    const cleanSeoTitle = cleanPipeTitle(seoTitle);
    frontmatter = frontmatter.replace(
      /^seoTitle:\s*".*"/m,
      `seoTitle: "${cleanSeoTitle.replace(/"/g, '\\"')}"`
    );
    changed = true;
  }

  // Clean seoDescription (remove pipe duplicates, decode entities)
  if (seoDescMatch && seoDescMatch[1]) {
    let cleanDesc = seoDescMatch[1];
    if (cleanDesc.includes('|')) {
      cleanDesc = cleanDesc.split('|')[0].trim();
    }
    cleanDesc = decodeHtmlEntities(cleanDesc);
    if (cleanDesc !== seoDescMatch[1]) {
      frontmatter = frontmatter.replace(
        /^seoDescription:\s*".*"/m,
        `seoDescription: "${cleanDesc.replace(/"/g, '\\"')}"`
      );
      changed = true;
    }
  }

  if (changed) {
    // Apply title fix
    if (titleMatch) {
      frontmatter = frontmatter.replace(
        /^title:\s*".*"/m,
        `title: "${newTitle.replace(/"/g, '\\"')}"`
      );
    } else {
      frontmatter = `title: "${newTitle.replace(/"/g, '\\"')}"\n${frontmatter}`;
    }

    const newContent = `${fmMatch[1]}${frontmatter}\n${fmMatch[3]}${content.slice(fmMatch[0].length)}`;
    fs.writeFileSync(filePath, newContent);
    return true;
  }
  return false;
}

function fixJsonFile(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let changed = false;

  if (data.title && data.title.includes('|')) {
    // For experts: "anthony|Anthony - Comptable gestion" → take the descriptive part
    const parts = data.title.split('|').map(p => p.trim());
    // Pick the longest meaningful part
    data.title = parts.reduce((best, p) => p.length > best.length ? p : best, '');
    data.title = decodeHtmlEntities(data.title);
    changed = true;
  }

  if (data.seoTitle && data.seoTitle.includes('|')) {
    data.seoTitle = cleanPipeTitle(data.seoTitle);
    changed = true;
  }

  if (data.seoDescription && data.seoDescription.includes('|')) {
    data.seoDescription = data.seoDescription.split('|')[0].trim();
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    return true;
  }
  return false;
}

// Process all collections
const stats = { articles: 0, services: 0, experts: 0, pages: 0, annonces: 0 };

// Articles
const articlesDir = path.join(CONTENT_DIR, 'articles');
for (const f of fs.readdirSync(articlesDir)) {
  if (f.endsWith('.md') && fixMarkdownFile(path.join(articlesDir, f), 'articles')) stats.articles++;
}

// Services
const servicesDir = path.join(CONTENT_DIR, 'services');
for (const f of fs.readdirSync(servicesDir)) {
  if (f.endsWith('.md') && fixMarkdownFile(path.join(servicesDir, f), 'services')) stats.services++;
}

// Pages
const pagesDir = path.join(CONTENT_DIR, 'pages');
for (const f of fs.readdirSync(pagesDir)) {
  if (f.endsWith('.md') && fixMarkdownFile(path.join(pagesDir, f), 'pages')) stats.pages++;
}

// Experts (JSON)
const expertsDir = path.join(CONTENT_DIR, 'experts');
for (const f of fs.readdirSync(expertsDir)) {
  if (f.endsWith('.json') && fixJsonFile(path.join(expertsDir, f))) stats.experts++;
}

// Annonces (JSON) — fix pipe titles and seoTitle/seoDescription
const annoncesDir = path.join(CONTENT_DIR, 'annonces');
const annFiles = fs.readdirSync(annoncesDir);
for (const f of annFiles) {
  if (f.endsWith('.json') && fixJsonFile(path.join(annoncesDir, f))) stats.annonces++;
}

console.log('Fixed:', stats);
console.log(`Total files modified: ${Object.values(stats).reduce((a, b) => a + b, 0)}`);
