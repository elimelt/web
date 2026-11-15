from pathlib import Path
import tempfile
import unittest

from scripts.patch_content_meta_dates import MARKER, NEW, OLD, patch


class PatchContentMetaDatesTests(unittest.TestCase):
    def write(self, text: str) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "index.js"
        path.write_text(text)
        return path

    def test_replaces_single_date_block(self) -> None:
        path = self.write(f"before\n{OLD}\nafter\n")
        patch(path)
        source = path.read_text()
        self.assertIn(MARKER, source)
        self.assertIn('"Created "', source)
        self.assertIn('"Updated "', source)
        self.assertNotIn(OLD, source)

    def test_is_idempotent(self) -> None:
        path = self.write(f"{OLD}\n")
        patch(path)
        once = path.read_text()
        patch(path)
        self.assertEqual(once, path.read_text())

    def test_refuses_changed_upstream(self) -> None:
        path = self.write("something else\n")
        with self.assertRaises(SystemExit):
            patch(path)

    def test_refuses_partial_patch(self) -> None:
        path = self.write(f"{MARKER}\n")
        with self.assertRaises(SystemExit):
            patch(path)
        self.assertIn("Created", NEW)


if __name__ == "__main__":
    unittest.main()
