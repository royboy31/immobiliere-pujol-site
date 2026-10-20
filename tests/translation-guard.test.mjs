import test from 'node:test';
import assert from 'node:assert/strict';

import { hasBrowserTranslation, TranslatedContentError } from '../src/lib/translation-guard.ts';
import { updateExpert, createExpert } from '../src/lib/experts-db.ts';
import { updateArticle, createArticle } from '../src/lib/blog-db.ts';

// Real payload shape saved for Thibault Arnoux on 17/07 (Chrome translating the editor).
const CHROME_TRANSLATED = '<p class="expert-bio-quote"><font dir="auto" style="vertical-align: inherit;"><font dir="auto" style="vertical-align: inherit;">"Trust is built."</font></font></p>';
const EDGE_TRANSLATED = '<p _msttexthash="12345" _msthash="7">Trust is built.</p>';
const FRENCH = '<p class="expert-bio-quote">« La confiance se construit. »</p><p><font color="#333">texte</font></p>';

// Any database access means the save went through.
const untouchableDb = () => {
  const db = { calls: 0, prepare() { db.calls += 1; throw new Error('database must not be touched'); } };
  return db;
};

test('detects Chrome and Edge translation markup, anywhere in the payload', () => {
  assert.equal(hasBrowserTranslation(CHROME_TRANSLATED), true);
  assert.equal(hasBrowserTranslation(EDGE_TRANSLATED), true);
  assert.equal(hasBrowserTranslation({ title: 'x', nested: [{ body: CHROME_TRANSLATED }] }), true);
});

test('normal French content, including other <font> tags, is accepted', () => {
  assert.equal(hasBrowserTranslation(FRENCH), false);
  assert.equal(hasBrowserTranslation({ description: FRENCH, hidden: false, sort_order: 3, email_aliases: [] }), false);
});

test('a translated expert save is rejected before the row is touched', async () => {
  for (const save of [
    (db) => updateExpert(db, 26, { description: CHROME_TRANSLATED }),
    (db) => createExpert(db, { title: 'X', description: EDGE_TRANSLATED }, 'admin@example.com'),
  ]) {
    const db = untouchableDb();
    await assert.rejects(save(db), TranslatedContentError);
    assert.equal(db.calls, 0);
  }
});

test('translated article saves are rejected before the row is touched', async () => {
  for (const save of [
    (db) => updateArticle(db, 1, { body_html: CHROME_TRANSLATED }),
    (db) => createArticle(db, { title: 'X', body_html: CHROME_TRANSLATED }, 'admin@example.com'),
  ]) {
    const db = untouchableDb();
    await assert.rejects(save(db), TranslatedContentError);
    assert.equal(db.calls, 0);
  }
});

test('the rejection tells the editor what to do', () => {
  assert.match(new TranslatedContentError().message, /traduction/);
  assert.match(new TranslatedContentError().message, /rechargez/);
});
