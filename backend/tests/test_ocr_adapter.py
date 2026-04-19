from pathlib import Path

from app.ocr import build_paddle_ocr_options, collect_ocr_blocks, extract_text_from_image


def test_build_paddle_ocr_options_uses_lightweight_models():
    options = build_paddle_ocr_options()

    assert options["text_detection_model_name"] == "PP-OCRv5_mobile_det"
    assert options["text_recognition_model_name"] == "PP-OCRv5_mobile_rec"
    assert options["use_textline_orientation"] is False
    assert "lang" not in options
    assert "ocr_version" not in options


def test_collect_ocr_blocks_from_paddle_v3_result():
    result = [{"rec_texts": ["社区通知", "4月20日上午9点登记"], "rec_scores": [0.91, 0.87]}]

    blocks = collect_ocr_blocks(result)

    assert blocks == [
        {"text": "社区通知", "confidence": 0.91},
        {"text": "4月20日上午9点登记", "confidence": 0.87},
    ]


def test_collect_ocr_blocks_from_legacy_result():
    result = [[[[0, 0], [1, 0], [1, 1], [0, 1]], ("请携带身份证", 0.83)]]

    blocks = collect_ocr_blocks(result)

    assert blocks == [{"text": "请携带身份证", "confidence": 0.83}]


def test_extract_text_from_image_uses_engine_and_removes_temp_file(tmp_path):
    seen_paths = []

    class FakeEngine:
        def predict(self, image_path):
            seen_paths.append(image_path)
            assert Path(image_path).exists()
            return [{"rec_texts": ["家长会通知", "本周三下午3点"], "rec_scores": [0.9, 0.8]}]

    result = extract_text_from_image(
        "notice.png",
        b"image-bytes",
        engine_factory=lambda: FakeEngine(),
        temp_dir=tmp_path,
    )

    assert result["text"] == "家长会通知\n本周三下午3点"
    assert result["confidence"] == 0.85
    assert result["provider"] == "paddleocr"
    assert seen_paths
    assert not Path(seen_paths[0]).exists()


def test_extract_text_from_image_reports_unavailable_engine(tmp_path):
    def broken_engine():
        raise RuntimeError("paddleocr missing")

    result = extract_text_from_image(
        "notice.png",
        b"image-bytes",
        engine_factory=broken_engine,
        temp_dir=tmp_path,
    )

    assert result["text"] == ""
    assert result["confidence"] == 0
    assert result["provider"] == "paddleocr_unavailable"
    assert "paddleocr missing" in result["error"]
