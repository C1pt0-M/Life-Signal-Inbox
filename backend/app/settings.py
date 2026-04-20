from __future__ import annotations

import os
from pathlib import Path


def load_env_file(path: str | Path, override: bool = False) -> bool:
    env_path = Path(path)
    if not env_path.exists():
        return False

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line.removeprefix("export ").strip()
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        parsed = _strip_quotes(value.strip())
        if override or key not in os.environ:
            os.environ[key] = parsed
    return True


def load_default_env_files() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    project_dir = backend_dir.parent
    load_env_file(project_dir / ".env")
    load_env_file(backend_dir / ".env")


def _strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value
