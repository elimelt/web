from pathlib import Path
import tempfile
import unittest

from scripts.self_host_katex import copy_assets, rewrite_pages


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


CSS = (
    '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),'
    'url(fonts/KaTeX_Main-Regular.woff) format("woff"),'
    'url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}.katex{font:normal 1.21em KaTeX_Main}'
)


class SelfHostKatexTests(unittest.TestCase):
    def test_copies_woff2_only_and_rewrites_pages(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            katex = root / "katex"
            write(katex / "dist/katex.min.css", CSS)
            write(katex / "dist/contrib/copy-tex.min.js", "copy")
            for ext in ("woff2", "woff", "ttf"):
                write(katex / f"dist/fonts/KaTeX_Main-Regular.{ext}", ext)

            site = root / "public"
            cdn = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/"
            write(site / "note.html", f'<link href="{cdn}katex.min.css"><script src="{cdn}contrib/copy-tex.min.js">')
            write(site / "docs/old.html", f'<link href="{cdn}katex.min.css">')
            write(site / "plain.html", "<p>no math</p>")

            fonts = copy_assets(katex, site / "static/katex/0.16.47")
            pages = rewrite_pages(site, "/static/katex/0.16.47/")

            css = (site / "static/katex/0.16.47/katex.min.css").read_text(encoding="utf-8")
            self.assertEqual(fonts, 1)
            self.assertNotIn(".woff)", css)
            self.assertNotIn(".ttf)", css)
            self.assertIn('url(fonts/KaTeX_Main-Regular.woff2) format("woff2")}', css)
            self.assertEqual(
                sorted(p.name for p in (site / "static/katex/0.16.47/fonts").iterdir()),
                ["KaTeX_Main-Regular.woff2"],
            )
            self.assertTrue((site / "static/katex/0.16.47/contrib/copy-tex.min.js").is_file())
            self.assertEqual(pages, 1)
            note = (site / "note.html").read_text(encoding="utf-8")
            self.assertIn('href="/static/katex/0.16.47/katex.min.css"', note)
            self.assertIn('src="/static/katex/0.16.47/contrib/copy-tex.min.js"', note)
            self.assertIn(cdn, (site / "docs/old.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
