import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

// The paste/broom cleaner lives in ArticleEditor's inline script and needs a
// real DOM, so its source is lifted out of the component and run in Chrome.
const src = readFileSync(new URL('../src/components/admin/ArticleEditor.astro', import.meta.url), 'utf8');
const start = src.indexOf('  // ── Paste cleanup ──');
const end = src.indexOf("  body.addEventListener('paste'");
assert.ok(start > 0 && end > start, 'cleaner block not found in ArticleEditor.astro');
const cleanerSource = src.slice(start, end);

let browser, page;
test.before(async () => {
  browser = await puppeteer.launch({ headless: true });
  page = await browser.newPage();
  await page.addScriptTag({ content: `${cleanerSource}\nwindow.cleanHtml = cleanHtml;` });
});
test.after(async () => { await browser?.close(); });

const clean = (html) => page.evaluate((h) => window.cleanHtml(h), html);

// Shape saved in article 1059 on 27/10: a heading holding whole paragraphs and lists.
const SECTION_IN_H2 = '<p>Intro.</p><h2>Assurance immeuble en copropriété : comment savoir ?<p>Un dégât des eaux, un <b>incendie</b>…</p><p>Voir <a href="https://www.immobiliere-pujol.fr/">notre agence</a>.</p><ul><li>Point 1</li><li>Point 2</li></ul></h2><h2>Vrai intertitre</h2><p>Suite.</p>';

test('a heading holding paragraphs and lists keeps its title and releases the blocks in order', async () => {
  assert.equal(await clean(SECTION_IN_H2),
    '<p>Intro.</p><h2>Assurance immeuble en copropriété : comment savoir ?</h2>'
    + '<p>Un dégât des eaux, un <b>incendie</b>…</p>'
    + '<p>Voir <a href="https://www.immobiliere-pujol.fr/">notre agence</a>.</p>'
    + '<ul><li>Point 1</li><li>Point 2</li></ul><h2>Vrai intertitre</h2><p>Suite.</p>');
});

test('legitimate headings are left alone, long ones included', async () => {
  const long = '<h2>' + 'Un intertitre très long mais légitime '.repeat(8).trim() + '</h2><h3>Court</h3><p>Texte.</p>';
  assert.equal(await clean(long), long);
});

test('a heading made only of blocks disappears, text between blocks becomes a paragraph', async () => {
  assert.equal(await clean('<h2><p>Un.</p>texte libre<br><div>Deux.</div></h2>'), '<p>Un.</p><p>texte libre</p><div>Deux.</div>');
  assert.equal(await clean('<h3><p>Seul.</p></h3>'), '<p>Seul.</p>');
});

test('nested section headings are flattened all the way', async () => {
  assert.equal(await clean('<h2>A<h3>B<p>texte</p></h3></h2>'), '<h2>A</h2><h3>B</h3><p>texte</p>');
});

test('the Google Docs neutral bold wrapper is dropped, real bold is kept', async () => {
  const docs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b"><p dir="ltr"><span style="font-size:11pt;font-family:Arial;font-weight:700">Gras</span><span style="font-size:11pt;font-family:Arial"> normal</span></p></b>';
  assert.equal(await clean(docs), '<p>Gras normal</p>');
  assert.equal(await clean('<p>Un <b>vrai</b> et <strong style="color:red">fort</strong>.</p>'), '<p>Un <b>vrai</b> et <strong>fort</strong>.</p>');
});

test('clean content is returned unchanged, so the broom can report nothing to do', async () => {
  const ok = '<h2>Titre</h2><p>Un <a href="https://example.com/">lien</a>.</p><ul><li>a</li></ul>';
  assert.equal(await clean(ok), ok);
});
