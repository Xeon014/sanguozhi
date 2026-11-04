"""Regression tests for fail-closed release validation (stdlib only)."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check-release-gate.py"
SPEC = importlib.util.spec_from_file_location("release_gate", SCRIPT)
gate_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate_module)


class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.reader = self.root / "reader"
        self.runtime = self.reader / "knowledge" / "runtime"
        self.sha = "a" * 64
        self.section_map = {"chapter-001": "b" * 64, "chapter-002": "c" * 64}
        self.write("index.html", "reader/")
        self.write('reader/index.html', 'id="main" reader.js reader.css href="#/"')
        for name in gate_module.SHELL_JS:
            self.write("reader/" + name, "")
        self.write("reader/reader.js", "async function boot loadTopics source_sha256 #/contents")
        self.write("reader/reader.css", "")
        self.write_json("reader/config.json", {
            "dataRoot": "data/", "bookFile": "knowledge/runtime/book.json",
            "runtimeRoot": "knowledge/runtime/",
        })
        self.write_json("reader/site.json", {})
        self.write_json("reader/data/sections/chapter-001.json", {})
        for name in gate_module.RUNTIME_INDEX_FILES:
            self.write_json("reader/knowledge/runtime/" + name, {
                "source_sha256": self.sha,
            })
        self.write_json("reader/knowledge/runtime/fingerprints.json", {
            "source_sha256": self.sha, "section_sha256": self.section_map,
        })
        self.write_json("reader/knowledge/runtime/events-index.json", {
            "source_sha256": self.sha,
        })
        for sid in self.section_map:
            self.write_json(f"reader/knowledge/runtime/anchors/{sid}.json", {})
        self.write_json("reader/knowledge/topics.json", {
            "source_sha256": self.sha, "topics": [{"id": "chibi"}],
        })
        self.write_json("reader/knowledge/runtime/topics/chibi.json", {
            "source_sha256": self.sha,
        })
        for sub in ("people", "events", "sources"):
            self.write_shard(sub)
        for name in ("zh-display.json", "atlas-records.json"):
            self.write_json("reader/knowledge/" + name, {"source_sha256": self.sha})

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def write_json(self, relative, value):
        self.write(relative, json.dumps(value))

    def write_shard(self, sub, sha=None, section_map=False):
        value = {"source_sha256": sha or self.sha}
        if section_map:
            value["section_sha256"] = self.section_map
        self.write_json(f"reader/knowledge/runtime/{sub}/sample.json", value)

    def make_legacy(self):
        """Swap the slim markers for the legacy layout markers."""
        (self.runtime / "fingerprints.json").unlink()
        (self.runtime / "events-index.json").unlink()
        self.write_json("reader/knowledge/runtime/manifest.json", {
            "source_sha256": self.sha, "files": {},
        })
        self.write_json("reader/knowledge/runtime/anchors.json", {
            "source_sha256": self.sha,
        })
        self.write_json("reader/knowledge/runtime/directory.json", {
            "source_sha256": self.sha, "section_sha256": self.section_map,
        })
        for sub in ("people", "events", "sources"):
            self.write_shard(sub, section_map=True)

    def run_gate(self):
        output = io.StringIO()
        with patch("sys.argv", [str(SCRIPT), "--root", str(self.root)]):
            with contextlib.redirect_stdout(output):
                result = gate_module.main()
        return result, output.getvalue()

    def test_valid_fixture_passes_without_catalog(self):
        # The slimmed export ships no catalog.json; the gate must accept that.
        self.assertFalse((self.reader / "knowledge" / "catalog.json").exists())
        result, output = self.run_gate()
        self.assertEqual(result, 0, output)
        self.assertIn("PASSED", output)

    def test_non_object_config_and_site_fail(self):
        for name in ("config.json", "site.json"):
            original = (self.reader / name).read_text()
            for value in (None, [], "invalid", 0, False):
                with self.subTest(file=name, value=value):
                    self.write_json("reader/" + name, value)
                    result, output = self.run_gate()
                    self.assertEqual(result, 1, output)
                    self.assertIn(f"{name}: must be a JSON object", output)
                    self.assertNotIn("PASSED", output)
            self.write("reader/" + name, original)

    def test_sampled_shard_requires_matching_source_sha(self):
        for sub in ("people", "events", "sources"):
            with self.subTest(shard_type=sub, case="wrong sha"):
                self.write_shard(sub, "d" * 64)
                result, output = self.run_gate()
                self.assertEqual(result, 1, output)
                self.assertIn("source_sha256 mismatch or missing", output)
                self.assertNotIn("PASSED", output)
            with self.subTest(shard_type=sub, case="missing sha"):
                self.write_json(f"reader/knowledge/runtime/{sub}/sample.json", {})
                result, output = self.run_gate()
                self.assertEqual(result, 1, output)
                self.assertNotIn("PASSED", output)
            self.write_shard(sub)

    def test_fingerprints_requires_section_map(self):
        for value in (None, [], "invalid"):
            with self.subTest(value=value):
                self.write_json("reader/knowledge/runtime/fingerprints.json", {
                    "source_sha256": self.sha, "section_sha256": value,
                })
                result, output = self.run_gate()
                self.assertEqual(result, 1, output)
                self.assertIn("runtime/fingerprints.json: section_sha256 must be an object", output)
        self.write_json("reader/knowledge/runtime/fingerprints.json", {"source_sha256": self.sha})
        result, output = self.run_gate()
        self.assertEqual(result, 1, output)
        self.assertIn("runtime/fingerprints.json: section_sha256 must be an object", output)

    def test_missing_anchor_index_fails(self):
        (self.runtime / "anchors" / "chapter-001.json").unlink()
        result, output = self.run_gate()
        self.assertEqual(result, 1, output)
        self.assertIn("runtime/anchors/ missing per-chapter indexes: chapter-001", output)

    def test_missing_topic_bundle_fails(self):
        (self.runtime / "topics" / "chibi.json").unlink()
        result, output = self.run_gate()
        self.assertEqual(result, 1, output)
        self.assertIn("runtime/topics/ missing bundles: chibi", output)

    def test_topic_bundle_source_sha_mismatch_fails(self):
        self.write_json("reader/knowledge/runtime/topics/chibi.json", {
            "source_sha256": "d" * 64,
        })
        result, output = self.run_gate()
        self.assertEqual(result, 1, output)
        self.assertIn("source_sha256 mismatch", output)
        self.assertNotIn("PASSED", output)

    def test_legacy_fixture_passes(self):
        self.make_legacy()
        result, output = self.run_gate()
        self.assertEqual(result, 0, output)
        self.assertIn("PASSED", output)

    def test_legacy_shard_map_divergence_fails(self):
        self.make_legacy()
        self.write_json("reader/knowledge/runtime/people/sample.json", {
            "source_sha256": self.sha,
            "section_sha256": {**self.section_map, "chapter-001": "d" * 64},
        })
        result, output = self.run_gate()
        self.assertEqual(result, 1, output)
        self.assertIn("section_sha256 values diverge from directory", output)

    def test_mixed_layout_markers_fail(self):
        self.make_legacy()  # keeps manifest.json; re-add a slim marker
        self.write_json("reader/knowledge/runtime/fingerprints.json", {
            "source_sha256": self.sha, "section_sha256": self.section_map,
        })
        result, output = self.run_gate()
        self.assertEqual(result, 1, output)
        self.assertIn("runtime mixes legacy and slim layout markers", output)

    def test_missing_layout_markers_fail(self):
        (self.runtime / "fingerprints.json").unlink()
        (self.runtime / "events-index.json").unlink()
        result, output = self.run_gate()
        self.assertEqual(result, 1, output)
        self.assertIn("runtime layout markers missing", output)


if __name__ == "__main__":
    unittest.main()
