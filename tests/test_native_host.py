from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from native_host import digest, extract_download, handle, preserve_incomplete_archive, safe_relative, unique_target


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

    def test_move_rejects_files_outside_configured_download_folder(self):
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "local.zip"
            source.write_bytes(b"local")
            with patch("native_host.module.mounted_destination", return_value=Path(raw) / "nas"):
                with self.assertRaisesRegex(ValueError, "non si trova sotto"):
                    handle({"command": "move", "destination": "/Volumes/MyCloud", "downloadRoot": str(Path(raw) / "other"), "source": str(source)})

    def test_prepare_validates_local_download_directory(self):
        with tempfile.TemporaryDirectory() as raw:
            destination = Path(raw) / "GooglePhotos"
            downloads = Path(raw) / "Downloads"
            downloads.mkdir()
            with patch("native_host.module.mounted_destination", return_value=destination):
                result = handle({"command": "prepare", "destination": "/Volumes/MyCloud/GooglePhotos", "downloadRoot": str(downloads)})
            self.assertEqual(result["downloadPath"], str(downloads))

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

    def test_extraction_reports_monotonic_file_level_progress(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "photos.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                for index in range(4):
                    bundle.writestr(f"foto-{index}.jpg", f"data-{index}".encode())
            events = []
            extract_download(archive, root / "Media", True, "b" * 64, events.append)
            percentages = [event["percent"] for event in events]
            self.assertGreater(len(events), 4)
            self.assertEqual(percentages, sorted(percentages))
            self.assertEqual(percentages[-1], 95)
            self.assertEqual(events[-1]["current"], 4)

    def test_incomplete_archive_is_verified_on_nas_before_local_removal(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            source = root / "download.zip"
            source.write_bytes(b"partial but valuable")
            checksum = digest(source)
            target = preserve_incomplete_archive(source, root / "nas", checksum)
            self.assertFalse(source.exists())
            self.assertEqual(digest(target), checksum)
            self.assertEqual(target.parent.name, "IncompleteArchives")

    def test_rejects_zip_path_traversal(self):
        with self.assertRaisesRegex(ValueError, "non sicuro"):
            safe_relative("../../escape.jpg")

    def test_conflicting_content_keeps_the_original_filename(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            media = root / "Media"
            media.mkdir()
            (media / "foto.jpg").write_bytes(b"first")
            archive = root / "second.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("foto.jpg", b"second")
            files = extract_download(archive, media, True, "a" * 64)
            published = media / files[0]["file"]
            self.assertEqual(published.name, "foto.jpg")
            self.assertEqual(published.read_bytes(), b"second")
            self.assertIn("_conflitti", published.parts)


if __name__ == "__main__":
    unittest.main()
