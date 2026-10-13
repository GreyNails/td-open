"""Tutorial connection files must exercise the real adapter and asset API."""
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient

from backend import integrations
from backend.main import create_app

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples/api"
spec = importlib.util.spec_from_file_location("tutorial_provider", EXAMPLES / "mock_provider.py")
fixture_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_module)


@pytest.mark.parametrize("capability,magic", [("text", None), ("image", b"\x89PNG"), ("music", b"RIFF"), ("3d", b"glTF")])
def test_documented_connections_produce_readable_assets(tmp_path, monkeypatch, capability, magic):
    async def fixture_post(url, body, api_key):
        assert urlsplit(url).netloc == "127.0.0.1:9010"
        assert api_key is None
        with TestClient(fixture_module.app) as provider:
            result = provider.post(urlsplit(url).path, json=body)
            result.raise_for_status()
            return result.json()
    monkeypatch.setattr(integrations, "post_json", fixture_post)
    with TestClient(create_app(tmp_path)) as client:
        config = json.loads((EXAMPLES / f"demo-{capability}.provider.json").read_text())
        saved = client.post("/api/providers", json=config)
        assert saved.status_code == 200, saved.text
        result = client.post("/api/ai/generate", json={"provider_id": config["id"], "capability": capability, "prompt": "文档连接演练"})
        assert result.status_code == 200, result.text
        data = result.json()
        assert data["data"]["demo"] is True
        if magic:
            media = client.get(data["url"])
            assert media.status_code == 200
            assert media.content.startswith(magic)
            assert len(media.content) > 64
            assert (client.app.state.store.assets_dir / data["url"].rsplit("/", 1)[1]).is_file()
        else:
            assert "非 AI 生成" in data["text"] and "文档连接演练" in data["text"]
