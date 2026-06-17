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
# Annonce map: large (2.3 MB). Must NOT be loaded whole at runtime — parsing 2.3 MB
# on a cold isolate exceeds the Worker CPU limit (empty/503 responses, ~1 in 6).
# So it is SHARDED into 64 small files under public/seo-meta-annonces/<shard>.json,
# keyed by FNV-1a(slug) % 64 (must match hashString() in src/lib/internal-links.ts).
# The SSR route fetches only the one ~35 KB shard it needs (see src/lib/seo-meta.ts).
OUT_ADS_DIR = os.path.abspath(os.path.join(HERE, "..", "public", "seo-meta-annonces"))
SHARDS = 64


def fnv1a(s):
    """32-bit FNV-1a — must match hashString() in src/lib/internal-links.ts."""
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def norm(path):
    p = unquote(path)
    if not p.startswith("/"):
        p = "/" + p
    if not p.endswith("/"):
        p = p + "/"
    return p


def main():
    main_map = {}
    shards = [dict() for _ in range(SHARDS)]
    ads_total = 0
    with open(CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            title = r["title"].strip()
            if not title:
                continue
            key = norm(r["path"])
            entry = {"t": title, "d": r["description"]}
            parts = key.strip("/").split("/", 1)
            if key.startswith("/annonces/") and len(parts) > 1:
                slug = parts[1]  # path after "annonces/"
                shards[fnv1a(slug) % SHARDS][key] = entry
                ads_total += 1
            else:
                main_map[key] = entry  # incl. the /annonces/ listing index itself
    # non-annonce map (bundled in BaseLayout)
    os.makedirs(os.path.dirname(OUT_MAIN), exist_ok=True)
    with open(OUT_MAIN, "w", encoding="utf-8") as out:
        json.dump(main_map, out, ensure_ascii=False, separators=(",", ":"))
    print(f"{os.path.relpath(OUT_MAIN)}: {len(main_map)} entries, {os.path.getsize(OUT_MAIN)//1024} KB")
    # annonce shards (runtime-loaded, one small file per request)
    if os.path.isdir(OUT_ADS_DIR):
        for old in os.listdir(OUT_ADS_DIR):
            os.remove(os.path.join(OUT_ADS_DIR, old))
    os.makedirs(OUT_ADS_DIR, exist_ok=True)
    sizes = []
    for i, sh in enumerate(shards):
        p = os.path.join(OUT_ADS_DIR, f"{i}.json")
        with open(p, "w", encoding="utf-8") as out:
            json.dump(sh, out, ensure_ascii=False, separators=(",", ":"))
        sizes.append(os.path.getsize(p))
    print(f"{os.path.relpath(OUT_ADS_DIR)}/: {ads_total} entries across {SHARDS} shards, "
          f"max {max(sizes)//1024} KB, avg {sum(sizes)//len(sizes)//1024} KB")


if __name__ == "__main__":
    main()
