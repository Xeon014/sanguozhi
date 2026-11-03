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
                "source_sha256": self.sha, "section_sha256": self.section_map,
                "files": {},
            })
        for sub in ("people", "events", "sources"):
            self.write_shard(sub, self.section_map)
        for name in ("zh-display.json", "atlas-records.json"):
            self.write_json("reader/knowledge/" + name, {"source_sha256": self.sha})

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def write_json(self, relative, value):
        self.write(relative, json.dumps(value))

    def write_shard(self, sub, section_map, *, omit=False):
        value = {"source_sha256": self.sha}
        if not omit:
            value["section_sha256"] = section_map
        self.write_json(f"reader/knowledge/runtime/{sub}/sample.json", value)

    def run_gate(self):
        output = io.StringIO()
        with patch("sys.argv", [str(SCRIPT), "--root", str(self.root)]):
            with contextlib.redirect_stdout(output):
                result = gate_module.main()
        return result, output.getvalue()

    def test_valid_fixture_passes(self):
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

    def test_sampled_shard_requires_complete_matching_section_map(self):
        cases = {
            "missing key": {"chapter-001": "b" * 64},
            "empty map": {},
            "extra key": {**self.section_map, "chapter-003": "d" * 64},
            "wrong digest": {**self.section_map, "chapter-001": "d" * 64},
            "null": None,
            "array": [],
            "string": "invalid",
        }
        for sub in ("people", "events", "sources"):
            for label, section_map in cases.items():
                with self.subTest(shard_type=sub, case=label):
                    self.write_shard(sub, section_map)
                    result, output = self.run_gate()
                    self.assertEqual(result, 1, output)
                    self.assertIn("sample.json: section_sha256", output)
                    self.assertNotIn("PASSED", output)
            with self.subTest(shard_type=sub, case="missing map"):
                self.write_shard(sub, None, omit=True)
                result, output = self.run_gate()
                self.assertEqual(result, 1, output)
                self.assertIn("sample.json: section_sha256 must be an object", output)
            self.write_shard(sub, self.section_map)

    def test_directory_requires_section_map(self):
        for value in (None, [], "invalid"):
            with self.subTest(value=value):
                self.write_json("reader/knowledge/runtime/directory.json", {
                    "source_sha256": self.sha, "section_sha256": value,
                })
                result, output = self.run_gate()
                self.assertEqual(result, 1, output)
                self.assertIn("runtime/directory.json: section_sha256 must be an object", output)
        self.write_json("reader/knowledge/runtime/directory.json", {"source_sha256": self.sha})
        result, output = self.run_gate()
        self.assertEqual(result, 1, output)
        self.assertIn("runtime/directory.json: section_sha256 must be an object", output)


if __name__ == "__main__":
    unittest.main()
