from pathlib import Path
import tempfile
import unittest

from scripts.write_redirects import build_redirects, slug_tag


def write(path: Path, text: str = "page") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


ALIAS = (
    '<html><head><title>x</title><link rel="canonical" href="{target}">'
    '<meta name="robots" content="noindex"><meta charset="utf-8">'
    '<meta http-equiv="refresh" content="0; url={target}"></head></html>'
)


class WriteRedirectsTests(unittest.TestCase):
    def test_slug_tag_matches_quartz(self) -> None:
        self.assertEqual(slug_tag("graph theory"), "graph-theory")
        self.assertEqual(slug_tag("CPU utilization"), "cpu-utilization")
        self.assertEqual(slug_tag("I/O devices"), "i/o-devices")
        self.assertEqual(slug_tag("R&D"), "r-and-d")

    def test_alias_pages_become_301s_and_are_removed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write(root / "systems" / "networks" / "arp.html")
            stub = root / "networks" / "arp.html"
            write(stub, ALIAS.format(target="../systems/networks/arp"))
            redirects, stubs = build_redirects(root, [])
            self.assertEqual(stubs, [stub])
            self.assertIn(("/networks/arp", "/systems/networks/arp"), redirects)
            self.assertIn(("/networks/arp.html", "/systems/networks/arp"), redirects)

    def test_legacy_tags_redirect_to_current_tag_or_index(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write(root / "tags" / "index.html")
            write(root / "tags" / "graph-theory.html")
            write(root / "tags" / "cpu.html")
            redirects, _ = build_redirects(root, ["graph theory", "cpu", "Gone Tag"])
            self.assertIn(("/tags/graph%20theory.html", "/tags/graph-theory"), redirects)
            self.assertIn(("/tags/graph%20theory", "/tags/graph-theory"), redirects)
            self.assertIn(("/tags/Gone%20Tag.html", "/tags/"), redirects)
            # /tags/cpu.html still serves a page, so it needs no rule.
            self.assertFalse(any(source.startswith("/tags/cpu") for source, _ in redirects))

    def test_legacy_pages_match_case_insensitively(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write(root / "systems" / "networks" / "arp.html")
            write(root / "networks" / "arp.html", ALIAS.format(target="../systems/networks/arp"))
            redirects, _ = build_redirects(root, [], ["/networks/ARP.html", "/gone/Page.html"])
            self.assertIn(("/networks/ARP.html", "/systems/networks/arp"), redirects)
            self.assertFalse(any(source.startswith("/gone") for source, _ in redirects))

    def test_never_hides_a_real_page(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write(root / "tags" / "edge-computing.html")
            write(root / "tags" / "edge computing.html")
            redirects, _ = build_redirects(root, ["edge computing"])
            self.assertEqual(redirects, [])


if __name__ == "__main__":
    unittest.main()
