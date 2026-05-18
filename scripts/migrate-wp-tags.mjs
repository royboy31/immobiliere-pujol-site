#!/usr/bin/env node
/**
 * migrate-wp-tags.mjs
 *
 * Fetches all tags and per-post tag assignments from the live WordPress REST API,
 * then patches article markdown files in src/content/articles/ to populate the
 * `tags` frontmatter field.
 *
 * Usage:
 *   node scripts/migrate-wp-tags.mjs            # actual run
 *   node scripts/migrate-wp-tags.mjs --dry-run   # preview only
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const WP_BASE = 'https://www.immobiliere-pujol.fr/wp-json/wp/v2';
const ARTICLES_DIR = join(process.cwd(), 'src/content/articles');
const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 200; // polite delay between API pages

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAllPages(endpoint) {
  const results = [];
  let page = 1;
  while (true) {
    const url = `${WP_BASE}/${endpoint}&page=${page}`;
    console.log(`  Fetching ${url}`);
    const resp = await fetch(url);
    if (!resp.ok) {
      if (resp.status === 400 || resp.status === 404) break; // past last page
      throw new Error(`HTTP ${resp.status} for ${url}`);
    }
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    const totalPages = parseInt(resp.headers.get('X-WP-TotalPages') || '1');
    if (page >= totalPages) break;
    page++;
    await sleep(DELAY_MS);
  }
  return results;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // Step 1: Fetch all WP tags
  console.log('\n1. Fetching all WP tags...');
  const wpTags = await fetchAllPages('tags?per_page=100');
  console.log(`   Found ${wpTags.length} tags`);

  // Build tag ID → name map
  const tagIdToName = new Map();
  for (const t of wpTags) {
    tagIdToName.set(t.id, t.name);
  }

  // Step 2: Fetch all posts with their tag IDs
  console.log('\n2. Fetching all WP posts with tag assignments...');
  const wpPosts = await fetchAllPages('posts?_fields=id,slug,tags&per_page=100');
  console.log(`   Found ${wpPosts.length} posts`);

  // Build slug → tag names map
  const slugToTags = new Map();
  let postsWithTags = 0;
  for (const post of wpPosts) {
    if (post.tags && post.tags.length > 0) {
      const tagNames = post.tags
        .map((id) => tagIdToName.get(id))
        .filter(Boolean);
      if (tagNames.length > 0) {
        slugToTags.set(post.slug, tagNames);
        postsWithTags++;
      }
    }
  }
  console.log(`   ${postsWithTags} posts have tags`);

  // Step 3: Patch article MD files
  console.log('\n3. Patching article markdown files...');
  const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));
  console.log(`   ${files.length} article files found`);

  let patched = 0;
  let skipped = 0;
  let noMatch = 0;
  let alreadyHasTags = 0;

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const filePath = join(ARTICLES_DIR, file);
    const content = readFileSync(filePath, 'utf-8');

    // Check if this article has WP tags
    const newTags = slugToTags.get(slug);
    if (!newTags) {
      noMatch++;
      continue;
    }

    // Check if tags are already populated (non-empty)
    const tagsMatch = content.match(/^tags:\s*\[([^\]]*)\]/m);
    if (tagsMatch && tagsMatch[1].trim().length > 0) {
      alreadyHasTags++;
      continue;
    }

    // Build the replacement tags line
    const tagsJson = JSON.stringify(newTags);
    let updated;

    if (tagsMatch) {
      // Replace existing empty tags: []
      updated = content.replace(/^tags:\s*\[\s*\]/m, `tags: ${tagsJson}`);
    } else {
      // No tags field — add after categories line or at end of frontmatter
      const catMatch = content.match(/^categories:.*$/m);
      if (catMatch) {
        updated = content.replace(
          catMatch[0],
          `${catMatch[0]}\ntags: ${tagsJson}`
        );
      } else {
        // Add before closing ---
        updated = content.replace(/^---\s*$/m, (match, offset) => {
          // Only replace the second --- (end of frontmatter)
          const before = content.substring(0, offset);
          if (before.includes('---')) {
            return `tags: ${tagsJson}\n---`;
          }
          return match;
        });
      }
    }

    if (updated === content) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`   [DRY] ${slug}: would add ${newTags.length} tags: ${newTags.join(', ')}`);
    } else {
      writeFileSync(filePath, updated, 'utf-8');
    }
    patched++;
  }

  console.log('\n=== RESULTS ===');
  console.log(`  WP tags found:       ${wpTags.length}`);
  console.log(`  WP posts with tags:  ${postsWithTags}`);
  console.log(`  Articles patched:    ${patched}`);
  console.log(`  Already had tags:    ${alreadyHasTags}`);
  console.log(`  No WP match:         ${noMatch}`);
  console.log(`  Skipped (no change): ${skipped}`);
  if (DRY_RUN) console.log('\n  (DRY RUN — no files were modified)');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
