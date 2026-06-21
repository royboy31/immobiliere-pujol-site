// Cloudflare image-resizing wrapper.
// Routes (R2 / remote) image URLs through the zone's /cdn-cgi/image/ resizer so
// Cloudflare serves a resized, modern-format (AVIF/WebP) version on the fly.
//
// OFF by default (passthrough = original URL). Enable by setting IMAGE_RESIZE=true
// in the PROD build AFTER "Transform images" is enabled on the immobiliere-pujol.fr
// zone AND the domain is cut over (the /cdn-cgi/image/ endpoint must be served by
// that zone). `onerror=redirect` falls back to the original if a transform fails.
const ON = ['true', '1'].includes(String(import.meta.env.IMAGE_RESIZE || '').toLowerCase());

export function cfImg(src?: string | null, width = 800, quality = 75): string {
  const s = src || '';
  if (!ON || !s || s.startsWith('/cdn-cgi/') || s.startsWith('data:')) return s;
  return `/cdn-cgi/image/width=${width},quality=${quality},format=auto,onerror=redirect/${s}`;
}
