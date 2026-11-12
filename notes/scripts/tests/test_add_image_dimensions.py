import base64
from pathlib import Path
import struct
import tempfile
import unittest

from scripts.add_image_dimensions import annotate, image_size


def png(width: int, height: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", width, height) + b"\x08\x06\x00\x00\x00"


class AddImageDimensionsTests(unittest.TestCase):
    def test_reads_png_and_gif_sizes(self) -> None:
        self.assertEqual(image_size(png(640, 480)), (640, 480))
        self.assertEqual(image_size(b"GIF89a" + struct.pack("<HH", 3, 7)), (3, 7))
        self.assertIsNone(image_size(b"\xff\xd8\xff\xe0" + b"\x00" * 20))

    def test_annotates_local_and_data_images(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "notes" / "page.html"
            page.parent.mkdir()
            (root / "notes" / "plot one.png").write_bytes(png(800, 600))
            data = base64.b64encode(png(20, 10) + b"rest").decode()
            html = (
                '<img src="plot%20one.png" alt="a"/>'
                f'<img src="data:image/png;base64,{data}" alt="b">'
                '<img src="missing.png" width="5" height="5" loading="eager">'
            )
            updated, changed = annotate(root, page, html)
            self.assertEqual(changed, 3)
            self.assertIn('<img src="plot%20one.png" alt="a" width="800" height="600" decoding="async"/>', updated)
            self.assertIn('alt="b" width="20" height="10" loading="lazy" decoding="async">', updated)
            self.assertIn('loading="eager" decoding="async">', updated)
            self.assertNotIn('width="5" height="5" width=', updated)


if __name__ == "__main__":
    unittest.main()
