from pathlib import Path
import tempfile
import unittest
import zipfile

from native_host import digest, extract_download, handle, safe_relative, unique_target


class NativeHostTests(unittest.TestCase):
    def test_digest_and_unique_target(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            item = root / "photo.zip"
            item.write_bytes(b"original bytes")
            self.assertEqual(digest(item), "52c3935626c104b2cbc9031291a1c4d56614c38f52072a361d658a58a9c48698")
            self.assertEqual(unique_target(root, "photo.zip").name, "photo-1.zip")

    def test_status_rejects_unmounted_destination(self):
        with self.assertRaisesRegex(ValueError, "sotto /Volumes"):
            handle({"command": "status", "destination": "/tmp/photos"})

    def test_extracts_zip_into_one_media_tree_and_deduplicates_identical_files(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "photos.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("Google Photos/2025/foto.jpg", b"original")
                bundle.writestr("Google Photos/2025/video.mov", b"video")
            media = root / "Media"
            first = extract_download(archive, media, True)
            second = extract_download(archive, media, True)
            self.assertEqual(len(first), 2)
            self.assertEqual(len(second), 2)
            self.assertEqual(len(list(media.rglob("foto.jpg"))), 1)
            self.assertEqual((media / "Google Photos/2025/foto.jpg").read_bytes(), b"original")

    def test_rejects_zip_path_traversal(self):
        with self.assertRaisesRegex(ValueError, "non sicuro"):
            safe_relative("../../escape.jpg")


if __name__ == "__main__":
    unittest.main()
