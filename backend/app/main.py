from __future__ import annotations

from datetime import date
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from .ai_extractor import get_ai_config_status, set_runtime_ai_config
from .extractor import build_context, extract_life_items
from .ics import build_ics
from .ocr import extract_text_from_image
from .ocr_postprocess import build_ocr_structured_result
from .storage import SQLiteHistoryStore
from .validator import validate_items


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "life_signal.db"
store = SQLiteHistoryStore(DATA_PATH)

app = FastAPI(title="Life Signal Inbox API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExtractRequest(BaseModel):
    text: str
    source_type: str = "微信群"
    current_date: str | None = None
    timezone: str = "Asia/Shanghai"


class SaveRequest(BaseModel):
    items: list[dict]


class ValidateRequest(BaseModel):
    items: list[dict]
    historical_items: list[dict] | None = None


class AIConfigRequest(BaseModel):
    provider: str = "openai-compatible"
    api_key: str
    model: str = "gpt-4o-mini"
    base_url: str = "https://api.openai.com/v1"


SAMPLES = [
    {
        "title": "家长群通知",
        "source_type": "微信群",
        "text": "家长群通知：本周三下午3点在学校礼堂开家长会，请携带学生手册，联系人王老师 13800138000。",
    },
    {
        "title": "课程截止提醒",
        "source_type": "课程通知",
        "text": "课程通知：4月21日17:30前在学习平台提交论文PDF，如有问题联系助教。",
    },
    {
        "title": "社区报名信息",
        "source_type": "社区公告",
        "text": "社区公告：周末上午9点在社区中心集合参加志愿者服务，请带上水杯，联系人李老师 13900001111。",
    },
]


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/samples")
def samples() -> list[dict]:
    return SAMPLES


@app.get("/api/config")
def config() -> dict:
    return {"ai_extractor": get_ai_config_status()}


@app.post("/api/config")
def update_config(request: AIConfigRequest) -> dict:
    return {
        "ai_extractor": set_runtime_ai_config(
            provider=request.provider,
            api_key=request.api_key,
            model=request.model,
            base_url=request.base_url,
        )
    }


@app.get("/api/history")
def history() -> list[dict]:
    return store.list_items()


@app.post("/api/extract")
def extract(request: ExtractRequest) -> dict:
    history_items = store.list_items()
    return _extract_text_payload(
        text=request.text,
        source_type=request.source_type,
        current_date=request.current_date or date.today().isoformat(),
        timezone=request.timezone,
        history_items=history_items,
    )


@app.post("/api/todos")
def save_todos(request: SaveRequest) -> dict:
    saved = store.save_items(request.items)
    validation = validate_items(saved, store.list_items())
    return {"saved": saved, "validation": validation}


@app.post("/api/validate")
def validate_todos(request: ValidateRequest) -> dict:
    history_items = request.historical_items if request.historical_items is not None else store.list_items()
    return {"validation": validate_items(request.items, history_items)}


@app.get("/api/export.ics")
def export_ics() -> Response:
    content = build_ics(store.list_items())
    return Response(
        content=content,
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="life-signal-inbox.ics"'},
    )


@app.post("/api/ocr")
async def ocr(file: UploadFile = File(...)) -> dict:
    content = await file.read()
    return extract_text_from_image(file.filename or "upload.png", content)


@app.post("/api/ocr-extract")
async def ocr_extract(
    file: UploadFile = File(...),
    source_type: str = Form("截图文字"),
    current_date: str | None = Form(None),
    timezone: str = Form("Asia/Shanghai"),
) -> dict:
    content = await file.read()
    ocr_result = extract_text_from_image(file.filename or "upload.png", content)
    text = ocr_result.get("text", "")
    if not text.strip():
        return {
            "ocr": ocr_result,
            "context": build_context(
                raw_text="",
                source_type=source_type,
                current_date=current_date or date.today().isoformat(),
                timezone=timezone,
                historical_items=store.list_items(),
            ),
            "items": [],
            "json_debug": {
                "extractor": "ocr_to_ai_skipped",
                "reason": ocr_result.get("error") or "empty_ocr_text",
            },
            "validation": {
                "score": 0,
                "issues": [
                    {
                        "type": "empty_ocr_text",
                        "severity": "high",
                        "item_id": "",
                        "message": "截图没有识别出可用于提取的文字",
                    }
                ],
                "pending_confirmations": [],
                "has_blockers": True,
            },
        }

    history_items = store.list_items()
    context = build_context(
        raw_text=text,
        source_type=source_type,
        current_date=current_date or date.today().isoformat(),
        timezone=timezone,
        historical_items=history_items,
    )
    structured_ocr_result = build_ocr_structured_result(ocr_result, context)
    if structured_ocr_result:
        validation = validate_items(structured_ocr_result["items"], history_items)
        return {"ocr": ocr_result, **structured_ocr_result, "validation": validation}

    result = _extract_text_payload(
        text=text,
        source_type=source_type,
        current_date=current_date or date.today().isoformat(),
        timezone=timezone,
        history_items=history_items,
    )
    return {"ocr": ocr_result, **result}


def _extract_text_payload(
    text: str,
    source_type: str,
    current_date: str,
    timezone: str,
    history_items: list[dict],
) -> dict:
    context = build_context(
        raw_text=text,
        source_type=source_type,
        current_date=current_date,
        timezone=timezone,
        historical_items=history_items,
    )
    result = extract_life_items(context)
    validation = validate_items(result["items"], history_items)
    return {**result, "validation": validation}
