"""CLI regression tests for topic projection output paths (stdlib only)."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/build-topics-catalog.py"


class OutputPathTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.workspace = Path(self.temporary.name)
        self.repository = self.workspace / "repo"
        self.script = self.repository / "scripts/build-topics-catalog.py"
        self.script.parent.mkdir(parents=True)
        shutil.copyfile(SCRIPT, self.script)
        self.knowledge = self.repository / "site/reader/knowledge"
        self.knowledge.mkdir(parents=True)
        catalog = {
            "source_sha256": "fixture-source",
            "section_sha256": {"chapter-001": "fixture-section"},
            "events": [],
            "persons": [],
            "evidence": [],
        }
        topics = {
            "source_sha256": catalog["source_sha256"],
            "bindings": {},
            "event_bindings": {},
            "topics": [],
        }
        (self.knowledge / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
        (self.knowledge / "topics.json").write_text(json.dumps(topics), encoding="utf-8")
        self.expected = {
            "schema_version": 2,
            **catalog,
            "profiles": {},
            "directory_counts": {},
        }

    def assert_build(self, argument: str | None, output: Path, *, cwd: Path | None = None) -> None:
        command = [sys.executable, str(self.script)]
        if argument is not None:
            command.extend(["--out", argument])
        result = subprocess.run(
            command,
            cwd=cwd or self.repository,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(output.read_text(encoding="utf-8")), self.expected)
        self.assertIn("wrote ", result.stdout)
        self.assertIn("events=0 persons=0 evidence=0", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_default_output(self) -> None:
        self.assert_build(None, self.knowledge / "runtime/topics-catalog.json")

    def test_relative_output(self) -> None:
        output = "generated/relative.json"
        self.assert_build(output, self.repository / output)

    def test_absolute_output_inside_repository(self) -> None:
        output = self.repository / "generated/absolute.json"
        self.assert_build(str(output), output)

    def test_absolute_output_outside_repository(self) -> None:
        output = self.workspace / "outside/absolute.json"
        self.assert_build(str(output), output)

    def test_relative_output_uses_callers_working_directory(self) -> None:
        output = "outside/relative.json"
        self.assert_build(output, self.workspace / output, cwd=self.workspace)


if __name__ == "__main__":
    unittest.main()
