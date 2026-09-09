import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseBulkCategoryRequest } from '../src/lib/blog-bulk-categories.ts';

const categories = ['Copropriété', 'Archives', 'Avant/après'];

test('bulk category requests accept only unique positive article ids and a known category', () => {
  assert.deepEqual(
    parseBulkCategoryRequest({ ids: [7, 12], operation: 'add', category: 'Copropriété' }, categories),
    { ids: [7, 12], operation: 'add', category: 'Copropriété' },
  );
  assert.throws(
    () => parseBulkCategoryRequest({ ids: [7, 7], operation: 'add', category: 'Copropriété' }, categories),
    /Sélection invalide/,
  );
  assert.throws(
    () => parseBulkCategoryRequest({ ids: [7], operation: 'add', category: 'Inconnue' }, categories),
    /Catégorie invalide/,
  );
});

test('the category-only endpoint rejects date and status fields', () => {
  assert.throws(
    () => parseBulkCategoryRequest({ ids: [7], operation: 'replace', category: 'Archives', article_date: '2026-09-09' }, categories),
    /champ non autorisé/,
  );
  assert.throws(
    () => parseBulkCategoryRequest({ ids: [7], operation: 'replace', category: 'Archives', status: 'published' }, categories),
    /champ non autorisé/,
  );
});

test('the admin list shows and sorts by publication date and exposes bulk controls', async () => {
  const [page, db] = await Promise.all([
    readFile(new URL('../src/pages/admin-pujol/articles/index.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/blog-db.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(page, /<th>Parution<\/th>/);
  assert.match(page, /fmt\(a\.article_date\)/);
  assert.match(page, /id="art-select-visible"/);
  assert.match(page, /id="art-bulk-operation"/);
  assert.match(page, /bulk-categories/);
  assert.match(db, /date\(article_date\) DESC/);
  assert.match(db, /input\.article_date\.trim\(\)/);
});
