from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path


class SQLiteHistoryStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def list_items(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT item_json
                FROM history_items
                ORDER BY saved_at DESC, id ASC
                """
            ).fetchall()
        return [json.loads(row["item_json"]) for row in rows]

    def save_items(self, items: list[dict]) -> list[dict]:
        saved_at = datetime.now().isoformat(timespec="seconds")
        saved: list[dict] = []
        with self._connect() as conn:
            for item in items:
                existing = self._load_item(conn, item.get("id", ""))
                normalized = {**item, "status": item.get("status", "todo"), "saved_at": saved_at}
                normalized["completed_at"] = self._resolve_completed_at(normalized, existing, saved_at)
                conn.execute(
                    """
                    INSERT INTO history_items (
                        id, title, status, saved_at, completed_at, start_time, end_time,
                        location, source_type, confidence, quadrant, item_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        status = excluded.status,
                        saved_at = excluded.saved_at,
                        completed_at = excluded.completed_at,
                        start_time = excluded.start_time,
                        end_time = excluded.end_time,
                        location = excluded.location,
                        source_type = excluded.source_type,
                        confidence = excluded.confidence,
                        quadrant = excluded.quadrant,
                        item_json = excluded.item_json
                    """,
                    (
                        normalized["id"],
                        normalized.get("title", ""),
                        normalized.get("status", "todo"),
                        saved_at,
                        normalized.get("completed_at", ""),
                        normalized.get("time", {}).get("start", ""),
                        normalized.get("time", {}).get("end", ""),
                        normalized.get("location", ""),
                        normalized.get("source_type", ""),
                        float(normalized.get("confidence") or 0),
                        normalized.get("quadrant", ""),
                        json.dumps(normalized, ensure_ascii=False),
                    ),
                )
                saved.append(normalized)
            conn.commit()
        return saved

    def delete_item(self, item_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM history_items WHERE id = ?", (item_id,))
            conn.commit()
            return cursor.rowcount > 0

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS history_items (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    saved_at TEXT NOT NULL,
                    completed_at TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    location TEXT,
                    source_type TEXT,
                    confidence REAL,
                    quadrant TEXT,
                    item_json TEXT NOT NULL
                )
                """
            )
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(history_items)").fetchall()}
            if "completed_at" not in columns:
                conn.execute("ALTER TABLE history_items ADD COLUMN completed_at TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_saved_at ON history_items(saved_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_start_time ON history_items(start_time)")
            conn.commit()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _load_item(self, conn: sqlite3.Connection, item_id: str) -> dict:
        if not item_id:
            return {}
        row = conn.execute("SELECT item_json FROM history_items WHERE id = ?", (item_id,)).fetchone()
        return json.loads(row["item_json"]) if row else {}

    def _resolve_completed_at(self, item: dict, existing: dict, saved_at: str) -> str:
        status = item.get("status", "todo")
        if status != "done":
            return ""
        if item.get("completed_at"):
            return item["completed_at"]
        if existing.get("status") == "done" and existing.get("completed_at"):
            return existing["completed_at"]
        return saved_at
