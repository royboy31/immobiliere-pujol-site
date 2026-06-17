#!/usr/bin/env python3
"""
Scrape the live WordPress site's exact <title> and <meta name="description">
for every URL in its sitemap, into migration/seo-meta.csv.

Phase 1 meta-mirror (see migration/META-MIRROR-PLAYBOOK.md): the live site is the
source of truth. We copy meta VERBATIM, no optimization.

- Enumerates sitemap_index.xml -> all child sitemaps -> all page URLs.
- Fetches each page, extracts title + meta description (HTML entities decoded).
- Resumable: re-running skips paths already present in the CSV.
- Polite: small thread pool, timeout, retries.

Usage:  python3 migration/scrape-wp-meta.py
"""

import csv
import html
import os
import re
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlsplit, urlunsplit, quote

SITE = "https://www.immobiliere-pujol.fr"
SITEMAP_INDEX = f"{SITE}/sitemap_index.xml"
OUT = os.path.join(os.path.dirname(__file__), "seo-meta.csv")
FIELDS = ["path", "url", "final_url", "status", "title", "description"]

WORKERS = 8
TIMEOUT = 30
RETRIES = 3
UA = "Mozilla/5.0 (compatible; PujolMetaMirror/1.0; +migration)"

LOC_RE = re.compile(r"<loc>\s*(.*?)\s*</loc>", re.I | re.S)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
META_RE = re.compile(r"<meta\b[^>]*>", re.I)
NAME_DESC_RE = re.compile(r'name\s*=\s*["\']description["\']', re.I)
CONTENT_DQ_RE = re.compile(r'content\s*=\s*"([^"]*)"', re.I)
CONTENT_SQ_RE = re.compile(r"content\s*=\s*'([^']*)'", re.I)


def encode_url(url):
    """Percent-encode non-ASCII chars / spaces in path+query so urllib can fetch
    IRIs like /les-prix-au-m²-13012-marseille/. Host stays as-is."""
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, quote(p.path, safe="/%"),
                       quote(p.query, safe="=&%?+"), p.fragment))


def fetch(url):
    """GET url, follow redirects, return (final_url, status, body_text)."""
    url = encode_url(url)
    last_err = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                return resp.geturl(), resp.status, body
        except urllib.error.HTTPError as e:
            return url, e.code, ""
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    print(f"  ! failed {url}: {last_err}", file=sys.stderr)
    return url, 0, ""


def all_locs(xml):
    return [html.unescape(m.strip()) for m in LOC_RE.findall(xml)]


def collect_urls():
    """sitemap index -> child sitemaps -> page urls (deduped, order-preserving)."""
    _, _, idx = fetch(SITEMAP_INDEX)
    child_sitemaps = all_locs(idx)
    print(f"sitemap index: {len(child_sitemaps)} child sitemaps")
    seen, urls = set(), []
    for sm in child_sitemaps:
        _, _, body = fetch(sm)
        locs = all_locs(body)
        new = [u for u in locs if u not in seen]
        for u in new:
            seen.add(u)
            urls.append(u)
        print(f"  {sm.rsplit('/', 1)[-1]}: {len(locs)} urls ({len(new)} new)")
    print(f"total unique page urls: {len(urls)}")
    return urls


def extract(body):
    title = ""
    tm = TITLE_RE.search(body)
    if tm:
        title = html.unescape(tm.group(1)).strip()
    description = ""
    for m in META_RE.finditer(body):
        tag = m.group(0)
        if NAME_DESC_RE.search(tag):
            cm = CONTENT_DQ_RE.search(tag) or CONTENT_SQ_RE.search(tag)
            if cm:
                description = html.unescape(cm.group(1)).strip()
            break
    return title, description


def load_done():
    """A path counts as done only if it has a non-empty title (a successful
    fetch). Empty/failed rows are retried on the next run."""
    if not os.path.exists(OUT):
        return set()
    with open(OUT, newline="", encoding="utf-8") as f:
        return {row["path"] for row in csv.DictReader(f) if row.get("title", "").strip()}


def scrape_one(url):
    final_url, status, body = fetch(url)
    title, description = extract(body)
    return {
        "path": urlsplit(url).path,
        "url": url,
        "final_url": final_url,
        "status": status,
        "title": title,
        "description": description,
    }


def main():
    urls = collect_urls()
    done = load_done()
    todo = [u for u in urls if urlsplit(u).path not in done]
    print(f"already done: {len(done)} | to scrape: {len(todo)}")

    new_file = not os.path.exists(OUT)
    with open(OUT, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new_file:
            w.writeheader()
        n = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs = {ex.submit(scrape_one, u): u for u in todo}
            for fut in as_completed(futs):
                row = fut.result()
                w.writerow(row)
                n += 1
                if n % 100 == 0:
                    f.flush()
                    print(f"  ...{n}/{len(todo)}")
    print(f"done. wrote {n} rows -> {OUT}")


if __name__ == "__main__":
    main()
