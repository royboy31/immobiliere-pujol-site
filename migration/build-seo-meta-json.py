#!/usr/bin/env python3
"""
Compile migration/seo-meta.csv (scraped live WP meta) into a pathname-keyed
lookup map for the Astro templates. See migration/META-MIRROR-PLAYBOOK.md.

Key   = URL pathname, percent-DECODED, with a guaranteed trailing slash
        (so it matches `decodeURIComponent(Astro.url.pathname)` in the templates).
Value = {"t": <title>, "d": <description>} verbatim from live (description may be "").

Only rows with a non-empty title are emitted (empty = thin pages like /tag/, /quartiers/
that have no live title; templates keep their fallback for those).

Writes two files so SSR (annonce) pages don't have to bundle the whole map:
  src/data/seo-meta.json        — non-annonce pages (SSG, build-time only)
  src/data/seo-meta-annonces.json — /annonces/* only (used by the SSR route)

Usage: python3 migration/build-seo-meta-json.py
"""
import csv, json, os
from urllib.parse import unquote

HERE = os.path.dirname(__file__)
CSV = os.path.join(HERE, "seo-meta.csv")
# Non-annonce map: small (64 KB gz), imported (bundled) by BaseLayout for SSG pages.
# Lives in src/seo-data/ (NOT src/data/ — that's a build-artifact dir).
OUT_MAIN = os.path.abspath(os.path.join(HERE, "..", "src", "seo-data", "seo-meta.json"))
# Annonce map: large (2.3 MB). Must NOT be bundled into the SSR worker (exceeds the
# Worker size/startup limit — that broke deploy #1299). Served as a STATIC ASSET from
# public/ and loaded at runtime via env.ASSETS.fetch with per-isolate memoization
# (see src/lib/seo-meta.ts). public/ root is not touched by the build restore.
OUT_ADS = os.path.abspath(os.path.join(HERE, "..", "public", "seo-meta-annonces.json"))


def norm(path):
    p = unquote(path)
    if not p.startswith("/"):
        p = "/" + p
    if not p.endswith("/"):
        p = p + "/"
    return p


def main():
    main_map, ads_map = {}, {}
    with open(CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            title = r["title"].strip()
            if not title:
                continue
            key = norm(r["path"])
            entry = {"t": title, "d": r["description"]}
            (ads_map if key.startswith("/annonces/") else main_map)[key] = entry
    os.makedirs(os.path.dirname(OUT_MAIN), exist_ok=True)
    for path, m in ((OUT_MAIN, main_map), (OUT_ADS, ads_map)):
        with open(path, "w", encoding="utf-8") as out:
            json.dump(m, out, ensure_ascii=False, separators=(",", ":"))
        print(f"{os.path.relpath(path)}: {len(m)} entries, {os.path.getsize(path)//1024} KB")


if __name__ == "__main__":
    main()
