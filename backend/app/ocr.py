from __future__ import annotations

import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable


os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")


EngineFactory = Callable[[], Any]


def extract_text_from_image(
    filename: str,
    content: bytes,
    engine_factory: EngineFactory | None = None,
    temp_dir: str | Path | None = None,
) -> dict:
    if not content:
        return {
            "filename": filename,
            "text": "",
            "confidence": 0,
            "provider": "paddleocr",
            "blocks": [],
            "error": "上传图片为空",
        }

    try:
        engine = (engine_factory or get_paddle_ocr)()
    except Exception as exc:
        return _error_result(filename, "paddleocr_unavailable", exc)

    image_path = _write_temp_image(filename, content, temp_dir)
    try:
        raw_result = _run_ocr(engine, image_path)
        blocks = collect_ocr_blocks(raw_result)
        text = "\n".join(block["text"] for block in blocks if block["text"])
        return {
            "filename": filename,
            "text": text,
            "confidence": _average_confidence(blocks),
            "provider": "paddleocr",
            "blocks": blocks,
        }
    except Exception as exc:
        return _error_result(filename, "paddleocr_error", exc)
    finally:
        Path(image_path).unlink(missing_ok=True)


@lru_cache(maxsize=1)
def get_paddle_ocr() -> Any:
    from paddleocr import PaddleOCR

    return PaddleOCR(**build_paddle_ocr_options())


def build_paddle_ocr_options() -> dict:
    options = {
        "text_detection_model_name": os.getenv("PADDLE_OCR_DET_MODEL", "PP-OCRv5_mobile_det"),
        "text_recognition_model_name": os.getenv("PADDLE_OCR_REC_MODEL", "PP-OCRv5_mobile_rec"),
        "use_doc_orientation_classify": _env_bool("PADDLE_OCR_DOC_ORIENTATION", False),
        "use_doc_unwarping": _env_bool("PADDLE_OCR_DOC_UNWARPING", False),
        "use_textline_orientation": _env_bool("PADDLE_OCR_TEXTLINE_ORIENTATION", False),
    }
    if _env_bool("PADDLE_OCR_USE_LANG_PRESET", False):
        options.pop("text_detection_model_name")
        options.pop("text_recognition_model_name")
        options["lang"] = os.getenv("PADDLE_OCR_LANG", "ch")
        options["ocr_version"] = os.getenv("PADDLE_OCR_VERSION", "PP-OCRv5")
    return options


def collect_ocr_blocks(raw_result: Any) -> list[dict]:
    blocks: list[dict] = []
    _visit_ocr_node(raw_result, blocks)
    return blocks


def _run_ocr(engine: Any, image_path: str) -> Any:
    if hasattr(engine, "predict"):
        return engine.predict(image_path)
    return engine.ocr(image_path)


def _write_temp_image(filename: str, content: bytes, temp_dir: str | Path | None) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        suffix = ".png"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=temp_dir) as handle:
        handle.write(content)
        return handle.name


def _visit_ocr_node(node: Any, blocks: list[dict]) -> None:
    if node is None or isinstance(node, (str, bytes)):
        return

    payload = _as_result_payload(node)
    if payload is not node:
        _visit_ocr_node(payload, blocks)
        return

    if isinstance(node, dict):
        if _append_dict_blocks(node, blocks):
            return
        for value in node.values():
            _visit_ocr_node(value, blocks)
        return

    if isinstance(node, (list, tuple)):
        if _append_legacy_line(node, blocks):
            return
        for value in node:
            _visit_ocr_node(value, blocks)


def _as_result_payload(node: Any) -> Any:
    json_attr = getattr(node, "json", None)
    if callable(json_attr):
        try:
            return json_attr()
        except TypeError:
            return node
    if isinstance(json_attr, dict):
        return json_attr

    for attr in ("res", "data"):
        if hasattr(node, attr):
            return getattr(node, attr)
    return node


def _append_dict_blocks(node: dict, blocks: list[dict]) -> bool:
    texts = node.get("rec_texts") or node.get("texts")
    if not texts:
        return False
    scores = node.get("rec_scores") or node.get("scores") or []
    for index, text in enumerate(texts):
        cleaned = str(text).strip()
        if cleaned:
            blocks.append(
                {
                    "text": cleaned,
                    "confidence": _safe_score(scores[index] if index < len(scores) else None),
                }
            )
    return True


def _append_legacy_line(node: list | tuple, blocks: list[dict]) -> bool:
    if len(node) < 2 or not isinstance(node[1], (list, tuple)) or len(node[1]) < 2:
        return False
    text, score = node[1][0], node[1][1]
    if not isinstance(text, str):
        return False
    cleaned = text.strip()
    if cleaned:
        blocks.append({"text": cleaned, "confidence": _safe_score(score)})
    return True


def _safe_score(value: Any) -> float:
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return 0


def _average_confidence(blocks: list[dict]) -> float:
    scores = [float(block["confidence"]) for block in blocks if block.get("confidence")]
    if not scores:
        return 0
    return round(sum(scores) / len(scores), 2)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _error_result(filename: str, provider: str, exc: Exception) -> dict:
    return {
        "filename": filename,
        "text": "",
        "confidence": 0,
        "provider": provider,
        "blocks": [],
        "error": str(exc),
    }
