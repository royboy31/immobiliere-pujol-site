import test from 'node:test';
import assert from 'node:assert/strict';

import { getSeventeeApplicationUrl } from '../src/lib/seventee.ts';

test('builds Seventee URLs for residential and parking rentals', () => {
  const eligibleTypes = ['Studio', 'T3', 'Appartement', 'Maison', 'Villa', 'Garage individuel', 'Parking couvert', 'Box'];

  for (const propertyType of eligibleTypes) {
    assert.equal(
      getSeventeeApplicationUrl('L', propertyType, '1301neot'),
      'https://candidate.seventee.com/agencies/pujol/offers/1301neot',
    );
  }
});

test('keeps the contact form for sales, commercial rentals, and missing references', () => {
  assert.equal(getSeventeeApplicationUrl('V', 'Appartement', '1301neot'), null);
  assert.equal(getSeventeeApplicationUrl('L', 'Local commercial', '632neot'), null);
  assert.equal(getSeventeeApplicationUrl('L', 'Bureau', '409neot'), null);
  assert.equal(getSeventeeApplicationUrl('L', 'Appartement', null), null);
  assert.equal(getSeventeeApplicationUrl('L', 'Appartement', '  '), null);
});

test('trims and safely encodes the listing reference', () => {
  assert.equal(
    getSeventeeApplicationUrl('L', 'Appartement', ' REF 42/A '),
    'https://candidate.seventee.com/agencies/pujol/offers/REF%2042%2FA',
  );
});
