from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


COURSE_DEFINITIONS = [
    {"title": "大学英语", "aliases": ["大学英语", "大学英"]},
    {"title": "高等数学I", "aliases": ["高等数学I", "高等数"]},
    {"title": "程序设计基础", "aliases": ["程序设计基础", "程序设"]},
    {"title": "算法设计与分析", "aliases": ["算法设计与分析", "算法设"]},
    {"title": "软件工程（专创）", "aliases": ["软件工程（专创）", "软件工"]},
    {"title": "概率论与数理统计", "aliases": ["概率论与数理统计", "概率论"]},
    {"title": "烹饪营养与健康", "aliases": ["烹饪营养与健康", "烹饪营养"]},
    {"title": "形势与政策", "aliases": ["形势与政策", "形势与"]},
    {"title": "中国近现代史纲要", "aliases": ["中国近现代史纲要", "中国近"]},
    {"title": "思想道德与法治", "aliases": ["思想道德与法治", "思想道"]},
    {"title": "奇石妙赏", "aliases": ["奇石妙赏"]},
    {"title": "体育", "aliases": ["体育"]},
    {"title": "面向对象程序设计", "aliases": ["面向对象程序设计", "面向对"]},
]


def build_ocr_structured_result(ocr_result: dict, context: dict) -> dict | None:
    text = ocr_result.get("text", "")
    if not _looks_like_timetable(text):
        return None

    courses = _extract_course_occurrences(text)
    location = _extract_timetable_location(text)
    week_dates = _extract_week_dates(text, context)
    items = [
        _build_course_item(course, index, week_dates, location, text, ocr_result, context)
        for index, course in enumerate(courses)
    ]
    return {
        "context": {**context, "recognized_items": items},
        "items": items,
        "json_debug": {
            "extractor": "ocr_timetable_postprocess_v1",
            "ocr_preprocess": {
                "detected_type": "timetable",
                "course_count": len(courses),
                "reason": "课表截图属于网格排版，OCR 文本可能丢失节次；先按课程名生成事项，节次留在备注中提醒核对。",
            },
        },
    }


def _looks_like_timetable(text: str) -> bool:
    signals = ["我的课表", "学年", "第", "周一", "周二", "周三", "周四", "周五"]
    score = sum(1 for signal in signals if signal in text)
    course_hits = len(_extract_course_occurrences(text))
    return score >= 3 and course_hits >= 2


def _extract_course_occurrences(text: str) -> list[str]:
    found: list[tuple[int, str]] = []
    for course in COURSE_DEFINITIONS:
        positions = [_find_alias_position(text, alias) for alias in course["aliases"]]
        positions = [position for position in positions if position >= 0]
        if positions:
            found.append((min(positions), course["title"]))
    found.sort(key=lambda item: item[0])
    return [title for _, title in found]


def _find_alias_position(text: str, alias: str) -> int:
    index = text.find(alias)
    if index >= 0:
        return index
    pattern = r"\s*".join(map(re.escape, alias))
    match = re.search(pattern, text)
    return match.start() if match else -1


def _extract_timetable_location(text: str) -> str:
    compact = re.sub(r"\s+", "", text)
    for location in ["博达校区1号教学楼", "博达校区2号教学楼", "博达校区图书馆", "博达校区信息技术综合实验楼", "博达校区南区训练馆"]:
        if location in compact:
            return location
    match = re.search(r"(博达校区[^，。；;\n ]{0,18})", text)
    return match.group(1) if match else ""


def _extract_week_label(text: str) -> str:
    term = re.search(r"(\d{4}-\d{4}学年[^ ]{0,8})", text)
    week = re.search(r"第\d+周", text)
    parts = [part.group(0) for part in (term, week) if part]
    return " ".join(parts)


def _extract_week_dates(text: str, context: dict) -> list[date]:
    year = _extract_calendar_year(text, context["current_date"])
    month = _extract_month(text)
    days = [int(value) for value in re.findall(r"(\d{1,2})日", text)[:7]]
    if not month or not days:
        return []
    return [date(year, month, day) for day in days]


def _extract_calendar_year(text: str, current_date: str) -> int:
    term = re.search(r"(\d{4})-(\d{4})学年(第一|第二)学期", text)
    if term:
        return int(term.group(1) if term.group(3) == "第一" else term.group(2))
    return date.fromisoformat(current_date).year


def _extract_month(text: str) -> int | None:
    direct = re.search(r"(\d{1,2})月", text)
    if direct:
        return int(direct.group(1))
    before_days = re.search(r"(?:^|\s)(\d{1,2})\s+\d{1,2}日(?:\s+\d{1,2}日){2,}", text)
    if before_days:
        return int(before_days.group(1))
    after_days = re.search(r"\d{1,2}日(?:\s+\d{1,2}日){2,}\s+(\d{1,2})\s*月?", text)
    if after_days:
        return int(after_days.group(1))
    return None


def _build_course_item(
    course: str,
    index: int,
    week_dates: list[date],
    location: str,
    text: str,
    ocr_result: dict,
    context: dict,
) -> dict:
    item_date = week_dates[index % len(week_dates)] if week_dates else None
    tz = ZoneInfo(context["timezone"])
    start = datetime.combine(item_date, time(9, 0), tzinfo=tz) if item_date else None
    end = start + timedelta(hours=1) if start else None
    date_label = f"{item_date.year}年{item_date.month}月{item_date.day}日" if item_date else _extract_week_label(text)
    return {
        "id": f"item-{uuid.uuid4().hex[:10]}",
        "kind": "schedule_course",
        "title": course,
        "time": {
            "start": start.isoformat() if start else "",
            "end": end.isoformat() if end else "",
            "label": f"{date_label}（具体节次待确认）" if date_label else "具体时间待确认",
        },
        "location": location,
        "materials": [],
        "contacts": [],
        "notes": "由课表截图 OCR 生成，具体节次请核对原图。",
        "evidence": text,
        "source_type": context["source_type"],
        "confidence": 0.72 if float(ocr_result.get("confidence") or 0) >= 0.5 else 0.6,
        "quadrant": "important_not_urgent",
        "status": "pending",
    }
