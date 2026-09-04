const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const UNSAFE_IMAGE_ANCESTORS = new Set([
  'a', 'aside', 'blockquote', 'figure', 'li', 'ol', 'p', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

interface BlogImageOptions {
  enabled: boolean;
  site: string;
  width?: number;
}

export function optimizeBlogImageUrl(src: string, options: BlogImageOptions): string {
  if (!options.enabled || !src) return src;

  let source: URL;
  let site: URL;
  try {
    site = new URL(options.site);
    source = new URL(src, site);
  } catch {
    return src;
  }

  if (source.origin !== site.origin || !source.pathname.startsWith('/media/blog/')) return src;

  const width = Math.max(1, Math.round(options.width ?? 1200));
  return `/cdn-cgi/image/width=${width},quality=80,format=auto,onerror=redirect/${source.toString()}`;
}

export function optimizeArticleBodyImages(html: string, options: BlogImageOptions): string {
  return html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)(\2)/gi,
    (tag, prefix: string, quote: string, src: string) =>
      `${prefix}${quote}${optimizeBlogImageUrl(src, options)}${quote}`,
  );
}

function openAncestorsAt(html: string, offset: number): string[] {
  const stack: string[] = [];
  const tagRegex = /<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  const prefix = html.slice(0, offset);
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(prefix)) !== null) {
    const token = match[0];
    const name = match[1].toLowerCase();

    if (token.startsWith('</')) {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.splice(index);
    } else if (!token.endsWith('/>') && !VOID_TAGS.has(name)) {
      stack.push(name);
    }
  }

  return stack;
}

// Wrap each top-level <img> and its trailing text in a two-column card. Images
// embedded in paragraphs, lists and other structured blocks must stay in place:
// moving their closing tags into the card creates invalid HTML and can eject the
// rest of the article from .content__body when the browser repairs the markup.
export function wrapImagePairs(html: string): string {
  const imgRegex = /<img\b[^>]*>/gi;
  const breakRegex = /<\/?(?:h[1-6]|table|hr|blockquote|figure)\b[^>]*>/i;
  const imgs: { tag: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(html)) !== null) {
    imgs.push({ tag: match[0], start: match.index, end: match.index + match[0].length });
  }
  if (!imgs.length) return html;

  let out = '';
  let cursor = 0;
  let pairIndex = 0;

  for (let index = 0; index < imgs.length; index++) {
    const img = imgs[index];
    out += html.slice(cursor, img.start);

    const ancestors = openAncestorsAt(html, img.start);
    if (ancestors.some((name) => UNSAFE_IMAGE_ANCESTORS.has(name))) {
      out += img.tag;
      cursor = img.end;
      continue;
    }

    const nextStart = index + 1 < imgs.length ? imgs[index + 1].start : html.length;
    const remaining = html.slice(img.end, nextStart);
    const blockMatch = breakRegex.exec(remaining);
    const bodyEnd = blockMatch ? img.end + blockMatch.index : nextStart;
    const body = html.slice(img.end, bodyEnd);

    const stripped = body.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#8211;/g, '').trim();
    if (stripped.length < 6) {
      out += `<figure class="article-figure">${img.tag}</figure>${body}`;
      cursor = bodyEnd;
      continue;
    }

    const side = pairIndex % 2 === 0 ? 'left' : 'right';
    out += `<aside class="article-pair article-pair--${side}"><div class="article-pair__media">${img.tag}</div><div class="article-pair__body">${body}</div></aside>`;
    cursor = bodyEnd;
    pairIndex++;
  }

  out += html.slice(cursor);
  return out;
}

// Scraped WP bodies often carry surplus </div> tags. Injected via set:html they
// can close template wrappers early, so discard surplus closers and close any
// remaining body-owned divs.
export function balanceDivs(html: string): string {
  const re = /<div\b[^>]*>|<\/div\s*>/gi;
  let depth = 0;
  let last = 0;
  let out = '';
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    out += html.slice(last, match.index);
    if (match[0][1] === '/') {
      if (depth > 0) {
        depth--;
        out += match[0];
      }
    } else {
      depth++;
      out += match[0];
    }
    last = re.lastIndex;
  }

  out += html.slice(last);
  while (depth-- > 0) out += '</div>';
  return out;
}
