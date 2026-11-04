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

# Adapted 2026-11-04 for the slimmed runtime layout while staying compatible
# with the legacy tree: legacy markers are manifest.json + central anchors.json
# with per-shard section_sha256; the slim layout centralizes section
# fingerprints in fingerprints.json, splits anchors per chapter under anchors/,
# ships topic detail pages as per-topic bound bundles under topics/, and drops
# catalog.json and the runtime manifest from the export. The layout is
# detected per tree so intermediate branch states validate either way.
RUNTIME_INDEX_FILES = (
    "book.json",
    "directory.json",
    "highlights.json",
    "reading.json",
    "chooser.json",
    "people-search.json",
    "search-original.json",
)
LEGACY_RUNTIME_INDEX_FILES = ("manifest.json", "anchors.json")
SLIM_RUNTIME_INDEX_FILES = ("fingerprints.json", "events-index.json")
# anchors.json is a plain anchor map without a source_sha256 header; the sha
# comparison only takes digest-bearing extras per layout.
RUNTIME_SHA_EXTRAS = {
    "legacy": ("manifest.json",),
    "slim": ("fingerprints.json", "events-index.json"),
}

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
    for name, value in (("config.json", config), ("site.json", site)):
        if not isinstance(value, dict):
            gate.fail(f"{name}: must be a JSON object")
    if not isinstance(config, dict) or not isinstance(site, dict):
        return None, None, None, None, None

    data_root = config.get("dataRoot") or "./data/"
    book_file = config.get("bookFile")
    runtime_root = config.get("runtimeRoot")
    if not book_file:
        gate.fail("config.json: bookFile required")
        return config, site, None, None, None
    if not runtime_root:
        gate.fail("config.json: runtimeRoot required")
        return config, site, None, None, None

    data_dir = resolve_under(gate.reader, data_root)
    if not data_dir.is_dir():
        gate.fail(f"config.dataRoot missing: {data_root}")
    else:
        gate.ok(f"dataRoot {data_root}")

    book_path = resolve_under(gate.reader, book_file)
    runtime_dir = resolve_under(gate.reader, runtime_root)
    layout = None
    book = gate.load_json(book_path, book_file)
    if not isinstance(book, dict) or not book.get("source_sha256"):
        gate.fail(f"{book_file}: source_sha256 required")
        return config, site, None, runtime_dir if runtime_dir.is_dir() else None, None

    expected = book["source_sha256"]
    gate.ok(f"anchor source_sha256 {expected[:16]}…")

    if not runtime_dir.is_dir():
        gate.fail(f"config.runtimeRoot missing: {runtime_root}")
        runtime_dir = None
    else:
        gate.ok(f"runtimeRoot {runtime_root}")
        legacy = (runtime_dir / "manifest.json").is_file()
        slim = (runtime_dir / "fingerprints.json").is_file()
        extras = ()
        if legacy and slim:
            gate.fail("runtime mixes legacy and slim layout markers")
        elif legacy:
            layout = "legacy"
            extras = LEGACY_RUNTIME_INDEX_FILES
        elif slim:
            layout = "slim"
            extras = SLIM_RUNTIME_INDEX_FILES
        else:
            gate.fail(
                "runtime layout markers missing "
                "(need manifest.json or fingerprints.json)"
            )
        for name in RUNTIME_INDEX_FILES + extras:
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
        target = resolve_under(gate.reader, rel)
        if target.is_file():
            gate.ok(f"exists {rel}")
        elif rel == knowledge.get("file") and layout == "slim":
            # The slim export no longer ships the full catalog; runtime
            # projections serve its readers. Absence is expected, not fatal.
            gate.warn(f"{rel} absent (runtime projections serve readers)")
        else:
            gate.fail(f"missing file: {rel}")

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

    return config, site, expected, runtime_dir, layout


def check_sha_packages(
    gate: Gate,
    expected: str,
    runtime_dir: Path | None,
    layout: str | None,
) -> dict[str, Any] | None:
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
    section_map = None
    for rel in packages:
        path = gate.reader / rel
        if not path.is_file():
            # The slim export intentionally drops the full catalog; the refs
            # check already warns there. Legacy trees must still ship it.
            if rel == "knowledge/catalog.json" and layout == "slim":
                continue
            continue
        value = gate.load_json(path, rel)
        gate.expect_sha(value, expected, rel)

    if runtime_dir:
        for name in RUNTIME_INDEX_FILES + RUNTIME_SHA_EXTRAS.get(layout, ()):
            value = gate.load_json(runtime_dir / name, f"runtime/{name}")
            gate.expect_sha(value, expected, f"runtime/{name}")
            if not isinstance(value, dict):
                continue
            if layout == "slim" and name == "fingerprints.json":
                section_map = value.get("section_sha256")
            elif layout == "legacy" and name == "directory.json":
                section_map = value.get("section_sha256")
    return section_map


def check_runtime_samples(
    gate: Gate,
    expected: str,
    runtime_dir: Path,
    section_map: dict[str, Any] | None,
    site: dict[str, Any] | None,
    layout: str | None,
) -> None:
    print("== runtime shard sample ==")
    if not isinstance(section_map, dict):
        source = "fingerprints.json" if layout == "slim" else "directory.json"
        gate.fail(f"runtime/{source}: section_sha256 must be an object")
        section_map = None
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
            if layout != "legacy":
                continue
            # Legacy shards embed the full section map; it must match the
            # directory's map exactly. Slim shards centralize it instead.
            shard_map = value.get("section_sha256")
            if not isinstance(shard_map, dict):
                gate.fail(f"{path.name}: section_sha256 must be an object")
            elif isinstance(section_map, dict):
                if shard_map.keys() != section_map.keys():
                    gate.fail(f"{path.name}: section_sha256 keys differ from directory")
                elif shard_map != section_map:
                    gate.fail(f"{path.name}: section_sha256 values diverge from directory")
                else:
                    section_ok += 1
        gate.ok(f"runtime/{sub}/ sample source_sha256 ok ({sha_ok}/{len(picks)})")
        if layout == "legacy" and section_map is not None:
            gate.ok(f"runtime/{sub}/ sample section_sha256 ok ({section_ok}/{len(picks)})")

    if layout == "legacy":
        check_legacy_manifest(gate, expected, runtime_dir)
        return
    if layout != "slim":
        return

    # Section fingerprints no longer ride inside every shard; the centralized
    # fingerprints map must be covered by one per-chapter anchor index each.
    if section_map is not None:
        anchors_dir = runtime_dir / "anchors"
        if not anchors_dir.is_dir():
            gate.fail("runtime/anchors/ missing")
        else:
            missing_anchors = [
                sid for sid in sorted(section_map)
                if not (anchors_dir / f"{sid}.json").is_file()
            ]
            if missing_anchors:
                preview = ", ".join(missing_anchors[:8])
                more = f" (+{len(missing_anchors) - 8} more)" if len(missing_anchors) > 8 else ""
                gate.fail(f"runtime/anchors/ missing per-chapter indexes: {preview}{more}")
            else:
                gate.ok(f"runtime/anchors/ covers all {len(section_map)} sections")

    # Topic detail pages ship as per-topic bound bundles; the presentation
    # file lists the ids that must each have a bundle on the same source.
    topics_rel = ((site or {}).get("topics") or {}).get("file") or "knowledge/topics.json"
    presentation = gate.load_json(gate.reader / topics_rel, topics_rel)
    topic_ids = []
    if isinstance(presentation, dict) and isinstance(presentation.get("topics"), list):
        topic_ids = [
            entry.get("id")
            for entry in presentation["topics"]
            if isinstance(entry, dict) and entry.get("id")
        ]
    if not topic_ids:
        gate.fail(f"{topics_rel}: no topics listed")
        return
    topics_dir = runtime_dir / "topics"
    if not topics_dir.is_dir():
        gate.fail("runtime/topics/ missing")
        return
    missing = [tid for tid in topic_ids if not (topics_dir / f"{tid}.json").is_file()]
    if missing:
        gate.fail(f"runtime/topics/ missing bundles: {', '.join(missing[:8])}")
        return
    gate.ok(f"runtime/topics/ bundles present ({len(topic_ids)})")
    for tid in sample_paths(
        [topics_dir / f"{tid}.json" for tid in topic_ids],
        SAMPLE_PER_DIR,
        f"{expected}:topics",
    ):
        value = gate.load_json(tid, f"runtime/topics/{tid.name}")
        gate.expect_sha(value, expected, f"runtime/topics/{tid.name}")


def check_legacy_manifest(gate: Gate, expected: str, runtime_dir: Path) -> None:
    """Legacy trees ship runtime/manifest.json; sample its listed paths."""
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
    _config, site, expected, runtime_dir, layout = check_config_and_refs(gate)
    section_map = None
    if expected:
        section_map = check_sha_packages(gate, expected, runtime_dir, layout)
        if runtime_dir:
            check_runtime_samples(gate, expected, runtime_dir, section_map, site, layout)
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
