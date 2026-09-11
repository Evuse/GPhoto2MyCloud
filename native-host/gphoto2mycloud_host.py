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
import uuid
import zipfile


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


def safe_relative(name: str) -> Path:
    relative = Path(name.replace("\\", "/"))
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError(f"Percorso non sicuro nello ZIP: {name}")
    return relative


def publish_file(source: Path, target: Path, verify: bool, conflicts: Path | None = None) -> tuple[Path, str | None]:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if source.stat().st_size == target.stat().st_size and digest(source) == digest(target):
            source.unlink()
            return target, digest(target) if verify else None
        if conflicts is None:
            raise FileExistsError(f"File omonimo con contenuto diverso: {target}")
        target = conflicts / target.relative_to(conflicts.parent.parent)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            source_hash = digest(source)
            if source.stat().st_size == target.stat().st_size and source_hash == digest(target):
                source.unlink()
                return target, source_hash if verify else None
            relative = target.relative_to(conflicts)
            target = conflicts / source_hash[:16] / relative
            target.parent.mkdir(parents=True, exist_ok=True)
    checksum = digest(source) if verify else None
    os.replace(source, target)
    if verify and digest(target) != checksum:
        raise OSError(f"Verifica SHA-256 fallita: {target.name}")
    return target, checksum


def extract_download(source: Path, media: Path, verify: bool, archive_hash: str | None = None, progress=None) -> list[dict]:
    staging = media.parent / f".gphoto2mycloud-{uuid.uuid4().hex}"
    staging.mkdir(parents=True)
    extracted: list[dict] = []
    try:
        if zipfile.is_zipfile(source):
            with zipfile.ZipFile(source) as archive:
                members = [member for member in archive.infolist() if not member.is_dir()]
                total = max(1, len(members))
                for index, member in enumerate(members, 1):
                    relative = safe_relative(member.filename)
                    if (member.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError(f"Link simbolico non consentito: {member.filename}")
                    temporary = staging / relative
                    temporary.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(member) as reader, temporary.open("xb") as writer:
                        shutil.copyfileobj(reader, writer, 4 * 1024 * 1024)
                        writer.flush()
                        os.fsync(writer.fileno())
                    if progress:
                        progress({"phaseLabel":"Estrazione ZIP","message":f"Estratto {index} di {total}","percent":round(index / total * 55, 1),"current":index,"total":total,"file":member.filename})
        else:
            total = 1
            temporary = staging / safe_relative(source.name)
            with source.open("rb") as reader, temporary.open("xb") as writer:
                shutil.copyfileobj(reader, writer, 4 * 1024 * 1024)
                writer.flush()
                os.fsync(writer.fileno())
            if progress:
                progress({"phaseLabel":"Preparazione file","message":"File locale pronto per la pubblicazione","percent":55,"current":1,"total":1,"file":source.name})
        staged_files = sorted(path for path in staging.rglob("*") if path.is_file())
        total = max(1, len(staged_files))
        for index, temporary in enumerate(staged_files, 1):
            relative = temporary.relative_to(staging)
            conflicts = media / "_conflitti" / (archive_hash or "archivio-sconosciuto")[:16]
            published, checksum = publish_file(temporary, media / relative, verify, conflicts)
            extracted.append({"file": str(published.relative_to(media)), "bytes": published.stat().st_size, "sha256": checksum})
            if progress:
                progress({"phaseLabel":"Verifica e pubblicazione","message":f"Verificato {index} di {total}","percent":round(55 + index / total * 40, 1),"current":index,"total":total,"file":str(relative)})
        return extracted
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def preserve_incomplete_archive(source: Path, destination: Path, checksum: str) -> Path:
    folder = destination / "IncompleteArchives"
    folder.mkdir(parents=True, exist_ok=True)
    target = unique_target(folder, f"{checksum[:12]}-{source.name}")
    shutil.copy2(source, target)
    if digest(target) != checksum:
        target.unlink(missing_ok=True)
        raise OSError("Impossibile preservare l'archivio incompleto sul My Cloud")
    source.unlink()
    return target


def checkpoint_page(destination: Path, cursor: int = 0, limit: int = 2000) -> dict:
    history = destination / ".gphoto2mycloud-history.jsonl"
    if not history.is_file():
        return {"ok": True, "photoIds": [], "cursor": 0, "eof": True, "lastPhotoId": None, "resumeAnchor": None}
    photo_ids: list[str] = []
    last_photo_id = None
    resume_anchor = None
    with history.open("rb") as stream:
        stream.seek(max(0, cursor))
        while len(photo_ids) < limit:
            line = stream.readline()
            if not line:
                break
            try:
                receipt = json.loads(line.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            receipt_ids = [str(value) for value in receipt.get("photoIds", []) if value]
            photo_ids.extend(receipt_ids)
            if receipt_ids:
                last_photo_id = receipt_ids[-1]
            if isinstance(receipt.get("resumeAnchor"), dict):
                resume_anchor = receipt["resumeAnchor"]
        next_cursor = stream.tell()
        eof = not stream.read(1)
    return {"ok": True, "photoIds": photo_ids, "cursor": next_cursor, "eof": eof,
            "lastPhotoId": last_photo_id, "resumeAnchor": resume_anchor}


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


def handle(message: dict, progress=None) -> dict:
    destination = mounted_destination(str(message.get("destination", "")))
    if message.get("command") == "status":
        free = shutil.disk_usage(destination).free
        return {"ok": True, "freeBytes": free, "freeHuman": f"{free / 1024**3:.1f} GB"}
    if message.get("command") == "checkpoint":
        return checkpoint_page(destination, int(message.get("cursor", 0)), int(message.get("limit", 2000)))
    if message.get("command") == "prepare":
        downloads = Path(str(message.get("downloadRoot", "~/Downloads"))).expanduser().resolve()
        if not downloads.is_dir() or not os.access(downloads, os.W_OK):
            raise ValueError(f"Cartella Download locale non disponibile o non scrivibile: {downloads}")
        return {"ok": True, "downloadPath": str(downloads)}
    if message.get("command") != "move":
        raise ValueError("Comando sconosciuto")
    source = Path(str(message.get("source", ""))).resolve()
    downloads = Path(str(message.get("downloadRoot", "~/Downloads"))).expanduser().resolve()
    if not source.is_file() or (downloads not in source.parents and source.parent != downloads):
        raise ValueError(f"Il file completato da Chrome non si trova sotto {downloads}: {source}")
    folder = safe_relative(str(message.get("extractedFolder", "Media")))
    media = destination / folder
    media.mkdir(parents=True, exist_ok=True)
    archive_hash = digest(source)
    photo_ids = list(dict.fromkeys(message.get("photoIds") or []))
    raw_anchor = message.get("resumeAnchor")
    resume_anchor = raw_anchor if isinstance(raw_anchor, dict) else None
    if progress:
        progress({"phaseLabel":"Analisi archivio","message":"Lettura dello ZIP scaricato","percent":2,"current":0,"total":max(1, len(photo_ids)),"file":source.name})
    files = extract_download(source, media, bool(message.get("verify", True)), archive_hash, progress)
    if len(files) < len(photo_ids):
        preserved = preserve_incomplete_archive(source, destination, archive_hash)
        raise OSError(
            f"Google ha restituito {len(files)} file per {len(photo_ids)} elementi: "
            f"lotto non completato, archivio preservato in {preserved}, retry automatico"
        )
    if message.get("keepArchives") and zipfile.is_zipfile(source):
        archives = destination / "Archives"
        archives.mkdir(exist_ok=True)
        archive_target = unique_target(archives, source.name)
        shutil.copy2(source, archive_target)
        if digest(archive_target) != archive_hash:
            archive_target.unlink(missing_ok=True)
            raise OSError("Verifica SHA-256 dell'archivio fallita")
    source.unlink()
    receipt = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "archive": source.name, "archiveSha256": archive_hash,
        "extractedFolder": str(folder), "fileCount": len(files), "files": files,
        "photoIds": photo_ids,
        "resumeAnchor": resume_anchor,
    }
    with (destination / ".gphoto2mycloud-history.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps(receipt, ensure_ascii=False) + "\n")
    if progress:
        progress({"phaseLabel":"Estrazione completata","message":f"{len(files)} file disponibili sul My Cloud","percent":100,"current":len(files),"total":len(files),"file":str(media)})
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
            reply(handle(message, lambda event: reply({"ok": True, "event": "progress", **event})))
        except Exception as error:
            reply({"ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
