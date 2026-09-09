#!/usr/bin/env python3
"""Install a stable extension copy and repoint existing unpacked Chrome profiles."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil

EXTENSION_ID = "mocnnikkncmfihikmbkhlmhkjegjmime"


def install_extension(source: Path, destination: Path, chrome_root: Path) -> list[Path]:
    source = source.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".updating")
    shutil.rmtree(temporary, ignore_errors=True)
    shutil.copytree(source, temporary)
    previous = destination.with_name(destination.name + ".previous")
    shutil.rmtree(previous, ignore_errors=True)
    if destination.exists():
        destination.rename(previous)
    temporary.rename(destination)

    updated: list[Path] = []
    for preferences in chrome_root.glob("*/Preferences"):
        try:
            data = json.loads(preferences.read_text(encoding="utf-8"))
            setting = data.get("extensions", {}).get("settings", {}).get(EXTENSION_ID)
            if not setting:
                continue
            setting["path"] = str(destination)
            cached_manifest = setting.get("manifest")
            if isinstance(cached_manifest, dict):
                cached_manifest["version"] = json.loads((destination / "manifest.json").read_text())["version"]
            temp_preferences = preferences.with_suffix(".gphoto2mycloud.tmp")
            temp_preferences.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
            temp_preferences.replace(preferences)
            updated.append(preferences.parent)
        except (OSError, ValueError, TypeError):
            continue
    return updated


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("chrome_root", type=Path)
    args = parser.parse_args()
    profiles = install_extension(args.source, args.destination, args.chrome_root)
    print(json.dumps({"destination": str(args.destination), "profiles": [path.name for path in profiles]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
