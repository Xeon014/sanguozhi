#!/usr/bin/env python3
"""Build a lean runtime catalog projection for topic pages.

Topics previously fetched the full knowledge/catalog.json (~33MB) only to resolve
a handful of evidence, events, and people. This script slices those records into
knowledge/runtime/topics-catalog.json so the reader can follow the same
runtimeRoot projection pattern used by people/events/highlights.

Regenerate after catalog.json or topics.json changes:

  python3 scripts/build-topics-catalog.py

Optional paths:

  python3 scripts/build-topics-catalog.py \\
    --catalog site/reader/knowledge/catalog.json \\
    --topics site/reader/knowledge/topics.json \\
    --out site/reader/knowledge/runtime/topics-catalog.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


def stable_js(value):
  """Match reader.js digest canonicalization (sorted object keys, compact JSON)."""
  if isinstance(value, dict):
    return {key: stable_js(value[key]) for key in sorted(value)}
  if isinstance(value, list):
    return [stable_js(item) for item in value]
  return value


def digest(value) -> str:
  payload = json.dumps(stable_js(value), ensure_ascii=False, separators=(",", ":"))
  return hashlib.sha256(payload.encode()).hexdigest()


def collect_ids(topics: dict) -> tuple[set[str], set[str], set[str]]:
  evidence_ids = set(topics["bindings"])
  event_ids = set(topics["event_bindings"])
  person_ids: set[str] = set()
  for topic in topics["topics"]:
    for step in topic["steps"]:
      person_ids.update(step.get("people") or [])
      for entry in step.get("entries") or []:
        if entry.get("ref"):
          evidence_ids.add(entry["ref"])
        if entry.get("event"):
          event_ids.add(entry["event"])
      for line in step.get("intro") or []:
        evidence_ids.update(line.get("evidence") or [])
  return evidence_ids, event_ids, person_ids


def build_projection(catalog: dict, topics: dict) -> dict:
  evidence_by_id = {row["id"]: row for row in catalog["evidence"]}
  events_by_id = {row["id"]: row for row in catalog["events"]}
  persons_by_id = {row["id"]: row for row in catalog["persons"]}

  evidence_ids, event_ids, person_ids = collect_ids(topics)

  # card() keeps event.time while overriding accounts; include those evidence rows.
  for event_id in list(event_ids):
    event = events_by_id.get(event_id)
    if not event:
      raise SystemExit(f"missing event in catalog: {event_id}")
    evidence_ids.update(event.get("time", {}).get("evidence") or [])

  missing_evidence = sorted(evidence_ids - evidence_by_id.keys())
  missing_events = sorted(event_ids - events_by_id.keys())
  missing_people = sorted(person_ids - persons_by_id.keys())
  if missing_evidence or missing_events or missing_people:
    raise SystemExit(
      "catalog is missing topic dependencies: "
      f"evidence={missing_evidence} events={missing_events} people={missing_people}"
    )

  for evidence_id, expected in topics["bindings"].items():
    actual = digest(evidence_by_id[evidence_id])
    if actual != expected:
      raise SystemExit(f"evidence digest mismatch for {evidence_id}: {actual} != {expected}")
  for event_id, expected in topics["event_bindings"].items():
    actual = digest(events_by_id[event_id])
    if actual != expected:
      raise SystemExit(f"event digest mismatch for {event_id}: {actual} != {expected}")

  # Keep the full section_sha256 map like other runtime packs (highlights/directory).
  return {
    "schema_version": 2,
    "source_sha256": catalog["source_sha256"],
    "section_sha256": catalog["section_sha256"],
    "events": [events_by_id[event_id] for event_id in sorted(event_ids)],
    "persons": [persons_by_id[person_id] for person_id in sorted(person_ids)],
    "evidence": [evidence_by_id[evidence_id] for evidence_id in sorted(evidence_ids)],
    "profiles": {},
    "directory_counts": {},
  }


def main(argv: list[str]) -> int:
  root = Path(__file__).resolve().parents[1]
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument(
    "--catalog",
    type=Path,
    default=root / "site/reader/knowledge/catalog.json",
  )
  parser.add_argument(
    "--topics",
    type=Path,
    default=root / "site/reader/knowledge/topics.json",
  )
  parser.add_argument(
    "--out",
    type=Path,
    default=root / "site/reader/knowledge/runtime/topics-catalog.json",
  )
  args = parser.parse_args(argv)

  catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
  topics = json.loads(args.topics.read_text(encoding="utf-8"))
  if catalog["source_sha256"] != topics["source_sha256"]:
    raise SystemExit("catalog and topics source_sha256 differ")

  projection = build_projection(catalog, topics)
  args.out.parent.mkdir(parents=True, exist_ok=True)
  args.out.write_text(
    json.dumps(projection, ensure_ascii=False, separators=(",", ":")) + "\n",
    encoding="utf-8",
  )
  size = args.out.stat().st_size
  print(
    f"wrote {args.out.relative_to(root)} ({size:,} bytes); "
    f"events={len(projection['events'])} "
    f"persons={len(projection['persons'])} "
    f"evidence={len(projection['evidence'])}"
  )
  return 0


if __name__ == "__main__":
  sys.exit(main(sys.argv[1:]))
