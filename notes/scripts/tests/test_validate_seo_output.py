from pathlib import Path
import tempfile
import unittest

from scripts.validate_seo_output import expected_canonical, validate


class ValidateSeoOutputTests(unittest.TestCase):
    def test_expected_canonical_normalizes_index_pages(self) -> None:
        root = Path("/tmp/public")
        self.assertEqual(expected_canonical(root, root / "index.html"), "https://notes.elimelt.com/")
        self.assertEqual(
            expected_canonical(root, root / "tags" / "cpu.html"),
            "https://notes.elimelt.com/tags/cpu",
        )
        self.assertEqual(
            expected_canonical(root, root / "algorithms" / "index.html"),
            "https://notes.elimelt.com/algorithms/",
        )

    def test_validate_accepts_consistent_quartz_and_graph_pages(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "robots.txt").write_text(
                "User-agent: *\nAllow: /\n\nSitemap: https://notes.elimelt.com/sitemap.xml\n"
            )
            (root / "sitemap.xml").write_text(
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                "<url><loc>https://notes.elimelt.com/</loc></url>"
                "</urlset>"
            )
            (root / "index.html").write_text(
                '<meta name="generator" content="Quartz">'
                '<link rel="canonical" href="https://notes.elimelt.com/">'
                '<meta property="og:url" content="https://notes.elimelt.com/">'
                '<meta property="twitter:url" content="https://notes.elimelt.com/">'
                '<meta property="og:image:type" content="image/png">'
            )
            graph = root / "graph"
            graph.mkdir()
            (graph / "index.html").write_text(
                '<link rel="canonical" href="https://notes.elimelt.com/graph/">'
                '<meta property="og:url" content="https://notes.elimelt.com/graph/">'
            )
            self.assertEqual(validate(root), [])

    def test_validate_rejects_duplicate_or_index_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "robots.txt").write_text(
                "Sitemap: https://notes.elimelt.com/sitemap.xml\n"
            )
            (root / "sitemap.xml").write_text(
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                "<url><loc>https://notes.elimelt.com/</loc></url>"
                "</urlset>"
            )
            (root / "index.html").write_text(
                '<meta name="generator" content="Quartz">'
                '<link rel="canonical" href="https://notes.elimelt.com/index">'
                '<link rel="canonical" href="https://notes.elimelt.com/">'
                '<meta property="og:url" content="https://notes.elimelt.com/index">'
            )
            errors = validate(root)
            self.assertTrue(any("canonical" in error for error in errors))
            self.assertTrue(any("og:url" in error for error in errors))

    def _minimal_site(self, root: Path) -> None:
        (root / "robots.txt").write_text("Sitemap: https://notes.elimelt.com/sitemap.xml\n")
        (root / "sitemap.xml").write_text(
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            "<url><loc>https://notes.elimelt.com/new-name</loc></url>"
            "</urlset>"
        )
        (root / "new-name.html").write_text(
            '<meta name="generator" content="Quartz">'
            '<link rel="canonical" href="https://notes.elimelt.com/new-name">'
            '<meta property="og:url" content="https://notes.elimelt.com/new-name">'
            '<meta property="twitter:url" content="https://notes.elimelt.com/new-name">'
        )
        graph = root / "graph"
        graph.mkdir()
        (graph / "index.html").write_text(
            '<link rel="canonical" href="https://notes.elimelt.com/graph/">'
            '<meta property="og:url" content="https://notes.elimelt.com/graph/">'
        )

    def test_validate_rejects_noindex_alias_pages(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._minimal_site(root)
            (root / "old-name.html").write_text(
                '<meta name="robots" content="noindex">'
                '<meta http-equiv="refresh" content="0; url=new-name">'
                '<link rel="canonical" href="new-name">'
            )
            errors = validate(root)
            self.assertTrue(any("noindex" in error for error in errors))
            self.assertTrue(any("meta refresh" in error for error in errors))

    def test_validate_accepts_single_hop_redirects(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._minimal_site(root)
            (root / "_redirects").write_text(
                "# comment\n/old-name /new-name 301\n/tags/old%20tag.html /new-name 301\n"
            )
            self.assertEqual(validate(root), [])

    def test_validate_rejects_bad_redirects(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._minimal_site(root)
            (root / "_redirects").write_text(
                "/new-name /elsewhere 301\n/a /b 301\n/b /new-name 301\n/c /new-name 302\n"
            )
            errors = validate(root)
            self.assertTrue(any("hides a page" in error for error in errors))
            self.assertTrue(any("missing page" in error for error in errors))
            self.assertTrue(any("chains" in error for error in errors))
            self.assertTrue(any("malformed" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
