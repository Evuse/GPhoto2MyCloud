from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import zipfile

from .config import Config

ARCHIVE_SUFFIXES = (".zip", ".tgz", ".tar.gz")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_sha256(root: Path) -> str:
    """Hash file names, sizes and bytes so an extracted tree can be audited later."""
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        if path.name == ".gphoto2mycloud.json":
            continue
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        digest.update(path.stat().st_size.to_bytes(8, "big"))
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def is_archive(path: Path) -> bool:
    name = path.name.lower()
    return any(name.endswith(suffix) for suffix in ARCHIVE_SUFFIXES)


def _safe_target(root: Path, member: str) -> Path:
    normalized = PurePosixPath(member.replace("\\", "/"))
    if normalized.is_absolute() or ".." in normalized.parts:
        raise ValueError(f"Unsafe path in archive: {member}")
    target = root.joinpath(*normalized.parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Unsafe path in archive: {member}")
    return target


def extract_losslessly(archive: Path, target: Path) -> int:
    """Extract regular files without transforming media or JSON sidecars."""
    count = 0
    if archive.name.lower().endswith(".zip"):
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                output = _safe_target(target, member.filename)
                if member.is_dir():
                    output.mkdir(parents=True, exist_ok=True)
                    continue
                # Reject Unix symlinks encoded in ZIP external attributes.
                if (member.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError(f"Symlink not allowed in archive: {member.filename}")
                output.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(member) as source, output.open("wb") as destination:
                    shutil.copyfileobj(source, destination)
                count += 1
    else:
        with tarfile.open(archive, "r:gz") as bundle:
            for member in bundle.getmembers():
                output = _safe_target(target, member.name)
                if member.isdir():
                    output.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile():
                    raise ValueError(f"Non-regular entry not allowed: {member.name}")
                output.parent.mkdir(parents=True, exist_ok=True)
                source = bundle.extractfile(member)
                if source is None:
                    raise ValueError(f"Cannot read archive member: {member.name}")
                with source, output.open("wb") as destination:
                    shutil.copyfileobj(source, destination)
                count += 1
    return count


class Ingestor:
    def __init__(self, config: Config):
        self.config = config
        self.inbox = config.work_dir / "inbox"
        self.db_path = config.work_dir / "manifest.sqlite3"

    @contextmanager
    def database(self):
        self.config.work_dir.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.db_path)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """CREATE TABLE IF NOT EXISTS archives (
                sha256 TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL,
                file_count INTEGER NOT NULL, imported_at TEXT NOT NULL, target TEXT NOT NULL
            )"""
        )
        try:
            yield connection
        finally:
            connection.close()

    def fetch(self) -> None:
        self.inbox.mkdir(parents=True, exist_ok=True)
        if self.config.source_mode == "local":
            source = Path(self.config.source).expanduser()
            if not source.is_dir():
                raise FileNotFoundError(f"Takeout source does not exist: {source}")
            for item in source.iterdir():
                if item.is_file() and is_archive(item):
                    destination = self.inbox / item.name
                    if not destination.exists() or destination.stat().st_size != item.stat().st_size:
                        temporary = destination.with_suffix(destination.suffix + ".partial")
                        shutil.copy2(item, temporary)
                        os.replace(temporary, destination)
            return
        subprocess.run(
            ["rclone", "copy", self.config.source, str(self.inbox), "--include", "*.zip",
             "--include", "*.tgz", "--include", "*.tar.gz", "--ignore-existing",
             "--transfers", "2", "--checkers", "4"],
            check=True,
        )

    def import_archive(self, archive: Path) -> bool:
        checksum = sha256(archive)
        with self.database() as database:
            if database.execute("SELECT 1 FROM archives WHERE sha256 = ?", (checksum,)).fetchone():
                return False

        label = archive.name
        for suffix in ARCHIVE_SUFFIXES:
            if label.lower().endswith(suffix):
                label = label[: -len(suffix)]
                break
        final = self.config.destination / "takeout" / f"{label}-{checksum[:12]}"
        final.parent.mkdir(parents=True, exist_ok=True)
        if final.exists():
            raise FileExistsError(f"Untracked destination already exists: {final}")

        with tempfile.TemporaryDirectory(prefix="gphoto-import-", dir=final.parent) as temp:
            staging = Path(temp) / "payload"
            staging.mkdir()
            file_count = extract_losslessly(archive, staging)
            receipt = {
                "archive": archive.name,
                "archive_sha256": checksum,
                "archive_size": archive.stat().st_size,
                "file_count": file_count,
                "extracted_tree_sha256": tree_sha256(staging),
                "imported_at": datetime.now(timezone.utc).isoformat(),
            }
            (staging / ".gphoto2mycloud.json").write_text(
                json.dumps(receipt, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            os.replace(staging, final)

        if self.config.retain_archives:
            raw = self.config.destination / "takeout-archives"
            raw.mkdir(parents=True, exist_ok=True)
            archived = raw / f"{checksum[:12]}-{archive.name}"
            if not archived.exists():
                shutil.copy2(archive, archived)

        with self.database() as database:
            database.execute(
                "INSERT INTO archives VALUES (?, ?, ?, ?, ?, ?)",
                (checksum, archive.name, archive.stat().st_size, file_count,
                 datetime.now(timezone.utc).isoformat(), str(final)),
            )
            database.commit()
        return True

    def run_once(self) -> tuple[int, int]:
        self.fetch()
        imported = skipped = 0
        for archive in sorted(self.inbox.iterdir()):
            if not archive.is_file() or not is_archive(archive):
                continue
            if self.import_archive(archive):
                imported += 1
            else:
                skipped += 1
        return imported, skipped

    def verify(self) -> list[str]:
        errors: list[str] = []
        with self.database() as database:
            rows = database.execute("SELECT sha256, name, size, target FROM archives").fetchall()
        for checksum, name, size, target in rows:
            receipt_path = Path(target) / ".gphoto2mycloud.json"
            if not receipt_path.is_file():
                errors.append(f"Missing receipt for {name}: {receipt_path}")
                continue
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            if receipt.get("archive_sha256") != checksum or receipt.get("archive_size") != size:
                errors.append(f"Invalid receipt for {name}")
            elif receipt.get("extracted_tree_sha256") != tree_sha256(Path(target)):
                errors.append(f"Extracted files verification failed: {name}")
            if self.config.retain_archives:
                raw = self.config.destination / "takeout-archives" / f"{checksum[:12]}-{name}"
                if not raw.is_file() or raw.stat().st_size != size or sha256(raw) != checksum:
                    errors.append(f"Raw archive verification failed: {name}")
        return errors
