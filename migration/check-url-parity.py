#!/usr/bin/env python3
"""
URL parity: for every LIVE WordPress URL (from migration/seo-meta.csv), check what
STAGING serves at the same path. Detects redirects (staging serves a DIFFERENT URL
than live), 404s (missing), and matches. Output: migration/url-parity.csv.

This surfaces the active-listing slug drift (live `…-marseille-france` -> staging
301 `…-marseille`) and any other URL mismatches before go-live.

Resumable, threaded. Usage: python3 migration/check-url-parity.py
"""
import csv, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlsplit, urlunsplit, quote

STAGING = "https://immobiliere-pujol-staging.roy-68a.workers.dev"
HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, "seo-meta.csv")
OUT = os.path.join(HERE, "url-parity.csv")
FIELDS = ["path", "live_status", "live_final_path", "staging_status", "staging_location", "parity"]
WORKERS, TIMEOUT, RETRIES = 8, 30, 3
UA = "Mozilla/5.0 (compatible; PujolUrlParity/1.0)"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def enc(url):
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, quote(p.path, safe="/%"), quote(p.query, safe="=&%?+"), p.fragment))


def probe(path):
    """Return (status, location) for staging at path, NOT following redirects."""
    url = enc(STAGING + path)
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with OPENER.open(req, timeout=TIMEOUT) as resp:
                return resp.status, ""
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location", "") if e.headers else ""
            return e.code, loc
        except Exception as e:  # noqa: BLE001
            if attempt == RETRIES - 1:
                return 0, f"ERR:{e}"
            time.sleep(1.0 * (attempt + 1))
    return 0, ""


def classify(live_status, live_final_path, path, st_status, st_loc):
    loc_path = urlsplit(st_loc).path if st_loc.startswith("http") else st_loc
    if st_status == 200:
        return "MATCH"
    if st_status in (301, 302, 307, 308):
        # staging redirects; mismatch unless live also redirected to the same place
        if live_status != 200 and loc_path == live_final_path:
            return "MATCH"  # both redirect to same target
        return "REDIRECT"
    if st_status in (404, 410):
        return "MISSING"
    return f"OTHER:{st_status}"


def load_done():
    if not os.path.exists(OUT):
        return set()
    with open(OUT, newline="", encoding="utf-8") as f:
        return {r["path"] for r in csv.DictReader(f)}


def main():
    rows = list(csv.DictReader(open(SRC, newline="", encoding="utf-8")))
    done = load_done()
    todo = [r for r in rows if r["path"] not in done]
    print(f"live urls: {len(rows)} | done: {len(done)} | to check: {len(todo)}")

    def work(r):
        path = r["path"]
        live_final_path = urlsplit(r["final_url"]).path if r.get("final_url") else path
        st_status, st_loc = probe(path)
        return {
            "path": path,
            "live_status": r["status"],
            "live_final_path": live_final_path,
            "staging_status": st_status,
            "staging_location": st_loc,
            "parity": classify(r["status"], live_final_path, path, st_status, st_loc),
        }

    new = not os.path.exists(OUT)
    with open(OUT, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            w.writeheader()
        n = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for fut in as_completed([ex.submit(work, r) for r in todo]):
                w.writerow(fut.result())
                n += 1
                if n % 200 == 0:
                    f.flush(); print(f"  ...{n}/{len(todo)}")
    print(f"done. wrote {n} rows -> {OUT}")


if __name__ == "__main__":
    main()
