import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { ALERT_BEDROOM_MATCH_SQL, describeCriteria, normalizeBedroomCriterion } from './alerts-db.ts';

test('normalizes the closed bedroom choices without collapsing Studio', () => {
  assert.equal(normalizeBedroomCriterion(''), null);
  assert.equal(normalizeBedroomCriterion('0'), 0);
  assert.equal(normalizeBedroomCriterion('1'), 1);
  assert.equal(normalizeBedroomCriterion('3'), 3);
  assert.equal(normalizeBedroomCriterion('4'), 4);
  assert.equal(normalizeBedroomCriterion('5'), 4);
  assert.equal(normalizeBedroomCriterion('-1'), null);
  assert.equal(normalizeBedroomCriterion('studio'), null);
});

test('describes Studio distinctly from an indifferent bedroom criterion', () => {
  const common = {
    transac: 'L',
    kind: 'appartement',
    cp: '13006',
    budget_max: 850,
  };

  assert.equal(
    describeCriteria({ ...common, chambres_min: 0 }),
    'Location · Appartement · 13006 · Studio · budget max 850 €',
  );
  assert.equal(
    describeCriteria({ ...common, chambres_min: null }),
    'Location · Appartement · 13006 · budget max 850 €',
  );
});

test('main-app matcher uses the same safe Studio boundary as the cron worker', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE alerts (id TEXT, chambres_min INTEGER)');
  const insert = db.prepare('INSERT INTO alerts VALUES (?, ?)');
  insert.run('any', null);
  insert.run('studio', 0);
  insert.run('two', 2);

  const matchingIds = ({ kind, bedrooms, rooms }) => db.prepare(
    `SELECT id FROM alerts WHERE ${ALERT_BEDROOM_MATCH_SQL} ORDER BY id`,
  ).all(kind, bedrooms, bedrooms, rooms, bedrooms, bedrooms).map(({ id }) => id);

  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: null, rooms: 1 }), ['any', 'studio']);
  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: null, rooms: 3 }), ['any']);
  assert.deepEqual(matchingIds({ kind: 'parking', bedrooms: null, rooms: 1 }), ['any']);
  assert.deepEqual(matchingIds({ kind: 'appartement', bedrooms: 2, rooms: 3 }), ['any', 'two']);
});
