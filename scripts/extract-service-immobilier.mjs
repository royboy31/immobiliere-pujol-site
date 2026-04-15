/**
 * Extract /service-immobilier/ pages from the WordPress services CSV export
 * and create content collection files for the serviceImmobilier collection.
 */

import fs from 'fs';
import path from 'path';

const CSV_FILE = '../Export/Tous-les-services-Export-2026-April-01-1230.csv';
const OUTPUT_DIR = 'src/content/serviceImmobilier';

// Read CSV
const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
const lines = csvContent.split('\n');

// Parse CSV (simple — fields are comma-separated, quoted)
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && !inQuotes) { inQuotes = true; continue; }
    if (c === '"' && inQuotes) {
      if (line[i + 1] === '"') { current += '"'; i++; continue; }
      inQuotes = false; continue;
    }
    if (c === ',' && !inQuotes) { fields.push(current); current = ''; continue; }
    current += c;
  }
  fields.push(current);
  return fields;
}

// Get header
const header = parseCSVLine(lines[0].replace(/^\uFEFF/, '')); // Strip BOM

// Find service-immobilier entries
const entries = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const fields = parseCSVLine(lines[i]);
  const permalink = fields[1] || '';
  if (!permalink.includes('/service-immobilier/')) continue;

  const urlMatch = permalink.match(/\/service-immobilier\/([^/]+)\/?$/);
  if (!urlMatch) continue;

  const slug = urlMatch[1];
  const name = fields[2] || '';
  const description = fields[4] || '';
  const subtitle = fields[15] || ''; // services_subtitle
  const content = fields[16] || '';   // services_content
  const heroImage = fields[17] || ''; // services_image
  const btnText = fields[18] || '';   // btn_text
  const seoTitle = fields[20] || '';
  const seoDescription = fields[13] || ''; // or another field

  entries.push({ slug, name, description, subtitle, content, heroImage, btnText, seoTitle, seoDescription });
}

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Write markdown files
let count = 0;
for (const entry of entries) {
  const title = entry.name || entry.seoTitle || entry.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Decode HTML entities
  const cleanTitle = title
    .replace(/&rsquo;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç');

  const frontmatter = [
    '---',
    `title: "${cleanTitle.replace(/"/g, '\\"')}"`,
    `slug: "${entry.slug}"`,
    entry.subtitle ? `subtitle: "${entry.subtitle.replace(/"/g, '\\"')}"` : null,
    entry.heroImage ? `heroImage: "${entry.heroImage}"` : null,
    entry.btnText ? `ctaText: "${entry.btnText.replace(/"/g, '\\"')}"` : null,
    entry.seoTitle ? `seoTitle: "${entry.seoTitle.replace(/"/g, '\\"')}"` : null,
    entry.seoDescription ? `seoDescription: "${entry.seoDescription.replace(/"/g, '\\"')}"` : null,
    '---',
  ].filter(Boolean).join('\n');

  const body = entry.content || entry.description || '';
  const filename = `${entry.slug}.md`;
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), `${frontmatter}\n\n${body}\n`);
  count++;
}

console.log(`Extracted ${count} service-immobilier pages to ${OUTPUT_DIR}/`);
console.log('Files:', fs.readdirSync(OUTPUT_DIR).join(', '));
