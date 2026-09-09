from __future__ import annotations

import argparse
from pathlib import Path
import sys
import time

from .config import Config
from .importer import Ingestor


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Import Google Takeout into My Cloud without transcoding")
    result.add_argument("--config", type=Path, default=Path("config.toml"))
    result.add_argument("command", choices=("run", "watch", "verify"))
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        config = Config.load(args.config)
        ingestor = Ingestor(config)
        if args.command == "verify":
            errors = ingestor.verify()
            for error in errors:
                print(f"ERROR: {error}", file=sys.stderr)
            print(f"Verification completed: {len(errors)} error(s)")
            return 1 if errors else 0
        while True:
            imported, skipped = ingestor.run_once()
            print(f"Run completed: {imported} imported, {skipped} already present", flush=True)
            if args.command == "run":
                return 0
            time.sleep(config.poll_seconds)
    except (OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

