import json
from pathlib import Path
import tempfile
import unittest

from chrome_updater import EXTENSION_ID, install_extension


class ChromeUpdaterTests(unittest.TestCase):
    def test_installs_stable_copy_and_updates_existing_profile(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            source = root / "source"
            source.mkdir()
            (source / "manifest.json").write_text('{"version":"3.1.1"}')
            (source / "sidepanel.html").write_text("production")
            chrome = root / "Chrome"
            profile = chrome / "Default"
            profile.mkdir(parents=True)
            preferences = {"extensions":{"settings":{EXTENSION_ID:{"path":"/old/version","manifest":{"version":"2.0.0"}}}}}
            (profile / "Preferences").write_text(json.dumps(preferences))
            destination = root / "installed" / "extension-production"

            updated = install_extension(source, destination, chrome)

            self.assertEqual(updated, [profile])
            self.assertEqual((destination / "sidepanel.html").read_text(), "production")
            result = json.loads((profile / "Preferences").read_text())
            setting = result["extensions"]["settings"][EXTENSION_ID]
            self.assertEqual(setting["path"], str(destination))
            self.assertEqual(setting["manifest"]["version"], "3.1.1")


if __name__ == "__main__":
    unittest.main()
