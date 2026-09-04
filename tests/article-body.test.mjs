import test from 'node:test';
import assert from 'node:assert/strict';

import { optimizeArticleBodyImages, optimizeBlogImageUrl, wrapImagePairs } from '../src/lib/article-body.ts';

const imageOptions = {
  enabled: true,
  site: 'https://www.immobiliere-pujol.fr',
  width: 1200,
};

test('an uploaded blog image is served through Cloudflare image resizing', () => {
  const result = optimizeBlogImageUrl('/media/blog/2026/large-image.png/', imageOptions);

  assert.equal(
    result,
    '/cdn-cgi/image/width=1200,quality=80,format=auto,onerror=redirect/https://www.immobiliere-pujol.fr/media/blog/2026/large-image.png/',
  );
});

test('article body optimization only rewrites same-site blog uploads', () => {
  const html = '<img src="/media/blog/2026/large.png/"><img src="/images/logo.png"><img src="https://example.com/photo.png">';
  const result = optimizeArticleBodyImages(html, imageOptions);

  assert.match(result, /cdn-cgi\/image\/width=1200/);
  assert.match(result, /src="\/images\/logo\.png"/);
  assert.match(result, /src="https:\/\/example\.com\/photo\.png"/);
});

test('image optimization remains disabled on staging builds', () => {
  assert.equal(
    optimizeBlogImageUrl('/media/blog/2026/large.png/', { ...imageOptions, enabled: false }),
    '/media/blog/2026/large.png/',
  );
});

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
