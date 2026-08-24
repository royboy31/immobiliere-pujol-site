import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertCandidateFromLbi,
  alertCandidateFromUbiflow,
  isLbiSale,
  isUbiflowRental,
} from './index.ts';

test('normalizes an LBI sale into the fields consumed by the alert matcher', () => {
  assert.deepEqual(alertCandidateFromLbi({
    slug: 'vente-test',
    typeAnnonce: 'V',
    titre: 'Appartement T3',
    typeBien: 'Appartement',
    codePostal: '13008',
    ville: 'Marseille',
    prix: 325000,
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
