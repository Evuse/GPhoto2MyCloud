from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import tomllib


@dataclass(frozen=True)
class Config:
    source: str
    destination: Path
    work_dir: Path
    source_mode: str = "rclone"
    retain_archives: bool = True
    poll_seconds: int = 21_600

    @classmethod
    def load(cls, path: Path) -> "Config":
        with path.open("rb") as stream:
            raw = tomllib.load(stream)
        data = raw.get("gphoto2mycloud", raw)
        missing = [key for key in ("source", "destination", "work_dir") if not data.get(key)]
        if missing:
            raise ValueError(f"Missing configuration values: {', '.join(missing)}")
        mode = data.get("source_mode", "rclone")
        if mode not in {"rclone", "local"}:
            raise ValueError("source_mode must be 'rclone' or 'local'")
        poll = int(data.get("poll_seconds", 21_600))
        if poll < 60:
            raise ValueError("poll_seconds must be at least 60")
        return cls(
            source=str(data["source"]),
            destination=Path(data["destination"]).expanduser(),
            work_dir=Path(data["work_dir"]).expanduser(),
            source_mode=mode,
            retain_archives=bool(data.get("retain_archives", True)),
            poll_seconds=poll,
        )

