import json
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]


class ProjectIntegrityTests(unittest.TestCase):
    def test_manifest_references_current_ui_and_scripts(self):
        manifest = json.loads((ROOT / "extension/manifest.json").read_text())
        self.assertEqual(manifest["version"], "3.7.0")
        self.assertIn("scripting", manifest["permissions"])
        referenced = [manifest["side_panel"]["default_path"], manifest["background"]["service_worker"]]
        referenced.extend(manifest["content_scripts"][0]["js"])
        for relative in referenced:
            self.assertTrue((ROOT / "extension" / relative).is_file(), relative)

    def test_structured_panel_contains_requested_controls(self):
        panel = (ROOT / "extension/sidepanel.html").read_text()
        for control in ("processProgress", "batchProgress", "log", "diagnosticVersion", "reloadExtension"):
            self.assertIn(f'id="{control}"', panel)
        self.assertLess(panel.index('id="log"'), panel.index('id="destination"'))
        self.assertIn("azzera checkpoint sul NAS", panel)

    def test_download_does_not_use_unsupported_cdp_behavior_commands(self):
        worker = (ROOT / "extension/service-worker.js").read_text()
        self.assertNotIn("setDownloadBehavior", worker)
        self.assertNotIn('key:"Shift"', worker)
        self.assertIn("connectNative", worker)
        self.assertIn('response?.event === "progress"', worker)
        self.assertIn("chrome.scripting.executeScript", worker)
        self.assertIn("pingAutomation", worker)
        self.assertIn("syncCheckpointFromNas", worker)
        self.assertIn('command:"checkpoint"', worker)
        self.assertIn("resumeAnchor", worker)
        self.assertIn('command:"reset_checkpoint"', worker)
        self.assertIn('command:"update_head"', worker)
        automation = (ROOT / "extension/automation.js").read_text()
        self.assertIn("__gphoto2mycloudAutomationLoaded", automation)
        self.assertIn("restoreResumeAnchor", automation)
        self.assertIn("margine di sicurezza 4 schermate", automation)
        self.assertIn("selectNewPhotosBatch", automation)

    def test_installer_and_manifest_use_same_fixed_extension_id(self):
        installer = (ROOT / "macos/Installa.command").read_text()
        self.assertIn("mocnnikkncmfihikmbkhlmhkjegjmime", installer)
        self.assertIn("update_chrome_extension.py", installer)
        self.assertIn("--load-extension", installer)
        self.assertIn("--disable-background-timer-throttling", installer)
        self.assertIn("--disable-renderer-backgrounding", installer)


if __name__ == "__main__":
    unittest.main()
