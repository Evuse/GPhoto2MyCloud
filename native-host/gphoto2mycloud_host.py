#!/usr/bin/env python3
"""Chrome Native Messaging host: verifies and moves completed downloads to SMB."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import time


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def unique_target(folder: Path, name: str) -> Path:
    candidate = folder / name
    counter = 1
    while candidate.exists():
        candidate = folder / f"{Path(name).stem}-{counter}{Path(name).suffix}"
        counter += 1
    return candidate


def mounted_destination(raw: str) -> Path:
    destination = Path(raw).expanduser().resolve()
    if not str(destination).startswith("/Volumes/"):
        raise ValueError("La destinazione deve trovarsi sotto /Volumes su macOS")
    volume = Path("/Volumes") / destination.relative_to("/Volumes").parts[0]
    if not volume.is_dir() or not os.path.ismount(volume):
        raise ValueError(f"Volume SMB non montato: {volume}")
    destination.mkdir(parents=True, exist_ok=True)
    if not os.access(destination, os.W_OK):
        raise PermissionError(f"Destinazione non scrivibile: {destination}")
    return destination


def handle(message: dict) -> dict:
    destination = mounted_destination(str(message.get("destination", "")))
    if message.get("command") == "status":
        free = shutil.disk_usage(destination).free
        return {"ok": True, "freeBytes": free, "freeHuman": f"{free / 1024**3:.1f} GB"}
    if message.get("command") != "move":
        raise ValueError("Comando sconosciuto")
    source = Path(str(message.get("source", ""))).resolve()
    downloads = Path(str(message.get("downloadRoot", "~/Downloads"))).expanduser().resolve()
    if not source.is_file() or (downloads not in source.parents and source.parent != downloads):
        raise ValueError(f"Il file restituito da Chrome non è sotto {downloads}")
    target = unique_target(destination, source.name)
    temporary = target.with_name(f".{target.name}.gphoto2mycloud-partial")
    before = digest(source) if message.get("verify", True) else None
    with source.open("rb") as reader, temporary.open("xb") as writer:
        shutil.copyfileobj(reader, writer, 4 * 1024 * 1024)
        writer.flush()
        os.fsync(writer.fileno())
    after = digest(temporary) if before else None
    if before != after:
        temporary.unlink(missing_ok=True)
        raise OSError("Verifica SHA-256 fallita: il file sorgente non è stato rimosso")
    os.replace(temporary, target)
    source.unlink()
    receipt = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "file": target.name, "bytes": target.stat().st_size, "sha256": after,
    }
    with (destination / ".gphoto2mycloud-history.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps(receipt, ensure_ascii=False) + "\n")
    return {"ok": True, **receipt}


def read_message() -> dict | None:
    raw = sys.stdin.buffer.read(4)
    if not raw:
        return None
    size = struct.unpack("=I", raw)[0]
    if size > 1024 * 1024:
        raise ValueError("Messaggio troppo grande")
    return json.loads(sys.stdin.buffer.read(size))


def reply(payload: dict) -> None:
    encoded = json.dumps(payload).encode()
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)) + encoded)
    sys.stdout.buffer.flush()


def main() -> None:
    while True:
        try:
            message = read_message()
            if message is None:
                break
            reply(handle(message))
        except Exception as error:
            reply({"ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
