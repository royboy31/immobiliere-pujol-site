import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  countPendingArticles,
  deleteArticle,
  ensureSchema,
  listArticles,
  listDeletedArticles,
  listPendingArticleChanges,
  publishArticles,
  restoreArticle,
} from '../src/lib/blog-db.ts';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function d1(db) {
  return {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...next) { values = next; return statement; },
        async run() {
          const result = db.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } };
        },
        async first() { return db.prepare(sql).get(...values) || null; },
        async all() { return { results: db.prepare(sql).all(...values) }; },
      };
      return statement;
    },
  };
}

test('trash, restore and publish preserve the intended lifecycle', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const db = d1(sqlite);
  await ensureSchema(db);
  sqlite.prepare(
    `INSERT INTO blog_articles
       (id, slug, title, status, published_at, published_json)
     VALUES (1, 'article-test', 'Article test', 'published', '2099-01-01T00:00:00.000Z', '{"slug":"article-test"}')`
  ).run();

  assert.equal(await deleteArticle(db, 1), true);
  assert.equal((await listArticles(db)).length, 0);
  assert.equal((await listDeletedArticles(db)).length, 1);
  assert.equal(await countPendingArticles(db), 1);
  assert.deepEqual(await listPendingArticleChanges(db), [
    { id: 1, slug: 'article-test', title: 'Article test', action: 'remove' },
  ]);

  assert.equal(await restoreArticle(db, 1), true);
  assert.equal(await countPendingArticles(db), 0);

  await deleteArticle(db, 1);
  await publishArticles(db);
  assert.equal(sqlite.prepare('SELECT published_json FROM blog_articles WHERE id = 1').get().published_json, null);
  assert.equal(await countPendingArticles(db), 0);

  await restoreArticle(db, 1);
  assert.deepEqual(await listPendingArticleChanges(db), [
    { id: 1, slug: 'article-test', title: 'Article test', action: 'online' },
  ]);
  await publishArticles(db);
  assert.equal(await countPendingArticles(db), 0);
  assert.equal(JSON.parse(sqlite.prepare('SELECT published_json FROM blog_articles WHERE id = 1').get().published_json).slug, 'article-test');
});

test('article deletion is reversible and publish-gated', async () => {
  const db = await source('../src/lib/blog-db.ts');

  assert.match(db, /deleted_at TEXT/);
  assert.match(db, /SET deleted_at = datetime\('now'\)/);
  assert.doesNotMatch(db, /DELETE FROM blog_articles WHERE id/);
  assert.match(db, /SET deleted_at = NULL/);
  assert.match(db, /WHERE deleted_at IS NULL AND status = 'published'/);
  assert.match(db, /WHERE status = 'draft' OR deleted_at IS NOT NULL/);
});

test('active and trashed articles are separated throughout the admin workflow', async () => {
  const [db, page, restoreRoute] = await Promise.all([
    source('../src/lib/blog-db.ts'),
    source('../src/pages/admin-pujol/articles/index.astro'),
    source('../src/pages/api/admin-pujol/articles/[id]/restore.ts'),
  ]);

  assert.match(db, /export async function listDeletedArticles/);
  assert.match(db, /WHERE deleted_at IS NULL\n     ORDER BY/);
  assert.match(db, /WHERE deleted_at IS NOT NULL\n     ORDER BY/);
  assert.match(page, />Corbeille \(\{deletedArticles\.length\}\)</);
  assert.match(page, /data-restore=\{a\.id\}/);
  assert.match(page, /L’article restera en ligne jusqu’à la prochaine publication/);
  assert.doesNotMatch(page, /Cette action est définitive/);
  assert.match(restoreRoute, /restoreArticle/);
});

test('publication preview and site search respect the published trash state', async () => {
  const [db, search] = await Promise.all([
    source('../src/lib/blog-db.ts'),
    source('../src/pages/api/search.ts'),
  ]);

  assert.match(db, /deleted_at IS NOT NULL AND published_json IS NOT NULL/);
  assert.match(db, /CASE WHEN deleted_at IS NOT NULL OR status = 'draft' THEN 'remove'/);
  assert.match(search, /WHERE published_json IS NOT NULL AND json_valid\(published_json\)/);
  assert.match(search, /json_extract\(published_json, '\$\.slug'\) AS slug/);
  assert.doesNotMatch(search, /WHERE status = 'published'/);
});
