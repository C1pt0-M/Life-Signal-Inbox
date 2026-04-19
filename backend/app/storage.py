from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


class JsonHistoryStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def list_items(self) -> list[dict]:
        if not self.path.exists():
            return []
        return json.loads(self.path.read_text(encoding="utf-8"))

    def save_items(self, items: list[dict]) -> list[dict]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        existing = self.list_items()
        by_id = {item["id"]: item for item in existing if item.get("id")}
        saved_at = datetime.now().isoformat(timespec="seconds")
        saved: list[dict] = []
        for item in items:
            normalized = {**item, "status": item.get("status", "todo"), "saved_at": saved_at}
            by_id[normalized["id"]] = normalized
            saved.append(normalized)
        self.path.write_text(json.dumps(list(by_id.values()), ensure_ascii=False, indent=2), encoding="utf-8")
        return saved

