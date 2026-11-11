"""Keep the public site identity consistent after export."""

import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
READER = ROOT / "site" / "reader"
REMOVED_FRONT_MATTER_IMAGES = (
    "cover.jpeg",
    "OEBPS/Images/00121.jpg",
    "OEBPS/Images/00119.jpg",
)


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


class PublishedMetadataTests(unittest.TestCase):
    def test_public_descriptions_use_the_site_name(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        llms = (ROOT / "site" / "llms.txt").read_text(encoding="utf-8")
        self.assertEqual(readme.split("\n\n")[1], "这是三国志。")
        self.assertEqual(llms.split("\n\n")[1], "> 这是三国志。")

    def test_metadata_projections_match_without_source_edition_fields(self):
        source = load_json(READER / "data" / "book.json")
        runtime = load_json(READER / "knowledge" / "runtime" / "book.json")
        self.assertEqual(source, runtime)
        self.assertEqual(source["title"], "三国志")
        for field in ("translator", "publisher", "edition_note", "source_filename"):
            self.assertNotIn(field, source)
        self.assertEqual(source["author"], "陈寿")
        self.assertEqual(source["annotator"], "裴松之")

    def test_static_chapter_metadata_identifies_the_site(self):
        pages = sorted((READER / "read").glob("chapter-*.html"))
        self.assertEqual(len(pages), 65)
        for page in pages:
            with self.subTest(page=page.name):
                match = re.search(
                    r'<script type="application/ld\+json">(.*?)</script>',
                    page.read_text(encoding="utf-8"),
                )
                self.assertIsNotNone(match)
                page_metadata = json.loads(match[1])
                self.assertEqual(page_metadata["@type"], "WebPage")
                self.assertEqual(page_metadata["isPartOf"], {"@type": "WebSite", "name": "三国志"})

    def test_intro_sections_use_the_site_name_and_keep_original_anchors(self):
        book = load_json(READER / "data" / "book.json")
        titles = {entry["id"]: entry["title"] for entry in book["sections"]}
        for sid in ("extra-000", "extra-001", "extra-002"):
            with self.subTest(section=sid):
                section = load_json(READER / "data" / "sections" / f"{sid}.json")
                self.assertEqual(titles[sid], "三国志")
                self.assertEqual(section["title"], "三国志")
                self.assertEqual(len(section["blocks"]), 1)
                blocks = {block["id"]: block for block in section["blocks"]}
                block = section["blocks"][0]
                self.assertEqual(block["text"], "三国志")
                self.assertEqual(block["tokens"], [{"type": "text", "text": "三国志"}])
                anchors = load_json(READER / "knowledge" / "runtime" / "anchors" / f"{sid}.json")
                for target in anchors.values():
                    if target.get("block"):
                        self.assertIn(target["block"], blocks)

    def test_removed_images_are_not_published_or_referenced(self):
        book = load_json(READER / "data" / "book.json")
        for image in REMOVED_FRONT_MATTER_IMAGES:
            self.assertNotIn(image, book["assets"])
            self.assertFalse((READER / "data" / "resources" / image).exists())
        for path in (READER / "data" / "sections").glob("*.json"):
            section = load_json(path)
            for block in section["blocks"]:
                for token in block["tokens"]:
                    if token["type"] == "image":
                        with self.subTest(section=path.name, image=token["path"]):
                            self.assertNotIn(token["path"], REMOVED_FRONT_MATTER_IMAGES)
                            # The reader has a text fallback for source glyphs
                            # absent from the original EPUB asset manifest.
                            if token["path"] in book["assets"]:
                                self.assertTrue((READER / "data" / "resources" / token["path"]).is_file())

    def test_preface_retains_date_and_place(self):
        preface = load_json(READER / "data" / "sections" / "extra-004.json")
        last = preface["blocks"][-1]
        expected = "公元 2020 年 6 月夏日 于成都濯锦江畔双桐荫馆寓所"
        self.assertEqual(last["text"], expected)
        self.assertEqual(last["tokens"], [{"type": "text", "text": expected}])


if __name__ == "__main__":
    unittest.main()
