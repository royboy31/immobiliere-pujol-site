import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('restores the rental enquiry and information-form instructions before Seventee', async () => {
  const source = await readFile(
    new URL('../workers/email/index.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /faire votre demande directement depuis l'annonce concernée\. Un email vous sera alors envoyé afin de compléter une fiche de renseignements/,
  );
  assert.doesNotMatch(
    source,
    /en cliquant sur « Déposer ma candidature »/,
  );
});
