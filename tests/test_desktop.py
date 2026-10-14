"""Desktop isolation, lifecycle and portability regression checks."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.local_ai import manager
from backend.paths import RESOURCE_ROOT


def test_private_desktop_apis_require_session_for_http_and_websocket(tmp_path, monkeypatch):
    monkeypatch.setenv("TD_DESKTOP_TOKEN", "desktop-test-token")
    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/api/projects").status_code == 403
        assert client.get("/api/providers").status_code == 403
        assert client.get("/api/health", headers={"x-td-desktop-token": "desktop-test-token"}).status_code == 200
        from starlette.websockets import WebSocketDisconnect
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/api/io/bridge/test/ws"):
                pass
        # Opaque media URLs remain available to isolated HTML-render nodes.
        assert client.get("/api/assets/missing.png").status_code == 404


def test_owned_backend_uses_writable_workspace_preserves_examples_and_exits(tmp_path):
    workspace = tmp_path / "用户工作区 with spaces"
    workspace.mkdir()
    env = {**os.environ, "TD_WORKSPACE_DIR": str(workspace), "TD_DATA_DIR": "data",
           "TD_LOCAL_AI_DIR": "data/local-ai", "TD_DESKTOP_TOKEN": "owned-test-token",
           "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1"}
    process = subprocess.Popen([sys.executable, "-m", "backend.desktop"], cwd=RESOURCE_ROOT,
        env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    lines = queue.Queue()
    threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
    try:
        line = lines.get(timeout=30)
        assert line, process.stderr.read() if process.poll() is not None else "No startup handshake"
        ready = json.loads(line)
        assert ready["event"] == "ready" and ready["pid"] == process.pid
        assert (workspace / ".desktop-port").read_text() == str(ready["port"])
        with httpx.Client(base_url=f"http://127.0.0.1:{ready['port']}", headers={"x-td-desktop-token": "owned-test-token"}, trust_env=False) as client:
            assert Path(client.get("/api/health").json()["data_dir"]) == workspace / "data"
            examples = client.get("/api/examples").json()
            assert len(examples) >= 90
            original = client.get("/api/examples/example_flow").json()
            saved = client.post("/api/projects", json={**original, "name": "桌面作品"}).json()
            assert saved["id"] != original["id"]
            assert (workspace / "data/projects" / (saved["id"] + ".json")).is_file()
            intent = client.post("/api/scripts/intent", json={}).json()["token"]
            result = client.post("/api/scripts/run", json={"code": "def cook(inputs, time):\n    return {'中文': 42}", "inputs": {}, "time": 0}, headers={"x-td-script-intent": intent})
            assert result.status_code == 200, result.text
            assert result.json()["value"] == {"中文": 42}
            assert client.get("/api/examples/example_flow").json() == original
        import asyncio
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        async def check_mcp():
            parameters = StdioServerParameters(command=sys.executable, args=[str(RESOURCE_ROOT / "backend/desktop_mcp.py"), "--session", str(workspace / ".desktop-session.json")])
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    assert "list_operators" in [tool.name for tool in tools.tools]
                    projects = await session.call_tool("list_projects", {})
                    assert not projects.isError and saved["id"] in str(projects.content)
        asyncio.run(check_mcp())
        process.stdin.close()  # Simulates a parent crash as well as a normal quit.
        process.wait(timeout=20)
        assert process.returncode == 0
        assert not (workspace / ".desktop-session.json").exists()
    finally:
        if process.poll() is None: process.kill(); process.wait(timeout=5)


def test_apple_silicon_uses_mps_environment_instead_of_cuda(monkeypatch):
    monkeypatch.setattr(manager.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(manager.platform, "machine", lambda: "arm64")
    monkeypatch.setattr(manager.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 1, "", ""))
    hw = manager.hardware()
    assert hw["accelerator"] == "mps" and hw["automatic_install_supported"]
    monkeypatch.setattr(manager.platform, "machine", lambda: "x86_64")
    assert not manager.hardware()["automatic_install_supported"]


@pytest.mark.parametrize("entry", ["../../outside.py", "repo/../../outside.py"])
def test_runtime_source_download_rejects_escaping_paths(tmp_path, monkeypatch, entry):
    import io
    import zipfile
    from backend.local_ai import repositories
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped: zipped.writestr(entry, "unsafe")
    def respond(request): return httpx.Response(200, content=archive.getvalue())
    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(repositories.httpx, "Client", lambda **kwargs: client)
    with pytest.raises(ValueError, match="Unsafe"):
        repositories.install_repository("https://github.com/Comfy-Org/ComfyUI.git", "a" * 40, tmp_path / "runtime", lambda: False)
    assert not (tmp_path / "runtime").exists()


def test_runtime_source_install_retains_license_and_is_reusable(tmp_path, monkeypatch):
    import io
    import zipfile
    from backend.local_ai import repositories
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr("repo/LICENSE", "original license")
        zipped.writestr("repo/main.py", "print('runtime')")
    requests = []
    def respond(request):
        requests.append(str(request.url))
        return httpx.Response(200, content=archive.getvalue())
    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(repositories.httpx, "Client", lambda **kwargs: client)
    destination = tmp_path / "runtime"
    for _ in range(2): repositories.install_repository("https://github.com/Comfy-Org/ComfyUI.git", "a" * 40, destination, lambda: False)
    assert len(requests) == 1 and "/Comfy-Org/ComfyUI/zip/" in requests[0]
    assert (destination / "LICENSE").read_text() == "original license"
