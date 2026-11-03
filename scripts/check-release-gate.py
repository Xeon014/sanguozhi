#!/usr/bin/env python3
"""Pre-deploy release gate for the sanguozhi GitHub Pages site.

Validates entry points, config/site references, source_sha256 consistency
across knowledge packages, a deterministic sample of runtime shards, soft
size budgets, and minimal structural smoke checks. Stdlib only — suitable
for GitHub Actions ubuntu-latest runners.

Usage (from repo root):
  python3 scripts/check-release-gate.py
  python3 scripts/check-release-gate.py --root site
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from pathlib import Path
from typing import Any

# Soft budgets with headroom over the current published tree.
# Fail closed so a half-generated or ballooned publish cannot ship unnoticed.
MAX_CATALOG_BYTES = 50 * 1024 * 1024  # ~34MB today
MAX_SECTION_BYTES = 3 * 1024 * 1024  # ~2.0MB today (chapter-001)
MAX_RUNTIME_SHARD_BYTES = 512 * 1024  # people/events/sources samples

RUNTIME_INDEX_FILES = (
    "book.json",
    "manifest.json",
    "directory.json",
    "highlights.json",
    "reading.json",
    "chooser.json",
    "people-search.json",
    "search-original.json",
    "anchors.json",
)

SHELL_JS = (
    "reader.js",
    "data-loader.js",
    "route-hash.js",
    "search.js",
    "reading-controls.js",
    "floating-panel.js",
)

SAMPLE_PER_DIR = 24


class Gate:
    def __init__(self, site_root: Path) -> None:
        self.site = site_root
        self.reader = site_root / "reader"
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.checks = 0

    def fail(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def ok(self, message: str) -> None:
        self.checks += 1
        print(f"  ok  {message}")

    def load_json(self, path: Path, label: str | None = None) -> Any | None:
        name = label or str(path.relative_to(self.site))
        if not path.is_file():
            self.fail(f"missing JSON: {name}")
            return None
        try:
            with path.open("r", encoding="utf-8") as fh:
                value = json.load(fh)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            self.fail(f"unreadable JSON {name}: {exc}")
            return None
        self.ok(f"parsed {name}")
        return value

    def require_file(self, path: Path, label: str | None = None) -> bool:
        name = label or str(path.relative_to(self.site))
        if path.is_file():
            self.ok(f"exists {name}")
            return True
        self.fail(f"missing file: {name}")
        return False

    def expect_sha(self, value: Any, expected: str, label: str) -> None:
        if not isinstance(value, dict):
            self.fail(f"{label}: not an object")
            return
        got = value.get("source_sha256")
        if not got:
            self.fail(f"{label}: missing source_sha256")
        elif got != expected:
            self.fail(f"{label}: source_sha256 mismatch (got {got[:12]}…, want {expected[:12]}…)")
        else:
            self.ok(f"source_sha256 matches for {label}")


def resolve_under(base: Path, rel: str) -> Path:
    return (base / rel).resolve()


def sample_paths(paths: list[Path], n: int, seed: str) -> list[Path]:
    if len(paths) <= n:
        return sorted(paths)
    rng = random.Random(hashlib.sha256(seed.encode()).hexdigest())
    return sorted(rng.sample(paths, n))


def check_entries(gate: Gate) -> None:
    print("== entries ==")
    gate.require_file(gate.site / "index.html")
    gate.require_file(gate.reader / "index.html")
    gate.require_file(gate.reader / "reader.js")
    gate.require_file(gate.reader / "reader.css")
    for name in SHELL_JS:
        gate.require_file(gate.reader / name)


def check_config_and_refs(gate: Gate) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None, Path | None]:
    print("== config / site refs ==")
    config = gate.load_json(gate.reader / "config.json")
    site = gate.load_json(gate.reader / "site.json")
    if not isinstance(config, dict) or not isinstance(site, dict):
        return None, None, None, None

    data_root = config.get("dataRoot") or "./data/"
    book_file = config.get("bookFile")
    runtime_root = config.get("runtimeRoot")
    if not book_file:
        gate.fail("config.json: bookFile required")
        return config, site, None, None
    if not runtime_root:
        gate.fail("config.json: runtimeRoot required")
        return config, site, None, None

    data_dir = resolve_under(gate.reader, data_root)
    if not data_dir.is_dir():
        gate.fail(f"config.dataRoot missing: {data_root}")
    else:
        gate.ok(f"dataRoot {data_root}")

    book_path = resolve_under(gate.reader, book_file)
    runtime_dir = resolve_under(gate.reader, runtime_root)
    book = gate.load_json(book_path, book_file)
    if not isinstance(book, dict) or not book.get("source_sha256"):
        gate.fail(f"{book_file}: source_sha256 required")
        return config, site, None, runtime_dir if runtime_dir.is_dir() else None

    expected = book["source_sha256"]
    gate.ok(f"anchor source_sha256 {expected[:16]}…")

    if not runtime_dir.is_dir():
        gate.fail(f"config.runtimeRoot missing: {runtime_root}")
        runtime_dir = None
    else:
        gate.ok(f"runtimeRoot {runtime_root}")
        for name in RUNTIME_INDEX_FILES:
            gate.require_file(runtime_dir / name, f"{runtime_root.rstrip('/')}/{name}")

    knowledge = site.get("knowledge") or {}
    topic = site.get("topics") or {}
    ref_files = [
        knowledge.get("file"),
        knowledge.get("profiles"),
        knowledge.get("editorial"),
        knowledge.get("atlas"),
        topic.get("file"),
        "knowledge/zh-display.json",
        "knowledge/atlas-records.json",
    ]
    for rel in ref_files:
        if not rel:
            continue
        gate.require_file(resolve_under(gate.reader, rel), rel)

    # Collection / supplement chapter files under data/sections.
    section_ids: list[str] = []
    for collection in site.get("collections") or []:
        section_ids.extend(collection.get("chapters") or [])
    for supplement in site.get("supplements") or []:
        section_ids.extend(supplement.get("sections") or [])
    section_ids.extend(site.get("featured") or [])
    missing_sections = [
        sid
        for sid in sorted(set(section_ids))
        if not (data_dir / "sections" / f"{sid}.json").is_file()
    ]
    if missing_sections:
        preview = ", ".join(missing_sections[:8])
        more = f" (+{len(missing_sections) - 8} more)" if len(missing_sections) > 8 else ""
        gate.fail(f"site.json references missing sections: {preview}{more}")
    else:
        gate.ok(f"site.json section refs present ({len(set(section_ids))})")

    if isinstance(book.get("sections"), list):
        missing_book = []
        for entry in book["sections"]:
            if not isinstance(entry, dict):
                continue
            sid = entry.get("id")
            if not sid:
                continue
            if not (data_dir / "sections" / f"{sid}.json").is_file():
                missing_book.append(sid)
        if missing_book:
            gate.fail(f"book sections missing files: {', '.join(missing_book[:8])}")
        else:
            gate.ok(f"book lists {len(book['sections'])} sections; files present")

    people = knowledge.get("people") or []
    featured = knowledge.get("featuredPeople") or []
    if runtime_dir:
        person_ids = []
        for person in people:
            if isinstance(person, dict) and person.get("id"):
                person_ids.append(person["id"])
        person_ids.extend(pid for pid in featured if pid)
        missing_people = [
            pid
            for pid in sorted(set(person_ids))
            if not (runtime_dir / "people" / f"{pid}.json").is_file()
        ]
        if missing_people:
            preview = ", ".join(missing_people[:8])
            more = f" (+{len(missing_people) - 8} more)" if len(missing_people) > 8 else ""
            gate.fail(f"site.json people refs missing runtime shards: {preview}{more}")
        else:
            gate.ok(f"site.json people refs present ({len(set(person_ids))})")

    return config, site, expected, runtime_dir


def check_sha_packages(gate: Gate, expected: str, runtime_dir: Path | None) -> dict[str, Any] | None:
    print("== source_sha256 packages ==")
    packages = [
        "knowledge/zh-display.json",
        "knowledge/topics.json",
        "knowledge/atlas.json",
        "knowledge/atlas-records.json",
        "knowledge/profiles.json",
        "knowledge/event-editorial.json",
        "knowledge/catalog.json",
        "data/book.json",
    ]
    directory = None
    for rel in packages:
        path = gate.reader / rel
        if not path.is_file():
            # catalog may eventually leave the publish set; warn rather than hard-fail
            # only if site.json no longer points at it — handled via refs already.
            if rel == "knowledge/catalog.json":
                gate.warn("catalog.json absent (ok once topics leave that hot path)")
                continue
            continue
        value = gate.load_json(path, rel)
        gate.expect_sha(value, expected, rel)
        if rel == "knowledge/catalog.json" and isinstance(value, dict):
            directory = value  # reuse section map below if needed

    if runtime_dir:
        for name in (
            "book.json",
            "manifest.json",
            "directory.json",
            "highlights.json",
            "reading.json",
            "chooser.json",
            "people-search.json",
            "search-original.json",
        ):
            value = gate.load_json(runtime_dir / name, f"runtime/{name}")
            gate.expect_sha(value, expected, f"runtime/{name}")
            if name == "directory.json" and isinstance(value, dict):
                directory = value
    return directory


def check_runtime_samples(
    gate: Gate,
    expected: str,
    runtime_dir: Path,
    directory: dict[str, Any] | None,
) -> None:
    print("== runtime shard sample ==")
    section_map = (directory or {}).get("section_sha256") if directory else None
    for sub in ("people", "events", "sources"):
        folder = runtime_dir / sub
        if not folder.is_dir():
            gate.fail(f"runtime/{sub}/ missing")
            continue
        files = [p for p in folder.glob("*.json") if p.is_file()]
        if not files:
            gate.fail(f"runtime/{sub}/ has no JSON shards")
            continue
        gate.ok(f"runtime/{sub}/ count={len(files)}")
        picks = sample_paths(files, SAMPLE_PER_DIR, f"{expected}:{sub}")
        sha_ok = 0
        section_ok = 0
        for path in picks:
            if path.stat().st_size > MAX_RUNTIME_SHARD_BYTES:
                gate.fail(
                    f"{path.relative_to(gate.site)} exceeds shard budget "
                    f"({path.stat().st_size} > {MAX_RUNTIME_SHARD_BYTES})"
                )
            try:
                with path.open("r", encoding="utf-8") as fh:
                    value = json.load(fh)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                gate.fail(f"unreadable shard {path.relative_to(gate.reader)}: {exc}")
                continue
            if not isinstance(value, dict) or value.get("source_sha256") != expected:
                gate.fail(
                    f"{path.relative_to(gate.reader)}: source_sha256 mismatch or missing"
                )
                continue
            sha_ok += 1
            if isinstance(section_map, dict) and isinstance(value.get("section_sha256"), dict):
                mismatched = next(
                    (
                        sid
                        for sid, sha in value["section_sha256"].items()
                        if sid in section_map and section_map[sid] != sha
                    ),
                    None,
                )
                if mismatched:
                    gate.fail(
                        f"{path.name}: section_sha256[{mismatched}] diverges from directory"
                    )
                else:
                    section_ok += 1
        gate.ok(f"runtime/{sub}/ sample source_sha256 ok ({sha_ok}/{len(picks)})")
        if section_map is not None:
            gate.ok(f"runtime/{sub}/ sample section_sha256 ok ({section_ok}/{len(picks)})")

    # Manifest: every listed top-level index exists; sample relative shard paths exist.
    manifest_path = runtime_dir / "manifest.json"
    try:
        with manifest_path.open("r", encoding="utf-8") as fh:
            manifest = json.load(fh)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        gate.fail(f"unreadable runtime/manifest.json: {exc}")
        return
    if isinstance(manifest, dict) and isinstance(manifest.get("files"), dict):
        missing = 0
        names = list(manifest["files"])
        for rel in names:
            if "/" not in rel and not (runtime_dir / rel).is_file():
                gate.fail(f"manifest lists missing top-level file: {rel}")
                missing += 1
        shard_names = [n for n in names if "/" in n]
        sample_rels = sample_paths(
            [Path(n) for n in shard_names],
            min(40, len(shard_names)),
            f"{expected}:manifest",
        )
        for rel in sample_rels:
            if not (runtime_dir / rel).is_file():
                gate.fail(f"manifest sample missing: {rel.as_posix()}")
                missing += 1
        if missing == 0:
            gate.ok(f"manifest samples present ({len(sample_rels)} shards + top-level)")


def check_size_budgets(gate: Gate) -> None:
    print("== size budgets ==")
    catalog = gate.reader / "knowledge" / "catalog.json"
    if catalog.is_file():
        size = catalog.stat().st_size
        if size > MAX_CATALOG_BYTES:
            gate.fail(f"catalog.json {size} bytes exceeds budget {MAX_CATALOG_BYTES}")
        else:
            gate.ok(f"catalog.json {size} bytes within budget")

    sections = list((gate.reader / "data" / "sections").glob("*.json"))
    if not sections:
        gate.fail("data/sections/ empty")
        return
    largest = max(sections, key=lambda p: p.stat().st_size)
    size = largest.stat().st_size
    if size > MAX_SECTION_BYTES:
        gate.fail(f"{largest.name} {size} bytes exceeds section budget {MAX_SECTION_BYTES}")
    else:
        gate.ok(f"largest section {largest.name}={size} bytes within budget")


def check_smoke(gate: Gate, site: dict[str, Any] | None) -> None:
    print("== smoke ==")
    root_html = (gate.site / "index.html").read_text(encoding="utf-8")
    if "reader/" not in root_html:
        gate.fail("site/index.html does not redirect into reader/")
    else:
        gate.ok("site/index.html redirects to reader/")

    html = (gate.reader / "index.html").read_text(encoding="utf-8")
    for needle in ('id="main"', "reader.js", "reader.css", 'href="#/"'):
        if needle not in html:
            gate.fail(f"reader/index.html missing marker {needle!r}")
        else:
            gate.ok(f"reader/index.html has {needle!r}")

    reader_js = (gate.reader / "reader.js").read_text(encoding="utf-8")
    for needle in ("async function boot", "loadTopics", "source_sha256", "#/contents"):
        if needle not in reader_js:
            gate.fail(f"reader.js missing expected symbol/path {needle!r}")
        else:
            gate.ok(f"reader.js contains {needle!r}")

    # Route data prerequisites called out in the optimization review smoke list.
    if site:
        knowledge = site.get("knowledge") or {}
        if knowledge.get("atlas"):
            gate.require_file(gate.reader / knowledge["atlas"], knowledge["atlas"])
        if site.get("topics", {}).get("file"):
            gate.require_file(
                gate.reader / site["topics"]["file"],
                site["topics"]["file"],
            )
        # First collection chapter is the usual #/read/chapter-001 landing.
        collections = site.get("collections") or []
        if collections and collections[0].get("chapters"):
            first = collections[0]["chapters"][0]
            gate.require_file(
                gate.reader / "data" / "sections" / f"{first}.json",
                f"smoke read target data/sections/{first}.json",
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default="site",
        help="Pages artifact root relative to cwd (default: site)",
    )
    args = parser.parse_args()
    site_root = Path(args.root).resolve()
    if not site_root.is_dir():
        print(f"error: site root not found: {site_root}", file=sys.stderr)
        return 2

    gate = Gate(site_root)
    print(f"release gate: {site_root}")

    check_entries(gate)
    _config, site, expected, runtime_dir = check_config_and_refs(gate)
    directory = None
    if expected:
        directory = check_sha_packages(gate, expected, runtime_dir)
        if runtime_dir:
            check_runtime_samples(gate, expected, runtime_dir, directory)
    check_size_budgets(gate)
    check_smoke(gate, site)

    print()
    if gate.warnings:
        print(f"warnings ({len(gate.warnings)}):")
        for item in gate.warnings:
            print(f"  warn  {item}")
    if gate.errors:
        print(f"FAILED with {len(gate.errors)} error(s); {gate.checks} checks passed")
        for item in gate.errors:
            print(f"  fail  {item}")
        return 1

    print(f"PASSED ({gate.checks} checks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
