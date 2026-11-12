from pathlib import Path
import tempfile
import unittest

from scripts.fix_sitemap_lastmod import collect_notes, note_path, rewrite_sitemap


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def entry(path: str, lastmod: str = "2026-11-12T21:08:13.596Z") -> str:
    return f"<url>\n    <loc>https://notes.example.com{path}</loc>\n    <lastmod>{lastmod}</lastmod>\n  </url>"


class FixSitemapLastmodTests(unittest.TestCase):
    def test_note_path_matches_quartz_slugs(self) -> None:
        self.assertEqual(note_path(Path("systems/networks/3-network/ARP.md")), "/systems/networks/3-network/arp")
        self.assertEqual(note_path(Path("math/index.md")), "/math/")
        self.assertEqual(note_path(Path("index.md")), "/")
        self.assertEqual(note_path(Path("a b/R&D.md")), "/a-b/r-and-d")

    def test_uses_content_dates_for_notes_tags_and_folders(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            content = Path(tmp)
            write(content / "index.md", "---\ntitle: Home\ndate: 2024-01-01\n---\n")
            write(
                content / "sys/net/ARP.md",
                "---\ntitle: ARP\ndate: 2024-02-01\nupdated: 2026-07-30\ntags:\n  - networks/link\n  - arp\n---\n",
            )
            write(content / "sys/os/sched.md", "---\ntitle: Sched\ndate: 2026-08-01\ntags: [os]\n---\n")
            write(content / "sys/os/undated.md", "---\ntitle: Undated\n---\n")
            notes = collect_notes(content)

            xml = "<urlset>" + "".join(
                entry(path)
                for path in [
                    "/sys/net/arp",
                    "/sys/os/sched",
                    "/sys/os/undated",
                    "/tags/networks",
                    "/tags/os",
                    "/tags/missing",
                    "/tags/",
                    "/sys/",
                    "/sys/net/",
                    "/",
                ]
            ) + "</urlset>"
            rewritten, missing = rewrite_sitemap(xml, notes)

        expected = {
            "/sys/net/arp": "2026-07-30",
            "/sys/os/sched": "2026-08-01",
            "/tags/networks": "2026-07-30",
            "/tags/os": "2026-08-01",
            "/tags/": "2026-08-01",
            "/sys/": "2026-08-01",
            "/sys/net/": "2026-07-30",
            "/": "2026-08-01",
        }
        for path, lastmod in expected.items():
            self.assertIn(f"<loc>https://notes.example.com{path}</loc>\n    <lastmod>{lastmod}</lastmod>", rewritten)
        self.assertIn("<loc>https://notes.example.com/sys/os/undated</loc>\n  </url>", rewritten)
        self.assertIn("<loc>https://notes.example.com/tags/missing</loc>\n  </url>", rewritten)
        self.assertEqual(missing, 2)
        self.assertNotIn("T21:08", rewritten)


if __name__ == "__main__":
    unittest.main()
