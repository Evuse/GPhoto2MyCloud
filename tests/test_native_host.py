from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from native_host import digest, handle, unique_target


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


if __name__ == "__main__":
    unittest.main()
