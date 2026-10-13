"""No paid services: adapter HTTP and MCP session boundaries are mocked."""
import asyncio
import base64
import json
import os
import socket
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import integrations as api

PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=="


@pytest.fixture
def client(tmp_path):
    app = FastAPI()
    app.state.integration_store = api.ConfigStore(tmp_path / "config")
    app.state.assets_dir = tmp_path / "assets"
    app.include_router(api.router)
    with TestClient(app) as value:
        yield value


def provider(**overrides):
    return {"id": "local-ai", "name": "Local AI", "kind": "openai", "base_url": "http://localhost:1234/v1", "api_key": "private-key-do-not-echo", "model": "example-model", "capability": "text", **overrides}


def project():
    return {"id": "project1", "name": "Test", "version": 1, "nodes": [{"id": "noise1", "type": "noise", "position": {"x": 0, "y": 0}, "data": {"label": "噪声", "params": {}}}], "edges": [], "settings": {}}


def test_credentials_private_and_preserved(client):
    result = client.post("/api/providers", json=provider())
    assert result.status_code == 200
    assert result.json()["has_api_key"] is True
    assert "private-key" not in result.text
    assert "api_key" not in result.json()
    path = client.app.state.integration_store.directory / "providers.json"
    assert os.stat(path).st_mode & 0o777 == 0o600
    assert os.stat(path.parent).st_mode & 0o777 == 0o700
    assert json.loads(path.read_text())[0]["api_key"] == provider()["api_key"]
    change = provider(name="Renamed")
    del change["api_key"]
    assert client.post("/api/providers", json=change).status_code == 200
    assert json.loads(path.read_text())[0]["api_key"] == provider()["api_key"]
    assert "private-key" not in client.get("/api/providers").text


def test_missing_provider_and_invalid_address(client):
    response = client.post("/api/ai/generate", json={"provider_id": "missing", "capability": "image", "prompt": "a tree"})
    assert response.status_code == 404
    assert "配置" in response.json()["detail"]
    assert client.post("/api/providers", json=provider(base_url="https://user:password@example.com/v1")).status_code == 422
    assert client.post("/api/providers", json=provider(path="//elsewhere.test/generate")).status_code == 422


def mock_http(monkeypatch, handler):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(api.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))


def test_openai_text_request_and_secret_redaction(client, monkeypatch):
    client.post("/api/providers", json=provider())
    def handler(request):
        assert str(request.url) == "http://localhost:1234/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer private-key-do-not-echo"
        body = json.loads(request.content)
        assert body["messages"] == [{"role": "user", "content": "hello"}]
        assert body["stream"] is False
        return httpx.Response(200, json={"choices": [{"message": {"content": "hello private-key-do-not-echo"}}], "api_key": "private-key-do-not-echo"})
    mock_http(monkeypatch, handler)
    response = client.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": "text", "prompt": "hello"})
    assert response.status_code == 200
    assert response.json()["text"] == "hello [redacted]"
    assert "private-key" not in response.text


def test_openai_image_base64(client, monkeypatch):
    client.post("/api/providers", json=provider(capability="image"))
    def handler(request):
        assert request.url.path == "/v1/images/generations"
        assert json.loads(request.content)["prompt"] == "tree"
        return httpx.Response(200, json={"data": [{"b64_json": PNG_B64}]})
    mock_http(monkeypatch, handler)
    response = client.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": "image", "prompt": "tree"})
    assert response.status_code == 200, response.text
    url = response.json()["url"]
    assert url.startswith("/api/assets/") and url.endswith(".png")
    assert (client.app.state.assets_dir / url.split("/")[-1]).read_bytes() == base64.b64decode(PNG_B64)
    assert response.json()["data"] == {"data": [{"url": url}]}
    assert PNG_B64 not in response.text


@pytest.mark.parametrize("capability,mime,content,suffix", [
    ("image", "image/png", base64.b64decode(PNG_B64), ".png"),
    ("music", "audio/wav", b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + b"\0" * 32, ".wav"),
    ("3d", "model/gltf-binary", b"glTF" + (2).to_bytes(4, "little") + (12).to_bytes(4, "little"), ".glb"),
])
def test_generated_data_url_is_persisted_locally(client, monkeypatch, capability, mime, content, suffix):
    client.post("/api/providers", json=provider(kind="http", capability=capability))
    encoded = base64.b64encode(content).decode()
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={"output": f"data:{mime};base64,{encoded}"}))
    response = client.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": capability, "prompt": "create asset"})
    assert response.status_code == 200, response.text
    url = response.json()["url"]
    assert url.startswith("/api/assets/") and url.endswith(suffix)
    assert (client.app.state.assets_dir / url.split("/")[-1]).read_bytes() == content
    assert encoded not in response.text


def test_generated_media_rejects_bad_magic_size_and_cleans_partial_writes(tmp_path, monkeypatch):
    with pytest.raises(api.HTTPException) as invalid:
        api.persist_returned_media({"b64_json": base64.b64encode(b"<html>not an image</html>").decode()}, "image", {}, tmp_path)
    assert invalid.value.status_code == 502
    with pytest.raises(api.HTTPException):
        api.persist_returned_media({"data": [{"b64_json": PNG_B64}, {"b64_json": "!not-base64"}]}, "image", {}, tmp_path)
    assert list(tmp_path.iterdir()) == []
    monkeypatch.setattr(api, "MAX_GENERATED_ASSET_BYTES", 16)
    with pytest.raises(api.HTTPException) as oversized:
        api.persist_returned_media({"b64_json": PNG_B64}, "image", {}, tmp_path)
    assert oversized.value.status_code == 413


def test_full_app_serves_generated_asset_from_configured_store(tmp_path, monkeypatch):
    from backend.main import create_app
    app = create_app(tmp_path)
    app.state.integration_store = api.ConfigStore(tmp_path / "config")
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={"data": [{"b64_json": PNG_B64}]}))
    with TestClient(app) as browser:
        assert browser.post("/api/providers", json=provider(capability="image")).status_code == 200
        result = browser.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": "image", "prompt": "one pixel"})
        assert result.status_code == 200
        image = browser.get(result.json()["url"])
        assert image.status_code == 200
        assert image.headers["content-type"].startswith("image/png")
        assert image.content == base64.b64decode(PNG_B64)


def test_generic_music_template_and_async_result(client, monkeypatch):
    client.post("/api/providers", json=provider(kind="http", capability="music", path="/music", body_template={"input": {"prompt": "{{prompt}}"}, "options": "{{parameters}}"}))
    def handler(request):
        assert request.url.path == "/v1/music"
        assert json.loads(request.content) == {"input": {"prompt": "ambient"}, "options": {"duration": 8}}
        return httpx.Response(200, json={"task_id": "job-1"})
    mock_http(monkeypatch, handler)
    response = client.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": "music", "prompt": "ambient", "parameters": {"duration": 8}})
    assert response.status_code == 200
    assert response.json()["status"] == "submitted"
    assert "url" not in response.json()


def test_remote_error_does_not_echo_secrets(client, monkeypatch):
    client.post("/api/providers", json=provider())
    mock_http(monkeypatch, lambda request: httpx.Response(401, json={"error": "private-key-do-not-echo"}))
    response = client.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": "text", "prompt": "hello"})
    assert response.status_code == 502
    assert "401" in response.text
    assert "private-key" not in response.text


@pytest.mark.parametrize("capability,response,expected", [
    ("music", {"data": {"audioUrl": "https://assets.example/song.mp3"}}, "https://assets.example/song.mp3"),
    ("music", {"output": ["https://assets.example/song.wav"]}, "https://assets.example/song.wav"),
    ("3d", {"model_urls": {"glb": "https://assets.example/model.glb"}, "thumbnail_url": "https://assets.example/preview.png"}, "https://assets.example/model.glb"),
    ("3d", {"data": {"result": {"model_url": "https://assets.example/model.glb"}}}, "https://assets.example/model.glb"),
    ("image", {"images": [{"url": "/images/result.png"}]}, "http://localhost:1234/images/result.png"),
])
def test_generic_nested_media_formats(client, monkeypatch, capability, response, expected):
    client.post("/api/providers", json=provider(kind="http", capability=capability))
    mock_http(monkeypatch, lambda request: httpx.Response(200, json=response))
    result = client.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": capability, "prompt": "create an asset"})
    assert result.status_code == 200
    assert result.json()["url"] == expected


@pytest.mark.parametrize("response", [{"error": {"message": "private-key-do-not-echo"}}, {"data": {"status": "FAILED"}}])
def test_http_200_generation_errors_are_not_reported_as_submitted(client, monkeypatch, response):
    client.post("/api/providers", json=provider(kind="http", capability="music"))
    mock_http(monkeypatch, lambda request: httpx.Response(200, json=response))
    result = client.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": "music", "prompt": "create music"})
    assert result.status_code == 502
    assert "private-key" not in result.text


def test_unrecognized_response_is_not_a_fake_task(client, monkeypatch):
    client.post("/api/providers", json=provider(kind="http", capability="3d"))
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={"unexpected": "response"}))
    result = client.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": "3d", "prompt": "create model"})
    assert result.status_code == 200
    assert result.json()["status"] == "unrecognized"


def test_malformed_text_response_returns_clear_error(client, monkeypatch):
    client.post("/api/providers", json=provider())
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={"choices": [{"message": None}]}))
    result = client.post("/api/ai/generate", json={"provider_id": "local-ai", "capability": "text", "prompt": "hello"})
    assert result.status_code == 502


def test_untrusted_media_url_is_not_exposed_as_link():
    assert api.media_urls({"url": "javascript:alert(1)"}, "image", "https://example.test") == []
    assert api.media_urls({"url": "http://[invalid"}, "image", "https://example.test") == []


def test_nested_text_response():
    response = {"output": [{"content": [{"type": "output_text", "text": "A creative idea"}]}]}
    assert api.text_from_response(response) == "A creative idea"


@pytest.mark.parametrize("message,op,key,value", [
    ("添加噪声", "add_node", "type", "noise"),
    ("add particles", "add_node", "type", "particles"),
    ("改成蓝色", "set_param", "key", "color2"),
    ("速度调为0.5", "set_param", "value", 0.5),
    ("删除所选节点", "remove_node", "id", "noise1"),
])
def test_local_chat(client, message, op, key, value):
    document = project()
    if "蓝色" in message:
        document["nodes"][0]["type"] = "ramp"
    response = client.post("/api/chat", json={"message": message, "project": document, "selected_node": "noise1"})
    assert response.status_code == 200
    assert response.json()["mode"] == "local"
    command = response.json()["commands"][0]
    assert command["op"] == op
    assert command[key] == value


def test_ai_chat_validated_graph_commands(client, monkeypatch):
    client.post("/api/providers", json=provider())
    command = {"op": "set_param", "id": "noise1", "key": "speed", "value": 0.25}
    def handler(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"reply": "Ready", "commands": [command]})}}]})
    mock_http(monkeypatch, handler)
    response = client.post("/api/chat", json={"provider_id": "local-ai", "message": "slower", "project": project()})
    assert response.status_code == 200
    assert response.json()["commands"] == [command]
    assert response.json()["mode"] == "ai"
    assert project()["nodes"][0]["data"]["params"] == {}


def test_generated_code_and_invalid_graph_are_rejected():
    with pytest.raises(api.HTTPException):
        api.validate_chat_commands([{"op": "exec", "code": "print(1)"}], project())
    with pytest.raises(api.HTTPException):
        api.validate_chat_commands([{"op": "set_param", "id": "missing", "key": "speed", "value": 1}], project())


@pytest.mark.parametrize("command", [{"op": []}, {"op": "add_node", "type": []}, {"op": "set_param", "id": [], "key": "speed", "value": 1}])
def test_malformed_ai_command_returns_clear_error(command):
    with pytest.raises(api.HTTPException) as error:
        api.validate_chat_commands([command], project())
    assert error.value.status_code == 502


def test_malformed_project_returns_validation_error(client):
    result = client.post("/api/chat", json={"message": "add noise", "project": {"id": "test", "name": "Test", "nodes": [None]}})
    assert result.status_code == 422


def test_local_color_adjustment_finds_downstream_color(client):
    document = project()
    document["nodes"].append({"id": "color1", "type": "color", "data": {"params": {}}})
    response = client.post("/api/chat", json={"message": "改成蓝色", "project": document, "selected_node": "noise1"})
    assert response.json()["commands"] == [{"op": "set_param", "id": "color1", "key": "hue", "value": 80}]
    assert "实际颜色取决于输入画面" in response.json()["reply"]


def test_mcp_lifecycle_and_allowed_tools(client, monkeypatch):
    import mcp
    import mcp.client.streamable_http as transport
    events = []
    class Dumpable:
        def __init__(self, data):
            self.data = data
        def model_dump(self, **kwargs):
            return self.data
    @asynccontextmanager
    async def connection(url, **kwargs):
        assert url == "http://localhost:9000/mcp"
        assert kwargs["http_client"].headers["Authorization"] == "Bearer mcp-private"
        events.append("connect")
        try:
            yield object(), object(), lambda: "session"
        finally:
            events.append("close")
    class Session:
        def __init__(self, *args):
            pass
        async def __aenter__(self):
            events.append("session")
            return self
        async def __aexit__(self, *args):
            events.append("exit")
        async def initialize(self):
            events.append("initialize")
        async def list_tools(self):
            return SimpleNamespace(tools=[Dumpable({"name": "echo", "inputSchema": {"type": "object"}})])
        async def call_tool(self, name, arguments):
            events.append("call")
            return Dumpable({"content": [{"type": "text", "text": arguments["text"] + " mcp-private"}], "isError": False})
    monkeypatch.setattr(transport, "streamable_http_client", connection)
    monkeypatch.setattr(mcp, "ClientSession", Session)
    saved = client.post("/api/mcp/servers", json={"id": "demo", "name": "Demo", "url": "http://localhost:9000/mcp", "token": "mcp-private", "allowed_tools": ["echo"]})
    assert saved.status_code == 200
    assert "mcp-private" not in saved.text
    assert client.post("/api/mcp/servers/demo/tools").json()["tools"][0]["name"] == "echo"
    events.clear()
    result = client.post("/api/mcp/call", json={"server_id": "demo", "name": "echo", "arguments": {"text": "Hi"}})
    assert result.status_code == 200
    assert result.json()["content"][0]["text"] == "Hi [redacted]"
    assert events == ["connect", "session", "initialize", "call", "exit", "close"]
    assert client.post("/api/mcp/call", json={"server_id": "demo", "name": "danger", "arguments": {}}).status_code == 403


def test_mcp_graph_server_preview_and_apply(monkeypatch):
    from backend import mcp_server
    writes = []
    async def request(method, path, payload=None):
        if method == "GET":
            return project()
        writes.append(payload)
        return payload
    monkeypatch.setattr(mcp_server, "app_request", request)
    command = {"op": "set_param", "id": "noise1", "key": "speed", "value": 0.25}
    preview = asyncio.run(mcp_server.apply_graph_commands("project1", [command]))
    assert preview["applied"] is False
    assert writes == []
    result = asyncio.run(mcp_server.apply_graph_commands("project1", [command], apply=True))
    assert result["applied"] is True
    assert writes[0]["nodes"][0]["data"]["params"]["speed"] == 0.25


def test_actual_stdio_server_handshake_and_tool_discovery():
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    async def check():
        params = StdioServerParameters(command=sys.executable, args=["-m", "backend.mcp_server"], cwd=str(api.ROOT))
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                initialized = await session.initialize()
                assert initialized.serverInfo.name == "TD Open"
                listing = await session.list_tools()
                assert {tool.name for tool in listing.tools} == {"list_projects", "get_project", "list_operators", "apply_graph_commands", "get_local_model_status", "run_local_model", "get_local_model_job", "cancel_local_model_job"}
    asyncio.run(asyncio.wait_for(check(), timeout=20))


@pytest.fixture
def loopback_mcp():
    """A real SDK HTTP server on loopback, no third-party service or credentials."""
    import uvicorn
    from mcp.server.fastmcp import FastMCP
    from starlette.responses import JSONResponse

    sdk = FastMCP("TD Open integration fixture", json_response=True)
    events = []

    @sdk.tool()
    async def echo(message: str) -> dict[str, str]:
        return {"message": message}

    @sdk.tool()
    async def fail() -> str:
        raise ValueError("Expected fixture tool error")

    sdk_app = sdk.streamable_http_app()

    async def authenticated_app(scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope["headers"])
            if headers.get(b"authorization") != b"Bearer loopback-test-token":
                return await JSONResponse({"error": "Unauthorized"}, status_code=401)(scope, receive, send)
            events.append((scope["method"], headers.get(b"mcp-session-id")))
        await sdk_app(scope, receive, send)

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    # Prefer 8766 for manual reproducibility; never disturb an existing service.
    try:
        listener.bind(("127.0.0.1", 8766))
    except OSError:
        listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    config = uvicorn.Config(authenticated_app, host="127.0.0.1", port=port, log_level="error", access_log=False)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=lambda: asyncio.run(server.serve(sockets=[listener])), daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    try:
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started, "Loopback MCP fixture did not start"
        yield f"http://127.0.0.1:{port}/mcp", events
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
        assert not thread.is_alive(), "Loopback MCP fixture did not shut down"


def test_real_streamable_http_discovery_call_error_and_cleanup(client, loopback_mcp):
    url, events = loopback_mcp
    config = {"id": "loopback", "name": "Loopback MCP", "url": url, "token": "loopback-test-token"}
    assert client.post("/api/mcp/servers", json=config).status_code == 200
    listing = client.post("/api/mcp/servers/loopback/tools")
    assert listing.status_code == 200, listing.text
    assert {tool["name"] for tool in listing.json()["tools"]} == {"echo", "fail"}
    result = client.post("/api/mcp/call", json={"server_id": "loopback", "name": "echo", "arguments": {"message": "Hello real MCP"}})
    assert result.status_code == 200, result.text
    assert result.json()["isError"] is False
    assert result.json()["structuredContent"] == {"message": "Hello real MCP"}
    missing = client.post("/api/mcp/call", json={"server_id": "loopback", "name": "missing", "arguments": {}})
    assert missing.status_code == 404, missing.text
    failed = client.post("/api/mcp/call", json={"server_id": "loopback", "name": "fail", "arguments": {}})
    assert failed.status_code == 200, failed.text
    assert failed.json()["isError"] is True
    # Four independent initialized sessions must all be terminated with DELETE.
    terminated = [session for method, session in events if method == "DELETE"]
    assert len(terminated) == 4
    assert len(set(terminated)) == 4
