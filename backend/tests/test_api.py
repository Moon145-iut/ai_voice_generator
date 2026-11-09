"""Backend smoke tests that do not require downloading model weights."""
from unittest.mock import patch
import numpy as np
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json()["inference"] == "local"


def test_catalog():
    result = client.get("/api/catalog")
    assert result.status_code == 200
    assert any(v["id"] == "af_sarah" for v in result.json()["voices"])


def test_validation():
    assert client.post("/api/generate", data={"mode": "preset", "text": ""}).status_code == 422
    assert client.post("/api/generate", data={"mode": "clone", "text": "Hello"}).status_code == 422


def test_audio_response():
    with patch("app.main.generate_preset", return_value=(np.zeros(2400), 24000)):
        result = client.post("/api/generate", data={"mode": "preset", "text": "Hello"})
    assert result.status_code == 200
    assert result.headers["content-type"].startswith("audio/wav")
    assert result.content[:4] == b"RIFF"
