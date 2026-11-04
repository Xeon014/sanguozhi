#!/usr/bin/env python3
"""Rewrite handwritten asset ?v= tokens from a content fingerprint.

Computes a short hex stamp from reader app bytes (JS/CSS/HTML/icons/vendor)
plus a few knowledge identity files, after normalizing any existing ?v= values
so the stamp is stable across re-runs. Then rewrites ?v= in HTML/JS entry
points and ESM import URLs. JSON fetches inherit the stamp at runtime from
reader.js (import.meta.url → assetVersion).

Usage (repo root):
  python3 scripts/stamp-assets.py           # rewrite in place
  python3 scripts/stamp-assets.py --check   # exit 1 if rewrite would change files
  python3 scripts/stamp-assets.py --print   # print stamp only, no writes
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
READER = SITE / "reader"

# Match cache-bust query on asset URLs; values may be hex or legacy tokens.
VERSION_TOKEN = re.compile(r"\?v=[^\"'\s?#]+")

APP_GLOBS = (
    "reader/*.js",
    "reader/*.css",
    "reader/*.html",
    "reader/favicon.ico",
    "reader/favicon.svg",
    "reader/vendor/opencc.js",
    "index.html",
)

# Light identity inputs so data-only publishes still bust JSON ?v= without
# hashing the full knowledge tree.
DATA_IDENTITY = (
    "reader/config.json",
    "reader/site.json",
    "reader/knowledge/runtime/book.json",
    "reader/knowledge/runtime/directory.json",
    "reader/knowledge/runtime/highlights.json",
    "reader/knowledge/runtime/reading.json",
    "reader/knowledge/runtime/chooser.json",
)

REWRITE_GLOBS = (
    "index.html",
    "reader/*.html",
    "reader/*.js",
)


def normalize(text: str) -> str:
    return VERSION_TOKEN.sub("?v=", text)


def iter_files(globs: tuple[str, ...]) -> list[Path]:
    found: list[Path] = []
    for pattern in globs:
        found.extend(sorted(SITE.glob(pattern)))
    # De-dupe while keeping order
    seen: set[Path] = set()
    out: list[Path] = []
    for path in found:
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        out.append(path)
    return out


def fingerprint() -> str:
    digest = hashlib.sha256()
    for path in iter_files(APP_GLOBS):
        rel = path.relative_to(SITE).as_posix()
        raw = path.read_bytes()
        if path.suffix.lower() in {".js", ".css", ".html", ".svg"}:
            text = raw.decode("utf-8")
            payload = normalize(text).encode("utf-8")
        else:
            payload = raw
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
    for path in iter_files(DATA_IDENTITY):
        rel = path.relative_to(SITE).as_posix()
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:16]


def rewrite_text(text: str, stamp: str) -> str:
    return VERSION_TOKEN.sub(f"?v={stamp}", text)


def apply_stamp(stamp: str, *, check: bool) -> list[Path]:
    changed: list[Path] = []
    for path in iter_files(REWRITE_GLOBS):
        # Byte round-trip keeps committed CRLF (.gitattributes * -text).
        original = path.read_bytes().decode("utf-8")
        if "?v=" not in original:
            continue
        updated = rewrite_text(original, stamp)
        if updated == original:
            continue
        changed.append(path)
        if not check:
            path.write_bytes(updated.encode("utf-8"))
    return changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="fail if files need rewriting")
    parser.add_argument("--print", action="store_true", dest="print_only", help="print stamp and exit")
    args = parser.parse_args(argv)

    missing = [p for p in DATA_IDENTITY if not (SITE / p).is_file()]
    missing += [p for p in ("reader/index.html", "reader/reader.js") if not (SITE / p).is_file()]
    if missing:
        print("missing required files:", ", ".join(missing), file=sys.stderr)
        return 2

    stamp = fingerprint()
    if args.print_only:
        print(stamp)
        return 0

    changed = apply_stamp(stamp, check=args.check)
    if args.check:
        if changed:
            rels = ", ".join(p.relative_to(ROOT).as_posix() for p in changed)
            print(f"asset stamp stale ({stamp}); would update: {rels}", file=sys.stderr)
            return 1
        print(f"asset stamp ok ({stamp})")
        return 0

    rels = ", ".join(p.relative_to(ROOT).as_posix() for p in changed) or "(no file changes)"
    print(f"asset stamp {stamp}; updated: {rels}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
