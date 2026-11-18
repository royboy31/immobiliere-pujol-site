import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { imageSize, sniffImage } from '../src/lib/image-sniff.ts';

// Real encoder output for each format; the upload endpoint must read these sizes from the bytes.
for (const [fmt, opts] of [['jpeg', {}], ['png', {}], ['webp', {}], ['webp', { lossless: true }]]) {
  test(`imageSize reads ${fmt}${opts.lossless ? ' lossless' : ''} dimensions from the header`, async () => {
    const buf = await sharp({ create: { width: 1234, height: 567, channels: 3, background: '#c33' } })[fmt](opts).toBuffer();
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const kind = sniffImage(ab);
    assert.ok(kind);
    assert.deepEqual(imageSize(ab, kind.ext), { w: 1234, h: 567 });
  });
}

test('imageSize rejects a forged header with a valid signature', () => {
  const fake = new Uint8Array(64); fake.set([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(imageSize(fake.buffer, 'jpg'), null);
  const riff = new TextEncoder().encode('RIFF\0\0\0\0WEBPXXXX' + '\0'.repeat(40));
  assert.equal(imageSize(riff.buffer, 'webp'), null);
});

test('imageSize reads the transparent extended WebP header (VP8X)', async () => {
  const buf = await sharp({ create: { width: 801, height: 402, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer();
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  assert.deepEqual(imageSize(ab, 'webp'), { w: 801, h: 402 });
});

// ── whole-file integrity (Codex review of 91dc0c6b): a plausible header is not a readable image ──
import { imageLooksComplete } from '../src/lib/image-sniff.ts';

const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const encode = async (fmt, opts = {}, alpha = false) =>
  ab(await sharp({ create: { width: 640, height: 400, channels: alpha ? 4 : 3, background: alpha ? { r: 9, g: 99, b: 199, alpha: 0.5 } : '#3a7' } })[fmt](opts).toBuffer());

test('complete images from a real encoder pass the integrity check', async () => {
  for (const [fmt, opts, alpha, ext] of [['jpeg', {}, false, 'jpg'], ['jpeg', { progressive: true }, false, 'jpg'], ['png', {}, false, 'png'], ['png', {}, true, 'png'],
    ['webp', {}, false, 'webp'], ['webp', { lossless: true }, false, 'webp'], ['webp', {}, true, 'webp']]) {
    assert.equal(imageLooksComplete(await encode(fmt, opts, alpha), ext), true, `${fmt} ${JSON.stringify(opts)} alpha=${alpha}`);
  }
});

test("Codex's 24-byte PNG with signature, IHDR tag and 1600×1000 is refused", () => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, 1600); new DataView(b.buffer).setUint32(20, 1000);
  assert.deepEqual(imageSize(b.buffer, 'png'), { w: 1600, h: 1000 }, 'header alone looks fine');
  assert.equal(imageLooksComplete(b.buffer, 'png'), false);
});

test('truncated files are refused for every format', async () => {
  for (const [fmt, ext] of [['jpeg', 'jpg'], ['png', 'png'], ['webp', 'webp']]) {
    const full = new Uint8Array(await encode(fmt));
    for (const keep of [0.25, 0.5, 0.9, 0.99]) {
      const cut = full.slice(0, Math.floor(full.length * keep)).buffer;
      assert.equal(imageLooksComplete(cut, ext), false, `${fmt} cut at ${keep}`);
    }
  }
});

test('a PNG with one corrupted byte inside a chunk is refused (CRC)', async () => {
  const b = new Uint8Array(await encode('png'));
  b[40] ^= 0xff;
  assert.equal(imageLooksComplete(b.buffer, 'png'), false);
});
