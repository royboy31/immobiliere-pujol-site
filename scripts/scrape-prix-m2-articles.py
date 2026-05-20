#!/usr/bin/env python3
"""
Scrape the 26 prix-au-m² articles missing from the Astro content collection.

These articles have ² (U+00B2) in their slug. The original migration script
choked on URL-encoding, so they were never imported. They contain 47-62 kB of
real content each and are part of the SEO pillar François Lamotte built around
the "prix par arrondissement" category.

Output: one .md per article in src/content/articles/ keeping the original
² character in the slug so backlinks pointing to the live URL keep resolving.
"""

import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO_ROOT, "src", "content", "articles")
WP_BASE = "https://www.immobiliere-pujol.fr"

# 26 missing URLs (paths only). All contain ² which needs URL-encoding.
MISSING_URLS = [
    "/les-prix-au-m²-13012-marseille/",
    "/les-prix-au-m²-dans-le-neuf-dans-le-13010-marseille/",
    "/les-prix-au-m²-de-limmobilier-neuf-dans-le-5eme/",
    "/les-prix-au-m²-des-ventes-en-2022-dans-le-13001-a-marseille/",
    "/les-prix-au-m²-des-ventes-en-2022-dans-le-13006-a-marseille/",
    "/prix-au-m²-de-limmobilier-ancien-en-2014-dans-le-13010/",
    "/prix-au-m²-de-limmobilier-neuf-dans-le-13012-2/",
    "/prix-au-m²-des-ventes-a-marseille-par-arrondissement-fin-2023/",
    "/prix-m²-ancien-13001-marseille-2016/",
    "/prix-m²-ancien-13006-2015-2/",
    "/prix-m²-ancien-13010-2016-2/",
    "/prix-m²-ancien-13010-2016/",
    "/prix-m²-ancien-2015-13005-marseille/",
    "/prix-m²-de-lancien-2015-13001-marseille-2/",
    "/prix-m²-de-lancien-2015-13002-marseille-2/",
    "/prix-m²-de-lancien-2015-13003-marseille/",
    "/prix-m²-de-lancien-2015-13004-marseille-2/",
    "/prix-m²-de-lancien-2015-13008-marseille/",
    "/prix-m²-de-lancien-2015-13011-marseille/",
    "/prix-m²-lancien-13012-marseille-2015/",
    "/prix-m²-lancien-13013-marseille-2015-2/",
    "/prix-m²-lancien-2015-13007-marseille/",
    "/prix-m²-lancien-2015-13009-marseille/",
    "/prix-m²-lancien-2015-13010-marseille/",
    "/quel-est-le-prix-au-m²-dun-t3-dans-le-13001-a-marseille/",
]

USER_AGENT = "Mozilla/5.0 (compatible; PujolMigration/1.0)"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "fr-FR,fr;q=0.9"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def encode_url(path):
    """URL-encode a path while preserving slashes."""
    return urllib.parse.quote(path, safe="/")


def slug_from_path(path):
    """Strip leading/trailing slashes. We keep the original ² character so the
    generated URL on staging matches the live URL byte-for-byte and external
    backlinks pointing to /…m²…/ continue to resolve without redirects."""
    return path.strip("/")


def extract_ld_json(page_html):
    """Return the first NewsArticle/Article JSON-LD object, or None."""
    for m in re.finditer(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', page_html, re.DOTALL):
        raw = m.group(1).strip()
        # WordPress sometimes injects PHP-style placeholders in the JSON
        # (e.g. "width":"' . $options_set2 . '"). Sanitise those before parsing.
        clean = re.sub(r"'\s*\.\s*\$[A-Za-z_]+\s*\.\s*'", '""', raw)
        try:
            data = json.loads(clean)
        except json.JSONDecodeError:
            continue
        candidates = data if isinstance(data, list) else [data]
        for c in candidates:
            if isinstance(c, dict) and c.get("@type") in ("NewsArticle", "Article", "BlogPosting"):
                return c
    return None


def extract_meta(page_html, name=None, prop=None):
    if name:
        m = re.search(r'<meta\s+name="' + re.escape(name) + r'"\s+content="([^"]*)"', page_html, re.IGNORECASE)
    else:
        m = re.search(r'<meta\s+property="' + re.escape(prop) + r'"\s+content="([^"]*)"', page_html, re.IGNORECASE)
    return html.unescape(m.group(1)) if m else ""


def extract_h1(page_html):
    """Hero title for prix-m2 pages is in <h1 class='hero__title'>."""
    m = re.search(r'<h1[^>]*class="[^"]*hero__title[^"]*"[^>]*>(.*?)</h1>', page_html, re.DOTALL)
    if not m:
        m = re.search(r'<h1[^>]*>(.*?)</h1>', page_html, re.DOTALL)
    return html.unescape(re.sub(r'<[^>]+>', '', m.group(1)).strip()) if m else ""


def extract_post_content(page_html):
    """The article body lives in <div class='post__content'>...</div>.

    Use a greedy depth-aware capture since the body contains nested divs.
    """
    start_re = re.compile(r'<div[^>]*class="[^"]*\bpost__content\b[^"]*"[^>]*>')
    s = start_re.search(page_html)
    if not s:
        return ""
    i = s.end()
    depth = 1
    n = len(page_html)
    div_open = re.compile(r'<div\b', re.IGNORECASE)
    div_close = re.compile(r'</div\s*>', re.IGNORECASE)
    out_start = i
    while i < n and depth > 0:
        next_open = div_open.search(page_html, i)
        next_close = div_close.search(page_html, i)
        if not next_close:
            break
        if next_open and next_open.start() < next_close.start():
            depth += 1
            i = next_open.end()
        else:
            depth -= 1
            if depth == 0:
                return page_html[out_start:next_close.start()].strip()
            i = next_close.end()
    return page_html[out_start:].strip()


def extract_categories_and_tags(page_html):
    """Extract category names and tag names from the rendered page.

    Categories: links to /categorie/... with class containing 'post__category' or 'category__link'.
    Tags: WP's theme places them under post__tanonomy (theme typo); fall back to any /tag/ link.
    """
    cats = []
    # Primary category visible in the share bar
    for m in re.finditer(r'<a[^>]+href="https?://[^"]*?/categorie/([^"]+?)/?"[^>]*class="[^"]*\blink\b[^"]*"[^>]*>([^<]+)</a>', page_html):
        name = html.unescape(m.group(2)).strip()
        if name and name not in cats:
            cats.append(name)

    # Anything in the post__tanonomy block
    tag_block = re.search(r'<div[^>]*class="[^"]*post__tanonomy[^"]*"[^>]*>(.*?)</div>', page_html, re.DOTALL)
    tags = []
    if tag_block:
        for m in re.finditer(r'<a[^>]+href="[^"]+/tag/([^"/]+)/?"[^>]*>([^<]+)</a>', tag_block.group(1)):
            t = html.unescape(m.group(2)).strip()
            if t and t not in tags:
                tags.append(t)
    return cats, tags


def yaml_quote(s):
    """Quote a string for YAML frontmatter."""
    s = (s or "").replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").strip()
    return f'"{s}"'


def yaml_list(items):
    if not items:
        return "[]"
    return "[" + ", ".join(yaml_quote(x) for x in items) + "]"


def build_markdown(meta, body_html):
    fm_lines = ["---"]
    fm_lines.append(f"title: {yaml_quote(meta['title'])}")
    fm_lines.append(f"slug: {yaml_quote(meta['slug'])}")
    if meta.get("date"):
        fm_lines.append(f"date: {yaml_quote(meta['date'])}")
    if meta.get("excerpt"):
        fm_lines.append(f"excerpt: {yaml_quote(meta['excerpt'])}")
    fm_lines.append(f"categories: {yaml_list(meta.get('categories', []))}")
    fm_lines.append(f"tags: {yaml_list(meta.get('tags', []))}")
    if meta.get("featuredImage"):
        fm_lines.append(f"featuredImage: {yaml_quote(meta['featuredImage'])}")
    if meta.get("seoTitle"):
        fm_lines.append(f"seoTitle: {yaml_quote(meta['seoTitle'])}")
    if meta.get("seoDescription"):
        fm_lines.append(f"seoDescription: {yaml_quote(meta['seoDescription'])}")
    fm_lines.append("---")
    fm_lines.append("")
    return "\n".join(fm_lines) + "\n" + body_html.strip() + "\n"


def scrape_one(path, dry_run=False):
    encoded = encode_url(path)
    url = WP_BASE + encoded
    print(f"  GET {url}")
    page = fetch(url)

    title_tag_m = re.search(r'<title>(.*?)</title>', page, re.DOTALL | re.IGNORECASE)
    seo_title = html.unescape(title_tag_m.group(1)).strip() if title_tag_m else ""
    seo_title = re.sub(r'\s*[–\-]\s*Immobili[eè]re Pujol\s*$', '', seo_title, flags=re.IGNORECASE).strip()

    h1 = extract_h1(page)
    title = h1 or seo_title

    meta_desc = extract_meta(page, name="description")
    og_image = extract_meta(page, prop="og:image")

    ld = extract_ld_json(page) or {}
    date_iso = (ld.get("datePublished") or "")[:10]

    cats, tags = extract_categories_and_tags(page)
    body = extract_post_content(page)

    slug = slug_from_path(path)
    meta = {
        "title": title,
        "slug": slug,
        "date": date_iso,
        "excerpt": meta_desc,
        "categories": cats,
        "tags": tags,
        "featuredImage": og_image,
        "seoTitle": seo_title,
        "seoDescription": meta_desc,
    }
    md = build_markdown(meta, body)
    out_path = os.path.join(OUT_DIR, slug + ".md")
    if dry_run:
        print(f"  DRY-RUN — would write: {out_path}")
        print("  ---")
        print(md[:1500])
        print("  ---")
        print(f"  Body length: {len(body)} chars")
        return out_path, len(md)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(md)
    return out_path, len(md)


def main():
    dry = "--dry-run" in sys.argv
    only = None
    if "--only" in sys.argv:
        i = sys.argv.index("--only")
        only = sys.argv[i + 1]
    urls = [u for u in MISSING_URLS if (only is None or only in u)]
    print(f"Scraping {len(urls)} article(s){' [dry-run]' if dry else ''}...")
    written = []
    for i, path in enumerate(urls, 1):
        print(f"[{i}/{len(urls)}] {path}")
        try:
            out, size = scrape_one(path, dry_run=dry)
            written.append((path, out, size))
            print(f"  -> {out}  ({size} bytes)")
        except Exception as e:
            print(f"  ERROR: {e}")
        time.sleep(0.5)
    print(f"\nDone. {len(written)}/{len(urls)} succeeded.")
    if not dry and written:
        sizes = [s for _, _, s in written]
        print(f"  Avg file size: {sum(sizes) // len(sizes)} bytes")


if __name__ == "__main__":
    main()
