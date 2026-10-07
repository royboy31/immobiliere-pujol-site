import test from 'node:test';
import assert from 'node:assert/strict';

import { getSeventeeApplicationUrl, isCommercialRental } from '../src/lib/seventee.ts';

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

test('identifies only commercial rentals for direct listing-contact routing', () => {
  for (const propertyType of ['Local commercial', 'Bureau', 'Boutique', 'Entrepôt']) {
    assert.equal(isCommercialRental('L', propertyType), true, propertyType);
  }

  assert.equal(isCommercialRental('V', 'Local commercial'), false);
  assert.equal(isCommercialRental('L', 'Appartement'), false);
  assert.equal(isCommercialRental('L', 'Parking'), false);
});

test('renders Caroline’s approved Seventee copy and short button label', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../src/components/annonces/SeventeeApplication.astro', import.meta.url), 'utf8')
  );

  assert.match(source, /Ce bien vous intéresse \?/);
  assert.match(source, /Pour organiser une visite, merci de/);
  assert.match(source, /créer votre dossier de candidature/);
  assert.match(source, /plateforme <strong><u>Seventee<\/u><\/strong>, notre partenaire\./);
  assert.match(source, /Cliquez sur le bouton ci-dessous pour accéder à l'annonce, créer votre compte,/);
  assert.match(source, />\s*Déposer ma candidature\s*<\/a>/);
  assert.doesNotMatch(source, /Déposer ma candidature sur Seventee/);
  assert.match(source, /rel="noopener"/);
  assert.doesNotMatch(source, /rel="noopener noreferrer"/);
});
