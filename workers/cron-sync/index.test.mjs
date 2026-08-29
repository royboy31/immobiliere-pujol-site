import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  ALERT_BEDROOM_MATCH_SQL,
  alertCandidateFromLbi,
  alertCandidateFromUbiflow,
  isLbiSale,
  isUbiflowRental,
  parseLbiInteger,
} from './index.ts';

test('matches studios safely and keeps numbered bedroom choices strict', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE alerts (id TEXT, chambres_min INTEGER)');
  const insert = db.prepare('INSERT INTO alerts VALUES (?, ?)');
  insert.run('any', null);
  insert.run('studio', 0);
  for (const bedrooms of [1, 2, 3, 4]) insert.run(String(bedrooms), bedrooms);

  const matchingIds = ({ kind, bedrooms, rooms }) => db.prepare(
    `SELECT id FROM alerts WHERE ${ALERT_BEDROOM_MATCH_SQL} ORDER BY id`,
  ).all(kind, bedrooms, bedrooms, rooms, bedrooms, bedrooms).map(({ id }) => id);

  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: 0, rooms: 1 }), ['any', 'studio']);
  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: null, rooms: 1 }), ['any', 'studio']);
  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: null, rooms: 3 }), ['any']);
  assert.deepEqual(matchingIds({ kind: 'parking', bedrooms: null, rooms: 1 }), ['any']);
  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: 1, rooms: 2 }), ['1', 'any']);
  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: 2, rooms: 3 }), ['2', 'any']);
  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: 3, rooms: 4 }), ['3', 'any']);
  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: 4, rooms: 5 }), ['4', 'any']);
  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: 5, rooms: 6 }), ['4', 'any']);
});

test('preserves an explicit zero bedroom count from the LBI feed', () => {
  assert.equal(parseLbiInteger('0'), 0);
  assert.equal(parseLbiInteger('3'), 3);
  assert.equal(parseLbiInteger(''), null);
});

test('normalizes an LBI sale into the fields consumed by the alert matcher', () => {
  assert.deepEqual(alertCandidateFromLbi({
    slug: 'vente-test',
    typeAnnonce: 'V',
    titre: 'Appartement T3',
    typeBien: 'Appartement',
    codePostal: '13008',
    ville: 'Marseille',
    prix: 325000,
    nbPieces: 3,
    nbChambres: 2,
  }), {
    slug: 'vente-test',
    type: 'V',
    title: 'Appartement T3',
    kindLabel: 'Appartement',
    codePostal: '13008',
    ville: 'Marseille',
    price: 325000,
    bedrooms: 2,
    rooms: 3,
  });
});

test('normalizes an Ubiflow rental using its rent including charges', () => {
  assert.deepEqual(alertCandidateFromUbiflow({
    slug: 'location-test',
    type: 'L',
    titre: 'Studio meublé',
    libelleType: 'Studio',
    codePostal: '13006',
    ville: 'Marseille',
    prix: null,
    loyerCC: 780,
    nbPieces: 1,
    nbChambres: 1,
  }), {
    slug: 'location-test',
    type: 'L',
    title: 'Studio meublé',
    kindLabel: 'Studio',
    codePostal: '13006',
    ville: 'Marseille',
    price: 780,
    bedrooms: 1,
    rooms: 1,
  });
});

test('ignores an Ubiflow sale for alert matching', () => {
  assert.equal(alertCandidateFromUbiflow({ type: 'V' }), null);
});

test('ignores an LBI rental for alert matching', () => {
  assert.equal(alertCandidateFromLbi({ typeAnnonce: 'L' }), null);
});

test('accepts only rentals from the Ubiflow import', () => {
  assert.equal(isUbiflowRental({ type: 'L' }), true);
  assert.equal(isUbiflowRental({ type: 'V' }), false);
});

test('accepts only sales from the LBI import', () => {
  assert.equal(isLbiSale({ typeAnnonce: 'V' }), true);
  assert.equal(isLbiSale({ typeAnnonce: 'L' }), false);
});
