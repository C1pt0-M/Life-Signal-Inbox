from datetime import datetime

from fastapi.testclient import TestClient

from app.extractor import build_context, extract_life_items
from app.ics import build_ics
from app.main import app
from app.storage import SQLiteHistoryStore
from app.validator import validate_items


def test_extracts_structured_item_from_life_notice():
    context = build_context(
        raw_text="家长群通知：本周三下午3点在学校礼堂开家长会，请携带学生手册，联系人王老师 13800138000。",
        source_type="微信群",
        current_date="2026-04-19",
        timezone="Asia/Shanghai",
        historical_items=[],
    )

    result = extract_life_items(context)

    assert result["context"]["raw_text"].startswith("家长群通知")
    assert len(result["items"]) == 1
    item = result["items"][0]
    assert item["title"] == "家长会确认参会"
    assert item["time"]["start"] == "2026-04-22T15:00:00+08:00"
    assert item["location"] == "学校礼堂"
    assert item["materials"] == ["学生手册"]
    assert item["contacts"][0]["name"] == "王老师"
    assert item["confidence"] >= 0.8


def test_validation_flags_missing_fields_low_confidence_and_conflict():
    current = [
        {
            "id": "new-1",
            "title": "社区疫苗登记",
            "time": {"start": "2026-04-20T09:00:00+08:00", "end": "2026-04-20T10:00:00+08:00"},
            "location": "",
            "materials": [],
            "contacts": [],
            "confidence": 0.58,
            "evidence": "明天上午9点登记",
            "source_type": "社区公告",
            "quadrant": "important_urgent",
        }
    ]
    history = [
        {
            "id": "old-1",
            "title": "课程答疑",
            "time": {"start": "2026-04-20T09:30:00+08:00", "end": "2026-04-20T10:30:00+08:00"},
            "location": "线上",
            "materials": [],
            "contacts": [],
            "confidence": 0.9,
            "evidence": "历史事项",
            "source_type": "课程通知",
            "quadrant": "important_urgent",
        }
    ]

    report = validate_items(current, history)

    assert report["score"] < 80
    assert any(issue["type"] == "missing_location" for issue in report["issues"])
    assert any(issue["type"] == "missing_materials" for issue in report["issues"])
    assert any(issue["type"] == "missing_contacts" for issue in report["issues"])
    assert any(issue["type"] == "low_confidence" for issue in report["issues"])
    assert any(issue["type"] == "time_conflict" for issue in report["issues"])
    assert report["pending_confirmations"]


def test_build_ics_exports_calendar_event():
    items = [
        {
            "id": "item-1",
            "title": "课程作业提交",
            "time": {"start": "2026-04-21T17:30:00+08:00", "end": "2026-04-21T18:00:00+08:00"},
            "location": "学习平台",
            "materials": ["论文PDF"],
            "contacts": [{"name": "助教", "phone": ""}],
            "confidence": 0.92,
            "evidence": "4月21日17:30前提交论文PDF",
            "source_type": "课程通知",
            "quadrant": "important_urgent",
        }
    ]

    ics = build_ics(items, generated_at=datetime(2026, 4, 19, 12, 0, 0))

    assert "BEGIN:VCALENDAR" in ics
    assert "SUMMARY:课程作业提交" in ics
    assert "DTSTART:20260421T093000Z" in ics
    assert "LOCATION:学习平台" in ics


def test_history_store_roundtrip(tmp_path):
    store = SQLiteHistoryStore(tmp_path / "history.db")
    saved = store.save_items(
        [
            {
                "id": "item-1",
                "title": "周末志愿者报名",
                "time": {"start": "2026-04-25T09:00:00+08:00", "end": "2026-04-25T10:00:00+08:00"},
                "location": "社区中心",
                "materials": [],
                "contacts": [],
                "confidence": 0.86,
                "evidence": "周六上午9点社区中心集合",
                "source_type": "报名信息",
                "quadrant": "important_not_urgent",
            }
        ]
    )

    assert saved[0]["title"] == "周末志愿者报名"
    assert store.list_items()[0]["id"] == "item-1"


def test_sqlite_history_store_persists_across_instances(tmp_path):
    db_path = tmp_path / "history.db"
    first = SQLiteHistoryStore(db_path)
    first.save_items(
        [
            {
                "id": "item-1",
                "title": "家长会确认参会",
                "time": {"start": "2026-04-22T15:00:00+08:00", "end": "2026-04-22T16:00:00+08:00"},
                "location": "学校礼堂",
                "materials": ["学生手册"],
                "contacts": [{"name": "王老师", "phone": "13800138000"}],
                "confidence": 0.92,
                "evidence": "家长群通知",
                "source_type": "微信群",
                "quadrant": "important_urgent",
            }
        ]
    )

    second = SQLiteHistoryStore(db_path)

    assert second.list_items()[0]["title"] == "家长会确认参会"
    assert second.list_items()[0]["materials"] == ["学生手册"]


def test_config_endpoint_reports_ai_extractor_mode():
    client = TestClient(app)

    response = client.get("/api/config")

    assert response.status_code == 200
    assert "ai_extractor" in response.json()


def test_validate_endpoint_rechecks_edited_items():
    client = TestClient(app)
    item = {
        "id": "edited-1",
        "title": "社区登记",
        "time": {"start": "2026-04-20T09:00:00+08:00", "end": "2026-04-20T10:00:00+08:00"},
        "location": "社区中心",
        "materials": ["身份证"],
        "contacts": [{"name": "社区工作人员", "phone": ""}],
        "confidence": 0.84,
        "evidence": "明天上午9点社区中心登记，请带身份证。",
        "source_type": "社区公告",
        "quadrant": "important_urgent",
    }

    response = client.post("/api/validate", json={"items": [item], "historical_items": []})

    assert response.status_code == 200
    assert response.json()["validation"]["score"] == 100
    assert response.json()["validation"]["pending_confirmations"] == []


def test_todo_api_persists_items_in_sqlite_store(tmp_path, monkeypatch):
    from app import main as main_module

    test_store = SQLiteHistoryStore(tmp_path / "api-history.db")
    monkeypatch.setattr(main_module, "store", test_store)
    client = TestClient(app)
    item = {
        "id": "api-item-1",
        "title": "课程作业提交",
        "time": {"start": "2026-04-21T17:30:00+08:00", "end": "2026-04-21T18:00:00+08:00"},
        "location": "学习平台",
        "materials": ["论文PDF"],
        "contacts": [{"name": "助教", "phone": ""}],
        "confidence": 0.92,
        "evidence": "4月21日17:30前提交",
        "source_type": "课程通知",
        "quadrant": "important_urgent",
    }

    save_response = client.post("/api/todos", json={"items": [item]})
    history_response = client.get("/api/history")
    ics_response = client.get("/api/export.ics")

    assert save_response.status_code == 200
    assert history_response.json()[0]["id"] == "api-item-1"
    assert "SUMMARY:课程作业提交" in ics_response.text
