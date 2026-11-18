import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  ConflictError, LP_PAGES, LP_SLOTS, defaultPhotoMap, discardPage, draftFromPrevious, duplicateGroups,
  ensureLpPhotosSchema, getPhotoMap, getSlotStates, posStyle, publishPage, saveDraft, sectionPhotoUses, validatePhoto,
} from '../src/lib/lp-photos.ts';

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

async function fresh() {
  const db = d1(new DatabaseSync(':memory:'));
  await ensureLpPhotosSchema(db);
  return db;
}

const up = (n) => ({ src: `/media/lp-proposition/${String(n).repeat(64).slice(0, 64)}.webp/`, w: 1600, h: 1067 });
const rev = async (db, id) => (await getSlotStates(db)).find((s) => s.id === id).revision;
const revisionsOf = async (db, page) =>
  Object.fromEntries((await getSlotStates(db)).filter((s) => s.page === page).map((s) => [s.id, s.revision]));

test('registry: 21 fixed slots over the 5 pages, ids unique, defaults are the committed photos', () => {
  assert.equal(LP_SLOTS.length, 21);
  assert.equal(new Set(LP_SLOTS.map((s) => s.id)).size, 21);
  assert.deepEqual(LP_PAGES.map((p) => p.id), ['accueil', 'deja-en-agence', 'je-gere-seul', 'premiere-location', 'coproprietaire']);
  assert.equal(LP_SLOTS.filter((s) => s.page === 'accueil').length, 8);
  for (const s of LP_SLOTS) assert.match(s.def.src, /^\/images\/services\/lp-proposition\/.+\.webp$/);
  // the committed framing that keeps Gaël's head in the crop is part of the default
  assert.equal(LP_SLOTS.find((s) => s.id === 'deja-en-agence-hero').def.pos, '50% 18%');
});

test('repo photos repeated across slots are reported (Caroline: no photo twice)', () => {
  assert.deepEqual(duplicateGroups(defaultPhotoMap()), []);
  const map = defaultPhotoMap();
  map['je-gere-seul-s1'] = map['accueil-hero'];
  assert.deepEqual(duplicateGroups(map), [['accueil-hero', 'je-gere-seul-s1']]);
});

test('validation: only our uploads or repo photos, sane sizes and framing', () => {
  assert.equal(typeof validatePhoto(up(1)), 'object');
  assert.equal(typeof validatePhoto({ ...up(1), src: 'https://evil.example/x.jpg' }), 'string');
  assert.equal(typeof validatePhoto({ ...up(1), src: '/media/blog/2026/x.webp/' }), 'string');
  assert.equal(typeof validatePhoto({ ...up(1), w: 50 }), 'string');
  assert.equal(typeof validatePhoto({ ...up(1), pos: '50% 18%' }), 'object');
  assert.equal(typeof validatePhoto({ ...up(1), pos: '50% 18%; background:red' }), 'string');
  assert.equal(typeof validatePhoto({ ...up(1), posMobile: '101% 0%' }), 'string');
});

test('empty table: visitors and preview both see the repo photos', async () => {
  const db = await fresh();
  assert.deepEqual(await getPhotoMap(db, 'published'), defaultPhotoMap());
  assert.deepEqual(await getPhotoMap(db, 'draft'), defaultPhotoMap());
});

test('round trip: replace, publish, go back to previous, publish, back to original', async () => {
  const db = await fresh();
  const id = 'je-gere-seul-hero';
  const original = defaultPhotoMap()[id];

  await saveDraft(db, id, { ...up('a'), pos: '40% 20%' }, 0, 'caroline@test');
  assert.equal((await getPhotoMap(db, 'published'))[id].src, original.src, 'draft is not public');
  assert.equal((await getPhotoMap(db, 'draft'))[id].src, up('a').src);

  assert.deepEqual(await publishPage(db, 'je-gere-seul', await revisionsOf(db, 'je-gere-seul'), 'caroline@test'), [id]);
  assert.deepEqual((await getPhotoMap(db, 'published'))[id], { ...up('a'), pos: '40% 20%' });

  await saveDraft(db, id, up('b'), await rev(db, id), 'caroline@test');
  await publishPage(db, 'je-gere-seul', await revisionsOf(db, 'je-gere-seul'), 'caroline@test');
  assert.equal((await getPhotoMap(db, 'published'))[id].src, up('b').src);

  await draftFromPrevious(db, id, await rev(db, id), 'caroline@test');
  await publishPage(db, 'je-gere-seul', await revisionsOf(db, 'je-gere-seul'), 'caroline@test');
  assert.deepEqual((await getPhotoMap(db, 'published'))[id], { ...up('a'), pos: '40% 20%' });

  await saveDraft(db, id, null, await rev(db, id), 'caroline@test');
  const state = (await getSlotStates(db)).find((s) => s.id === id);
  assert.equal(state.isDefault, true);
  assert.equal(state.pending, true);
  await publishPage(db, 'je-gere-seul', await revisionsOf(db, 'je-gere-seul'), 'caroline@test');
  assert.deepEqual(await getPhotoMap(db, 'published'), defaultPhotoMap());
});

test('publishing one page never publishes the drafts of another page', async () => {
  const db = await fresh();
  await saveDraft(db, 'accueil-step3', up('c'), 0, 'x');
  await saveDraft(db, 'coproprietaire-s2', up('d'), 0, 'x');
  await publishPage(db, 'accueil', await revisionsOf(db, 'accueil'), 'x');
  const pub = await getPhotoMap(db, 'published');
  assert.equal(pub['accueil-step3'].src, up('c').src);
  assert.equal(pub['coproprietaire-s2'].src, defaultPhotoMap()['coproprietaire-s2'].src);
  assert.equal((await getSlotStates(db)).find((s) => s.id === 'coproprietaire-s2').pending, true);
});

test('stale editors get a conflict instead of overwriting', async () => {
  const db = await fresh();
  await saveDraft(db, 'accueil-hero', up('e'), 0, 'tab1');
  await assert.rejects(saveDraft(db, 'accueil-hero', up('f'), 0, 'tab2'), ConflictError);
  assert.equal((await getPhotoMap(db, 'draft'))['accueil-hero'].src, up('e').src);
  // a publish prepared before another save on the same page is refused as a whole
  const seen = await revisionsOf(db, 'accueil');
  await saveDraft(db, 'accueil-final', up('7'), 0, 'tab2');
  await assert.rejects(publishPage(db, 'accueil', seen, 'tab1'), ConflictError);
  assert.equal((await getPhotoMap(db, 'published'))['accueil-hero'].src, defaultPhotoMap()['accueil-hero'].src);
});

test('discard restores the drafts of one page to what is online', async () => {
  const db = await fresh();
  await saveDraft(db, 'premiere-location-s1', up('8'), 0, 'x');
  await saveDraft(db, 'deja-en-agence-s1', up('9'), 0, 'x');
  assert.deepEqual(await discardPage(db, 'premiere-location', 'x'), ['premiere-location-s1']);
  const draft = await getPhotoMap(db, 'draft');
  assert.equal(draft['premiere-location-s1'].src, defaultPhotoMap()['premiere-location-s1'].src);
  assert.equal(draft['deja-en-agence-s1'].src, up('9').src);
});

test('saving the repo photo with its repo framing counts as no change', async () => {
  const db = await fresh();
  const id = 'deja-en-agence-hero';
  await saveDraft(db, id, defaultPhotoMap()[id], 0, 'x');
  assert.equal((await getSlotStates(db)).find((s) => s.id === id).pending, false);
});

test('unknown slots and pages are refused', async () => {
  const db = await fresh();
  await assert.rejects(saveDraft(db, 'home-hero', up(1), 0, 'x'), /inconnu/);
  await assert.rejects(publishPage(db, 'vente', {}, 'x'), /inconnue/);
});

test('framing style and section headings helpers', () => {
  assert.equal(posStyle({ src: '', w: 1, h: 1 }), undefined);
  assert.equal(posStyle({ src: '', w: 1, h: 1, pos: '50% 18%', posMobile: '68% 40%' }, true), '--hero-pos: 50% 18%; --hero-pos-mobile: 68% 40%');
  assert.equal(posStyle({ src: '', w: 1, h: 1, pos: '10% 20%' }), '--pos: 10% 20%');
  const blocks = [{ kind: 'cards', title: 'A' }, { kind: 'steps', title: 'S' }, { kind: 'cards', title: 'B' }, { kind: 'cards', title: 'C' }];
  assert.deepEqual(sectionPhotoUses(blocks, 2), [['A', 'C'], ['B']]);
});

test('both templates read the photos at request time and use every slot', async () => {
  const landing = await source('../src/pages/service-immobilier/gestion-locative-proposition/index.astro');
  const profile = await source('../src/pages/service-immobilier/gestion-locative-proposition/[profil].astro');
  for (const s of [landing, profile]) {
    assert.match(s, /export const prerender = false/);
    assert.match(s, /loadLpPhotos\(Astro\.request, Astro\.url\)/);
    assert.doesNotMatch(s, /LP_IMG\.|card\.img\.src|p\.img\.src/);
  }
  for (const id of ['accueil-hero', 'accueil-proofs', 'accueil-final']) assert.ok(landing.includes(`'${id}'`), id);
  assert.match(landing, /accueil-step\$\{n\}/);
  assert.match(landing, /\$\{p\.slug\}-hero/); // landing cards follow each profile's hero
  assert.match(profile, /\$\{card\.slug\}-s\$\{i \+ 1\}/);
});

test('admin endpoints are guarded and the photo API never touches the global publish', async () => {
  const api = await source('../src/pages/api/admin-pujol/photos/index.ts');
  const upload = await source('../src/pages/api/admin-pujol/photos/upload.ts');
  for (const s of [api, upload]) assert.match(s, /requireAdmin\(request\)/);
  assert.doesNotMatch(api, /publishArticles|publishExperts|publishPages|triggerDeploy/);
  assert.match(upload, /sniffImage\(bytes\)/);
  const runtime = await source('../src/lib/lp-photos-runtime.ts');
  assert.match(runtime, /wantsPreview && !!\(await requireAdmin\(request\)\)/);
});
