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
