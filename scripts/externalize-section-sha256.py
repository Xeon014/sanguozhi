#!/usr/bin/env python3
"""Externalize duplicated section_sha256 maps from knowledge runtime packs.

Nearly every people/events/sources shard embeds the same 65-entry chapter digest
map (~5KB each, ~100MB total). This script:

1. Writes knowledge/runtime/section-sha256.json with the shared map
2. Strips section_sha256 from shard packs and full-map aggregates
3. Leaves intentional subsets (reading.json) embedded for compatibility
4. Rebuilds knowledge/runtime/manifest.json file digests

Regenerate after regenerating runtime knowledge packs:

  python3 scripts/externalize-section-sha256.py

Options:

  python3 scripts/externalize-section-sha256.py --runtime site/reader/knowledge/runtime
  python3 scripts/externalize-section-sha256.py --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

# Aggregates that historically embedded the full shared map (same 65 keys).
STRIP_ROOT_FILES = {
  "chooser.json",
  "directory.json",
  "highlights.json",
  "people-search.json",
  "search-original.json",
}

# Keep subset maps / non-knowledge payloads untouched.
KEEP_EMBEDDED = {
  "reading.json",
  "book.json",
  "anchors.json",
  "manifest.json",
  "section-sha256.json",
}

SHARD_DIRS = ("people", "events", "sources")


def load_json(path: Path):
  return json.loads(path.read_text(encoding="utf-8"))


def dump_compact(path: Path, data: dict) -> bytes:
  raw = (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
  path.write_bytes(raw)
  return raw


def canonical_map(runtime: Path) -> tuple[str, dict]:
  # Prefer highlights (runtime list pack); fall back to any shard.
  candidates = [runtime / "highlights.json"]
  candidates.extend(sorted((runtime / "events").glob("*.json"))[:1])
  for path in candidates:
    if not path.exists():
      continue
    data = load_json(path)
    section = data.get("section_sha256")
    source = data.get("source_sha256")
    if isinstance(section, dict) and source and len(section) >= 65:
      return source, section
  raise SystemExit("could not locate a full section_sha256 map under runtime/")


def should_strip(path: Path, runtime: Path) -> bool:
  rel = path.relative_to(runtime).as_posix()
  name = path.name
  if name in KEEP_EMBEDDED:
    return False
  if name in STRIP_ROOT_FILES and path.parent == runtime:
    return True
  parts = path.relative_to(runtime).parts
  return len(parts) == 2 and parts[0] in SHARD_DIRS and name.endswith(".json")


def strip_file(path: Path, shared_source: str, shared_map: dict, dry_run: bool) -> tuple[int, int]:
  raw_before = path.read_bytes()
  data = json.loads(raw_before)
  if not isinstance(data, dict) or "section_sha256" not in data:
    return len(raw_before), len(raw_before)
  embedded = data["section_sha256"]
  if data.get("source_sha256") and data["source_sha256"] != shared_source:
    raise SystemExit(f"source_sha256 mismatch in {path}")
  # Full-map packs must match shared exactly; reject drift before stripping.
  if embedded != shared_map:
    raise SystemExit(f"section_sha256 differs from shared map: {path}")
  before = len(raw_before)
  if dry_run:
    sample = {k: v for k, v in data.items() if k != "section_sha256"}
    after = len(json.dumps(sample, ensure_ascii=False, separators=(",", ":")).encode()) + 1
    return before, after
  del data["section_sha256"]
  raw_after = dump_compact(path, data)
  return before, len(raw_after)


def rebuild_manifest(runtime: Path, source_sha: str, dry_run: bool) -> None:
  files: dict[str, str] = {}
  for path in sorted(runtime.rglob("*.json")):
    rel = path.relative_to(runtime).as_posix()
    if rel == "manifest.json":
      continue
    files[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
  manifest = {
    "schema_version": 1,
    "source_sha256": source_sha,
    "files": files,
  }
  target = runtime / "manifest.json"
  if dry_run:
    print(f"dry-run manifest entries: {len(files)}")
    return
  dump_compact(target, manifest)


def main(argv: list[str]) -> int:
  root = Path(__file__).resolve().parents[1]
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument(
    "--runtime",
    type=Path,
    default=root / "site/reader/knowledge/runtime",
  )
  parser.add_argument("--dry-run", action="store_true")
  args = parser.parse_args(argv)
  runtime: Path = args.runtime
  if not runtime.is_dir():
    raise SystemExit(f"runtime directory not found: {runtime}")

  source_sha, shared_map = canonical_map(runtime)
  shared_path = runtime / "section-sha256.json"
  shared_doc = {
    "schema_version": 1,
    "source_sha256": source_sha,
    "section_sha256": shared_map,
  }
  if not args.dry_run:
    dump_compact(shared_path, shared_doc)

  before_total = 0
  after_total = 0
  stripped = 0
  for path in sorted(runtime.rglob("*.json")):
    if path.name == "section-sha256.json":
      continue
    if not should_strip(path, runtime):
      continue
    before, after = strip_file(path, source_sha, shared_map, args.dry_run)
    before_total += before
    after_total += after
    stripped += 1

  rebuild_manifest(runtime, source_sha, args.dry_run)
  shared_size = len(json.dumps(shared_doc, ensure_ascii=False, separators=(",", ":")).encode()) + 1
  print(
    f"{'dry-run ' if args.dry_run else ''}stripped {stripped} files; "
    f"payload {before_total:,} -> {after_total:,} bytes "
    f"(saved {before_total - after_total:,}); "
    f"shared map {shared_size:,} bytes -> {shared_path.relative_to(root)}"
  )
  return 0


if __name__ == "__main__":
  sys.exit(main(sys.argv[1:]))
