from pathlib import Path
import tempfile
import unittest

from scripts.prepare_mdx import check_markdown, prepare


class PrepareMdxTests(unittest.TestCase):
    def test_renames_and_marks_mdx_notes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "hw/bench.mdx"
            note.parent.mkdir()
            note.write_text("---\ntitle: Bench\n---\n\nText\n\n<Chart />\n", encoding="utf-8")

            target = prepare(note)

            self.assertEqual(target, note.with_suffix(".md"))
            self.assertFalse(note.exists())
            self.assertEqual(
                target.read_text(encoding="utf-8"),
                "---\nmdx: true\ntitle: Bench\n---\n\nText\n\n<Chart />\n",
            )

    def test_refuses_a_note_that_exists_as_both(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.mdx").write_text("---\ntitle: A\n---\n", encoding="utf-8")
            (root / "a.md").write_text("---\ntitle: A\n---\n", encoding="utf-8")
            with self.assertRaises(SystemExit):
                prepare(root / "a.mdx")

    def test_refuses_mdx_flag_on_markdown(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.md").write_text("---\ntitle: A\nmdx: true\n---\n", encoding="utf-8")
            with self.assertRaises(SystemExit):
                check_markdown(root)


if __name__ == "__main__":
    unittest.main()
