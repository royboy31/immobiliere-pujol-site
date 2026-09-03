import test from 'node:test';
import assert from 'node:assert/strict';

import { wrapImagePairs } from '../src/lib/article-body.ts';

test('an image inside a list paragraph stays inside that paragraph', () => {
  const html = '<p>Intro</p><ul><li><p>Illustration avec cet exemple : <a href="https://example.com">vidéo</a><img src="/image.png" alt=""></p><p></p></li><li><p>Deuxième puce</p></li></ul><h2>Section suivante</h2><p>Suite.</p>';

  const result = wrapImagePairs(html);

  assert.equal(result, html);
  assert.doesNotMatch(result, /article-pair/);
  assert.match(result, /<\/ul><h2>Section suivante<\/h2>/);
});

test('a top-level image with caption content still becomes an article pair', () => {
  const html = '<p>Intro</p><img src="/image.png" alt=""><p>Une légende suffisamment longue.</p><h2>Section suivante</h2>';

  const result = wrapImagePairs(html);

  assert.match(result, /article-pair article-pair--left/);
  assert.match(result, /<div class="article-pair__body"><p>Une légende suffisamment longue.<\/p><\/div>/);
  assert.match(result, /<\/aside><h2>Section suivante<\/h2>/);
});
