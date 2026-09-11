from pathlib import Path
import json
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from native_host import checkpoint_page, checkpoint_state, digest, extract_download, handle, preserve_incomplete_archive, reset_checkpoint, safe_relative, unique_target, update_checkpoint_head


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

    def test_checkpoint_pages_rebuild_completed_ids_from_nas_history(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            history = root / ".gphoto2mycloud-history.jsonl"
            history.write_text('\n'.join((
                json.dumps({"photoIds":["photo-1", "photo-2"]}),
                "invalid line is ignored",
                json.dumps({"photoIds":["photo-3"]}),
            )) + '\n')
            first = checkpoint_page(root, limit=2)
            second = checkpoint_page(root, cursor=first["cursor"], limit=2)
            self.assertEqual(first["photoIds"], ["photo-1", "photo-2"])
            self.assertFalse(first["eof"])
            self.assertEqual(second["photoIds"], ["photo-3"])
            self.assertEqual(second["lastPhotoId"], "photo-3")
            self.assertTrue(second["eof"])

    def test_checkpoint_returns_latest_persisted_timeline_anchor(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            history = root / ".gphoto2mycloud-history.jsonl"
            history.write_text("\n".join((
                json.dumps({"photoIds":["photo-1"], "resumeAnchor":{"scrollTop":1200, "ratio":0.1}}),
                json.dumps({"photoIds":["photo-2"], "resumeAnchor":{"scrollTop":987654, "ratio":0.7}}),
            )) + "\n")
            checkpoint = checkpoint_page(root)
            self.assertEqual(checkpoint["lastPhotoId"], "photo-2")
            self.assertEqual(checkpoint["resumeAnchor"]["scrollTop"], 987654)

    def test_head_checkpoint_is_atomic_and_reset_archives_state(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / ".gphoto2mycloud-history.jsonl").write_text('{"photoIds":["one"]}\n')
            update_checkpoint_head(root, "newest-photo")
            self.assertEqual(checkpoint_state(root)["headPhotoId"], "newest-photo")
            result = reset_checkpoint(root)
            self.assertEqual(len(result["archived"]), 2)
            self.assertFalse((root / ".gphoto2mycloud-history.jsonl").exists())
            self.assertFalse((root / ".gphoto2mycloud-state.json").exists())
            self.assertEqual(len(list((root / "CheckpointArchives").iterdir())), 2)

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
