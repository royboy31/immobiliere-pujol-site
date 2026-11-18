// Identify an uploaded image from its BYTES, never from the browser-declared
// type.
//
// Why: `File.type` is the browser's guess and it is wrong in both directions. It
// is '' whenever the OS/browser has no MIME mapping for the extension, which
// made the upload endpoints reject perfectly good images with a 415 (the same
// bug that rejected real PDFs on the legal-pages upload). It is also trivially
// forged, and since the endpoints store `contentType` from it, a mislabelled
// file would be served back under a type it isn't.
//
// Kept dependency-free: it is imported by Worker-side endpoints, where no image
// library is available (sharp is a native Node module and cannot run there).

export interface SniffedImage {
  /** Canonical extension for the R2 key. */
  ext: string;
  /** Content type to store, derived from the bytes. */
  type: string;
}

/**
 * Returns the format of `bytes`, or null if it is not a supported image.
 *
 * SVG is deliberately absent. It cannot be identified by a magic number (it is
 * just XML), no editor offers it — both `accept` lists are raster-only — and
 * /media streams objects from our own origin, so a script-bearing .svg served
 * as image/svg+xml would be stored XSS. Raster only is both sniffable and safe.
 */
export function sniffImage(bytes: ArrayBuffer): SniffedImage | null {
  const b = new Uint8Array(bytes);
  // Shortest signature we check needs 12 bytes (RIFF....WEBP).
  if (b.length < 12) return null;

  const has = (sig: number[], off = 0) => sig.every((v, i) => b[off + i] === v);
  const tag = (off: number) => String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);

  if (has([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', type: 'image/png' };
  if (has([0xff, 0xd8, 0xff])) return { ext: 'jpg', type: 'image/jpeg' };
  if (tag(0) === 'GIF8') return { ext: 'gif', type: 'image/gif' };
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  // ISO-BMFF box: <size>'ftyp'<brand>. AVIF still images use avif; avis = sequence.
  if (tag(4) === 'ftyp' && (tag(8) === 'avif' || tag(8) === 'avis')) return { ext: 'avif', type: 'image/avif' };

  return null;
}

/**
 * Pixel size read from the image header itself (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X), so an
 * upload never trusts browser-declared dimensions. Returns null when the header is missing or
 * malformed, which the caller treats as "not a valid image".
 */
export function imageSize(bytes: ArrayBuffer, ext: string): { w: number; h: number } | null {
  const b = new Uint8Array(bytes);
  const u16be = (o: number) => (b[o] << 8) | b[o + 1];
  const u16le = (o: number) => b[o] | (b[o + 1] << 8);
  const u24le = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  const u32be = (o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
  const ok = (w: number, h: number) => (w > 0 && h > 0 ? { w, h } : null);
  if (ext === 'png') {
    if (b.length < 24 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
    return ok(u32be(16), u32be(20));
  }
  if (ext === 'jpg') {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const m = b[o + 1];
      if (m === 0xff) { o++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
      const len = u16be(o + 2);
      if (len < 2) return null;
      // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16be(o + 7), u16be(o + 5));
      if (m === 0xda || m === 0xd9) return null; // image data before any frame header
      o += 2 + len;
    }
    return null;
  }
  if (ext === 'webp') {
    if (b.length < 30) return null;
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8 ') {
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    }
    if (chunk === 'VP8L') {
      if (b[20] !== 0x2f) return null;
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X') return ok(u24le(24) + 1, u24le(27) + 1);
    return null;
  }
  return null;
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(b: Uint8Array, start: number, end: number): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Structural check of the WHOLE file, not just its header: a truncated or padded-header file with a
 * plausible signature and size is refused (Codex review of 91dc0c6b). No image library runs in the
 * Worker, so this does not decode the compressed pixels; it proves the container is complete:
 * - PNG: every chunk fits and its CRC matches, IHDR first, at least one IDAT, ends with IEND.
 * - JPEG: markers walk cleanly to a frame header and the scan, and the file ends with EOI.
 * - WebP: RIFF size matches the file, every chunk fits, and an image chunk (VP8/VP8L) has data.
 */
export function imageLooksComplete(bytes: ArrayBuffer, ext: string): boolean {
  const b = new Uint8Array(bytes);
  const u32be = (o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
  const u32le = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (ext === 'png') {
    let o = 8, first = true, idat = false;
    while (o + 12 <= b.length) {
      const len = u32be(o), type = tag(o + 4), end = o + 8 + len;
      if (end + 4 > b.length) return false;
      if (crc32(b, o + 4, end) !== u32be(end)) return false;
      if (first && type !== 'IHDR') return false;
      first = false;
      if (type === 'IDAT' && len > 0) idat = true;
      if (type === 'IEND') return idat && end + 4 === b.length;
      o = end + 4;
    }
    return false;
  }
  if (ext === 'jpg') {
    let end = b.length;
    while (end > 2 && b[end - 1] === 0x00) end--; // some encoders pad with zeros after EOI
    if (end < 4 || b[end - 2] !== 0xff || b[end - 1] !== 0xd9) return false;
    let o = 2, frame = false;
    while (o + 4 <= end) {
      if (b[o] !== 0xff) return false;
      const m = b[o + 1];
      if (m === 0xff) { o++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
      if (m === 0xd9) return false; // EOI before any scan
      const len = (b[o + 2] << 8) | b[o + 3];
      if (len < 2 || o + 2 + len > end) return false;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) frame = true;
      if (m === 0xda) return frame && o + 2 + len < end - 2; // scan header, then entropy data, then EOI
      o += 2 + len;
    }
    return false;
  }
  if (ext === 'webp') {
    if (b.length < 20) return false;
    const riff = u32le(4) + 8;
    if (riff !== b.length && riff + 1 !== b.length) return false;
    let o = 12, image = false;
    while (o + 8 <= riff) {
      const type = tag(o), len = u32le(o + 4), end = o + 8 + len;
      if (end > riff) return false;
      if ((type === 'VP8 ' || type === 'VP8L') && len > 10) image = true;
      o = end + (len & 1);
    }
    return image && o >= riff;
  }
  return false;
}
