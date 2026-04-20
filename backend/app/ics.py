from __future__ import annotations

from datetime import datetime, timezone


def build_ics(items: list[dict], generated_at: datetime | None = None) -> str:
    stamp = _format_utc(generated_at or datetime.now(timezone.utc))
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Life Signal Inbox//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for item in items:
        start = _parse(item.get("time", {}).get("start"))
        if not start:
            continue
        end = _parse(item.get("time", {}).get("end")) or start
        event_lines = [
            "BEGIN:VEVENT",
            f"UID:{_escape(item.get('id', item.get('title', 'life-signal')))}@life-signal-inbox",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{_format_utc(start)}",
            f"DTEND:{_format_utc(end)}",
            f"SUMMARY:{_escape(item.get('title', '待处理生活事项'))}",
            f"LOCATION:{_escape(item.get('location', ''))}",
        ]
        recurrence_rule = (item.get("recurrence") or {}).get("rrule")
        if recurrence_rule:
            event_lines.append(f"RRULE:{recurrence_rule}")
        event_lines.extend(
            [
                f"DESCRIPTION:{_escape(_description(item))}",
                "END:VEVENT",
            ]
        )
        lines.extend(event_lines)
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _format_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _description(item: dict) -> str:
    materials = "、".join(item.get("materials") or [])
    contacts = "、".join(contact.get("name", "") for contact in item.get("contacts") or [])
    recurrence = (item.get("recurrence") or {}).get("label", "")
    notes = item.get("notes", "")
    return (
        f"来源：{item.get('source_type', '')}\\n"
        f"重复：{recurrence or '不重复'}\\n"
        f"备注：{notes or '无'}\\n"
        f"材料：{materials or '待确认'}\\n"
        f"联系人：{contacts or '待确认'}\\n"
        f"可信度：{round(float(item.get('confidence') or 0) * 100)}%\\n"
        f"原文依据：{item.get('evidence', '')}"
    )


def _escape(value: str) -> str:
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )
