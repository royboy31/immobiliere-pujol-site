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
