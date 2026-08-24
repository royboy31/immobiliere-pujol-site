import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRelatedArticles } from '../src/lib/blog-related.ts';
import { pendingPreviewCount, pendingPreviewToken, resolveArticleStatus } from '../src/lib/blog-workflow.ts';

test('normal saves preserve draft and published status', () => {
  assert.equal(resolveArticleStatus('draft', 'preserve'), 'draft');
  assert.equal(resolveArticleStatus('published', 'preserve'), 'published');
  assert.equal(resolveArticleStatus('published', undefined), 'published');
});

test('only explicit actions change article status', () => {
  assert.equal(resolveArticleStatus('draft', 'publish'), 'published');
  assert.equal(resolveArticleStatus('published', 'draft'), 'draft');
  assert.throws(() => resolveArticleStatus('draft', 'published'), /invalide/);
});

test('publication preview token changes when a reviewed action changes', () => {
  const preview = {
    articles: [{ id: 7, slug: 'article', title: 'Article', action: 'online' }],
    experts: [{ id: 2, slug: 'caroline', title: 'Caroline' }],
    pages: [],
  };
  assert.equal(pendingPreviewCount(preview), 2);
  assert.notEqual(
    pendingPreviewToken(preview),
    pendingPreviewToken({ ...preview, articles: [{ ...preview.articles[0], action: 'remove' }] }),
  );
});

test('curated links keep their order and newest articles fill remaining slots', () => {
  const articles = [
    { slug: 'newest', title: 'Newest', date: '2026-08-20' },
    { slug: 'chosen-old', title: 'Chosen old', date: '2020-01-01' },
    { slug: 'second', title: 'Second', date: '2026-08-10' },
    { slug: 'third', title: 'Third', date: '2026-08-01' },
  ];
  assert.deepEqual(
    buildRelatedArticles(articles, 'current', ['chosen-old'], 3).map((article) => article.slug),
    ['chosen-old', 'newest', 'second'],
  );
});

test('related links skip current, local, missing and duplicate curated slugs', () => {
  const articles = [
    { slug: 'current', title: 'Current', date: '2026-08-24' },
    { slug: 'local/seo', title: 'SEO', date: '2026-08-23' },
    { slug: 'valid', title: 'Valid', date: '2026-08-22' },
    { slug: 'fallback', title: 'Fallback', date: '2026-08-21' },
  ];
  assert.deepEqual(
    buildRelatedArticles(articles, 'current', ['missing', 'valid', 'valid', 'local/seo'], 6).map((article) => article.slug),
    ['valid', 'fallback'],
  );
});

test('all curated links remain visible when Caroline selects more than the default limit', () => {
  const articles = Array.from({ length: 8 }, (_, index) => ({
    slug: `chosen-${index + 1}`,
    title: `Chosen ${index + 1}`,
    date: `2026-08-${String(20 - index).padStart(2, '0')}`,
  }));
  const curated = articles.map((article) => article.slug).reverse();
  assert.deepEqual(
    buildRelatedArticles(articles, 'current', curated, 6).map((article) => article.slug),
    curated,
  );
});
