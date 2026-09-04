import test from 'node:test';
import assert from 'node:assert/strict';

import { isVisibleBlogCategory, slugifyBlogCategory } from '../src/lib/blog-categories.ts';

test('the obsolete new-build category is hidden regardless of accents or case', () => {
  assert.equal(isVisibleBlogCategory("L'immobilier neuf à Marseille"), false);
  assert.equal(isVisibleBlogCategory("L'IMMOBILIER NEUF A MARSEILLE"), false);
});

test('current editorial categories remain visible', () => {
  assert.equal(isVisibleBlogCategory('Le marché immobilier à Marseille'), true);
  assert.equal(isVisibleBlogCategory('Prix au m² par arrondissement'), true);
  assert.equal(slugifyBlogCategory('Mon quartier, ma ville'), 'mon-quartier-ma-ville');
});
