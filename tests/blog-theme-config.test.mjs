import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { BLOG_THEMES } from '../src/lib/blog-db.ts';

test('the editor offers Caroline\'s new category and the hidden archive', () => {
  const labels = BLOG_THEMES.map((theme) => theme.label);

  assert.ok(labels.includes('Copropriété'));
  assert.ok(labels.includes('Archives'));
  assert.ok(labels.includes('Prix au m² par arrondissement'));
  assert.ok(!labels.includes("L'immobilier neuf"));
});

test('the blog home promotes copropriété only when populated and omits arrondissement', async () => {
  const source = await readFile(new URL('../src/pages/blog-immobilier-marseille.astro', import.meta.url), 'utf8');

  assert.match(source, /slug: 'copropriete'/);
  assert.doesNotMatch(source, /slug: 'prix-immo-arrondissement'/);
  assert.match(source, /\.filter\(p => p\.count > 0\)/);
});
