from __future__ import annotations

from datetime import datetime


def validate_items(items: list[dict], historical_items: list[dict] | None = None) -> dict:
    historical_items = historical_items or []
    issues: list[dict] = []
    pending: list[dict] = []

    for item in items:
        _check_required_fields(item, issues, pending)
        _check_time(item, issues, pending)
        _check_confidence(item, issues, pending)

    _check_conflicts(items, historical_items, issues, pending)
    score = max(0, 100 - _issue_penalty(issues))
    return {
        "score": score,
        "issues": issues,
        "pending_confirmations": pending,
        "has_blockers": any(issue["severity"] == "high" for issue in issues),
    }


def _check_required_fields(item: dict, issues: list[dict], pending: list[dict]) -> None:
    field_labels = {
        "title": "标题",
        "location": "地点",
        "materials": "材料",
        "contacts": "联系人",
    }
    optional_fields = _optional_required_fields(item)
    for field, label in field_labels.items():
        if field in optional_fields:
            continue
        value = item.get(field)
        missing = value in ("", None, []) or (isinstance(value, str) and not value.strip())
        if missing:
            issue_type = f"missing_{field}"
            issues.append(
                {
                    "type": issue_type,
                    "severity": "medium" if field != "title" else "high",
                    "item_id": item.get("id", ""),
                    "message": f"缺少{label}",
                }
            )
            pending.append(
                {
                    "item_id": item.get("id", ""),
                    "field": field,
                    "question": f"“{item.get('title') or '未命名事项'}”还需要确认{label}。",
                }
            )


def _optional_required_fields(item: dict) -> set[str]:
    if item.get("kind") == "schedule_course":
        return {"materials", "contacts"}
    return set()


def _check_time(item: dict, issues: list[dict], pending: list[dict]) -> None:
    start = item.get("time", {}).get("start")
    try:
        if not start:
            raise ValueError("empty")
        datetime.fromisoformat(start)
    except ValueError:
        issues.append(
            {
                "type": "unresolved_time",
                "severity": "high",
                "item_id": item.get("id", ""),
                "message": "时间没有解析成明确日期",
            }
        )
        pending.append(
            {
                "item_id": item.get("id", ""),
                "field": "time",
                "question": f"“{item.get('title') or '未命名事项'}”需要确认明确日期和时间。",
            }
        )


def _check_confidence(item: dict, issues: list[dict], pending: list[dict]) -> None:
    confidence = float(item.get("confidence") or 0)
    if confidence < 0.7:
        issues.append(
            {
                "type": "low_confidence",
                "severity": "medium",
                "item_id": item.get("id", ""),
                "message": f"可信度偏低：{round(confidence * 100)}%",
            }
        )
        pending.append(
            {
                "item_id": item.get("id", ""),
                "field": "confidence",
                "question": f"“{item.get('title') or '未命名事项'}”有低可信度字段，请人工确认。",
            }
        )


def _check_conflicts(items: list[dict], historical_items: list[dict], issues: list[dict], pending: list[dict]) -> None:
    all_existing = [(item, "current") for item in items] + [(item, "history") for item in historical_items]
    for index, (item, _) in enumerate(all_existing):
        interval = _interval(item)
        if not interval:
            continue
        for other, source in all_existing[index + 1 :]:
            other_interval = _interval(other)
            if not other_interval:
                continue
            if interval[0] < other_interval[1] and other_interval[0] < interval[1]:
                issues.append(
                    {
                        "type": "time_conflict",
                        "severity": "high",
                        "item_id": item.get("id", ""),
                        "message": f"与“{other.get('title', '未命名事项')}”时间冲突",
                    }
                )
                pending.append(
                    {
                        "item_id": item.get("id", ""),
                        "field": "time",
                        "question": f"“{item.get('title', '未命名事项')}”可能和“{other.get('title', '未命名事项')}”冲突。",
                    }
                )


def _interval(item: dict) -> tuple[datetime, datetime] | None:
    time_block = item.get("time", {})
    try:
        start = datetime.fromisoformat(time_block.get("start", ""))
        end_raw = time_block.get("end") or time_block.get("start")
        end = datetime.fromisoformat(end_raw)
        return start, end
    except ValueError:
        return None


def _issue_penalty(issues: list[dict]) -> int:
    weights = {"high": 18, "medium": 9, "low": 4}
    return sum(weights.get(issue.get("severity"), 6) for issue in issues)
