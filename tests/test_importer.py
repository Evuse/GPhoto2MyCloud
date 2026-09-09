from pathlib import Path
import json
import tarfile
import tempfile
import unittest
import zipfile

from gphoto2mycloud.config import Config
from gphoto2mycloud.importer import Ingestor, extract_losslessly, sha256


class ImporterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.source = root / "source"
        self.source.mkdir()
        self.destination = root / "nas"
        self.config = Config(
            source=str(self.source), source_mode="local",
            destination=self.destination, work_dir=root / "state", retain_archives=True,
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_import_preserves_media_and_sidecar_bytes_and_is_idempotent(self):
        archive = self.source / "takeout-001.zip"
        photo = b"\xff\xd8original-photo-bytes\xff\xd9"
        metadata = json.dumps({"title": "foto.jpg", "photoTakenTime": {"timestamp": "1"}}).encode()
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("Takeout/Google Photos/2020/foto.jpg", photo)
            bundle.writestr("Takeout/Google Photos/2020/foto.jpg.json", metadata)

        ingestor = Ingestor(self.config)
        self.assertEqual(ingestor.run_once(), (1, 0))
        self.assertEqual(ingestor.run_once(), (0, 1))
        imports = list((self.destination / "takeout").iterdir())
        self.assertEqual(len(imports), 1)
        year = imports[0] / "Takeout/Google Photos/2020"
        self.assertEqual((year / "foto.jpg").read_bytes(), photo)
        self.assertEqual((year / "foto.jpg.json").read_bytes(), metadata)
        retained = next((self.destination / "takeout-archives").iterdir())
        self.assertEqual(sha256(retained), sha256(archive))
        self.assertEqual(ingestor.verify(), [])
        (year / "foto.jpg").write_bytes(b"corrupted")
        self.assertRegex(ingestor.verify()[0], "Extracted files verification failed")

    def test_rejects_zip_path_traversal(self):
        archive = self.source / "bad.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("../escape.jpg", b"bad")
        with self.assertRaisesRegex(ValueError, "Unsafe path"):
            extract_losslessly(archive, self.destination)

    def test_extracts_tgz(self):
        payload = Path(self.temp.name) / "photo.jpg"
        payload.write_bytes(b"unaltered")
        archive = self.source / "takeout.tgz"
        with tarfile.open(archive, "w:gz") as bundle:
            bundle.add(payload, arcname="Takeout/Google Photos/photo.jpg")
        ingestor = Ingestor(self.config)
        self.assertEqual(ingestor.run_once(), (1, 0))
        imported = next((self.destination / "takeout").iterdir())
        self.assertEqual((imported / "Takeout/Google Photos/photo.jpg").read_bytes(), b"unaltered")


if __name__ == "__main__":
    unittest.main()
