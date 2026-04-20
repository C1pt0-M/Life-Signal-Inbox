import pytest

from app.ai_extractor import clear_runtime_ai_config


@pytest.fixture(autouse=True)
def isolate_ai_config(monkeypatch):
    clear_runtime_ai_config()
    for name in [
        "LIFE_SIGNAL_AI_PROVIDER",
        "LIFE_SIGNAL_AI_API_KEY",
        "LIFE_SIGNAL_AI_MODEL",
        "LIFE_SIGNAL_AI_BASE_URL",
        "OPENAI_API_KEY",
    ]:
        monkeypatch.delenv(name, raising=False)
    yield
    clear_runtime_ai_config()
