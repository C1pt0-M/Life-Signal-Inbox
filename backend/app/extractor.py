from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .ai_extractor import AIClient, AIExtractionError, extract_with_ai, get_configured_ai_client


WEEKDAY_MAP = {
    "一": 0,
    "二": 1,
    "三": 2,
    "四": 3,
    "五": 4,
    "六": 5,
    "日": 6,
    "天": 6,
}


def build_context(
    raw_text: str,
    source_type: str,
    current_date: str | None = None,
    timezone: str = "Asia/Shanghai",
    historical_items: list[dict] | None = None,
) -> dict:
    today = current_date or date.today().isoformat()
    return {
        "raw_text": raw_text.strip(),
        "source_type": source_type,
        "current_date": today,
        "timezone": timezone,
        "recognized_items": [],
        "historical_items": historical_items or [],
    }


def extract_life_items(context: dict, ai_client: AIClient | None = None) -> dict:
    client = ai_client or get_configured_ai_client()
    if client:
        try:
            return extract_with_ai(context, client)
        except AIExtractionError as exc:
            result = _extract_life_items_with_rules(context)
            result["json_debug"]["ai_fallback"] = {"reason": exc.code, "message": str(exc)}
            return result
        except Exception as exc:
            result = _extract_life_items_with_rules(context)
            result["json_debug"]["ai_fallback"] = {"reason": "ai_runtime_error", "message": str(exc)}
            return result

    return _extract_life_items_with_rules(context)


def _extract_life_items_with_rules(context: dict) -> dict:
    raw_text = context["raw_text"]
    candidates = _split_candidates(raw_text)
    items = [_extract_one(candidate, context) for candidate in candidates]
    context = {**context, "recognized_items": items}
    return {
        "context": context,
        "items": items,
        "json_debug": {"extractor": "mock_ai_rules_v1", "candidate_count": len(candidates)},
    }


def _split_candidates(raw_text: str) -> list[str]:
    lines = [line.strip() for line in re.split(r"[\n\r]+", raw_text) if line.strip()]
    if len(lines) > 1:
        return lines[:6]
    chunks = [chunk.strip() for chunk in re.split(r"[；;]", raw_text) if chunk.strip()]
    return chunks[:6] or [raw_text.strip()]


def _extract_one(text: str, context: dict) -> dict:
    start = _parse_datetime(text, context["current_date"], context["timezone"])
    end = (start + timedelta(hours=1)) if start else None
    title = _infer_title(text)
    location = _extract_location(text)
    materials = _extract_materials(text)
    contacts = _extract_contacts(text)
    confidence = _score_confidence(start, location, materials, contacts, title)

    item = {
        "id": f"item-{uuid.uuid4().hex[:10]}",
        "title": title,
        "time": {
            "start": start.isoformat() if start else "",
            "end": end.isoformat() if end else "",
            "label": _extract_time_label(text),
        },
        "location": location,
        "materials": materials,
        "contacts": contacts,
        "evidence": text,
        "source_type": context["source_type"],
        "confidence": confidence,
        "quadrant": _infer_quadrant(start, context["current_date"], confidence),
        "status": "pending",
    }
    return item


def _infer_title(text: str) -> str:
    rules = [
        (r"家长会", "家长会确认参会"),
        (r"疫苗|接种", "社区疫苗登记"),
        (r"作业|论文|提交", "课程作业提交"),
        (r"志愿者|报名", "周末志愿者报名"),
        (r"缴费|费用|付款", "费用确认与缴纳"),
        (r"集合", "集合安排确认"),
    ]
    for pattern, title in rules:
        if re.search(pattern, text):
            return title
    cleaned = re.sub(r"【.*?】|通知[:：]?|请|需要", "", text).strip()
    return (cleaned[:18] or "待处理生活事项").rstrip("，。,. ")


def _parse_datetime(text: str, current_date: str, timezone: str) -> datetime | None:
    tz = ZoneInfo(timezone)
    base = date.fromisoformat(current_date)
    item_date = _parse_date_part(text, base)
    item_time = _parse_time_part(text)
    if not item_date:
        return None
    return datetime.combine(item_date, item_time or time(9, 0), tzinfo=tz)


def _parse_date_part(text: str, base: date) -> date | None:
    absolute = re.search(r"(?:(20\d{2})年)?\s*(\d{1,2})月(\d{1,2})[日号]?", text)
    if absolute:
        year = int(absolute.group(1) or base.year)
        return date(year, int(absolute.group(2)), int(absolute.group(3)))

    if "后天" in text:
        return base + timedelta(days=2)
    if "明天" in text:
        return base + timedelta(days=1)
    if "今天" in text or "今晚" in text:
        return base

    weekend = re.search(r"(本周末|周末)", text)
    if weekend:
        days = (5 - base.weekday()) % 7
        return base + timedelta(days=days or 7)

    weekday = re.search(r"(?:本周|这周|下周)?周([一二三四五六日天])", text)
    if weekday:
        target = WEEKDAY_MAP[weekday.group(1)]
        days = target - base.weekday()
        if "下周" in weekday.group(0):
            days += 7 if days <= 0 else 7
        elif days <= 0:
            days += 7
        return base + timedelta(days=days)

    return None


def _parse_time_part(text: str) -> time | None:
    colon = re.search(r"(\d{1,2})[:：](\d{2})", text)
    if colon:
        return time(int(colon.group(1)), int(colon.group(2)))

    hour_match = re.search(r"(上午|下午|晚上|中午|早上)?\s*(\d{1,2})点(?:半|(\d{1,2})分?)?", text)
    if not hour_match:
        return None
    period = hour_match.group(1) or ""
    hour = int(hour_match.group(2))
    minute = 30 if "半" in hour_match.group(0) else int(hour_match.group(3) or 0)
    if period in {"下午", "晚上"} and hour < 12:
        hour += 12
    if period == "中午" and hour < 11:
        hour += 12
    return time(hour, minute)


def _extract_time_label(text: str) -> str:
    patterns = [
        r"(?:(20\d{2})年)?\s*\d{1,2}月\d{1,2}[日号]?\s*(?:上午|下午|晚上|中午|早上)?\s*\d{1,2}(?::|：|点)\d{0,2}",
        r"(?:今天|明天|后天|本周末|周末|本周周?[一二三四五六日天]|下周周?[一二三四五六日天]|周[一二三四五六日天]).{0,8}?\d{1,2}(?:点|[:：]\d{2})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(0)
    return ""


def _extract_location(text: str) -> str:
    explicit = re.search(r"(?:地点|地址)[:：]\s*([^，。；;\n]+)", text)
    if explicit:
        return explicit.group(1).strip()

    at_place = re.search(r"在([^，。；;\n]+?)(?:开|集合|登记|接种|办理|参加|提交|进行)", text)
    if at_place:
        return at_place.group(1).strip()

    for keyword in ["学校礼堂", "社区中心", "学习平台", "线上", "小区门口", "图书馆", "教室"]:
        if keyword in text:
            return keyword
    return ""


def _extract_materials(text: str) -> list[str]:
    materials: list[str] = []
    carry = re.search(r"(?:携带|带上|准备|提交)([^，。；;\n]+)", text)
    if carry:
        materials.extend(_split_list(carry.group(1)))
    for keyword in ["学生手册", "身份证", "户口本", "论文PDF", "报名表", "水杯"]:
        if keyword in text and keyword not in materials:
            materials.append(keyword)
    return [item for item in materials if item and item not in {"材料", "资料"}]


def _split_list(text: str) -> list[str]:
    text = re.sub(r"^(好|相关|以下|的)?", "", text.strip())
    parts = re.split(r"[、,，和及\s]+", text)
    return [part.strip("。.;； ") for part in parts if part.strip("。.;； ")]


def _extract_contacts(text: str) -> list[dict]:
    contacts: list[dict] = []
    teacher = re.search(r"(王老师|李老师|张老师|刘老师|陈老师|助教|社区工作人员|联系人[:：]?\s*[\u4e00-\u9fa5]{2,4})\s*(1[3-9]\d{9})?", text)
    phone = re.search(r"(1[3-9]\d{9})", text)
    if teacher:
        name = teacher.group(1).replace("联系人", "").replace("：", "").replace(":", "").strip()
        contacts.append({"name": name, "phone": teacher.group(2) or (phone.group(1) if phone else "")})
    elif phone:
        contacts.append({"name": "联系人", "phone": phone.group(1)})
    return contacts


def _score_confidence(start: datetime | None, location: str, materials: list[str], contacts: list[dict], title: str) -> float:
    score = 0.52
    if title and title != "待处理生活事项":
        score += 0.12
    if start:
        score += 0.18
    if location:
        score += 0.08
    if materials:
        score += 0.06
    if contacts:
        score += 0.04
    return round(min(score, 0.96), 2)


def _infer_quadrant(start: datetime | None, current_date: str, confidence: float) -> str:
    if not start:
        return "important_not_urgent"
    today = date.fromisoformat(current_date)
    days = (start.date() - today).days
    if confidence < 0.7:
        return "important_urgent"
    if days <= 2:
        return "important_urgent"
    if days <= 7:
        return "important_not_urgent"
    return "not_important_not_urgent"
