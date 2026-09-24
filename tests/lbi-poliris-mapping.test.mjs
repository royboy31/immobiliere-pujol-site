import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildLbiUpsertStmt, parseLbiCsv } from '../workers/cron-sync/index.ts';
import { isExclusiveMandate } from '../src/lib/listing-status.ts';

function saleRow(overrides = {}) {
  const fields = Array(335).fill('');
  fields[1] = 'TEST-MAISON';
  fields[2] = 'Vente';
  fields[3] = 'maison/villa';
  fields[4] = '13012';
  fields[5] = 'Marseille';
  fields[10] = '650000';
  fields[19] = 'Maison test';
  fields[20] = 'Description test';
  fields[38] = '2';       // field 39: NB balcons
  fields[40] = 'OUI';     // field 41: ascenseur
  fields[41] = 'OUI';     // field 42: cave
  fields[42] = '1';       // field 43: NB parkings
  fields[45] = 'OUI';     // field 46: interphone
  fields[47] = 'OUI';     // field 48: terrasse
  fields[82] = 'OUI';     // field 83: mandat en exclusivité
  fields[111] = '6400';
  fields[135] = 'Actif';
  for (const [index, value] of Object.entries(overrides)) fields[Number(index)] = value;
  return fields.map((value) => `"${value}"`).join('!#');
}

test('the LBI parser follows the Poliris amenity and exclusivity columns', () => {
  const [annonce] = parseLbiCsv(saleRow());

  assert.equal(annonce.mandatType, 'exclusif');
  assert.equal(annonce.balcon, true);
  assert.equal(annonce.ascenseur, true);
  assert.equal(annonce.cave, true);
  assert.equal(annonce.parking, true);
  assert.equal(annonce.interphone, true);
  assert.equal(annonce.terrasse, true);
});

test('NON maps to the shared simple mandate enum', () => {
  const [annonce] = parseLbiCsv(saleRow({ 82: 'NON' }));
  assert.equal(annonce.mandatType, 'simple');
  assert.equal(isExclusiveMandate(annonce.mandatType), false);
  assert.equal(isExclusiveMandate(' EXCLUSIF '), true);
});

test('the D1 upsert persists mandat_type with one bind per placeholder', () => {
  const [annonce] = parseLbiCsv(saleRow());
  let sql = '';
  let args = [];
  const db = {
    prepare(value) {
      sql = value;
      return { bind: (...values) => { args = values; return { sql, args }; } };
    },
  };

  buildLbiUpsertStmt(db, annonce, '2026-09-24T10:00:00.000Z');

  assert.match(sql, /mandat_numero, mandat_type, url_visite_virtuelle/);
  assert.match(sql, /mandat_type=excluded\.mandat_type/);
  assert.equal((sql.match(/\?/g) || []).length, args.length);
  assert.ok(args.includes('exclusif'));
});

test('the manual importer copy uses the same Poliris positions', async () => {
  const source = await readFile(new URL('../scripts/import-lbi-ftp.mjs', import.meta.url), 'utf8');
  assert.match(source, /balcon: \(parseInt\(f\[38\]\) \|\| 0\) > 0/);
  assert.match(source, /ascenseur: f\[40\] === 'OUI'/);
  assert.match(source, /cave: f\[41\] === 'OUI'/);
  assert.match(source, /parking: \(parseInt\(f\[42\]\) \|\| 0\) > 0/);
  assert.match(source, /interphone: f\[45\] === 'OUI'/);
  assert.match(source, /terrasse: f\[47\] === 'OUI'/);
  assert.match(source, /mandatType: f\[82\] === 'OUI' \? 'exclusif'/);
});
