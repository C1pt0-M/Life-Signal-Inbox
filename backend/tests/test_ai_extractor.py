from app.ai_extractor import (
    build_ai_messages,
    clear_runtime_ai_config,
    extract_with_vision,
    extract_with_ai,
    get_ai_config_status,
    get_configured_ai_client,
    get_configured_vision_client,
    get_vision_config_status,
    parse_model_json,
)
from app.extractor import build_context, extract_life_items
from app.main import app
from app.settings import load_env_file
from fastapi.testclient import TestClient


class FakeAIClient:
    def __init__(self, responses):
        self.responses = responses
        self.messages = []

    def complete(self, messages):
        self.messages.append(messages)
        return self.responses.pop(0)


def test_parse_model_json_accepts_fenced_json():
    data = parse_model_json(
        """```json
        {"items": [{"title": "课程作业提交"}]}
        ```"""
    )

    assert data["items"][0]["title"] == "课程作业提交"


def test_ai_extraction_uses_structured_context_and_output():
    context = build_context(
        raw_text="课程通知：4月21日17:30前在学习平台提交论文PDF，如有问题联系助教。",
        source_type="课程通知",
        current_date="2026-04-19",
        timezone="Asia/Shanghai",
        historical_items=[],
    )
    client = FakeAIClient(
        [
            """
            {
              "items": [
                {
                  "title": "课程作业提交",
                  "time": {"start": "2026-04-21T17:30:00+08:00", "end": "2026-04-21T18:00:00+08:00", "label": "4月21日17:30前"},
                  "location": "学习平台",
                  "materials": ["论文PDF"],
                  "contacts": [{"name": "助教", "phone": ""}],
                  "evidence": "4月21日17:30前在学习平台提交论文PDF，如有问题联系助教。",
                  "confidence": 0.93,
                  "quadrant": "important_urgent"
                }
              ]
            }
            """
        ]
    )

    result = extract_with_ai(context, client)

    assert result["items"][0]["title"] == "课程作业提交"
    assert result["items"][0]["source_type"] == "课程通知"
    assert result["items"][0]["id"].startswith("item-")
    assert result["json_debug"]["extractor"] == "ai_harness_v1"
    assert result["json_debug"]["attempts"] == 1
    assert "raw_text" in client.messages[0][1]["content"]


def test_ai_prompt_warns_against_over_extracting_noisy_ocr():
    context = build_context(
        raw_text="我的课表 第8周 周一 周二 软件工 程 概率论 @ 博达校 区1号 教学楼",
        source_type="截图文字",
        current_date="2026-04-20",
        timezone="Asia/Shanghai",
        historical_items=[],
    )

    messages = build_ai_messages(context)

    assert "低质量 OCR" in messages[1]["content"]
    assert "不要强行拆成多个事项" in messages[1]["content"]


def test_ai_extraction_repairs_invalid_result_after_validation():
    context = build_context(
        raw_text="明天上午9点社区中心登记，请带身份证。",
        source_type="社区公告",
        current_date="2026-04-19",
        timezone="Asia/Shanghai",
        historical_items=[],
    )
    client = FakeAIClient(
        [
            '{"items":[{"title":"","time":{"start":""},"location":"","materials":[],"contacts":[],"confidence":0.4}]}',
            """
            {
              "items": [
                {
                  "title": "社区登记",
                  "time": {"start": "2026-04-20T09:00:00+08:00", "end": "2026-04-20T10:00:00+08:00", "label": "明天上午9点"},
                  "location": "社区中心",
                  "materials": ["身份证"],
                  "contacts": [],
                  "evidence": "明天上午9点社区中心登记，请带身份证。",
                  "confidence": 0.82,
                  "quadrant": "important_urgent"
                }
              ]
            }
            """,
        ]
    )

    result = extract_with_ai(context, client)

    assert result["items"][0]["title"] == "社区登记"
    assert result["json_debug"]["attempts"] == 2
    assert result["json_debug"]["feedback_loop"]["repaired"] is True
    assert len(client.messages) == 2
    assert "自动验证发现以下问题" in client.messages[1][1]["content"]


def test_extract_life_items_falls_back_to_rules_when_ai_fails():
    context = build_context(
        raw_text="家长群通知：本周三下午3点在学校礼堂开家长会，请携带学生手册，联系人王老师 13800138000。",
        source_type="微信群",
        current_date="2026-04-19",
        timezone="Asia/Shanghai",
        historical_items=[],
    )
    client = FakeAIClient(["not-json"])

    result = extract_life_items(context, ai_client=client)

    assert result["items"][0]["title"] == "家长会确认参会"
    assert result["json_debug"]["extractor"] == "mock_ai_rules_v1"
    assert result["json_debug"]["ai_fallback"]["reason"] == "model_output_not_json"


def test_load_env_file_configures_openai_compatible_client(tmp_path, monkeypatch):
    clear_runtime_ai_config()
    monkeypatch.delenv("LIFE_SIGNAL_AI_PROVIDER", raising=False)
    monkeypatch.delenv("LIFE_SIGNAL_AI_API_KEY", raising=False)
    monkeypatch.delenv("LIFE_SIGNAL_AI_MODEL", raising=False)
    monkeypatch.delenv("LIFE_SIGNAL_AI_BASE_URL", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "LIFE_SIGNAL_AI_PROVIDER=openai-compatible",
                "LIFE_SIGNAL_AI_API_KEY=test-secret-key",
                "LIFE_SIGNAL_AI_MODEL=demo-model",
                "LIFE_SIGNAL_AI_BASE_URL=https://example.test/v1",
            ]
        ),
        encoding="utf-8",
    )

    load_env_file(env_file)
    status = get_ai_config_status()
    client = get_configured_ai_client()

    assert status["enabled"] is True
    assert status["provider"] == "openai-compatible"
    assert status["model"] == "demo-model"
    assert status["base_url"] == "https://example.test/v1"
    assert "secret" not in str(status).lower()
    assert client is not None
    clear_runtime_ai_config()


def test_config_endpoint_accepts_runtime_ai_config_without_exposing_secret(monkeypatch):
    clear_runtime_ai_config()
    monkeypatch.delenv("LIFE_SIGNAL_AI_PROVIDER", raising=False)
    monkeypatch.delenv("LIFE_SIGNAL_AI_API_KEY", raising=False)
    client = TestClient(app)

    response = client.post(
        "/api/config",
        json={
            "provider": "openai-compatible",
            "api_key": "dummy-runtime-key",
            "model": "demo-runtime-model",
            "base_url": "https://runtime.example/v1",
        },
    )
    payload = response.json()["ai_extractor"]

    assert response.status_code == 200
    assert payload["enabled"] is True
    assert payload["source"] == "runtime"
    assert payload["model"] == "demo-runtime-model"
    assert payload["base_url"] == "https://runtime.example/v1"
    assert "dummy-runtime-key" not in str(response.json())
    assert get_configured_ai_client() is not None
    clear_runtime_ai_config()


def test_load_env_file_configures_openai_compatible_vision_client(tmp_path, monkeypatch):
    clear_runtime_ai_config()
    for name in [
        "LIFE_SIGNAL_VISION_PROVIDER",
        "LIFE_SIGNAL_VISION_API_KEY",
        "LIFE_SIGNAL_VISION_MODEL",
        "LIFE_SIGNAL_VISION_BASE_URL",
        "LIFE_SIGNAL_AI_PROVIDER",
        "LIFE_SIGNAL_AI_API_KEY",
        "LIFE_SIGNAL_AI_MODEL",
        "LIFE_SIGNAL_AI_BASE_URL",
    ]:
        monkeypatch.delenv(name, raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "LIFE_SIGNAL_AI_PROVIDER=openai-compatible",
                "LIFE_SIGNAL_AI_API_KEY=test-secret-key",
                "LIFE_SIGNAL_AI_BASE_URL=https://example.test/v1",
                "LIFE_SIGNAL_VISION_MODEL=gemini-2.5-flash",
            ]
        ),
        encoding="utf-8",
    )

    load_env_file(env_file)
    status = get_vision_config_status()
    client = get_configured_vision_client()

    assert status["enabled"] is True
    assert status["model"] == "gemini-2.5-flash"
    assert status["base_url"] == "https://example.test/v1"
    assert client is not None
    clear_runtime_ai_config()


def test_extract_with_vision_uses_image_understanding_and_structured_output():
    context = build_context(
        raw_text="",
        source_type="截图文字",
        current_date="2026-04-21",
        timezone="Asia/Shanghai",
        historical_items=[],
    )
    client = FakeAIClient(
        [
            """
            {
              "items": [
                {
                  "title": "课程作业提交",
                  "time": {"start": "2026-04-21T17:30:00+08:00", "end": "2026-04-21T18:00:00+08:00", "label": "4月21日17:30前"},
                  "location": "学习平台",
                  "materials": ["论文PDF"],
                  "contacts": [{"name": "助教", "phone": ""}],
                  "evidence": "4月21日17:30前在学习平台提交论文PDF，如有问题联系助教。",
                  "confidence": 0.93,
                  "quadrant": "important_urgent"
                }
              ]
            }
            """
        ]
    )

    result = extract_with_vision(context, "notice.png", b"fake-image-bytes", client)

    assert result["items"][0]["title"] == "课程作业提交"
    assert result["json_debug"]["extractor"] == "vision_harness_v1"
    assert client.messages[0][1]["content"][1]["type"] == "image_url"
    assert client.messages[0][1]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
