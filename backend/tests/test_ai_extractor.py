from app.ai_extractor import extract_with_ai, parse_model_json
from app.extractor import build_context, extract_life_items


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
