from __future__ import annotations

import json
import os
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Protocol
from urllib import request

from .settings import load_default_env_files
from .validator import validate_items


load_default_env_files()

_RUNTIME_AI_CONFIG: dict[str, str] = {}


class AIClient(Protocol):
    def complete(self, messages: list[dict]) -> str:
        ...


class AIExtractionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class OpenAICompatibleClient:
    def __init__(self, api_key: str, model: str, base_url: str = "https://api.openai.com/v1", timeout: int = 45):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def complete(self, messages: list[dict]) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = request.Request(
            f"{self.base_url}/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with request.urlopen(req, timeout=self.timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"]


def get_configured_ai_client() -> AIClient | None:
    config = _effective_ai_config()
    provider = config["provider"]
    if provider not in {"openai", "openai-compatible", "openai_compatible"}:
        return None

    api_key = config["api_key"]
    model = config["model"]
    base_url = config["base_url"]
    if not api_key:
        return None
    return OpenAICompatibleClient(api_key=api_key, model=model, base_url=base_url)


def get_ai_config_status() -> dict:
    config = _effective_ai_config()
    provider = config["provider"]
    api_key_present = bool(config["api_key"])
    enabled = provider in {"openai", "openai-compatible", "openai_compatible"} and api_key_present
    return {
        "enabled": enabled,
        "provider": provider or "rules_fallback",
        "model": config["model"] if enabled else "",
        "base_url": config["base_url"] if enabled else "",
        "mode": "ai_harness_v1" if enabled else "mock_ai_rules_v1",
        "fallback": "mock_ai_rules_v1",
        "source": config["source"] if enabled else "rules_fallback",
        "api_key_present": api_key_present,
    }


def set_runtime_ai_config(provider: str, api_key: str, model: str, base_url: str) -> dict:
    _RUNTIME_AI_CONFIG.clear()
    _RUNTIME_AI_CONFIG.update(
        {
            "provider": provider.strip().lower(),
            "api_key": api_key.strip(),
            "model": model.strip() or "gpt-4o-mini",
            "base_url": (base_url.strip() or "https://api.openai.com/v1").rstrip("/"),
        }
    )
    return get_ai_config_status()


def clear_runtime_ai_config() -> None:
    _RUNTIME_AI_CONFIG.clear()


def _effective_ai_config() -> dict:
    if _RUNTIME_AI_CONFIG:
        return {**_RUNTIME_AI_CONFIG, "source": "runtime"}
    return {
        "provider": os.getenv("LIFE_SIGNAL_AI_PROVIDER", "").strip().lower(),
        "api_key": os.getenv("LIFE_SIGNAL_AI_API_KEY") or os.getenv("OPENAI_API_KEY") or "",
        "model": os.getenv("LIFE_SIGNAL_AI_MODEL", "gpt-4o-mini"),
        "base_url": os.getenv("LIFE_SIGNAL_AI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        "source": "env",
    }


def extract_with_ai(context: dict, ai_client: AIClient, max_repairs: int = 1) -> dict:
    attempts = 0
    repaired = False
    last_validation: dict | None = None
    messages = build_ai_messages(context)

    while attempts <= max_repairs:
        attempts += 1
        raw_output = ai_client.complete(messages)
        model_data = parse_model_json(raw_output)
        items = normalize_model_items(model_data.get("items", []), context)
        validation = validate_items(items, context.get("historical_items") or [])
        last_validation = validation

        if not validation["has_blockers"] or attempts > max_repairs:
            return {
                "context": {**context, "recognized_items": items},
                "items": items,
                "json_debug": {
                    "extractor": "ai_harness_v1",
                    "attempts": attempts,
                    "feedback_loop": {
                        "repaired": repaired,
                        "validation_score": validation["score"],
                        "issues": validation["issues"],
                    },
                },
            }

        repaired = True
        messages = build_repair_messages(context, items, validation)

    raise AIExtractionError("ai_repair_failed", f"AI extraction failed: {last_validation}")


def build_ai_messages(context: dict) -> list[dict]:
    return [
        {
            "role": "system",
            "content": (
                "你是 Life Signal Inbox 的生活事项抽取引擎。"
                "你只能输出 JSON，不能输出解释文字。"
                "所有事项必须是可执行待办、日历事项或待确认事项。"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "task": "从结构化上下文中抽取生活事项",
                    "context": context,
                    "output_schema": _output_schema(),
                    "rules": [
                        "时间必须尽量解析为 ISO 8601，带时区。",
                        "今天、明天、后天、本周、下周等相对日期，必须基于 context.current_date 和 context.timezone 解析，不能基于模型当前时间猜测。",
                        "如果原文说“明天上午10点”，且 current_date 是 2026-04-20，则 start 必须是 2026-04-21T10:00:00+08:00。",
                        "不能确定的字段留空或空数组，并降低 confidence。",
                        "evidence 必须引用原文依据。",
                        "quadrant 只能是 important_urgent、important_not_urgent、not_important_urgent、not_important_not_urgent。",
                        "如果输入来自截图文字，并且像低质量 OCR 或课表/表格网格文本，不要强行拆成多个事项。",
                        "对低质量 OCR，可生成一个待确认聚合事项，标题如“课表截图待确认”，把可识别课程或材料放入 materials。",
                    ],
                },
                ensure_ascii=False,
            ),
        },
    ]


def build_repair_messages(context: dict, items: list[dict], validation: dict) -> list[dict]:
    return [
        {
            "role": "system",
            "content": "你是 Life Signal Inbox 的结构化结果修正引擎。只输出 JSON。",
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "task": "自动验证发现以下问题，请基于原始上下文修正结构化结果",
                    "context": context,
                    "previous_items": items,
                    "validation_issues": validation["issues"],
                    "pending_confirmations": validation["pending_confirmations"],
                    "output_schema": _output_schema(),
                },
                ensure_ascii=False,
            ),
        },
    ]


def parse_model_json(text: str) -> dict:
    cleaned = _strip_json_fence(text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise AIExtractionError("model_output_not_json", str(exc)) from exc
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise AIExtractionError("model_output_schema_invalid", "missing items array")
    return data


def normalize_model_items(items: list[dict], context: dict) -> list[dict]:
    normalized = []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        item = {
            "id": raw.get("id") or f"item-{uuid.uuid4().hex[:10]}",
            "title": str(raw.get("title") or "").strip(),
            "time": _normalize_time(raw.get("time") or {}),
            "location": str(raw.get("location") or "").strip(),
            "materials": _normalize_string_list(raw.get("materials")),
            "contacts": _normalize_contacts(raw.get("contacts")),
            "evidence": str(raw.get("evidence") or context.get("raw_text", "")).strip(),
            "source_type": raw.get("source_type") or context.get("source_type", ""),
            "confidence": _clamp_confidence(raw.get("confidence")),
            "quadrant": _normalize_quadrant(raw.get("quadrant")),
            "status": raw.get("status") or "pending",
        }
        normalized.append(item)
    return normalized


def _strip_json_fence(text: str) -> str:
    stripped = text.strip()
    match = re.search(r"```(?:json)?\s*(.*?)```", stripped, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return stripped


def _normalize_time(value: dict) -> dict:
    start = str(value.get("start") or "").strip()
    end = str(value.get("end") or "").strip()
    if start and not end:
        end = _plus_one_hour(start)
    return {
        "start": start,
        "end": end,
        "label": str(value.get("label") or "").strip(),
    }


def _plus_one_hour(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return ""
    return (parsed + timedelta(hours=1)).isoformat()


def _normalize_string_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _normalize_contacts(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    contacts = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        phone = str(item.get("phone") or "").strip()
        if name or phone:
            contacts.append({"name": name, "phone": phone})
    return contacts


def _clamp_confidence(value) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.5
    return round(max(0, min(confidence, 1)), 2)


def _normalize_quadrant(value) -> str:
    allowed = {
        "important_urgent",
        "important_not_urgent",
        "not_important_urgent",
        "not_important_not_urgent",
    }
    return value if value in allowed else "important_not_urgent"


def _output_schema() -> dict:
    return {
        "items": [
            {
                "title": "string",
                "time": {"start": "ISO datetime string", "end": "ISO datetime string", "label": "string"},
                "location": "string",
                "materials": ["string"],
                "contacts": [{"name": "string", "phone": "string"}],
                "evidence": "string",
                "confidence": "number 0-1",
                "quadrant": "string",
            }
        ]
    }
