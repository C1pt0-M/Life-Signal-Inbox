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


def test_build_ics_exports_recurrence_and_notes():
    items = [
        {
            "id": "manual-1",
            "title": "程序设计基础",
            "time": {"start": "2026-04-21T09:00:00+08:00", "end": "2026-04-21T10:30:00+08:00"},
            "location": "博达校区1号教学楼",
            "notes": "带电脑",
            "recurrence": {"type": "weekdays", "label": "每个工作日", "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"},
            "materials": [],
            "contacts": [],
            "confidence": 1,
            "evidence": "手动添加",
            "source_type": "手动添加",
            "quadrant": "important_urgent",
        }
    ]

    ics = build_ics(items, generated_at=datetime(2026, 4, 19, 12, 0, 0))

    assert "SUMMARY:程序设计基础" in ics
    assert "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" in ics
    assert "备注：带电脑" in ics


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


def test_ocr_extract_endpoint_runs_ocr_then_structured_extraction(tmp_path, monkeypatch):
    from app import main as main_module

    monkeypatch.setattr(main_module, "store", SQLiteHistoryStore(tmp_path / "ocr-history.db"))
    monkeypatch.setattr(
        main_module,
        "extract_text_from_image",
        lambda filename, content: {
            "filename": filename,
            "text": "截图通知：4月21日17:30前在学习平台提交论文PDF，如有问题联系助教。",
            "confidence": 0.91,
            "provider": "paddleocr",
            "blocks": [{"text": "截图通知：4月21日17:30前在学习平台提交论文PDF，如有问题联系助教。", "confidence": 0.91}],
        },
    )
    client = TestClient(app)

    response = client.post(
        "/api/ocr-extract",
        files={"file": ("notice.png", b"image-bytes", "image/png")},
        data={"current_date": "2026-04-19", "timezone": "Asia/Shanghai"},
    )

    payload = response.json()
    assert response.status_code == 200
    assert payload["ocr"]["provider"] == "paddleocr"
    assert payload["context"]["source_type"] == "截图文字"
    assert payload["items"][0]["title"] == "课程作业提交"
    assert payload["items"][0]["time"]["start"] == "2026-04-21T17:30:00+08:00"
    assert payload["validation"]["score"] > 0


def test_ocr_extract_endpoint_turns_timetable_courses_into_events(tmp_path, monkeypatch):
    from app import main as main_module

    noisy_timetable = (
        "我的课表 2025-2026学年第一学期 第11周 长按格子添加备注 "
        "11 24日 25日 26日 27日 28日 29日 30日 月 周一 周二 周三 周四 周五 周六 周日 "
        "大学英 高等数 程序设 语（@ 学I@博 计基础 @博达校区1号教学楼 "
        "高等数学I@博达校区1号教学楼 烹饪营养与@博达校区1号教学楼 "
        "体育(A) 形势与政策 思想道德与法治 奇石妙赏 备注：[100580]程序设计基础(004)第1-16周"
    )
    monkeypatch.setattr(main_module, "store", SQLiteHistoryStore(tmp_path / "ocr-timetable.db"))
    monkeypatch.setattr(
        main_module,
        "extract_text_from_image",
        lambda filename, content: {
            "filename": filename,
            "text": noisy_timetable,
            "confidence": 0.63,
            "provider": "paddleocr",
            "blocks": [{"text": noisy_timetable, "confidence": 0.63}],
        },
    )
    client = TestClient(app)

    response = client.post(
        "/api/ocr-extract",
        files={"file": ("timetable.jpg", b"image-bytes", "image/jpeg")},
        data={"current_date": "2026-04-20", "timezone": "Asia/Shanghai"},
    )

    payload = response.json()
    assert response.status_code == 200
    titles = [item["title"] for item in payload["items"]]
    program_item = next(item for item in payload["items"] if item["title"] == "程序设计基础")
    assert "程序设计基础" in titles
    assert "高等数学I" in titles
    assert program_item["time"]["start"] == "2025-11-26T09:00:00+08:00"
    assert program_item["location"] == "博达校区1号教学楼"
    assert program_item["notes"] == "由课表截图 OCR 生成，具体节次请核对原图。"
    assert payload["json_debug"]["ocr_preprocess"]["detected_type"] == "timetable"
    assert len(payload["validation"]["issues"]) < 12
