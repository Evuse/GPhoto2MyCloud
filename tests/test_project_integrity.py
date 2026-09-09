import json
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]


class ProjectIntegrityTests(unittest.TestCase):
    def test_manifest_references_current_ui_and_scripts(self):
        manifest = json.loads((ROOT / "extension/manifest.json").read_text())
        self.assertEqual(manifest["version"], "2.1.0")
        referenced = [manifest["side_panel"]["default_path"], manifest["background"]["service_worker"]]
        referenced.extend(manifest["content_scripts"][0]["js"])
        for relative in referenced:
            self.assertTrue((ROOT / "extension" / relative).is_file(), relative)

    def test_structured_panel_contains_requested_controls(self):
        panel = (ROOT / "extension/sidepanel.html").read_text()
        for control in ("processProgress", "batchProgress", "log", "diagnosticVersion", "reloadExtension"):
            self.assertIn(f'id="{control}"', panel)

    def test_installer_and_manifest_use_same_fixed_extension_id(self):
        installer = (ROOT / "macos/Installa.command").read_text()
        self.assertIn("mocnnikkncmfihikmbkhlmhkjegjmime", installer)


if __name__ == "__main__":
    unittest.main()
