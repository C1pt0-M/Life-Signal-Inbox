from __future__ import annotations

from datetime import date
from pathlib import Path

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from .extractor import build_context, extract_life_items
from .ics import build_ics
from .ocr import extract_text_from_image
from .storage import JsonHistoryStore
from .validator import validate_items


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "history.json"
store = JsonHistoryStore(DATA_PATH)

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


@app.get("/api/history")
def history() -> list[dict]:
    return store.list_items()


@app.post("/api/extract")
def extract(request: ExtractRequest) -> dict:
    history_items = store.list_items()
    context = build_context(
        raw_text=request.text,
        source_type=request.source_type,
        current_date=request.current_date or date.today().isoformat(),
        timezone=request.timezone,
        historical_items=history_items,
    )
    result = extract_life_items(context)
    validation = validate_items(result["items"], history_items)
    return {**result, "validation": validation}


@app.post("/api/todos")
def save_todos(request: SaveRequest) -> dict:
    saved = store.save_items(request.items)
    validation = validate_items(saved, store.list_items())
    return {"saved": saved, "validation": validation}


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

